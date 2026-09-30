"use client";
import TestAccount from "@/components/TestAccount";
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Customer } from "@/lib/pricing";
import { money } from "@/lib/format";
import { pvCountsAsSale, orderCountsAsSale } from "@/lib/sales";
import { useShopData } from "@/lib/shopData";
import { Due, Pill } from "@/components/bits";
import AccountAreas, { type AAttn, type AMessage, type AMockup, type APayment } from "@/components/AccountAreas";
import { fmtDateLong } from "@/lib/format";
import { previewUrls } from "@/lib/designs";
import { staffCustomerMessage } from "@/app/shop/actions";
import { archiveDesign, deleteDesign } from "@/app/artwork-actions";
import { PAY_TERMS, payDueDate, type Design, type PayTerms } from "@/lib/pricing";
import Timeline from "@/components/Timeline";
import { splitCustomer } from "@/lib/crm/private";
import { fmtStamp } from "@/lib/format";
import { orderSearchText } from "@/lib/search";
import ShopMessages from "@/components/ShopMessages";
import ShopGoods from "@/components/ShopGoods";
import CustomerContacts from "@/components/CustomerContacts";
import ShopCustomerProjects from "@/components/ShopCustomerProjects";
import ProgramAdmin from "@/components/ProgramAdmin";
import { emailStatement, recordLumpPayment } from "@/app/shop/pay-actions";
import { needsGoods } from "@/lib/goods";
import { ARCHIVE_LIST_COLS, archiveAsOrder, archivePayments, type ArchiveSummary, type PvTransaction } from "@/lib/archive";

export default function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const isNew = searchParams.get("new") === "1";
  const { orders, customers, settings, loading, reload: reloadShop } = useShopData();
  const [c, setC] = useState<Customer | null>(null);
  const [state, setState] = useState("");
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Customer | null>(null);

  useEffect(() => { if (!c && customers[id]) setC(customers[id]); }, [customers, id, c]);

  // account areas: payments, artwork, messages for this customer
  const [payments, setPayments] = useState<APayment[]>([]);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [designUrls, setDesignUrls] = useState<Record<string, string>>({});
  const [mockups, setMockups] = useState<AMockup[]>([]);
  const [messages, setMessages] = useState<AMessage[]>([]);
  const [pendingArt, setPendingArt] = useState<Record<string, string>>({});
  const [reload, setReload] = useState(0);
  const [usedIds, setUsedIds] = useState<string[]>([]);
  // old orders brought over from Printavo: listed with the rest, marked "Archived"
  const [goodsOpen, setGoodsOpen] = useState(0);
  const [projOpen, setProjOpen] = useState(0);
  const [hasProgram, setHasProgram] = useState(false);
  useEffect(() => { createClient().from("programs").select("id", { count: "exact", head: true }).eq("customer_id", id).then(({ count }) => setHasProgram(!!count)); }, [id]);
  const [archive, setArchive] = useState<(ArchiveSummary & { transactions: PvTransaction[] | null })[]>([]);
  useEffect(() => {
    createClient().from("archived_orders").select(`${ARCHIVE_LIST_COLS}, search:search_staff, transactions:data->transactions`)
      .eq("customer_id", id).order("order_date", { ascending: false }).then(({ data }) => setArchive((data || []) as never));
  }, [id]);
  const orderIds = orders.filter((o) => o.customer_id === id).map((o) => o.id).join(",");
  useEffect(() => {
    if (loading) return;
    const sb = createClient();
    const ids = orderIds ? orderIds.split(",") : [];
    const num = (oid: string | null) => orders.find((o) => o.id === oid)?.number ?? null;
    (async () => {
      const [p, d, m, msg, pr] = await Promise.all([
        ids.length ? sb.from("payments").select("*").in("order_id", ids).order("paid_on", { ascending: false }) : Promise.resolve({ data: [] }),
        sb.from("designs").select("*").eq("customer_id", id).order("number", { ascending: false }),
        sb.from("mockups").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
        sb.from("messages").select("*").or(ids.length ? `customer_id.eq.${id},order_id.in.(${ids.join(",")})` : `customer_id.eq.${id}`).order("created_at"),
        ids.length ? sb.from("proofs").select("order_id,created_at").in("order_id", ids).eq("status", "pending") : Promise.resolve({ data: [] }),
      ]);
      const pa: Record<string, string> = {};
      ((pr.data || []) as { order_id: string; created_at: string }[]).forEach((x) => { pa[x.order_id] = x.created_at; });
      setPendingArt(pa);
      setPayments(((p.data || []) as { id: string; order_id: string; amount: number; method: string; paid_on: string | null; created_at: string }[]).map((x) => ({ ...x, amount: +x.amount || 0, number: num(x.order_id) || 0 })));
      const dl = (d.data || []) as Design[];
      const { data: used } = await sb.rpc("designs_in_use", { p_customer: id });
      setUsedIds((used || []) as string[]);
      setDesigns(dl);
      setDesignUrls(await previewUrls(sb, dl));
      const ml = (m.data || []) as { id: string; title: string; file_path: string; order_id: string | null; created_at: string; starred?: boolean }[];
      const paths = ml.flatMap((x) => [x.file_path, x.file_path.replace(/\.png$/, "-thumb.png")]);
      const { data: signed } = paths.length ? await sb.storage.from("proofs").createSignedUrls(paths, 3600) : { data: [] };
      setMockups(ml.map((x, i) => ({ id: x.id, title: x.title, starred: !!x.starred, order_id: x.order_id, number: num(x.order_id), created_at: x.created_at, url: signed?.[i * 2]?.signedUrl || "", thumb: signed?.[i * 2 + 1]?.signedUrl || signed?.[i * 2]?.signedUrl || "" })));
      setMessages(((msg.data || []) as AMessage[]).map((x) => ({ ...x, number: num(x.order_id) })));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orderIds, loading, reload]);

  async function save() {
    if (!latest.current) return;
    // staff-only fields (notes, tags, follow-up, owner) are saved to customer_private; last contact is kept by the database
    const { id: _id, created_at, ...all } = latest.current;
    const { pub: rest, priv } = splitCustomer(all);
    setState("Saving…");
    const sb = createClient();
    const [a, b] = await Promise.all([
      sb.from("customers").update({ ...rest, email: (rest.email || "").trim().toLowerCase(), contact2_email: (rest.contact2_email || "").trim().toLowerCase() }).eq("id", id),
      sb.from("customer_private").upsert({ customer_id: id, ...priv }),
    ]);
    const error = a.error || b.error;
    setState(error ? "Save failed: " + error.message : "Saved");
  }
  function set<K extends keyof Customer>(k: K, v: Customer[K]) {
    setC((prev) => {
      const n = { ...(prev as Customer), [k]: v };
      latest.current = n;
      return n;
    });
    setState("Editing…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 700);
  }
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); save(); } }, []); // flush on leave

  async function newQuote() {
    const { data, error } = await createClient().from("orders").insert({ customer_id: id, tax_exempt: !!c?.tax_exempt, price_type: c?.price_type || "retail" }).select("id").single();
    if (data) router.push(`/shop/orders/${data.id}?new=1`);
    else if (error) alert(error.message);
  }

  const [tagDraft, setTagDraft] = useState("");
  const addTag = (raw: string) => { const t = raw.trim().replace(/,$/, "").slice(0, 40); if (!t || !c) return; if (!(c.tags || []).some((x) => x.toLowerCase() === t.toLowerCase())) set("tags", [...(c.tags || []), t]); setTagDraft(""); };
  const os = orders.filter((o) => o.customer_id === id);
  const spent = os.filter((o) => orderCountsAsSale(o as { type: string; status: string; source?: string })).reduce((a, o) => a + o.total, 0) + archive.filter((a) => pvCountsAsSale(a.kind, a.status_name)).reduce((s, a) => s + (+a.total || 0), 0);
  const owed = os.filter((o) => o.type === "invoice").reduce((a, o) => a + Math.max(0, o.balance), 0);

  async function del() {
    if (os.length || archive.length) return;
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3500); return; }
    if (timer.current) clearTimeout(timer.current);
    await createClient().from("customers").delete().eq("id", id);
    router.push("/shop/customers");
  }

  if (loading) return <div className="empty">Loading…</div>;
  if (!c) return <><Link className="back" href="/shop/customers">← Customers</Link><div className="empty">This customer doesn&apos;t exist.</div></>;

  return (
    <>
      <Link className="back" href="/shop/customers">← Customers</Link>
      <div className="page-head" style={{ marginTop: 8 }}>
        <div><div className="eyebrow">Customer{c.is_test ? <span className="ta-tag">Test account</span> : null}</div><h1>{c.company || c.name || "New Customer"}</h1></div>
        <div className="row">
          <Link className="btn" href={`/shop/customers/${id}?area=details`} scroll={false}>Customer details</Link>
          <a className="btn" href={`/portal?as=${id}`} target="_blank" rel="noreferrer">View their portal</a>
          <button className="btn primary" type="button" onClick={newQuote}>+ New quote</button>
          <button className={"btn danger" + (armed ? " armed" : "")} type="button" onClick={del} disabled={os.length > 0 || archive.length > 0} title={os.length ? "Delete this customer's orders first" : archive.length ? "This customer has archived Printavo orders" : ""}>{armed ? "Confirm delete" : "Delete"}</button>
        </div>
      </div>
      <TestAccount key={id} customerId={id} isTest={!!c.is_test} jobs={os.length} onChange={(v) => { reloadShop(); if (v !== undefined) setC((x) => (x ? { ...x, is_test: v } : x)); }} />
      <AccountAreas mode="shop" goodsCount={goodsOpen}
          projectsPanel={<ShopCustomerProjects customerId={id} label={c.company || c.name || "Customer"} onCount={setProjOpen} />} projectsCount={projOpen}
          programPanel={<ProgramAdmin customerId={id} />} hasProgram={hasProgram}
          statementHref={`/portal/statement?as=${id}`} onEmailStatement={() => emailStatement(id)}
          onRecordPayment={async (p) => { const r = await recordLumpPayment(id, p); if (r.ok && !p.preview) { reloadShop(); setReload((n) => n + 1); } return r; }}
          goodsPanel={c.price_type === "wholesale" || os.some((o) => o.price_type === "wholesale") ? <ShopGoods orderIds={os.filter(needsGoods).map((o) => o.id)} customerId={id} onCount={setGoodsOpen} /> : undefined}
          messagesPanel={<ShopMessages customerId={id} customerName={c.name || c.company || "Customer"} shopName={settings?.shop?.name || "FBS Print"}
          orders={os.map((o) => ({ id: o.id, number: o.number, nickname: o.nickname || "", href: `/shop/orders/${o.id}` }))} start={searchParams.get("c")} />} attention={os.flatMap((o): AAttn[] => {
          const out: AAttn[] = [];
          const d = (x?: string | null) => (x ? fmtDateLong(x.slice(0, 10)) : "");
          if (o.status === "request") out.push({ kind: "request", order_id: o.id, number: o.number, date: d(o.submitted_at || o.created_at) });
          if (o.status === "quote_sent") out.push({ kind: "quote", order_id: o.id, number: o.number, date: d(o.created_at) });
          if (pendingArt[o.id]) out.push({ kind: "art", order_id: o.id, number: o.number, date: d(pendingArt[o.id]) });
          if (o.type === "invoice" && o.balance > 0.004) out.push({ kind: "pay", order_id: o.id, number: o.number, date: money(o.balance) });
          if (o.price_type === "wholesale" && o.type === "invoice" && ["approved", "art", "blanks"].includes(o.status)) out.push({ kind: "receive", order_id: o.id, number: o.number, date: d(o.due_date) || "—" });
          return out;
        })} orders={[...os.map((o) => ({ ...o, search: orderSearchText(o), nickname: o.nickname || "", price_type: o.price_type, pay_due: o.type === "invoice" ? payDueDate(o, c.payment_terms) : null })),
          ...archive.map((a) => archiveAsOrder(a, `/shop/archive/${a.id}`))]} terms={PAY_TERMS[c.payment_terms || "receipt"]} payments={[...payments, ...archive.flatMap((a) => archivePayments(a, `/shop/archive/${a.id}`))].sort((a, b) => (b.paid_on || b.created_at).localeCompare(a.paid_on || a.created_at))} designs={designs} designUrls={designUrls} mockups={mockups} messages={messages}
        hrefBase="/shop/orders/"
        onSend={async (body) => { const r = await staffCustomerMessage(id, body); if (r.ok) setReload((n) => n + 1); return r; }}
        usedIds={usedIds} onDelete={deleteDesign} onArchive={archiveDesign}
        onStarMockup={async (mid, starred) => { const { error } = await createClient().rpc("set_mockup_star", { p_mockup: mid, p_starred: starred }); return { ok: !error, error: error?.message }; }}
        onStar={async (designId, starred) => { const { error } = await createClient().rpc("set_design_star", { p_design: designId, p_starred: starred }); return { ok: !error, error: error?.message }; }}
        details={
      <div className="cust-grid">
          <form className="panel" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
            <div className="panel-h"><h2>Details</h2><span className="faint" style={{ fontSize: 12 }}>{state || "Saves as you type"}</span></div>
            <div className="panel-b stack">
              <div className="field"><label htmlFor="cu-company">Company / organization</label><input autoFocus={isNew} type="text" id="cu-company" value={c.company} onChange={(e) => set("company", e.target.value)} /></div>
              <div className="field"><label htmlFor="cu-name">Contact name</label><input type="text" id="cu-name" value={c.name} onChange={(e) => set("name", e.target.value)} /></div>
              <div className="grid g2">
                <div className="field"><label htmlFor="cu-email">Email (their portal login)</label><input type="email" id="cu-email" value={c.email} onChange={(e) => set("email", e.target.value)} /></div>
                <div className="field"><label htmlFor="cu-phone">Phone</label><input type="tel" id="cu-phone" value={c.phone} onChange={(e) => set("phone", e.target.value)} /></div>
              </div>
              <div className="grid g2">
                <div className="field"><label htmlFor="cu-address">Billing address</label><textarea id="cu-address" rows={3} value={c.address} onChange={(e) => set("address", e.target.value)} /></div>
                <div className="field"><label htmlFor="cu-ship">Ship-to address (if different)</label><textarea id="cu-ship" rows={3} value={c.ship_address || ""} onChange={(e) => set("ship_address", e.target.value)} /></div>
              </div>
              <div className="lbl" style={{ marginTop: 4 }}>Second contact (optional)</div>
              <div className="grid g3">
                <div className="field"><label htmlFor="cu-c2n">Name</label><input id="cu-c2n" type="text" value={c.contact2_name || ""} onChange={(e) => set("contact2_name", e.target.value)} /></div>
                <div className="field"><label htmlFor="cu-c2e">Email</label><input id="cu-c2e" type="email" value={c.contact2_email || ""} onChange={(e) => set("contact2_email", e.target.value)} /></div>
                <div className="field"><label htmlFor="cu-c2p">Phone</label><input id="cu-c2p" type="tel" value={c.contact2_phone || ""} onChange={(e) => set("contact2_phone", e.target.value)} /></div>
              </div>
              <CustomerContacts customerId={id} />
              <div className="field"><label htmlFor="cu-type">Customer type</label>
                <select id="cu-type" value={c.price_type || "retail"} onChange={(e) => set("price_type", e.target.value as Customer["price_type"])}>
                  <option value="retail">Retail: we supply the garments</option>
                  <option value="wholesale">Wholesale: they supply the garments (imprint pricing only)</option>
                </select>
              </div>
              <div className="field"><label htmlFor="cu-terms">Payment terms</label>
              <select id="cu-terms" value={c.payment_terms || "receipt"} onChange={(e) => set("payment_terms", e.target.value as PayTerms)}>
                {(Object.keys(PAY_TERMS) as PayTerms[]).map((k) => <option key={k} value={k}>{PAY_TERMS[k]}</option>)}
              </select>
            </div>
            <label className="check"><input type="checkbox" checked={c.tax_exempt} onChange={(e) => set("tax_exempt", e.target.checked)} /> Tax exempt (new quotes start exempt)</label>
              <div className="field"><label htmlFor="cu-notes">Notes (only your shop sees these)</label><textarea id="cu-notes" rows={3} placeholder="Preferred inks, art files, pickup details…" value={c.notes} onChange={(e) => set("notes", e.target.value)} /></div>
            </div>
          </form>
          <div className="stack">
            <section className="panel">
              <div className="panel-h"><h2>Relationship</h2><span className="faint" style={{ fontSize: 12 }}>{c.last_contact_at ? `Last contact ${fmtStamp(c.last_contact_at)}` : "No contact logged yet"}</span></div>
              <div className="panel-b stack" style={{ gap: 10 }}>
                <div className="grid g2">
                  <div className="field"><label htmlFor="cu-fu">Next follow-up</label>
                    <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                      <input id="cu-fu" type="date" value={c.next_follow_up || ""} onChange={(e) => set("next_follow_up", e.target.value || null)} />
                      {c.next_follow_up && <button type="button" className="btn icon ghost" aria-label="Clear follow-up" onClick={() => set("next_follow_up", null)}>✕</button>}
                    </div>
                    <span className="faint" style={{ fontSize: 11.5 }}>Shows up in the Assistant on that day.</span>
                  </div>
                  <div className="field"><label htmlFor="cu-own">Account owner</label><select id="cu-own" value={c.account_owner || ""} onChange={(e) => set("account_owner", e.target.value)}><option value="">No one yet</option>{(settings?.accountOwners || []).map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}{c.account_owner && !(settings?.accountOwners || []).some((o) => o.name === c.account_owner) ? <option value={c.account_owner}>{c.account_owner}</option> : null}</select><span className="faint" style={{ fontSize: 11.5 }}>Owners are set in Settings → Staff.</span></div>
                </div>
                <div className="field"><label htmlFor="cu-tag">Tags</label>
                  <div className="tag-edit">
                    {(c.tags || []).map((t) => <span key={t} className="tg">{t}<button type="button" aria-label={`Remove ${t}`} onClick={() => set("tags", (c.tags || []).filter((x) => x !== t))}>✕</button></span>)}
                    <input id="cu-tag" type="text" placeholder="school, league, annual event, VIP…" value={tagDraft} onChange={(e) => { if (e.target.value.endsWith(",")) addTag(e.target.value); else setTagDraft(e.target.value); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(tagDraft); } }} onBlur={() => tagDraft && addTag(tagDraft)} />
                  </div>
                </div>
              </div>
            </section>
            <section className="panel">
              <div className="panel-h"><h2>Timeline</h2><span className="faint" style={{ fontSize: 12 }}>Calls, notes and emails · shop only</span></div>
              <div className="panel-b"><Timeline customerId={id} orderNumbers={Object.fromEntries(os.map((o) => [o.id, o.number]))} /></div>
            </section>
            <div className="stats" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))", margin: 0 }}>
              <div className="stat" style={{ cursor: "default" }}><span className="v">{os.length + archive.length}</span><span className="k">Orders</span></div>
              <div className="stat" style={{ cursor: "default" }}><span className="v">{money(spent)}</span><span className="k">Invoiced</span></div>
              <div className="stat" style={{ cursor: "default" }}><span className={"v" + (owed > 0.004 ? " alert" : "")}>{money(owed)}</span><span className="k">Balance owed</span></div>
            </div>
            <div className="tbl-wrap">
              <table className="tbl" style={{ minWidth: 520 }}>
                <thead><tr><th>#</th><th>Job</th><th>Status</th><th>Due</th><th className="r">Total</th></tr></thead>
                <tbody>
                  {os.map((o) => (
                    <tr key={o.id} onClick={() => router.push(`/shop/orders/${o.id}`)}><td><span className="ordno">{o.number}</span></td><td>{o.nickname || "Untitled Job"}</td><td><Pill status={o.status} /></td><td><Due date={o.due_date} status={o.status} /></td><td className="r">{money(o.total)}</td></tr>
                  ))}
                  {archive.map((a) => (
                    <tr key={a.id} onClick={() => router.push(`/shop/archive/${a.id}`)}><td><span className="ordno">{a.visual_id}</span></td><td>{a.nickname || "Untitled Job"}<span className="aa-arch">Archived</span></td><td><span className="pv-dot" style={{ ["--sc" as string]: a.status_color || "#888" }}>{a.status_name}</span></td><td>{a.due_date ? fmtDateLong(a.due_date) : "—"}</td><td className="r">{money(a.total)}</td></tr>
                  ))}
                  {!os.length && !archive.length && <tr><td colSpan={5}><div className="empty">No orders for this customer yet.</div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
          } />
    </>
  );
}
