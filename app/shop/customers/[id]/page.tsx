"use client";
import { archiveMyMockup } from "@/app/portal/actions";
import { oneOfEach } from "@/lib/mockupList";
import { logoShirtsFrom } from "@/lib/logoShirts";
import BackLink from "@/components/BackLink";
import CustomerProductionFiles from "@/components/CustomerProductionFiles";
import CustomerBrands from "@/components/CustomerBrands";
import { use, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Customer } from "@/lib/pricing";
import { money } from "@/lib/format";
import { pvCountsAsSale, orderCountsAsSale } from "@/lib/sales";
import { useShopData } from "@/lib/shopData";
import { Due, Pill, pvStatusOf } from "@/components/bits";
import AccountAreas, { type AAttn, type AMessage, type AMockup, type APayment } from "@/components/AccountAreas";
import CustomerGangSheets from "@/components/CustomerGangSheets";
import { fmtDateLong } from "@/lib/format";
import { previewUrls } from "@/lib/designs";
import { staffCustomerMessage } from "@/app/shop/actions";
import { archiveDesign, deleteDesign, deleteDesignForever } from "@/app/artwork-actions";
import { PAY_TERMS, orderGroups, payDueDate, type Design, type PayTerms } from "@/lib/pricing";
import Timeline from "@/components/Timeline";
import CustomerTexts from "@/components/CustomerTexts";
import { customerTextCount } from "@/app/shop/texts-actions";
import { splitCustomer } from "@/lib/crm/private";
import { fmtStamp } from "@/lib/format";
import { orderSearchText } from "@/lib/search";
import ShopMessages from "@/components/ShopMessages";
import ShopGoods from "@/components/ShopGoods";
import CustomerContacts from "@/components/CustomerContacts";
import { cropPreviews, uploadDesign } from "@/lib/designs";
import BrandAssistant from "@/components/BrandAssistant";
import BrandSections from "@/components/BrandSections";
import DesignCatalogSetting from "@/components/DesignCatalogSetting";
import FilmFolder from "@/components/FilmFolder";
import ShopCustomerProjects from "@/components/ShopCustomerProjects";
import CustomerDesigns from "@/components/CustomerDesigns";
import ProgramAdmin from "@/components/ProgramAdmin";
import { emailStatement, recordLumpPayment } from "@/app/shop/pay-actions";
import { needsGoods } from "@/lib/goods";
import { ARCHIVE_LIST_COLS, archiveAsOrder, archivePayments, type ArchiveSummary, type PvTransaction } from "@/lib/archive";
import CustomerMove, { needsMove } from "@/components/CustomerMove";
import { fmtPhone } from "@/lib/phone";

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
  // their texts from the Mac (owners only): a Texts tab when there are any (Oct 15)
  const [textN, setTextN] = useState(0);
  useEffect(() => { if (id && id !== "new") customerTextCount(id).then(setTextN).catch(() => null); }, [id]);
  const [usedIds, setUsedIds] = useState<string[]>([]);
  // old orders brought over from Printavo: listed with the rest, marked "Archived"
  const [goodsOpen, setGoodsOpen] = useState(0);
  const [projOpen, setProjOpen] = useState(0);
  // any projects at all: the Projects tab shows only then (Oct 21, Nick); "More" adds the first one
  useEffect(() => { createClient().from("projects").select("id", { count: "exact", head: true }).eq("customer_id", id).then(({ count }) => setProjOpen(count || 0)); }, [id]);
  // Customer details: a panel that slides in over the page (Oct 21, Nick: "everything… needs to be rethought… simpler");
  // ?area=details (older links) and a brand new customer open it
  const [detailsOpen, setDetailsOpen] = useState(() => isNew || searchParams.get("area") === "details");
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
        sb.from("designs").select("*").eq("customer_id", id).eq("draft", false).order("number", { ascending: false }),
        sb.from("mockups").select("*").eq("customer_id", id).is("archived_at", null).eq("draft", false).order("created_at", { ascending: false }),
        sb.from("messages").select("*").or(ids.length ? `customer_id.eq.${id},order_id.in.(${ids.join(",")})` : `customer_id.eq.${id}`).order("created_at"),
        ids.length ? sb.from("proofs").select("order_id,created_at").in("order_id", ids).is("archived_at", null).eq("status", "pending") : Promise.resolve({ data: [] }),
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
      // logos still showing the whole page around the art: cropped once, in the background (Oct 16, Nick)
      cropPreviews(sb, dl).then(async (fixed) => {
        if (!fixed.length) return;
        const byId = new Map(fixed.map((x) => [x.id, x]));
        setDesigns((ds) => ds.map((x) => byId.get(x.id) || x));
        const urls = await previewUrls(sb, fixed);
        setDesignUrls((m) => ({ ...m, ...urls }));
      }).catch(() => null);
      const ml = oneOfEach((m.data || []) as { id: string; title: string; file_path: string; order_id: string | null; created_at: string; starred?: boolean; number?: number | null; snapshot?: { lines?: unknown[] } | null; shelved_at?: string | null }[]);
      const paths = ml.flatMap((x) => [x.file_path, x.file_path.replace(/\.png$/, "-thumb.png")]);
      const { data: signed } = paths.length ? await sb.storage.from("proofs").createSignedUrls(paths, 3600) : { data: [] };
      setMockups(ml.map((x, i) => ({ id: x.id, title: x.title, starred: !!x.starred, order_id: x.order_id, number: num(x.order_id), mno: x.number ?? null, setup: !!x.snapshot?.lines?.length, shelved: !!x.shelved_at, created_at: x.created_at, url: signed?.[i * 2]?.signedUrl || "", thumb: signed?.[i * 2 + 1]?.signedUrl || signed?.[i * 2]?.signedUrl || "" })));
      setMessages(((msg.data || []) as AMessage[]).map((x) => ({ ...x, number: num(x.order_id) })));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orderIds, loading, reload]);

  async function save() {
    if (!latest.current) return;
    // staff-only fields (notes, tags, follow-up, owner) are saved to customer_private; last contact is kept by the database
    const { id: _id, created_at, ...all } = latest.current;
    const { pub: rest0, priv } = splitCustomer(all);
    // the move fields belong to the move checklist: never written from here (a stale copy would undo a move)
    // so are the brand fields, each saved by its own section (a stale copy here would undo a label, guide or color added
    // there since the page opened)
    const { moved_at: _ma, moved_by: _mb, move_checklist: _mc, film_folder: _ff, neck_labels: _nl, style_guides: _sg, brand_print: _bp, brand_colors: _bc, ...rest } = rest0 as typeof rest0 & { moved_at?: unknown; moved_by?: unknown; move_checklist?: unknown; film_folder?: unknown; neck_labels?: unknown; style_guides?: unknown; brand_print?: unknown; brand_colors?: unknown };
    void _ma; void _mb; void _mc; void _ff; void _nl; void _sg; void _bp; void _bc;
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

  // moving off Printavo: their first order here waits for the move checklist (name, contacts, pricing…)
  const [moveOpen, setMoveOpen] = useState<"" | "quote" | "edit">("");
  async function newQuote() {
    if (needsMove(c as unknown as Record<string, unknown>)) { setMoveOpen("quote"); return; }
    const { data, error } = await createClient().from("orders").insert({ customer_id: id, tax_exempt: !!c?.tax_exempt, price_type: c?.price_type || "retail", draft: true }).select("id").single();
    if (data) router.push(`/shop/orders/${data.id}?new=1`);
    else if (error) alert(error.message);
  }

  const [tagDraft, setTagDraft] = useState("");
  const addTag = (raw: string) => { const t = raw.trim().replace(/,$/, "").slice(0, 40); if (!t || !c) return; if (!(c.tags || []).some((x) => x.toLowerCase() === t.toLowerCase())) set("tags", [...(c.tags || []), t]); setTagDraft(""); };
  const os = orders.filter((o) => o.customer_id === id);
  // the shirt color each logo was printed on (newest order first), for its card instead of a checkerboard (Oct 16)
  const logoShirts = logoShirtsFrom(os);
  const spent = os.filter((o) => orderCountsAsSale(o as { type: string; status: string; source?: string })).reduce((a, o) => a + o.total, 0) + archive.filter((a) => pvCountsAsSale(a.kind, a.status_name)).reduce((s, a) => s + (+a.total || 0), 0);
  const owed = os.filter((o) => o.type === "invoice").reduce((a, o) => a + Math.max(0, o.balance), 0);

  // Delete the whole customer: a small button at the bottom of Customer details, then a confirm (Oct 15, Nick: it sat
  // beside the order page's Delete in the same spot at the top)
  async function del() {
    if (os.length || archive.length) return;
    if (timer.current) clearTimeout(timer.current);
    await createClient().from("customers").delete().eq("id", id);
    router.push("/shop/customers");
  }

  if (loading) return <div className="empty">Loading…</div>;
  if (!c) return <><BackLink href="/shop/customers" label="Customers" /><div className="empty">This customer doesn&apos;t exist.</div></>;

  return (
    <>
      <BackLink href="/shop/customers" label="Customers" />
      <div className="page-head" style={{ marginTop: 8 }}>
        <div><h1>{c.company || c.name || "New Customer"}</h1>
          <div className="eyebrow cx-facts">{[c.company ? c.name : "", c.email, c.phone ? fmtPhone(c.phone) : "", c.price_type === "wholesale" ? "Wholesale" : "Retail", PAY_TERMS[c.payment_terms || "receipt"], c.tax_exempt ? "Tax exempt" : ""].filter(Boolean).map((x, i) => <span key={i}>{x}</span>)}{c.is_test ? <span className="ta-tag">Test account</span> : null}</div></div>
        <div className="row">
          <button className="btn" type="button" onClick={() => setDetailsOpen(true)}>Details</button>
          <a className="btn" href={`/portal?as=${id}`} target="_blank" rel="noreferrer">Their portal</a>
          <button className="btn primary" type="button" onClick={newQuote}>+ New quote</button>
        </div>
      </div>
      {c && "moved_at" in (c as object) && !c.is_test && (() => {
        const mv = c as unknown as { moved_at?: string | null; moved_by?: string; move_checklist?: Record<string, unknown> };
        const steps = Object.entries(mv.move_checklist || {}).filter(([k, v]) => k !== "pricing_note" && v).length;
        // moved: said in Details instead of a strip on every visit (Oct 21, Nick)
        return mv.moved_at
          ? null
          : <div className="mv-strip"><span><b>Not in the new system yet.</b> Their next order here waits for a short checklist (name, contacts, retail / wholesale, pricing, addresses).{steps ? ` ${steps} of 5 done.` : ""}</span><button type="button" className="btn primary sm" onClick={() => setMoveOpen("edit")}>Move to the new system</button></div>;
      })()}
      {moveOpen && <CustomerMove customerId={id} onClose={() => setMoveOpen("")} onMoved={async () => { const go = moveOpen === "quote"; await reloadShop(); const { data: fresh } = await createClient().from("customers").select("*").eq("id", id).maybeSingle(); if (fresh) setC((x) => (x ? { ...x, ...(fresh as object) } : x)); setMoveOpen(""); if (go) setTimeout(() => newQuote(), 300); }} />}
      {/* the Test account switch (components/TestAccount) is off (Oct 21, Nick: "we're past that point… might come back to it later") */}
      {detailsOpen && (
        <div className="cx-dr-bg" onClick={() => { setDetailsOpen(false); if (searchParams.get("area") === "details") router.replace(`/shop/customers/${id}`, { scroll: false }); }}>
          <aside className="cx-dr" role="dialog" aria-modal="true" aria-label="Customer details" onClick={(e) => e.stopPropagation()}>
            <div className="cx-dr-h"><h2>{c.company || c.name || "New customer"}</h2><span className="faint" style={{ fontSize: 12 }}>{state || "Saves as you type"}</span><span className="spacer" /><button type="button" className="btn sm" onClick={() => { setDetailsOpen(false); if (searchParams.get("area") === "details") router.replace(`/shop/customers/${id}`, { scroll: false }); }}>Done</button></div>
            <div className="cx-dr-b">
        {(c as unknown as { moved_at?: string | null }).moved_at ? <div className="faint cx-moved">In the new system since {new Date(String((c as unknown as { moved_at: string }).moved_at)).toLocaleDateString()}{(c as unknown as { moved_by?: string }).moved_by ? ` (${(c as unknown as { moved_by?: string }).moved_by})` : ""}. New orders are 40,000-series. <button type="button" className="linkbtn" onClick={() => { setDetailsOpen(false); setMoveOpen("edit"); }}>Checklist</button></div> : null}
      <div className="cust-grid">
          <form className="panel" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
            <div className="panel-h"><h2>Details</h2><span className="faint" style={{ fontSize: 12 }}>{state || "Saves as you type"}</span></div>
            <div className="panel-b stack">
              <div className="field"><label htmlFor="cu-company">Company / organization</label><input autoFocus={isNew} type="text" id="cu-company" value={c.company} onChange={(e) => set("company", e.target.value)} /></div>
              <div className="field"><label htmlFor="cu-name">Contact name</label><input type="text" id="cu-name" value={c.name} onChange={(e) => set("name", e.target.value)} /></div>
              <div className="grid g2">
                <div className="field"><label htmlFor="cu-email">Email (their portal login)</label><input type="email" id="cu-email" value={c.email} onChange={(e) => set("email", e.target.value)} /></div>
                <div className="field"><label htmlFor="cu-phone">Phone</label><input type="tel" id="cu-phone" value={c.phone} onChange={(e) => set("phone", e.target.value)} onBlur={(e) => { const f = fmtPhone(e.target.value); if (f !== e.target.value) set("phone", f); }} /></div>
              </div>
              <div className="grid g2">
                <div className="field"><label htmlFor="cu-address">Billing address</label><textarea id="cu-address" rows={3} value={c.address} onChange={(e) => set("address", e.target.value)} /></div>
                <div className="field"><label htmlFor="cu-ship">Ship-to address (if different)</label><textarea id="cu-ship" rows={3} value={c.ship_address || ""} onChange={(e) => set("ship_address", e.target.value)} /></div>
              </div>
              {/* other addresses (Oct 26, Nick: "sometimes clients may need different addresses other than just billing and ship
                  to… a shipping address and then a delivery address… other addresses… I can just click and add") */}
              <div className="cu-oa">
                <div className="lbl">Other addresses</div>
                {(c.other_addresses || []).map((a, i) => {
                  const put = (p: Partial<typeof a>) => set("other_addresses", (c.other_addresses || []).map((x) => (x.id === a.id ? { ...x, ...p } : x)));
                  return (
                    <div key={a.id} className="cu-oa-r">
                      <div className="field"><label htmlFor={`cu-oa-l${i}`}>What it&apos;s for</label><input id={`cu-oa-l${i}`} type="text" placeholder="Delivery, warehouse, second location…" value={a.label} onChange={(e) => put({ label: e.target.value })} /></div>
                      <div className="field"><label htmlFor={`cu-oa-a${i}`}>Address</label><textarea id={`cu-oa-a${i}`} rows={3} value={a.address} onChange={(e) => put({ address: e.target.value })} /></div>
                      <button type="button" className="btn icon ghost" aria-label={`Remove ${a.label || "this address"}`} title="Remove this address" onClick={() => set("other_addresses", (c.other_addresses || []).filter((x) => x.id !== a.id))}>×</button>
                    </div>
                  );
                })}
                <button type="button" className="lc-link" onClick={() => set("other_addresses", [...(c.other_addresses || []), { id: Math.random().toString(36).slice(2, 9), label: "", address: "" }])}>+ Add an address</button>
              </div>
              <div className="lbl" style={{ marginTop: 4 }}>Second contact (optional)</div>
              <div className="grid g3">
                <div className="field"><label htmlFor="cu-c2n">Name</label><input id="cu-c2n" type="text" value={c.contact2_name || ""} onChange={(e) => set("contact2_name", e.target.value)} /></div>
                <div className="field"><label htmlFor="cu-c2e">Email</label><input id="cu-c2e" type="email" value={c.contact2_email || ""} onChange={(e) => set("contact2_email", e.target.value)} /></div>
                <div className="field"><label htmlFor="cu-c2p">Phone</label><input id="cu-c2p" type="tel" value={c.contact2_phone || ""} onChange={(e) => set("contact2_phone", e.target.value)} onBlur={(e) => { const f = fmtPhone(e.target.value); if (f !== e.target.value) set("contact2_phone", f); }} /></div>
              </div>
              <CustomerContacts customerId={id} />
              <FilmFolder customerId={id} />
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
            <DesignCatalogSetting customerId={id} on={!!c.design_catalog} onChange={(v) => set("design_catalog", v)} portalOn={!!c.design_catalog_portal} onPortal={(v) => set("design_catalog_portal", v)} />
              <div className="field"><label htmlFor="cu-notes">Notes (only your shop sees these)</label><textarea id="cu-notes" rows={3} placeholder="Preferred inks, art files, pickup details…" value={c.notes} onChange={(e) => set("notes", e.target.value)} /></div>
              {/* Create order training (Oct 30, Nick: "it's okay to have special training for All My Sons… one of our top 10
                  clients"): how this customer's orders are made, read in full every time Create order reads one of theirs */}
              <div className="field"><label htmlFor="cu-training">Create order training</label><textarea id="cu-training" rows={6} placeholder="How their orders are made: the groups, which logo goes on what, personalization, pricing, shipping… Create order reads all of it for every one of their orders." value={c.order_training || ""} onChange={(e) => set("order_training", e.target.value)} /></div>
              <div className="cu-train-when">
                <div className="field"><label htmlFor="cu-train-n">Training name</label><input id="cu-train-n" type="text" value={c.order_training_name || ""} placeholder="All My Sons" onChange={(e) => set("order_training_name", e.target.value)} /></div>
                <div className="field"><label htmlFor="cu-train-w">Use it when the job says</label><input id="cu-train-w" type="text" value={c.order_training_when || ""} placeholder="AMS, All My Sons" onChange={(e) => set("order_training_when", e.target.value)} /></div>
              </div>
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
          </div>
        </div>
        <div className="cu-del">
          {!armed ? <>
            <button type="button" className="btn sm ghost cu-del-b" onClick={() => setArmed(true)} disabled={os.length > 0 || archive.length > 0}>Delete</button>
            {(os.length > 0 || archive.length > 0) && <span className="faint">{os.length ? "Delete or move this customer's orders first." : "This customer has Printavo orders on file, so it can't be deleted."}</span>}
          </> : <div className="cu-del-ask" role="alertdialog" aria-label="Delete this customer">
            <span>Delete <b>{c.company || c.name || "this customer"}</b>&apos;s whole customer account? This can&apos;t be undone.</span>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn sm danger" onClick={() => void del()}>Yes, delete the account</button>
              <button type="button" className="btn sm ghost" onClick={() => setArmed(false)}>Cancel</button>
            </div>
          </div>}
        </div>
            </div>
          </aside>
        </div>
      )}
      <AccountAreas mode="shop" gangPanel={<CustomerGangSheets customerId={id} />} brandPortal={c?.brand_portal !== false} onBrandPortal={(v) => set("brand_portal", v)} brandColors={c?.brand_colors || []} brandEditor={<BrandAssistant customerId={id} customerName={c?.company || c?.name || ""} onApplied={async () => { const { data } = await createClient().from("designs").select("*").eq("customer_id", id).order("number", { ascending: false }); if (data) setDesigns(data as Design[]); }}><BrandSections customerId={id} company={c?.company || c?.name || ""} /></BrandAssistant>} customerName={c?.company || c?.name || ""} goodsCount={goodsOpen}
          projectsPanel={<ShopCustomerProjects customerId={id} label={c.company || c.name || "Customer"} />} projectsCount={projOpen}
          programPanel={<ProgramAdmin customerId={id} />} hasProgram={hasProgram}
          designsPanel={c.design_catalog ? <CustomerDesigns customerId={id} portalOn={!!c.design_catalog_portal} onPortal={(v) => set("design_catalog_portal", v)} /> : undefined}
          productionPanel={<CustomerProductionFiles customerId={id} />}
          brandsPanel={<CustomerBrands customerId={id} />}
          textsPanel={textN ? <CustomerTexts customerId={id} /> : undefined} textsCount={textN}
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
        })} orders={[...os.map((o) => ({ ...o, search: orderSearchText(o), nickname: o.nickname || "", price_type: o.price_type, pay_due: o.type === "invoice" ? payDueDate(o, c.payment_terms) : null, pv: pvStatusOf(o as never) })),
          ...archive.map((a) => archiveAsOrder(a, `/shop/archive/${a.id}`))]} terms={PAY_TERMS[c.payment_terms || "receipt"]} payments={[...payments, ...archive.flatMap((a) => archivePayments(a, `/shop/archive/${a.id}`))].sort((a, b) => (b.paid_on || b.created_at).localeCompare(a.paid_on || a.created_at))} designs={designs} designUrls={designUrls} mockups={mockups} messages={messages}
        hrefBase="/shop/orders/"
        onSend={async (body) => { const r = await staffCustomerMessage(id, body); if (r.ok) setReload((n) => n + 1); return r; }}
        logoShirts={logoShirts} usedIds={usedIds} onDelete={deleteDesign} onArchive={archiveDesign} onDeleteForever={async (did) => { const r = await deleteDesignForever(did); if (r.ok) setDesigns((ds) => ds.filter((x) => x.id !== did)); return r; }}
        onArchiveMockup={archiveMyMockup}
        onStarMockup={async (mid, starred) => { const { error } = await createClient().rpc("set_mockup_star", { p_mockup: mid, p_starred: starred }); return { ok: !error, error: error?.message }; }}
        onUploadLogos={async (files, star, progress) => {
          const sb = createClient();
          const { data: u } = await sb.auth.getUser();
          const made: Design[] = [], bad: string[] = [];
          for (const [i, f] of files.entries()) {
            try {
              const d = await uploadDesign(sb, { file: f, customer_id: id, name: f.name.replace(/\.[^.]+$/, ""), by: u.user?.email || "" });
              if (star) { await sb.rpc("set_design_star", { p_design: d.id, p_starred: true }); d.starred = true; }
              made.push(d);
            } catch (e) { bad.push(`${f.name}: ${e instanceof Error ? e.message : "couldn't upload"}`); }
            progress(i + 1);
          }
          if (made.length) { setDesigns((ds) => [...made, ...ds.filter((d) => !made.some((m) => m.id === d.id))]); const urls = await previewUrls(sb, made); setDesignUrls((m) => ({ ...m, ...urls })); }
          return bad.length ? `Couldn't add ${bad.join("; ")}` : undefined;
        }}
        onStar={async (designId, starred) => { const { error } = await createClient().rpc("set_design_star", { p_design: designId, p_starred: starred }); return { ok: !error, error: error?.message }; }}
      />
    </>
  );
}
