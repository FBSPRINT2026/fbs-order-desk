import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calcOrder, mergeSettings, METHODS, SIZES, type Customer, type Order, type Payment } from "@/lib/pricing";
import { fmtDateLong, money, todayISO } from "@/lib/format";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

// A clean quote/invoice page for printing or "Save as PDF".
export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
  const c = calcOrder(o, settings, (pays || []) as Payment[]);
  const cust = (cu || {}) as Partial<Customer>;
  const sh = settings.shop;
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
            {o.due_date && <div className="sub">{isQ ? "Needed by" : "Due"} {fmtDateLong(o.due_date)}</div>}
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
          <div><div className="eyebrow">Job</div><b>{o.nickname}</b>{o.approved_at && <div className="sub">Approved by {o.approved_name}, {fmtDateLong(o.approved_at.slice(0, 10))}</div>}</div>
        </div>
        <table className="items" style={{ minWidth: 0 }}>
          <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Each</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {o.lines.map((l, i) => (
              <tr key={l.id}>
                <td><b>{[l.style, l.garment].filter(Boolean).join(" · ") || "Garment"}</b>{l.color ? ` · ${l.color}` : ""}
                  <div className="sub">{SIZES.filter((z) => l.sizes?.[z]).map((z) => `${z}: ${l.sizes[z]}`).join(", ")}</div>
                  <div className="sub">{l.decorations.map((d) => `${METHODS[d.method]} ${d.location}${d.method === "screen" ? ` (${d.colors}c)` : ""}`).join("; ")}</div></td>
                <td className="r">{c.lines[i].qty}</td><td className="r">{money(c.lines[i].each)}</td><td className="r">{money(c.lines[i].sub)}</td>
              </tr>
            ))}
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
