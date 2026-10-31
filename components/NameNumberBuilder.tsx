"use client";
import { useEffect, useMemo, useState } from "react";
import { FONTS, UNITS_PER_IN, type RosterRow } from "@/lib/designerArt";
import { fileTable, parseRoster, rosterSvg, ROSTER_DEFAULT, svgPng, textTable, type RosterShow, type RosterSpec } from "@/lib/rosterArt";
import { loadFont } from "@/lib/webfonts";
import { useSticky } from "@/lib/useSticky";
import type { DesignerOut } from "@/components/ShirtDesigner";

/**
 * The Name & number builder in the Mockup Creator (Oct 31, Nick: "a simple name and number builder on the right-hand
 * side… upload a spreadsheet… names and then numbers… take the very first name… put it on, like, the back… select the
 * fonts, same thing you have from the design builder… that goes to the customer for approval… sometimes it's name only,
 * sometimes it's number only").
 *
 * The list (a spreadsheet, or typed), what prints (names and numbers, names only, numbers only), where, the font, color
 * and heights. "Put it on the shirt" makes the first shirt's name and number as the print's art (the same save the Design
 * Lab uses) and keeps the list and the look on the print (Imprint.roster), for the gang sheet once it's approved.
 */
const INKS: [string, string][] = [["White", "#FFFFFF"], ["Black", "#111111"], ["Red", "#C8102E"], ["Navy", "#1B2A4A"], ["Royal", "#1F4AA8"], ["Kelly Green", "#00843D"], ["Forest Green", "#1E4D2B"], ["Maroon", "#6D2433"], ["Orange", "#E35205"], ["Gold", "#F2A900"], ["Purple", "#4B2E83"], ["Gray", "#8A8D8F"]];
const light = (h: string) => { const v = parseInt((h || "#000").replace("#", "").padEnd(6, "0").slice(0, 6), 16); return 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255) > 150; };
const SPOTS = ["Full Back", "Upper Back", "Back Neck", "Full Front", "Left Chest", "Right Chest", "Left Sleeve", "Right Sleeve"];

export default function NameNumberBuilder({ pieces, start, onPlace }: {
  /** the pieces on the order (to check the list against) */ pieces?: number;
  /** the print's names & numbers when it has them (to change them) */ start?: RosterSpec | null;
  onPlace: (out: DesignerOut, spec: RosterSpec) => Promise<string | void>;
}) {
  const [open, setOpen] = useSticky<boolean>("mk.names", false);
  const [rows, setRows] = useState<RosterRow[]>(start?.rows || []);
  const [look, setLook] = useState(() => ({ ...ROSTER_DEFAULT, ...(start || {}) }));
  const [where, setWhere] = useState(start?.location || "Full Back");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const [pv, setPv] = useState("");
  useEffect(() => { if (start) { setRows(start.rows); setLook({ ...ROSTER_DEFAULT, ...start }); setWhere(start.location); } }, [start?.rows.length, start?.font]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = rows[0] || { name: "SMITH", number: "23", size: "" };
  // the first shirt, drawn live
  const key = JSON.stringify([look, first]);
  useEffect(() => {
    if (!open) return;
    let on = true;
    void rosterSvg(look, first, look.show).then(({ svg }) => { if (on) setPv(svg); });
    return () => { on = false; };
  }, [key, open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) FONTS.forEach((f) => void loadFont(f.name, f.weight)); }, [open]);
  const set = (p: Partial<typeof look>) => setLook((x) => ({ ...x, ...p }));
  const sizes = useMemo(() => { const m = new Map<string, number>(); for (const r of rows) if (r.size) m.set(r.size, (m.get(r.size) || 0) + 1); return [...m.entries()]; }, [rows]);

  async function readFile(f: File | null) {
    if (!f) return;
    setMsg("");
    try {
      const r = parseRoster(await fileTable(f));
      if (!r.length) { setMsg("No names or numbers found in that file. The first row can name the columns: Name, Number, Size."); return; }
      setRows(r); setMsg(`${r.length} shirt${r.length === 1 ? "" : "s"} from ${f.name}`);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't read that file."); }
  }
  function addPasted() {
    const r = parseRoster(textTable(paste));
    if (!r.length) return;
    setRows((x) => [...x, ...r]); setPaste("");
  }
  async function place() {
    if (!rows.length) { setMsg("Add the list first: upload a spreadsheet or type the names and numbers."); return; }
    setBusy(true); setMsg("");
    try {
      const spec: RosterSpec = { ...look, rows, location: where };
      const { svg, w, h } = await rosterSvg(spec, rows[0], spec.show, true);
      const png = await svgPng(svg, w / UNITS_PER_IN, h / UNITS_PER_IN, 300, 2400);
      const pngBlob: Blob = await new Promise((res, rej) => png.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make the picture."))), "image/png"));
      const label = spec.show === "name" ? "Names" : spec.show === "number" ? "Numbers" : "Names & numbers";
      // on the Design Lab's 12" × 14" sheet, centered, its top about 3" under the collar
      const box = { x: Math.round(300 - w / 2), y: -50, w: Math.round(w), h: Math.round(h) };
      const out: DesignerOut = {
        svg: new File([svg], `${label.replace(/[^\w]+/g, "-")}.svg`, { type: "image/svg+xml" }),
        png: new File([pngBlob], `${label.replace(/[^\w]+/g, "-")}.png`, { type: "image/png" }),
        doc: { v: 1, w: 600, h: 700, layers: [], roster: rows },
        roster: rows, box, name: `${label} · ${where}`,
        colors: look.outline ? 2 : 1, inks: [INKS.find(([, x]) => x.toLowerCase() === look.color.toLowerCase())?.[0] || look.color, look.outline ? INKS.find(([, x]) => x.toLowerCase() === look.outline!.toLowerCase())?.[0] || look.outline : ""].filter(Boolean).join(", "),
      };
      const err = await onPlace(out, spec);
      if (err) setMsg(err); else setMsg(`On the ${where}: the first shirt (${[rows[0].name, rows[0].number].filter(Boolean).join(" ")}) for approval; all ${rows.length} go on the gang sheet.`);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't put it on the shirt."); }
    setBusy(false);
  }

  return (
    <section className="panel nnb">
      <button type="button" className="panel-h nnb-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        <h2>Name &amp; number builder</h2><span className="faint">{rows.length ? `${rows.length} shirt${rows.length === 1 ? "" : "s"}` : "Names, numbers, or both"}</span>
        <svg className="nnb-car" viewBox="0 0 12 12" aria-hidden="true"><path d={open ? "M2.5 7.5 6 4l3.5 3.5" : "M2.5 4.5 6 8l3.5-3.5"} /></svg>
      </button>
      {open && (
        <div className="panel-b nnb-b">
          <div className="nnb-row">
            <label className="btn sm nnb-up">Upload a spreadsheet<input type="file" hidden accept=".xlsx,.xlsm,.csv,.tsv,.txt" onChange={(e) => { void readFile(e.target.files?.[0] || null); e.target.value = ""; }} /></label>
            <span className="faint">Name, Number, Size columns (.xlsx or .csv)</span>
          </div>
          <div className="field"><label htmlFor="nnb-p">Or type them, one shirt a line</label>
            <textarea id="nnb-p" rows={2} placeholder={"SMITH, 23, L\nJONES, 7, M"} value={paste} onChange={(e) => setPaste(e.target.value)} /></div>
          {paste.trim() && <button type="button" className="btn sm" onClick={addPasted}>Add to the list</button>}
          {rows.length > 0 && (
            <div className="nnb-list">
              <div className="nnb-lh"><b>{rows.length} shirt{rows.length === 1 ? "" : "s"}</b>{sizes.length ? <span className="faint"> · {sizes.map(([z, n]) => `${z} ${n}`).join(", ")}</span> : null}{pieces && pieces !== rows.length ? <span className="nnb-warn"> · the order has {pieces} pieces</span> : null}
                <button type="button" className="linkbtn" onClick={() => setRows([])}>Clear</button></div>
              <div className="nnb-rows">{rows.map((r, i) => (
                <div key={i} className="nnb-r">
                  <input aria-label="Name" value={r.name} placeholder="Name" onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
                  <input aria-label="Number" className="nnb-n" value={r.number} placeholder="#" onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, number: e.target.value } : y)))} />
                  <input aria-label="Size" className="nnb-z" value={r.size} placeholder="Size" onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, size: e.target.value.toUpperCase() } : y)))} />
                  <button type="button" className="btn icon ghost sm" aria-label="Take this shirt off" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}</div>
            </div>
          )}
          <div className="toolbar nnb-what"><div className="chips" role="group" aria-label="What prints">
            {([["both", "Names & numbers"], ["name", "Names only"], ["number", "Numbers only"]] as [RosterShow, string][]).map(([k, l]) => <button key={k} type="button" className={"chip" + (look.show === k ? " on" : "")} onClick={() => set({ show: k })}>{l}</button>)}
          </div></div>
          <div className="nnb-grid">
            <div className="field"><label htmlFor="nnb-w">Where</label><select id="nnb-w" value={where} onChange={(e) => setWhere(e.target.value)}>{SPOTS.map((z) => <option key={z}>{z}</option>)}</select></div>
            <div className="field"><label htmlFor="nnb-f">Font</label><select id="nnb-f" value={look.font} style={{ fontFamily: `'${look.font}'` }} onChange={(e) => set({ font: e.target.value })}>{FONTS.map((f) => <option key={f.name} value={f.name} style={{ fontFamily: `'${f.name}'` }}>{f.name}</option>)}</select></div>
            {look.show !== "number" && <div className="field"><label htmlFor="nnb-nh">Letters (in. tall)</label><input id="nnb-nh" type="number" min={0.5} max={6} step={0.25} value={look.nameIn} onChange={(e) => set({ nameIn: Math.max(0.25, +e.target.value || 0) })} /></div>}
            {look.show !== "name" && <div className="field"><label htmlFor="nnb-mh">Numbers (in. tall)</label><input id="nnb-mh" type="number" min={1} max={14} step={0.5} value={look.numIn} onChange={(e) => set({ numIn: Math.max(0.5, +e.target.value || 0) })} /></div>}
          </div>
          <div className="nnb-inks"><span className="nnb-k">Color</span>{INKS.map(([n, h]) => <button key={n} type="button" title={n} aria-label={n} className={"nnb-ink" + (look.color.toLowerCase() === h.toLowerCase() ? " on" : "")} style={{ background: h }} onClick={() => set({ color: h })} />)}</div>
          <div className="nnb-inks"><span className="nnb-k">Outline</span><button type="button" className={"nnb-ink none" + (!look.outline ? " on" : "")} title="None" aria-label="No outline" onClick={() => set({ outline: "" })}>×</button>{INKS.map(([n, h]) => <button key={n} type="button" title={n} aria-label={`${n} outline`} className={"nnb-ink" + ((look.outline || "").toLowerCase() === h.toLowerCase() ? " on" : "")} style={{ background: h }} onClick={() => set({ outline: h })} />)}</div>
          <div className={"nnb-pv" + (light(look.color) ? " dk" : "")} aria-label="The first shirt" dangerouslySetInnerHTML={{ __html: pv }} />
          {msg && <p className="faint nnb-msg">{msg}</p>}
          <button type="button" className="btn primary sm" disabled={busy} onClick={() => void place()}>{busy ? "Putting it on…" : start ? "Update the shirt" : `Put it on the ${where.toLowerCase()}`}</button>
        </div>
      )}
    </section>
  );
}
