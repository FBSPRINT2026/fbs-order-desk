import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calcOrder, imprintLabel, mergeSettings, orderGroups, SIZES, type ArtFile, type Customer, type Group, type GroupCalc, type Order, type Payment } from "@/lib/pricing";
import { fmtDateLong, money, todayISO } from "@/lib/format";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

const DELIVERY: Record<string, string> = { pickup: "Customer pickup", ship: "Ship", deliver: "We deliver" };

// Quote/invoice for customers, or (?work=1, shop only) a work order for the press with no prices.
export default async function PrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ work?: string }> }) {
  const { id } = await params;
  const { work } = await searchParams;
  const { supabase, user, isStaff } = await getViewer();
  if (!user) redirect(`/login?next=/print/${id}`);
  const db = isStaff ? createAdminClient() : supabase; // customers read through row security
  const { data: od } = await db.from("orders").select("*").eq("id", id).maybeSingle();
  if (!od) notFound();
  const o = od as Order;
  const admin = createAdminClient();
  const [{ data: cu }, { data: s }, { data: pays }] = await Promise.all([
    admin.from("customers").select("*").eq("id", o.customer_id).maybeSingle(),
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    db.from("payments").select("*").eq("order_id", id),
  ]);
  const settings = mergeSettings(s?.data);
  const groups = orderGroups(o);
  const c = calcOrder(o, settings, (pays || []) as Payment[]);
  const cust = (cu || {}) as Partial<Customer>;
  const sh = settings.shop;

  if (work && isStaff) {
    const [{ data: inn }, { data: af }] = await Promise.all([
      admin.from("order_internal").select("production_notes").eq("order_id", id).maybeSingle(),
      admin.from("art_files").select("*").eq("order_id", id).order("created_at"),
    ]);
    const arts = (af || []) as ArtFile[];
    const signed = arts.length ? (await admin.storage.from("proofs").createSignedUrls(arts.map((a) => a.file_path), 3600)).data || [] : [];
    return (
      <div style={{ background: "#fff", minHeight: "100%", color: "#141D2B" }}>
        <div className="print-bar"><PrintButton /></div>
        <div className="print-page wo" style={{ background: "#fff", color: "#141D2B", fontFamily: "Helvetica, Arial, sans-serif", fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", borderBottom: "3px solid #141D2B", paddingBottom: 10, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "#5A6478" }}>Work order</div>
              <h1 style={{ margin: 0 }}>#{o.number} {o.nickname}</h1>
              <div>{cust.company || cust.name}{o.po_number ? ` · PO ${o.po_number}` : ""}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              {o.rush && <div className="wo-rush">RUSH</div>}
              <div><b>Production:</b> {o.production_date ? fmtDateLong(o.production_date) : "not set"}</div>
              <div><b>In hands:</b> {o.due_date ? fmtDateLong(o.due_date) : "not set"}</div>
              <div><b>Delivery:</b> {DELIVERY[o.delivery_method] || "Customer pickup"}{o.ship_method ? ` · ${o.ship_method}` : ""}</div>
            </div>
          </div>
          {o.delivery_method !== "pickup" && o.ship_to && <div className="box"><b>{o.delivery_method === "ship" ? "Ship to" : "Deliver to"}:</b><div style={{ whiteSpace: "pre-line" }}>{o.ship_to}</div></div>}
          {groups.map((g, gi) => (
            <div key={g.id} className="box">
              <b>Group {gi + 1} · {c.groups[gi]?.qty || 0} pcs</b>
              <table>
                <thead><tr><th>Style</th><th>Color</th><th>Description</th>{SIZES.map((z) => <th key={z} className="c">{z}</th>)}<th className="c">Total</th></tr></thead>
                <tbody>
                  {g.lines.map((l, li) => (
                    <tr key={l.id}><td>{l.style}</td><td>{l.color}</td><td>{l.garment}</td>{SIZES.map((z) => <td key={z} className="c">{l.sizes?.[z] || ""}</td>)}<td className="c"><b>{c.groups[gi]?.lines[li]?.qty || 0}</b></td></tr>
                  ))}
                </tbody>
              </table>
              <table>
                <thead><tr><th>Imprint</th><th>Location</th><th className="c">Colors</th><th>Inks / PMS</th><th>Size</th><th>Notes</th></tr></thead>
                <tbody>
                  {g.imprints.map((d) => (
                    <tr key={d.id}><td>{d.method === "screen" ? "Screen print" : d.method === "embroidery" ? "Embroidery" : "DTF"}</td><td>{d.location}</td><td className="c">{d.method === "screen" ? d.colors : ""}</td><td>{d.inks}</td><td>{d.size}</td><td>{d.notes}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {inn?.production_notes && <div className="box"><b>Production notes</b><div style={{ whiteSpace: "pre-wrap" }}>{inn.production_notes}</div></div>}
          {arts.length > 0 && (
            <div className="box"><b>Art</b>
              <div className="artgrid">{arts.map((a, i) => (a.file_type.startsWith("image/") && signed[i]?.signedUrl ? <img key={a.id} src={signed[i].signedUrl!} alt={a.name} /> : <span key={a.id}>{a.name}</span>))}</div>
            </div>
          )}
          <div style={{ display: "flex", gap: 30, marginTop: 20, fontSize: 12, flexWrap: "wrap" }}><span>Printed by: ____________</span><span>Checked by: ____________</span><span>Date: ________</span></div>
        </div>
      </div>
    );
  }

  const isQ = o.type === "quote";
  return (
    <div style={{ background: "var(--bg)", minHeight: "100%" }}>
      <div className="print-bar"><PrintButton /></div>
      <div className="print-page" style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 13 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 20, borderBottom: "3px solid var(--ink)", paddingBottom: 14, marginBottom: 18, flexWrap: "wrap" }}>
          <div>
            {sh.logoUrl ? <img src={sh.logoUrl} alt={sh.name} style={{ maxHeight: 54 }} /> : <div style={{ fontSize: 26, fontWeight: 800 }}>{sh.name}</div>}
            <div className="sub" style={{ whiteSpace: "pre-line" }}>{sh.address}</div>
            <div className="sub">{[sh.phone, sh.email].filter(Boolean).join(" · ")}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="eyebrow">{isQ ? "Quote" : "Invoice"}</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>#{o.number}</div>
            <div className="sub">Date {fmtDateLong(todayISO())}</div>
            {o.po_number && <div className="sub">PO {o.po_number}</div>}
            {o.due_date && <div className="sub">In hands {fmtDateLong(o.due_date)}</div>}
          </div>
        </div>
        <div className="grid g2" style={{ marginBottom: 12 }}>
          <div>
            <div className="eyebrow">Bill to</div>
            <b>{cust.company || cust.name}</b>
            {cust.company && cust.name && <div>{cust.name}</div>}
            <div className="sub" style={{ whiteSpace: "pre-line" }}>{cust.address}</div>
            <div className="sub">{[cust.email, cust.phone].filter(Boolean).join(" · ")}</div>
          </div>
          <div>
            <div className="eyebrow">Job</div><b>{o.nickname}</b>
            {o.delivery_method !== "pickup" && o.ship_to && <div className="sub" style={{ whiteSpace: "pre-line" }}>{o.delivery_method === "ship" ? "Ship to" : "Deliver to"}: {o.ship_to}</div>}
            {o.approved_at && <div className="sub">Approved by {o.approved_name}, {fmtDateLong(o.approved_at.slice(0, 10))}</div>}
          </div>
        </div>
        <table className="items" style={{ minWidth: 0 }}>
          <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Each</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {groups.map((g, gi) => <GroupRows key={g.id} g={g} gc={c.groups[gi]} />)}
            {c.setup > 0 && <tr><td>Setup (screens / digitizing)</td><td /><td /><td className="r">{money(c.setup)}</td></tr>}
            {o.fees.filter((f) => +f.amount).map((f, i) => <tr key={i}><td>{f.label || "Fee"}</td><td /><td /><td className="r">{money(+f.amount)}</td></tr>)}
          </tbody>
        </table>
        <div className="totals" style={{ marginLeft: "auto", maxWidth: 300, marginTop: 12 }}>
          <div className="tr"><span>Subtotal</span><span>{money(c.items + c.setup + c.fees)}</span></div>
          {c.discount ? <div className="tr"><span>Discount</span><span>−{money(c.discount)}</span></div> : null}
          <div className="tr"><span>Tax{o.tax_exempt ? " (exempt)" : ` (${c.rate}%)`}</span><span>{money(c.tax)}</span></div>
          <div className="tr big"><span>Total</span><span>{money(c.total)}</span></div>
          {c.paid > 0 && <><div className="tr"><span>Paid</span><span>−{money(c.paid)}</span></div><div className="tr big"><span>Balance due</span><span>{money(c.balance)}</span></div></>}
        </div>
        {o.notes && <p style={{ whiteSpace: "pre-wrap" }}><span className="eyebrow">Notes</span><br />{o.notes}</p>}
        {sh.terms && <p className="sub">{sh.terms}</p>}
      </div>
    </div>
  );
}

function GroupRows({ g, gc }: { g: Group; gc: GroupCalc }) {
  return (
    <>
      {g.lines.map((l, li) => (
        <tr key={l.id}>
          <td>
            <b>{[l.style, l.garment].filter(Boolean).join(" · ") || "Garment"}</b>{l.color ? ` · ${l.color}` : ""}
            <div className="sub">{SIZES.filter((z) => l.sizes?.[z]).map((z) => `${z}: ${l.sizes[z]}`).join(", ")}</div>
            {li === g.lines.length - 1 && g.imprints.length > 0 && <div className="sub">Imprints: {g.imprints.map(imprintLabel).join("; ")}</div>}
          </td>
          <td className="r">{gc?.lines[li]?.qty}</td><td className="r">{money(gc?.lines[li]?.each)}</td><td className="r">{money(gc?.lines[li]?.sub)}</td>
        </tr>
      ))}
    </>
  );
}
