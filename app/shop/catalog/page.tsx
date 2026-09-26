"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SIZES, type Garment } from "@/lib/pricing";
import { money } from "@/lib/format";

type Draft = { style: string; brand: string; description: string; colors: string; cost: string; sizes: string };
const empty: Draft = { style: "", brand: "", description: "", colors: "", cost: "", sizes: "" };
const ALL = SIZES as readonly string[];
/** "S-5XL", "YXS-YXL", "S, M, L" or "OS" (one size) -> ordered list of sizes */
function parseSizes(v: string): string[] {
  const out = new Set<string>();
  for (const tok of v.toUpperCase().replace(/ONE ?SIZE/g, "OS").split(/[,\s|;]+/).filter(Boolean)) {
    const m = tok.match(/^([A-Z0-9]+)-([A-Z0-9]+)$/);
    if (m && ALL.includes(m[1]) && ALL.includes(m[2])) { const a = ALL.indexOf(m[1]), b = ALL.indexOf(m[2]); ALL.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((z) => out.add(z)); }
    else if (ALL.includes(tok)) out.add(tok);
  }
  return ALL.filter((z) => out.has(z));
}
/** ["S","M","L","XL"] -> "S-XL" when the run is unbroken */
function showSizes(list: string[] = []): string {
  if (!list.length) return "";
  if (list.length === 1) return list[0] === "OS" ? "One size" : list[0];
  const ix = list.map((z) => ALL.indexOf(z));
  return ix.every((v, i) => i === 0 || v === ix[i - 1] + 1) ? `${list[0]}-${list[list.length - 1]}` : list.join(", ");
}
const toRow = (d: Draft) => ({ style: d.style.trim(), brand: d.brand.trim(), description: d.description.trim(), colors: d.colors.split(/[|;]/).map((c) => c.trim()).filter(Boolean), cost: +d.cost || 0, sizes: parseSizes(d.sizes) });

export default function CatalogPage() {
  const sb = useMemo(() => createClient(), []);
  const [items, setItems] = useState<Garment[]>([]);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft>(empty);
  const [bulk, setBulk] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [msg, setMsg] = useState("");
  const [armed, setArmed] = useState("");
  const [ssq, setSsq] = useState("");
  const [ssBusy, setSsBusy] = useState("");
  const [ssHits, setSsHits] = useState<{ styleID: number; brand: string; style: string; title: string }[]>([]);
  async function searchSS() {
    const q = ssq.trim();
    if (q.length < 2) return;
    setSsBusy("search");
    const r = await fetch(`/api/ss/search?q=${encodeURIComponent(q)}`);
    const j = await r.json().catch(() => ({}));
    setSsBusy("");
    if (!r.ok) return setMsg(j.error || "S&S search failed");
    setSsHits(j.results || []);
    if (!(j.results || []).length) setMsg(`S&S has nothing matching "${q}".`);
  }
  async function addOne(id: number, label: string) {
    setSsBusy(label);
    const r = await fetch(`/api/ss/lookup?styleid=${id}`);
    const j = await r.json().catch(() => ({}));
    setSsBusy("");
    setMsg(r.ok ? `Added ${label} from S&S.` : j.error || "Couldn't add it");
    load();
  }

  // Pull styles from S&S Activewear (colors, sizes, your price, 2XL+ prices) into the catalog
  async function addFromSS(list: string[]) {
    const styles = list.map((x) => x.trim()).filter(Boolean);
    if (!styles.length) return;
    const bad: string[] = [];
    let ok = 0;
    for (const st of styles) {
      setSsBusy(st);
      const g = items.find((x) => x.style === st && x.ss_style_id);
      const r = await fetch(g ? `/api/ss/lookup?styleid=${g.ss_style_id}` : `/api/ss/lookup?style=${encodeURIComponent(st)}`);
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.garment) ok++; else bad.push(`${st}: ${j.error || r.status}`);
    }
    setSsBusy("");
    setMsg(`Pulled ${ok} of ${styles.length} from S&S.${bad.length ? " " + bad.join("; ") : ""}`);
    setSsq("");
    load();
  }

  const load = async () => {
    const { data } = await sb.from("garments").select("*").order("style");
    setItems((data || []) as Garment[]);
  };
  useEffect(() => { load(); }, []);

  async function add() {
    if (!draft.style.trim()) return setMsg("Enter a style number.");
    const { error } = await sb.from("garments").insert(toRow(draft));
    if (error) return setMsg(error.message.includes("duplicate") ? "That style is already in your catalog." : error.message);
    setDraft(empty); setMsg(""); load();
  }
  async function saveEdit(id: string) {
    const { error } = await sb.from("garments").update(toRow(edit)).eq("id", id);
    if (error) return setMsg(error.message);
    setEditing(null); load();
  }
  async function del(id: string) {
    if (armed !== id) { setArmed(id); setTimeout(() => setArmed(""), 3500); return; }
    await sb.from("garments").delete().eq("id", id); load();
  }
  async function importBulk() {
    const rows = bulk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => x.replace(/^"|"$/g, "").trim()));
    const data = rows.filter((r) => r[0] && r[0].toLowerCase() !== "style").map((r) => toRow({ style: r[0], brand: r[1] || "", description: r[2] || "", cost: r[3] || "", colors: r[4] || "", sizes: r[5] || "" }));
    if (!data.length) return setMsg("Nothing to import. Paste one garment per line.");
    const { error } = await sb.from("garments").upsert(data, { onConflict: "style" });
    if (error) {
      // fall back to one at a time (the unique index is on lower(style))
      let ok = 0;
      for (const d of data) { const r = await sb.from("garments").insert(d); if (!r.error) ok++; }
      setMsg(`Imported ${ok} of ${data.length}. Styles already in the catalog were skipped.`);
    } else setMsg(`Imported ${data.length} garments.`);
    setBulk(""); setShowBulk(false); load();
  }

  const list = items.filter((g) => !q.trim() || [g.style, g.brand, g.description, g.colors.join(" ")].join(" ").toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">{items.length} styles</div><h1>Garment catalog</h1></div>
        <button className="btn" type="button" onClick={() => setShowBulk(!showBulk)}>{showBulk ? "Close import" : "Paste a list"}</button>
      </div>
      <p className="muted" style={{ marginTop: -8, maxWidth: 720 }}>Type a style number on an order and the description, brand and your cost fill in from here. Colors show up as suggestions.</p>
      {msg && <div className="banner" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{msg}</div>}
      {showBulk && (
        <section className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-h"><h2>Paste from a spreadsheet</h2></div>
          <div className="panel-b stack">
            <div className="sub">One garment per line: <b>Style, Brand, Description, Cost, Colors, Sizes</b>. Separate colors with <b>|</b>, for example <span className="mono">G5000, Gildan, Heavy Cotton Tee, 2.85, Black|White|Sport Grey, S-5XL</span> (use <b>OS</b> for one-size items like hats). You can copy columns straight out of Excel or Google Sheets.</div>
            <textarea rows={8} value={bulk} onChange={(e) => setBulk(e.target.value)} aria-label="Garments to import" />
            <button className="btn primary" type="button" style={{ alignSelf: "flex-start" }} onClick={importBulk}>Import</button>
          </div>
        </section>
      )}
      <section className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-h"><h2>Add from S&amp;S Activewear</h2><span className="faint" style={{ fontSize: 12 }}>Styles typed on an order are pulled in automatically too</span></div>
        <div className="panel-b row">
          <input type="text" placeholder="Style number or name, e.g. 5000, 18500, BC3001" value={ssq} onChange={(e) => setSsq(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") searchSS(); }} style={{ maxWidth: 420 }} aria-label="S&S style search" />
          <button className="btn primary" type="button" disabled={!!ssBusy} onClick={searchSS}>{ssBusy === "search" ? "Searching…" : ssBusy ? `Adding ${ssBusy}…` : "Search S&S"}</button>
          {items.some((g) => g.ss_style_id) && <button className="btn" type="button" disabled={!!ssBusy} onClick={() => addFromSS(items.filter((g) => g.ss_style_id).map((g) => g.style))}>Refresh all from S&amp;S</button>}
        </div>
        {ssHits.length > 0 && (
          <div className="panel-b" style={{ paddingTop: 0 }}>
            <div className="ss-hits">
              {ssHits.map((h) => {
                const have = items.some((g) => g.ss_style_id === h.styleID);
                return (
                  <div key={h.styleID} className="ss-hit">
                    <b>{h.brand} {h.style}</b><span>{h.title}</span>
                    {have ? <span className="faint">In catalog</span> : <button className="btn sm" type="button" disabled={!!ssBusy} onClick={() => addOne(h.styleID, `${h.brand} ${h.style}`)}>Add</button>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
      <div className="toolbar"><input type="search" placeholder="Search style, brand, color…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="tbl-wrap">
        <table className="tbl" style={{ minWidth: 860 }}>
          <thead><tr><th>Style #</th><th>Brand</th><th>Description</th><th>Colors</th><th>Sizes</th><th className="r">Your cost</th><th /></tr></thead>
          <tbody>
            <tr style={{ cursor: "default" }}>
              <td><input type="text" placeholder="G5000" value={draft.style} onChange={(e) => setDraft({ ...draft, style: e.target.value })} aria-label="New style number" /></td>
              <td><input type="text" placeholder="Gildan" value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} aria-label="New brand" /></td>
              <td><input type="text" placeholder="Heavy Cotton Tee" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} aria-label="New description" /></td>
              <td><input type="text" placeholder="Black | White | Navy" value={draft.colors} onChange={(e) => setDraft({ ...draft, colors: e.target.value })} aria-label="New colors" /></td>
              <td><input type="text" placeholder="S-5XL or OS" value={draft.sizes} onChange={(e) => setDraft({ ...draft, sizes: e.target.value })} style={{ width: 110 }} aria-label="New sizes" /></td>
              <td className="r"><input type="number" step="0.01" placeholder="0.00" value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })} style={{ width: 90 }} aria-label="New cost" /></td>
              <td><button className="btn primary sm" type="button" onClick={add}>Add</button></td>
            </tr>
            {list.map((g) => editing === g.id ? (
              <tr key={g.id} style={{ cursor: "default" }}>
                <td><input type="text" value={edit.style} onChange={(e) => setEdit({ ...edit, style: e.target.value })} aria-label="Style number" /></td>
                <td><input type="text" value={edit.brand} onChange={(e) => setEdit({ ...edit, brand: e.target.value })} aria-label="Brand" /></td>
                <td><input type="text" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} aria-label="Description" /></td>
                <td><input type="text" value={edit.colors} onChange={(e) => setEdit({ ...edit, colors: e.target.value })} aria-label="Colors" /></td>
                <td><input type="text" value={edit.sizes} onChange={(e) => setEdit({ ...edit, sizes: e.target.value })} style={{ width: 110 }} aria-label="Sizes" /></td>
                <td className="r"><input type="number" step="0.01" value={edit.cost} onChange={(e) => setEdit({ ...edit, cost: e.target.value })} style={{ width: 90 }} aria-label="Cost" /></td>
                <td className="row" style={{ flexWrap: "nowrap" }}><button className="btn primary sm" type="button" onClick={() => saveEdit(g.id)}>Save</button><button className="btn ghost sm" type="button" onClick={() => setEditing(null)}>Cancel</button></td>
              </tr>
            ) : (
              <tr key={g.id} onClick={() => { setEditing(g.id); setEdit({ style: g.style, brand: g.brand, description: g.description, colors: g.colors.join(" | "), cost: String(g.cost), sizes: showSizes(g.sizes) }); }}>
                <td><span className="ordno">{g.style}</span></td><td>{g.brand}</td><td>{g.description}</td>
                <td className="sub">{g.colors.join(", ")}</td><td className="sub" style={{ whiteSpace: "nowrap" }}>{showSizes(g.sizes) || "—"}</td><td className="r">{money(g.cost)}</td>
                <td><button className={"btn sm ghost danger" + (armed === g.id ? " armed" : "")} type="button" onClick={(e) => { e.stopPropagation(); del(g.id); }}>{armed === g.id ? "Confirm" : "Delete"}</button></td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={7}><div className="empty">{items.length ? "No garments match." : "Your catalog is empty. Add styles above, or save them from an order."}</div></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
