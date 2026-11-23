"use client";
import { useMemo, useState } from "react";
import { savePo } from "@/app/shop/po-actions";

export type PoLine = { id: string; group: string; item: string; kind: string; desc: string[]; approved: string; qty: number; sizes: [string, number][]; supplier: string; pic: string };
export type PoRow = { id: string; seq: number; vendor: string; vendor_contact: string; ship_to_kind: "us" | "customer" | "other"; ship_to: string; needed_by: string | null; notes: string; line_ids: string[]; qty: Record<string, number>; created_by: string; created_at: string };

const NOTE0 = "Put this PO # on every box and the packing slip. Email a proof before production and tracking when it ships.";
const day = (d: string | null) => (d ? new Date(d + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

/** The purchase order: the form to fill (never printed) over the page that prints. No prices anywhere (Nick, Nov 23 2026). */
export default function PoDoc({ orderId, number, job, customer, shop, customerShip, me, lines, saved, vendors, open }: {
  orderId: string; number: string; job: string; customer: string; shop: { name: string; address: string; phone: string }; customerShip: string; me: string;
  lines: PoLine[]; saved: PoRow[]; vendors: { name: string; contact: string }[]; open: number;
}) {
  const [list, setList] = useState<PoRow[]>(saved);
  // the supplier named on most of the lines is the vendor to start with
  const supplier0 = useMemo(() => {
    const n = new Map<string, number>(); lines.forEach((l) => l.supplier && n.set(l.supplier, (n.get(l.supplier) || 0) + 1));
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  }, [lines]);
  const blank = (): PoRow => ({ id: "", seq: 0, vendor: supplier0, vendor_contact: vendors.find((x) => x.name.toLowerCase() === supplier0.toLowerCase())?.contact || "", ship_to_kind: "us", ship_to: "", needed_by: null, notes: NOTE0, line_ids: lines.filter((l) => !supplier0 || !l.supplier || l.supplier === supplier0).map((l) => l.id), qty: {}, created_by: me, created_at: new Date().toISOString() });
  const [po, setPo] = useState<PoRow>(() => saved.find((p) => p.seq === open) || saved[saved.length - 1] || blank());
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const set = (p: Partial<PoRow>) => { setPo((x) => ({ ...x, ...p })); setMsg(""); };

  const picked = lines.filter((l) => po.line_ids.includes(l.id));
  const qtyOf = (l: PoLine) => (po.qty[l.id] != null ? po.qty[l.id] : l.qty);
  const shopAddr = `${shop.name}\nAttn: Receiving · PO ${number}-${po.seq || "?"}\n${shop.address.replace(/,\s*(?=[^,]*,[^,]*$)/, "\n")}`;
  const shipText = po.ship_to_kind === "us" ? shopAddr : po.ship_to_kind === "customer" ? customerShip : po.ship_to;

  const save = async (): Promise<PoRow | null> => {
    if (!po.vendor.trim()) { setMsg("Who's it to? Type the vendor."); return null; }
    if (!picked.length) { setMsg("Tick at least one item."); return null; }
    setBusy(true);
    const r = await savePo(orderId, { id: po.id || undefined, vendor: po.vendor, vendorContact: po.vendor_contact, shipToKind: po.ship_to_kind, shipTo: po.ship_to_kind === "us" ? "" : shipText, neededBy: po.needed_by, notes: po.notes, lineIds: po.line_ids, qty: po.qty });
    setBusy(false);
    if (!r.ok) { setMsg(r.error); return null; }
    const next = { ...po, id: r.id, seq: r.seq };
    setPo(next); setList((xs) => [...xs.filter((x) => x.id !== r.id), next].sort((a, b) => a.seq - b.seq));
    setMsg(`Saved PO ${number}-${r.seq}`);
    history.replaceState(null, "", `?po=${r.seq}`);
    return next;
  };
  const print = async () => { if (await save()) setTimeout(() => window.print(), 150); };

  return (
    <div className="po-page">
      <style>{PO_CSS}</style>
      <div className="po-ctl">
        <div className="po-tabs">
          {list.map((p) => <button key={p.id} type="button" className={p.id === po.id ? "on" : ""} onClick={() => { setPo(p); setMsg(""); history.replaceState(null, "", `?po=${p.seq}`); }}>PO {number}-{p.seq}<small>{p.vendor}</small></button>)}
          <button type="button" className={!po.id ? "on" : ""} onClick={() => { setPo(blank()); setMsg(""); history.replaceState(null, "", "?"); }}>+ New PO</button>
        </div>
        <div className="po-row">
          <label className="po-f"><span>Vendor</span>
            <input list="po-vendors" value={po.vendor} placeholder="Type the vendor" onChange={(e) => { const name = e.target.value; const hit = vendors.find((x) => x.name.toLowerCase() === name.trim().toLowerCase()); set({ vendor: name, ...(hit && !po.vendor_contact ? { vendor_contact: hit.contact } : {}) }); }} />
            <datalist id="po-vendors">{vendors.map((x) => <option key={x.name} value={x.name} />)}</datalist>
          </label>
          <label className="po-f"><span>Needed by</span><input type="date" value={po.needed_by || ""} onChange={(e) => set({ needed_by: e.target.value || null })} /></label>
          <div className="po-f"><span>Ship to</span>
            <div className="po-seg">{([["us", "Us"], ["customer", "The customer"], ["other", "Other"]] as const).map(([k, l]) => (
              <button key={k} type="button" className={po.ship_to_kind === k ? "on" : ""} disabled={k === "customer" && !customerShip} onClick={() => set({ ship_to_kind: k, ...(k === "other" && !po.ship_to ? { ship_to: "" } : {}) })}>{l}</button>
            ))}</div>
          </div>
        </div>
        <div className="po-row">
          <label className="po-f"><span>Vendor contact (rep, email, phone, our account #)</span><textarea rows={2} value={po.vendor_contact} onChange={(e) => set({ vendor_contact: e.target.value })} /></label>
          {po.ship_to_kind === "other"
            ? <label className="po-f"><span>Ship to address</span><textarea rows={2} value={po.ship_to} placeholder={"Name\nStreet\nCity, ST ZIP"} onChange={(e) => set({ ship_to: e.target.value })} /></label>
            : <label className="po-f"><span>Notes for the vendor</span><textarea rows={2} value={po.notes} onChange={(e) => set({ notes: e.target.value })} /></label>}
        </div>
        {po.ship_to_kind === "other" && <div className="po-row"><label className="po-f"><span>Notes for the vendor</span><textarea rows={2} value={po.notes} onChange={(e) => set({ notes: e.target.value })} /></label></div>}
        <div className="po-items">
          <span className="po-k">Items on this PO</span>
          {lines.map((l) => (
            <label key={l.id} className="po-it">
              <input type="checkbox" checked={po.line_ids.includes(l.id)} onChange={(e) => set({ line_ids: e.target.checked ? [...po.line_ids, l.id] : po.line_ids.filter((x) => x !== l.id) })} />
              <span>{l.item || "Item"} · {l.desc[0] || ""}{l.desc[1] ? ` · ${l.desc[1]}` : ""}{l.supplier ? <small> ({l.supplier})</small> : null}</span>
              <input className="po-q" type="number" min={0} value={qtyOf(l)} onChange={(e) => set({ qty: { ...po.qty, [l.id]: Math.max(0, +e.target.value || 0) } })} aria-label="Quantity" />
            </label>
          ))}
          {!lines.length && <span className="po-none">This order has no promotional items yet.</span>}
        </div>
        <div className="po-btns">
          {msg && <span className={"po-msg" + (/^Saved/.test(msg) ? " ok" : "")}>{msg}</span>}
          <button type="button" className="btn" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void print()}>Print / Save PDF</button>
        </div>
      </div>

      <div className="po-sheet">
        <div className="po-top">
          <div className="po-shop"><b>{shop.name}</b>{shop.address.split(/,\s*(?=[^,]*,[^,]*$)/).map((x, i) => <span key={i}>{x}</span>)}{shop.phone && <span>{shop.phone}</span>}</div>
          <div className="po-meta"><h1>PURCHASE ORDER</h1><b>PO {number}-{po.seq || "?"}</b><span>Date: {day((po.created_at || new Date().toISOString()).slice(0, 10))}</span><span>Job #{number}{job ? ` · ${job}` : ""}</span>{po.needed_by && <span>Needed by: <b>{day(po.needed_by)}</b></span>}</div>
        </div>
        <div className="po-boxes">
          <div className="po-box"><div className="po-k">Vendor</div><b>{po.vendor || "—"}</b>{po.vendor_contact.split("\n").filter(Boolean).map((x, i) => <span key={i}>{x}</span>)}</div>
          <div className="po-box"><div className="po-k">Ship to</div>{shipText.split("\n").filter(Boolean).map((x, i) => (i === 0 ? <b key={i}>{x}</b> : <span key={i}>{x}</span>))}</div>
        </div>
        <table className="po-tbl" data-nofit>
          <thead><tr><th>Picture</th><th>Item</th><th>Description</th><th className="r">Qty</th></tr></thead>
          <tbody>{picked.map((l) => (
            <tr key={l.id}>
              <td><div className="po-pic">{l.pic ? <img src={l.pic} alt="" /> : null}</div></td>
              <td className="po-item"><b>{l.item || "—"}</b>{l.group && <small>{l.group}</small>}</td>
              <td>{l.desc.map((d, i) => <span key={i} className="po-d">{d}</span>)}{l.sizes.length > 0 && <span className="po-d po-sz">{l.sizes.map(([z, n]) => `${z} ${n}`).join(" · ")}</span>}{l.approved && <small>{l.approved}</small>}</td>
              <td className="r"><b>{qtyOf(l).toLocaleString()}</b></td>
            </tr>
          ))}</tbody>
        </table>
        <div className="po-tot">Total pieces <b>{picked.reduce((a, l) => a + qtyOf(l), 0).toLocaleString()}</b></div>
        {po.notes.trim() && <div className="po-note"><b>Notes:</b> {po.notes.replace(/this PO #/i, `PO ${number}-${po.seq || "?"}`)}</div>}
        <div className="po-sign"><div>Ordered by: {po.created_by || me}</div><div>Vendor confirmation #</div></div>
        {customer && <div className="po-foot">For our customer: {customer}</div>}
      </div>
    </div>
  );
}

const PO_CSS = `
@page { size: letter; margin: 0.5in; }
.po-page{background:#e9edf2;min-height:100vh;padding:20px 16px 60px;font-family:var(--body,Arial,sans-serif);color:var(--ink,#1c2430)}
.po-ctl{max-width:816px;margin:0 auto 16px;background:#fff;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.1);padding:14px 18px;display:flex;flex-direction:column;gap:12px}
.po-tabs{display:flex;flex-wrap:wrap;gap:6px}
.po-tabs button{border:1px solid var(--line,#dde3ea);background:#fff;border-radius:6px;padding:6px 10px;font-weight:700;font-size:13px;cursor:pointer;color:var(--ink-2,#3c4654);text-align:left}
.po-tabs button small{display:block;font-weight:400;font-size:11.5px;color:var(--ink-3,#7a8594)}
.po-tabs button.on{border-color:var(--accent,#0b72b5);color:var(--accent,#0b72b5);background:#eef6fc}
.po-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.po-f{display:flex;flex-direction:column;gap:4px;min-width:0}
.po-f>span,.po-k{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-3,#7a8594)}
.po-f input,.po-f textarea{border:1px solid var(--line,#ccd4dd);border-radius:6px;font:14px var(--body,Arial);padding:7px 10px;color:inherit;min-height:36px;box-sizing:border-box;width:100%}
.po-seg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--line,#ccd4dd);border-radius:6px;overflow:hidden;height:36px}
.po-seg button{border:0;background:#fff;font-weight:700;font-size:13px;cursor:pointer;color:var(--ink-2,#3c4654)}
.po-seg button+button{border-left:1px solid var(--line,#ccd4dd)}
.po-seg button.on{background:var(--accent,#0b72b5);color:#fff}.po-seg button:disabled{opacity:.4;cursor:default}
.po-items{display:flex;flex-direction:column;gap:4px}
.po-it{display:flex;align-items:center;gap:10px;font-size:14px;padding:4px 0}
.po-it span{flex:1;min-width:0}.po-it small{color:var(--ink-3,#7a8594)}
.po-q{width:80px;height:32px;border:1px solid var(--line,#ccd4dd);border-radius:6px;padding:0 8px;font:14px var(--body,Arial);text-align:right}
.po-none{color:var(--ink-3,#7a8594)}
.po-btns{display:flex;justify-content:flex-end;align-items:center;gap:8px;flex-wrap:wrap}
.po-msg{color:var(--danger,#c0392b);font-size:13px;margin-right:auto}.po-msg.ok{color:var(--ok,#1c9a5b)}
.po-sheet{max-width:816px;margin:0 auto;background:#fff;padding:40px 44px;box-sizing:border-box;box-shadow:0 6px 24px rgba(0,0,0,.12);font-size:13px}
.po-top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:3px solid #0b72b5;padding-bottom:14px}
.po-shop,.po-meta{display:flex;flex-direction:column;line-height:1.5}
.po-shop b{font:800 18px var(--display,Arial)}
.po-meta{text-align:right}.po-meta h1{margin:0 0 4px;font:800 26px var(--display,Arial);letter-spacing:.04em;color:#0b72b5}.po-meta>b{font-size:15px}
.po-boxes{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:18px 0}
.po-box{border:1px solid #dde3ea;border-radius:6px;padding:10px 12px;display:flex;flex-direction:column;line-height:1.5}
.po-tbl{width:100%;border-collapse:collapse}
.po-tbl th{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#7a8594;text-align:left;border-bottom:1px solid #ccd4dd;padding:6px}
.po-tbl td{border-bottom:1px solid #eef1f4;padding:10px 6px;vertical-align:top;line-height:1.5}
.po-tbl .r{text-align:right;white-space:nowrap}.po-tbl td.r b{font-size:15px}
.po-pic{width:84px;height:84px;border:1px solid #eef1f4;border-radius:4px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.po-pic img{max-width:100%;max-height:100%;object-fit:contain}
.po-item b{display:block;font-size:14px}.po-item small,.po-tbl small{display:block;color:#5a6676}
.po-d{display:block}.po-sz{color:#3c4654}
.po-tot{display:flex;justify-content:flex-end;gap:14px;align-items:baseline;margin-top:10px;font-size:14px}.po-tot b{font-size:17px}
.po-note{margin-top:18px;border:1px solid #dde3ea;border-radius:6px;padding:10px 12px;background:#f7f9fb;line-height:1.5}
.po-sign{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:34px}.po-sign div{border-top:1px solid #1c2430;padding-top:4px;font-size:11px;color:#5a6676}
.po-foot{margin-top:14px;font-size:11px;color:#7a8594}
@media (max-width:640px){.po-boxes{grid-template-columns:1fr}.po-sheet{padding:20px}}
@media print{.po-page{background:#fff;padding:0;min-height:0}.po-ctl{display:none!important}.po-sheet{box-shadow:none;padding:0;max-width:none}}
`;
