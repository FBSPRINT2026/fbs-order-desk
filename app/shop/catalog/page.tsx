"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Garment } from "@/lib/pricing";
import { money } from "@/lib/format";

type Draft = { style: string; brand: string; description: string; colors: string; cost: string };
const empty: Draft = { style: "", brand: "", description: "", colors: "", cost: "" };
const toRow = (d: Draft) => ({ style: d.style.trim(), brand: d.brand.trim(), description: d.description.trim(), colors: d.colors.split(/[|;]/).map((c) => c.trim()).filter(Boolean), cost: +d.cost || 0 });

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
    const data = rows.filter((r) => r[0] && r[0].toLowerCase() !== "style").map((r) => toRow({ style: r[0], brand: r[1] || "", description: r[2] || "", cost: r[3] || "", colors: r[4] || "" }));
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
            <div className="sub">One garment per line: <b>Style, Brand, Description, Cost, Colors</b>. Separate colors with <b>|</b>, for example <span className="mono">G5000, Gildan, Heavy Cotton Tee, 2.85, Black|White|Sport Grey</span>. You can copy columns straight out of Excel or Google Sheets.</div>
            <textarea rows={8} value={bulk} onChange={(e) => setBulk(e.target.value)} aria-label="Garments to import" />
            <button className="btn primary" type="button" style={{ alignSelf: "flex-start" }} onClick={importBulk}>Import</button>
          </div>
        </section>
      )}
      <div className="toolbar"><input type="search" placeholder="Search style, brand, color…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="tbl-wrap">
        <table className="tbl" style={{ minWidth: 860 }}>
          <thead><tr><th>Style #</th><th>Brand</th><th>Description</th><th>Colors</th><th className="r">Your cost</th><th /></tr></thead>
          <tbody>
            <tr style={{ cursor: "default" }}>
              <td><input type="text" placeholder="G5000" value={draft.style} onChange={(e) => setDraft({ ...draft, style: e.target.value })} aria-label="New style number" /></td>
              <td><input type="text" placeholder="Gildan" value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} aria-label="New brand" /></td>
              <td><input type="text" placeholder="Heavy Cotton Tee" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} aria-label="New description" /></td>
              <td><input type="text" placeholder="Black | White | Navy" value={draft.colors} onChange={(e) => setDraft({ ...draft, colors: e.target.value })} aria-label="New colors" /></td>
              <td className="r"><input type="number" step="0.01" placeholder="0.00" value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })} style={{ width: 90 }} aria-label="New cost" /></td>
              <td><button className="btn primary sm" type="button" onClick={add}>Add</button></td>
            </tr>
            {list.map((g) => editing === g.id ? (
              <tr key={g.id} style={{ cursor: "default" }}>
                <td><input type="text" value={edit.style} onChange={(e) => setEdit({ ...edit, style: e.target.value })} aria-label="Style number" /></td>
                <td><input type="text" value={edit.brand} onChange={(e) => setEdit({ ...edit, brand: e.target.value })} aria-label="Brand" /></td>
                <td><input type="text" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} aria-label="Description" /></td>
                <td><input type="text" value={edit.colors} onChange={(e) => setEdit({ ...edit, colors: e.target.value })} aria-label="Colors" /></td>
                <td className="r"><input type="number" step="0.01" value={edit.cost} onChange={(e) => setEdit({ ...edit, cost: e.target.value })} style={{ width: 90 }} aria-label="Cost" /></td>
                <td className="row" style={{ flexWrap: "nowrap" }}><button className="btn primary sm" type="button" onClick={() => saveEdit(g.id)}>Save</button><button className="btn ghost sm" type="button" onClick={() => setEditing(null)}>Cancel</button></td>
              </tr>
            ) : (
              <tr key={g.id} onClick={() => { setEditing(g.id); setEdit({ style: g.style, brand: g.brand, description: g.description, colors: g.colors.join(" | "), cost: String(g.cost) }); }}>
                <td><span className="ordno">{g.style}</span></td><td>{g.brand}</td><td>{g.description}</td>
                <td className="sub">{g.colors.join(", ")}</td><td className="r">{money(g.cost)}</td>
                <td><button className={"btn sm ghost danger" + (armed === g.id ? " armed" : "")} type="button" onClick={(e) => { e.stopPropagation(); del(g.id); }}>{armed === g.id ? "Confirm" : "Delete"}</button></td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={6}><div className="empty">{items.length ? "No garments match." : "Your catalog is empty. Add styles above, or save them from an order."}</div></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
