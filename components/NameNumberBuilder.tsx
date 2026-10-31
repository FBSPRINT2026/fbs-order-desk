"use client";
import { useEffect, useMemo, useState } from "react";
import { FONTS, UNITS_PER_IN } from "@/lib/designerArt";
import { fileTable, parseRoster, rosterSvg, ROSTER_DEFAULT, svgPng, textTable, type RosterShow, type RosterSpec } from "@/lib/rosterArt";
import { loadFont } from "@/lib/webfonts";
import { useSticky } from "@/lib/useSticky";
import type { DesignerOut } from "@/components/ShirtDesigner";

/**
 * The Name & number builder: a small pop-up opened from the Mockup Creator's Imprints panel (Oct 31, Nick: "this needs
 * to be a small window because we're just basically putting one name and one number on there and then you're going to
 * make it later… open name and number builder, and this whole thing pops up, and then you make the first one and say add
 * a shirt, and it brings it in under that location").
 *
 * The list is the box itself (typed, pasted or filled from a spreadsheet): what's in it counts, there's no separate "add"
 * step. What prints, where and the font sit on one row; color, outline and heights are under Edit details. "Add to the
 * shirt" makes the first shirt's name and number as the print's art (the same save the Design Lab uses) and keeps the
 * list and the look on the print (Imprint.roster) for the gang sheet once it's approved.
 */
const INKS: [string, string][] = [["White", "#FFFFFF"], ["Black", "#111111"], ["Red", "#C8102E"], ["Navy", "#1B2A4A"], ["Royal", "#1F4AA8"], ["Kelly Green", "#00843D"], ["Forest Green", "#1E4D2B"], ["Maroon", "#6D2433"], ["Orange", "#E35205"], ["Gold", "#F2A900"], ["Purple", "#4B2E83"], ["Gray", "#8A8D8F"]];
const SHOWS: [RosterShow, string][] = [["both", "Names & numbers"], ["name", "Names only"], ["number", "Numbers only"]];
const inkName = (h?: string) => (h ? INKS.find(([, x]) => x.toLowerCase() === h.toLowerCase())?.[0] || h : "");
/** the list as lines a person can read and change ("SMITH, 23, L") */
const asText = (rows: RosterSpec["rows"]) => rows.map((r) => [r.name, r.number, r.size].filter(Boolean).join(", ")).join("\n");

export default function NameNumberBuilder({ spots, start, pieces, bg, onPlace, onClose }: {
  /** the spots to pick from, back first (Full Back is picked unless the print already has a spot) */ spots: string[];
  /** the print's names & numbers when it has them (to change them) */ start?: RosterSpec | null;
  /** the pieces on the order (to check the list against) */ pieces?: number;
  /** the garment's color, behind the preview */ bg?: string;
  onPlace: (out: DesignerOut, spec: RosterSpec) => Promise<string | void>;
  onClose: () => void;
}) {
  const [look, setLook] = useState(() => ({ ...ROSTER_DEFAULT, ...(start || {}) }));
  const [where, setWhere] = useState(() => start?.location || spots.find((z) => /^full back/i.test(z)) || spots[0] || "Full Back");
  const [text, setText] = useState(() => asText(start?.rows || []));
  const [more, setMore] = useSticky<boolean>("mk.names.more", false);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const [pv, setPv] = useState("");
  const rows = useMemo(() => parseRoster(textTable(text)), [text]);
  const first = rows[0] || { name: "SMITH", number: "23", size: "" };
  const key = JSON.stringify([look, first]);
  useEffect(() => {
    let on = true;
    void rosterSvg(look, first, look.show).then(({ svg }) => { if (on) setPv(svg); });
    return () => { on = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { FONTS.forEach((f) => void loadFont(f.name, f.weight)); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [busy, onClose]);
  const set = (p: Partial<typeof look>) => setLook((x) => ({ ...x, ...p }));
  const sizes = useMemo(() => { const m = new Map<string, number>(); for (const r of rows) if (r.size) m.set(r.size, (m.get(r.size) || 0) + 1); return [...m.entries()]; }, [rows]);
  const spotList = spots.includes(where) ? spots : [where, ...spots];

  async function readFile(f: File | null) {
    if (!f) return;
    setMsg("");
    try {
      const r = parseRoster(await fileTable(f));
      if (!r.length) { setMsg("No names or numbers found in that file. The first row can name the columns: Name, Number, Size."); return; }
      setText(asText(r)); setMsg(`${r.length} shirt${r.length === 1 ? "" : "s"} from ${f.name}`);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't read that file."); }
  }
  async function place() {
    if (!rows.length) { setMsg("Type at least one name or number, or upload the spreadsheet."); return; }
    setBusy(true); setMsg("");
    try {
      const spec: RosterSpec = { ...look, rows, location: where };
      const { svg, w, h } = await rosterSvg(spec, rows[0], spec.show, true);
      const png = await svgPng(svg, w / UNITS_PER_IN, h / UNITS_PER_IN, 300, 2400);
      const pngBlob: Blob = await new Promise((res, rej) => png.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make the picture."))), "image/png"));
      const label = SHOWS.find(([k]) => k === spec.show)![1];
      const file = label.replace(/[^\w]+/g, "-");
      // on the Design Lab's 12" × 14" sheet, centered, its top about 3" under the collar
      const box = { x: Math.round(300 - w / 2), y: -50, w: Math.round(w), h: Math.round(h) };
      const out: DesignerOut = {
        svg: new File([svg], `${file}.svg`, { type: "image/svg+xml" }),
        png: new File([pngBlob], `${file}.png`, { type: "image/png" }),
        doc: { v: 1, w: 600, h: 700, layers: [], roster: rows },
        roster: rows, box, name: `${label} · ${where}`,
        colors: look.outline ? 2 : 1, inks: [inkName(look.color), inkName(look.outline)].filter(Boolean).join(", "),
      };
      const err = await onPlace(out, spec);
      if (err) { setMsg(err); setBusy(false); return; }
      onClose();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't put it on the shirt."); setBusy(false); }
  }

  return (
    <div className="mk-modal-back" role="dialog" aria-modal="true" aria-labelledby="nnb-t" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="mk-modal nnb">
        <div className="nnb-top">
          <h2 id="nnb-t">Names &amp; numbers</h2>
          <button type="button" className="btn icon ghost" aria-label="Close" onClick={onClose} disabled={busy}>✕</button>
        </div>
        <p className="faint nnb-lead">The first shirt goes on the mockup for approval. The whole list is made on the gang sheet once it&apos;s approved.</p>
        <div className="nnb-grid">
          <div className="field"><label htmlFor="nnb-s">Prints</label><select id="nnb-s" value={look.show} onChange={(e) => set({ show: e.target.value as RosterShow })}>{SHOWS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field"><label htmlFor="nnb-w">Where</label><select id="nnb-w" value={where} onChange={(e) => setWhere(e.target.value)}>{spotList.map((z) => <option key={z}>{z}</option>)}</select></div>
          <div className="field"><label htmlFor="nnb-f">Font</label><select id="nnb-f" value={look.font} style={{ fontFamily: `'${look.font}'` }} onChange={(e) => set({ font: e.target.value })}>{FONTS.map((f) => <option key={f.name} value={f.name} style={{ fontFamily: `'${f.name}'` }}>{f.name}</option>)}</select></div>
        </div>
        <div className="field nnb-list">
          <div className="nnb-lh">
            <label htmlFor="nnb-p">The list, one shirt a line</label>
            <label className="btn sm nnb-up">Upload a spreadsheet<input type="file" hidden accept=".xlsx,.xlsm,.csv,.tsv,.txt" onChange={(e) => { void readFile(e.target.files?.[0] || null); e.target.value = ""; }} /></label>
          </div>
          <textarea id="nnb-p" rows={Math.min(6, Math.max(3, rows.length + 1))} placeholder={"SMITH 23 L\nJONES 7 M"} value={text} onChange={(e) => { setText(e.target.value); setMsg(""); }} />
          <span className="faint nnb-count">
            {rows.length ? <><b>{rows.length} shirt{rows.length === 1 ? "" : "s"}</b>{sizes.length ? ` · ${sizes.map(([z, n]) => `${z} ${n}`).join(", ")}` : ""}</> : "Name, number and size on each line, or a spreadsheet with Name, Number and Size columns"}
            {rows.length > 0 && pieces && pieces !== rows.length ? <span className="nnb-warn"> · the order has {pieces} pieces</span> : null}
          </span>
        </div>
        <div className="nnb-pv" style={{ background: bg || "var(--surface-2)" }} aria-label="The first shirt" dangerouslySetInnerHTML={{ __html: pv }} />
        <button type="button" className="linkbtn nnb-more" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "Hide details" : "Edit details"}<span className="faint"> · color, outline, sizes</span></button>
        {more && (
          <div className="nnb-det">
            <div className="nnb-inks"><span className="nnb-k">Color</span>{INKS.map(([n, h]) => <button key={n} type="button" title={n} aria-label={n} className={"nnb-ink" + (look.color.toLowerCase() === h.toLowerCase() ? " on" : "")} style={{ background: h }} onClick={() => set({ color: h })} />)}</div>
            <div className="nnb-inks"><span className="nnb-k">Outline</span><button type="button" className={"nnb-ink none" + (!look.outline ? " on" : "")} title="None" aria-label="No outline" onClick={() => set({ outline: "" })}>×</button>{INKS.map(([n, h]) => <button key={n} type="button" title={n} aria-label={`${n} outline`} className={"nnb-ink" + ((look.outline || "").toLowerCase() === h.toLowerCase() ? " on" : "")} style={{ background: h }} onClick={() => set({ outline: h })} />)}</div>
            <div className="nnb-grid">
              {look.show !== "number" && <div className="field"><label htmlFor="nnb-nh">Letters (in. tall)</label><input id="nnb-nh" type="number" min={0.5} max={6} step={0.25} value={look.nameIn} onChange={(e) => set({ nameIn: Math.max(0.25, +e.target.value || 0) })} /></div>}
              {look.show !== "name" && <div className="field"><label htmlFor="nnb-mh">Numbers (in. tall)</label><input id="nnb-mh" type="number" min={1} max={14} step={0.5} value={look.numIn} onChange={(e) => set({ numIn: Math.max(0.5, +e.target.value || 0) })} /></div>}
              {look.show === "both" && <div className="field"><label htmlFor="nnb-g">Space between (in.)</label><input id="nnb-g" type="number" min={0} max={4} step={0.25} value={look.gapIn} onChange={(e) => set({ gapIn: Math.max(0, +e.target.value || 0) })} /></div>}
            </div>
          </div>
        )}
        {msg && <p className="nnb-msg" role="status">{msg}</p>}
        <div className="nnb-foot">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy || !rows.length} onClick={() => void place()}>{busy ? "Putting it on…" : start ? "Update the shirt" : `Add to the ${where.toLowerCase()}`}</button>
        </div>
      </div>
    </div>
  );
}
