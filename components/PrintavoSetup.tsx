"use client";
import { useState } from "react";
import { applyPrintavoSetup, printavoSetup, type SetupContact, type SetupDesign } from "@/app/shop/printavo-setup-actions";
import { useRole } from "@/components/RoleContext";

/**
 * Program tab: "Set up from Printavo" (Oct 15, Nick: so Amanda can convert her clients herself, "like we did for Furry
 * Feline"). Their Printavo invoices since a year, by design, with the newest mockups; the proposed price per design
 * (one price → flat, several → price breaks); their contacts from Printavo not in the portal; the account owner. Edit
 * anything, untick what to leave out, then Apply. Nothing changes before that.
 */
const money = (n: number) => `$${(+n || 0).toFixed(2)}`;
const day = (d: string) => new Date(d + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
type Row = SetupDesign & { on: boolean };

export default function PrintavoSetup({ customerId, onApplied }: { customerId: string; onApplied: () => void }) {
  const { staffName, email } = useRole();
  const [open, setOpen] = useState(false), [since, setSince] = useState(2023), [busy, setBusy] = useState(""), [err, setErr] = useState(""), [done, setDone] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null), [people, setPeople] = useState<(SetupContact & { on: boolean })[]>([]);
  const [owner, setOwner] = useState(""), [pvOwner, setPvOwner] = useState(""), [count, setCount] = useState(0), [big, setBig] = useState("");
  const load = async () => {
    setBusy("load"); setErr(""); setDone("");
    const r = await printavoSetup({ customerId, since });
    setBusy("");
    if (!r.ok) { setErr(r.error); return; }
    setRows(r.designs.map((d) => ({ ...d, on: true })));
    setPeople(r.contacts.map((c) => ({ ...c, on: true })));
    setOwner(r.owner || (staffName || (email || "").split("@")[0]).split(/\s+/)[0].replace(/^./, (x) => x.toUpperCase()));
    setPvOwner(r.printavoOwner); setCount(r.orders);
  };
  const upd = (k: string, f: (r: Row) => Row) => setRows((rs) => (rs || []).map((r) => (r.key === k ? f(r) : r)));
  const chosen = (rows || []).filter((r) => r.on), adding = people.filter((p) => p.on);
  const apply = async () => {
    setBusy("apply"); setErr("");
    const r = await applyPrintavoSetup({ customerId, owner,
      designs: chosen.map((d) => ({ name: d.name, mode: d.mode, tiers: d.tiers, supplied: d.supplied, front: d.front, back: d.back, garment: d.garment, orders: d.orders.length, last: d.orders[0]?.date || "", extras: d.extras })),
      contacts: adding.map(({ name, email: e, phone }) => ({ name, email: e, phone })) });
    setBusy("");
    if (!r.ok) { setErr(r.error); return; }
    setDone(`Done: ${r.added} design${r.added === 1 ? "" : "s"} added, ${r.updated} updated${r.people ? `, ${r.people} contact${r.people === 1 ? "" : "s"} added` : ""}${owner ? `, account owner ${owner}` : ""}.`);
    setRows(null); onApplied();
  };

  if (!open) return (
    <section className="pfs pfs-closed">
      <div><h3>Set up from Printavo</h3><p className="faint">Their designs and prices from past invoices, with mockups, their contacts, and the account owner. You check it, then Apply.</p></div>
      <button type="button" className="btn" onClick={() => setOpen(true)}>Start</button>
    </section>
  );
  return (
    <section className="pfs">
      <div className="pfs-h"><h3>Set up from Printavo</h3><span className="spacer" /><button type="button" className="linkbtn" onClick={() => { setOpen(false); setRows(null); }}>Close</button></div>
      <div className="pfs-row">
        <label>Invoices since <select value={since} onChange={(e) => { setSince(+e.target.value); setRows(null); }}>{Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - i).map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        <button type="button" className="btn primary" disabled={!!busy} onClick={() => void load()}>{busy === "load" ? "Reading their Printavo jobs…" : rows ? "Read again" : "Read their Printavo history"}</button>
        <span className="faint">Prices from before then are ignored. One price ever → a flat rate; several → price breaks at the smallest qty each price was charged.</span>
      </div>
      {err && <div className="pv-err">{err}</div>}
      {done && <div className="pfs-done">✓ {done}</div>}
      {rows && <>
        <div className="pfs-sum"><b>{count} invoice{count === 1 ? "" : "s"} since {since}</b> → {rows.length} design{rows.length === 1 ? "" : "s"}. Untick any to leave out; same names are merged into one design.
          <label className="pfs-sup pfs-all"><input type="checkbox" checked={rows.length > 0 && rows.every((r) => r.supplied)} onChange={(e) => setRows((rs) => (rs || []).map((r) => ({ ...r, supplied: e.target.checked })))} /> They supply all their garments (prices are print only)</label></div>
        <div className="pfs-list">
          {rows.map((d) => (
            <div key={d.key} className={"pfs-d" + (d.on ? "" : " off")}>
              <input type="checkbox" checked={d.on} onChange={(e) => upd(d.key, (r) => ({ ...r, on: e.target.checked }))} aria-label={`Include ${d.name}`} />
              <div className="pfs-pics">
                {d.frontUrl ? <img src={d.frontUrl} alt="Front" onClick={() => setBig(d.frontUrl)} /> : <span className="pfs-nopic">no mockup</span>}
                {d.backUrl && <img src={d.backUrl} alt="Back" onClick={() => setBig(d.backUrl)} />}
              </div>
              <div className="pfs-main">
                <div className="pfs-name"><input value={d.name} onChange={(e) => upd(d.key, (r) => ({ ...r, name: e.target.value }))} aria-label="Design name" />
                  {d.have && <span className="pfs-tag">On their program: will update</span>}{d.odd && <span className="pfs-tag warn">Price went up with qty: check</span>}</div>
                <div className="pfs-orders">{d.orders.slice(0, 8).map((o) => <a key={o.id} href={`/shop/archive/${o.id}`} target="_blank" rel="noreferrer">#{o.number} {day(o.date)} · {o.qty} @ {money(o.price)}</a>)}{d.orders.length > 8 && <span className="faint">+{d.orders.length - 8} more</span>}</div>
                {(d.garment || d.extras.length > 0) && <div className="faint pfs-meta">{d.garment}{d.extras.length ? ` · billed separately: ${d.extras.join(", ")}` : ""}</div>}
              </div>
              <div className="pfs-price">
                <select value={d.mode} onChange={(e) => upd(d.key, (r) => ({ ...r, mode: e.target.value as Row["mode"], tiers: e.target.value === "flat" ? [{ min: 0, price: r.tiers[0]?.price || 0 }] : r.tiers }))} aria-label="Pricing">
                  <option value="flat">Flat rate</option><option value="breaks">Price breaks</option>
                </select>
                {d.tiers.map((t, i) => (
                  <div key={i} className="pfs-tier">
                    {d.mode === "breaks" && <><input type="number" min={0} value={t.min} onChange={(e) => upd(d.key, (r) => ({ ...r, tiers: r.tiers.map((x, j) => (j === i ? { ...x, min: +e.target.value } : x)) }))} aria-label="From qty" /><span>+ →</span></>}
                    <span>$</span><input type="number" min={0} step="0.05" value={t.price} onChange={(e) => upd(d.key, (r) => ({ ...r, tiers: r.tiers.map((x, j) => (j === i ? { ...x, price: +e.target.value } : x)) }))} aria-label="Price per piece" />
                    {d.mode === "breaks" && d.tiers.length > 1 && <button type="button" className="linkbtn" aria-label="Remove this break" onClick={() => upd(d.key, (r) => ({ ...r, tiers: r.tiers.filter((_, j) => j !== i) }))}>✕</button>}
                  </div>
                ))}
                {d.mode === "breaks" && <button type="button" className="linkbtn" onClick={() => upd(d.key, (r) => ({ ...r, tiers: [...r.tiers, { min: (r.tiers[r.tiers.length - 1]?.min || 0) + 50, price: r.tiers[r.tiers.length - 1]?.price || 0 }] }))}>+ Break</button>}
                <label className="pfs-sup"><input type="checkbox" checked={d.supplied} onChange={(e) => upd(d.key, (r) => ({ ...r, supplied: e.target.checked }))} /> They supply the garment</label>
              </div>
            </div>
          ))}
        </div>
        <div className="pfs-check">
          <h4>Checklist</h4>
          <div className="pfs-ck"><b>Account owner</b> <input value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Account owner" style={{ maxWidth: 160 }} />{pvOwner && <span className="faint"> In Printavo: {pvOwner}</span>}</div>
          {people.length > 0 ? <div className="pfs-ck"><b>People from Printavo not in the portal yet</b> <span className="faint">(their texts come in once their numbers are here)</span>
            {people.map((p, i) => <label key={i} className="pfs-person"><input type="checkbox" checked={p.on} onChange={(e) => setPeople((ps) => ps.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} /> {p.name || "(no name)"} <span className="faint">{[p.email, p.phone].filter(Boolean).join(" · ")}</span></label>)}
          </div> : <div className="pfs-ck faint">Their Printavo contacts are all in the portal already.</div>}
        </div>
        <div className="pfs-go">
          <button type="button" className="btn primary" disabled={!!busy || (!chosen.length && !adding.length)} onClick={() => void apply()}>{busy === "apply" ? "Applying…" : `Apply: ${chosen.length} design${chosen.length === 1 ? "" : "s"}${adding.length ? `, ${adding.length} contact${adding.length === 1 ? "" : "s"}` : ""}`}</button>
          <span className="faint">Designs go on their program (the portal order form stays as it is). You can change any of it later.</span>
        </div>
      </>}
      {big && <div className="ctx-big" onClick={() => setBig("")}><img src={big} alt="" /></div>}
    </section>
  );
}
