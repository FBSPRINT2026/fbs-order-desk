import { notFound } from "next/navigation";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { blanksNeeded, loadOrders } from "@/lib/merchServer";
import { bySize, fmtDate, labelAnswers, orderCode, packingKey, r2, sizeName, type Field, type MerchOrder, type Product, type Store } from "@/lib/merch";
import PrintBar from "@/components/merch/PrintBar";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }>; searchParams: Promise<{ what?: string; order?: string; group?: string; over?: string; by?: string }> };
const money = (n: number) => (+n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * Printables for a merch store (staff): packing slips with a check box per item, 3"×1" bag labels, 4"×6" box labels by
 * grade / teacher, a hand-out sheet per classroom, the blank order sheet, and the give-back report.
 */
export default async function PrintPage({ params, searchParams }: P) {
  const { id } = await params;
  const sp = await searchParams;
  const { isStaff } = await getViewer();
  if (!isStaff) notFound();
  const admin = createAdminClient();
  const { data: s } = await admin.from("merch_stores").select("*").eq("id", id).maybeSingle();
  if (!s) notFound();
  const st = s as Store;
  const [{ data: ps }, all] = await Promise.all([admin.from("merch_products").select("*").eq("store_id", id).order("position"), loadOrders(admin, id)]);
  const products = (ps || []) as Product[];
  const fields = (st.fields || []) as Field[];
  const sf = fields.filter((f) => f.sort >= 0).sort((a, b) => a.sort - b.sort);
  const groupOf = (o: MerchOrder) => sf.slice(0, 2).map((f) => o.answers?.[f.key] || `No ${f.label.toLowerCase()}`).join(" · ") || (o.delivery === "ship" ? "Ship to home" : o.delivery === "pickup" ? "Pick up at FBS" : "Orders");
  let orders = all.filter((o) => !["cancelled", "refunded", "pending"].includes(o.status)).sort((a, b) => packingKey(fields, a.answers || {}, a.shopper?.name).localeCompare(packingKey(fields, b.answers || {}, b.shopper?.name)));
  if (sp.order) orders = orders.filter((o) => o.id === sp.order);
  if (sp.group) orders = orders.filter((o) => groupOf(o) === sp.group);
  const school = st.brand?.school || st.name;
  const color = st.brand?.primary || "#1F3A8A";
  const what = sp.what || "slips";
  const who = (o: MerchOrder) => o.answers?.student || o.shopper?.name || "";
  const pcs = (o: MerchOrder) => (o.items || []).reduce((a, i) => a + i.qty, 0);

  const css = `
  *{box-sizing:border-box} body{margin:0;font-family:Helvetica,Arial,sans-serif;color:#111;background:#eee}
  .mp-bar{position:sticky;top:0;display:flex;gap:12px;align-items:center;padding:10px 16px;background:#17202C;color:#fff;font-size:14px;z-index:2}
  .mp-bar span{opacity:.75}.mp-bar button{margin-left:auto;background:#fff;border:0;border-radius:8px;padding:8px 16px;font-weight:700;cursor:pointer}
  .pg{background:#fff;margin:14px auto;box-shadow:0 1px 4px rgba(0,0,0,.2);page-break-after:always;break-after:page;overflow:hidden}
  .pg:last-child{page-break-after:auto;break-after:auto}
  @media print{body{background:#fff}.mp-bar{display:none}.pg{margin:0;box-shadow:none}}
  .letter{width:8.5in;min-height:11in;padding:.55in .6in}
  .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:4px solid ${color};padding-bottom:10px;margin-bottom:14px}
  .hd h1{font-size:26px;margin:0;line-height:1.05}.hd .sub{font-size:13px;color:#444;margin-top:3px}
  .code{font-family:Menlo,monospace;font-size:20px;font-weight:700;text-align:right}
  .who{background:#FFF1A8;border:2px solid #111;border-radius:8px;padding:10px 14px;display:flex;gap:28px;flex-wrap:wrap;margin-bottom:14px}
  .who div{display:flex;flex-direction:column}.who small{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#333}.who b{font-size:22px}
  table{width:100%;border-collapse:collapse;font-size:13.5px}th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #111;padding:6px 6px}
  td{padding:9px 6px;border-bottom:1px solid #ccc;vertical-align:top}.r{text-align:right}.c{text-align:center}
  .box{display:inline-block;width:18px;height:18px;border:2px solid #111;border-radius:3px}
  .foot{margin-top:18px;font-size:11.5px;color:#444;line-height:1.45}
  .lbl3{width:3in;height:1in;padding:.06in .1in;display:flex;flex-direction:column;justify-content:center;margin:10px auto}
  .lbl3 .n{font-size:17pt;font-weight:800;line-height:1.02;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lbl3 .g{font-size:10pt;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lbl3 .o{font-size:8pt;font-family:Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lbl46{width:4in;height:6in;padding:.25in;display:flex;flex-direction:column;margin:10px auto}
  .lbl46 .s{font-size:13pt;font-weight:700;border-bottom:3px solid ${color};padding-bottom:6px}
  .lbl46 .big{font-size:38pt;font-weight:900;line-height:1;margin:.3in 0 .15in;word-break:break-word}
  .lbl46 .cnt{font-size:16pt;font-weight:700}.lbl46 .list{font-size:9.5pt;margin-top:auto;line-height:1.35;columns:2}
  h2{font-size:22px;margin:0 0 4px}
  `;
  const pageSize = what === "labels" ? "@page{size:3in 1in;margin:0}" : what === "boxes" ? "@page{size:4in 6in;margin:0}" : "@page{size:letter;margin:0}";

  let body: React.ReactNode = null, title = "", hint = "";
  if (what === "slips") {
    title = `Packing slips · ${orders.length}`; hint = "One per bag, in packing order. Check each item as it goes in the bag.";
    body = orders.map((o) => (
      <section key={o.id} className="pg letter">
        <div className="hd"><div><h1>{school}</h1><div className="sub">{st.name}{st.deliver_by ? ` · delivery around ${fmtDate(st.deliver_by, false)}` : ""}</div></div><div className="code">{orderCode(st, o.number)}<div style={{ fontSize: 12, fontWeight: 400 }}>{pcs(o)} item{pcs(o) === 1 ? "" : "s"}</div></div></div>
        <div className="who">{labelAnswers(fields, o.answers || {}).map((a) => <div key={a.label}><small>{a.label}</small><b>{a.value}</b></div>)}{!labelAnswers(fields, o.answers || {}).length && <div><small>For</small><b>{o.shopper.name}</b></div>}</div>
        <div style={{ fontSize: 13, marginBottom: 10 }}>Ordered by <b>{o.shopper.name}</b> · {o.shopper.email}{o.shopper.phone ? ` · ${o.shopper.phone}` : ""} · {o.delivery === "org" ? `Deliver to ${st.delivery?.org?.label || school}` : o.delivery === "pickup" ? "Pick up at FBS Print" : `Ship to ${[o.ship_to.name, o.ship_to.street1, o.ship_to.street2, o.ship_to.city, o.ship_to.state, o.ship_to.zip].filter(Boolean).join(", ")}`}</div>
        <table><thead><tr><th>Item</th><th>Color</th><th>Size</th><th className="c">Qty</th><th className="c">In bag</th><th className="c">Back-ordered</th></tr></thead>
          <tbody>{(o.items || []).map((it) => <tr key={it.id}><td><b>{it.name}</b>{Object.values(it.personalization || {}).length ? <div>Personalized: {Object.entries(it.personalization).map(([k, v]) => `${k}: ${v}`).join(", ")}</div> : null}</td><td>{it.color}</td><td><b>{sizeName(it.size)}</b></td><td className="c"><b>{it.qty}</b></td><td className="c"><span className="box" /></td><td className="c"><span className="box" /></td></tr>)}</tbody></table>
        {o.note && <p style={{ fontSize: 13 }}><b>Note:</b> {o.note}</p>}
        <div className="foot">Packed by ________ &nbsp; Checked by ________<br />This order was placed online and printed for {school} by FBS Print. Questions about this order? Reply to the confirmation email or use the order&apos;s status page.</div>
      </section>
    ));
  } else if (what === "labels") {
    title = `3×1 bag labels · ${orders.length}`; hint = "For 3\"×1\" thermal labels (Rollo / Zebra): set the printer to 3×1, scale 100%, no margins.";
    body = orders.map((o) => {
      const a = labelAnswers(fields, o.answers || {});
      const name = o.answers?.student || o.shopper.name;
      const rest = a.filter((x) => x.value !== name).map((x) => x.value).join(" · ");
      return <section key={o.id} className="pg lbl3"><div className="n">{name}</div><div className="g">{rest || school}</div><div className="o">{orderCode(st, o.number)} · {pcs(o)} item{pcs(o) === 1 ? "" : "s"} · {school}</div></section>;
    });
  } else if (what === "boxes") {
    const byKey = sp.by ? fields.filter((f) => f.key === sp.by) : sf.slice(0, 2);
    const gOf = (o: MerchOrder) => byKey.map((f) => o.answers?.[f.key] || "—").join(" · ") || "Orders";
    const groups = [...new Set(orders.map(gOf))];
    title = `Box labels · ${groups.length}`; hint = "4\"×6\" labels, one per box: bags go in the box for their group, in order.";
    body = groups.map((g) => {
      const os = orders.filter((o) => gOf(o) === g);
      return <section key={g} className="pg lbl46"><div className="s">{school} · {st.name}</div><div className="big">{g}</div><div className="cnt">{os.length} bag{os.length === 1 ? "" : "s"} · {os.reduce((a, o) => a + pcs(o), 0)} pieces</div><div className="list">{os.map((o) => <div key={o.id}>☐ {who(o)}</div>)}</div></section>;
    });
  } else if (what === "handout") {
    const groups = [...new Set(orders.map(groupOf))];
    title = `Hand-out sheets · ${groups.length}`; hint = "One page per group: goes in the box so the teacher can check off each bag.";
    body = groups.map((g) => {
      const os = orders.filter((o) => groupOf(o) === g);
      return (
        <section key={g} className="pg letter">
          <div className="hd"><div><h1>{g}</h1><div className="sub">{school} · {st.name}</div></div><div className="code">{os.length} bag{os.length === 1 ? "" : "s"}</div></div>
          <p style={{ fontSize: 13, marginTop: 0 }}>Each bag is labeled with the student&apos;s name. Please check off each one as it&apos;s handed out. Missing something? Contact {st.contact?.name || "your PTA"}{st.contact?.email ? ` (${st.contact.email})` : ""}.</p>
          <table><thead><tr><th>Student</th><th>Order</th><th>What&apos;s in the bag</th><th className="c">Handed out</th></tr></thead>
            <tbody>{os.map((o) => <tr key={o.id}><td><b>{who(o)}</b></td><td style={{ fontFamily: "Menlo,monospace", fontSize: 12 }}>{orderCode(st, o.number)}</td><td>{(o.items || []).map((i) => `${i.qty > 1 ? `${i.qty}× ` : ""}${i.name} (${i.size})`).join(", ")}</td><td className="c"><span className="box" /></td></tr>)}</tbody></table>
        </section>
      );
    });
  } else if (what === "blanks") {
    const over = Math.max(0, +(sp.over || 0));
    const rows = blanksNeeded(products, all);
    const sizes = [...new Set(rows.flatMap((r) => Object.keys(r.sizes)))].sort(bySize);
    const plus = (n: number) => (over ? n + Math.ceil((n * over) / 100) : n);
    title = "Blank order sheet"; hint = over ? `Includes ${over}% extra for misprints.` : "Exact counts from the orders.";
    body = (
      <section className="pg letter">
        <div className="hd"><div><h1>Blanks to order</h1><div className="sub">{school} · {st.name} · {all.filter((o) => !["cancelled", "refunded", "pending"].includes(o.status)).length} orders{over ? ` · +${over}% extra` : ""}</div></div><div className="code">{new Date().toLocaleDateString("en-US")}</div></div>
        <table><thead><tr><th>Supplier</th><th>Style</th><th>Color</th>{sizes.map((z) => <th key={z} className="r">{z}</th>)}<th className="r">Total</th><th className="c">Ordered</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.supplier + r.style + r.color}><td>{r.supplier === "ss" ? "S&S" : r.supplier === "sanmar" ? "SanMar" : r.supplier}</td><td><b>{r.style}</b><div style={{ fontSize: 11 }}>{r.brand}</div></td><td>{r.color}</td>{sizes.map((z) => <td key={z} className="r">{r.sizes[z] ? plus(r.sizes[z]) : ""}</td>)}<td className="r"><b>{sizes.reduce((a, z) => a + (r.sizes[z] ? plus(r.sizes[z]) : 0), 0)}</b></td><td className="c"><span className="box" /></td></tr>)}</tbody></table>
      </section>
    );
  } else if (what === "report") {
    const live = all.filter((o) => !["cancelled", "refunded", "pending"].includes(o.status));
    const m = new Map<string, { name: string; size: string; units: number; price: number; give: number; giveback: number; sales: number }>();
    for (const o of live) for (const it of o.items || []) { const k = `${it.name}|${it.size}|${it.giveback}`; const r = m.get(k) || { name: it.name, size: it.size, units: 0, price: it.unit_price, give: it.giveback, giveback: 0, sales: 0 }; r.units += it.qty; r.giveback = r2(r.giveback + it.qty * it.giveback); r.sales = r2(r.sales + it.qty * it.unit_price); m.set(k, r); }
    const rows = [...m.values()].sort((a, b) => a.name.localeCompare(b.name) || bySize(a.size, b.size));
    const tot = rows.reduce((a, r) => ({ u: a.u + r.units, g: r2(a.g + r.giveback), s: r2(a.s + r.sales) }), { u: 0, g: 0, s: 0 });
    title = "Give-back report"; hint = "For the organization: what they earned from the store.";
    body = (
      <section className="pg letter">
        <div className="hd"><div><h1>Give-back report</h1><div className="sub">{school} · {st.name}{st.closes_at ? ` · closed ${fmtDate(st.closes_at, false)}` : ""}</div></div><div className="code" style={{ color }}>{money(tot.g)}</div></div>
        <p style={{ fontSize: 14 }}>{live.length} orders · {tot.u} pieces · {money(tot.s)} in item sales. The give-back is the amount added on top of FBS Print&apos;s price on each piece.</p>
        <table><thead><tr><th>Product</th><th>Size</th><th className="r">Pieces</th><th className="r">Price</th><th className="r">Give-back each</th><th className="r">Give-back</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.name + r.size + r.give}><td>{r.name}</td><td>{r.size}</td><td className="r">{r.units}</td><td className="r">{money(r.price)}</td><td className="r">{money(r.give)}</td><td className="r"><b>{money(r.giveback)}</b></td></tr>)}</tbody>
          <tfoot><tr><td colSpan={2}><b>Total</b></td><td className="r"><b>{tot.u}</b></td><td colSpan={2} /><td className="r"><b>{money(tot.g)}</b></td></tr></tfoot></table>
        <div className="foot">Prepared by FBS Print for {school}.</div>
      </section>
    );
  }
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css + pageSize }} />
      <PrintBar title={title} hint={hint} />
      {orders.length || ["blanks", "report"].includes(what) ? body : <p style={{ padding: 20 }}>Nothing to print.</p>}
    </>
  );
}
