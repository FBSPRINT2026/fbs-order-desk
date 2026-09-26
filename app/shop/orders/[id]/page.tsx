"use client";
import { SITE_URL } from "@/lib/config";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  calcOrder, designLabel, LOCATIONS, mergeSettings, newGroup, orderGroups, PAY_METHODS, priceList, SHIP_METHODS, ST, STATUSES, uid,
  type ArtFile, type Customer, type Delivery, type Design, type Garment, type GLine, type Group, type Message, type Order, type OrderEvent, type Payment, type PriceType, type Proof, type Settings, type StatusKey,
} from "@/lib/pricing";
import GroupEditor from "@/components/GroupEditor";
import { previewUrls, uploadDesign } from "@/lib/designs";
import { custLabel, fmtDate, fmtDateLong, fmtStamp, money, todayISO } from "@/lib/format";
import { Pill } from "@/components/bits";
import { requestProofApproval, sendToCustomer, staffMessage } from "../../actions";

const EVENT_LABEL: Record<string, string> = {
  created: "Created", sent: "Sent to customer", approved: "Customer approved quote", changes: "Customer asked for changes",
  proof_approved: "Proof approved", proof_changes: "Proof changes requested", proofs_requested: "Proof approval requested",
  payment: "Payment received", viewed: "Customer viewed",
};

export default function OrderEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const sb = useMemo(() => createClient(), []);
  const [o, setO] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);
  const [settings, setSettings] = useState<Settings>(mergeSettings({}));
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [proofs, setProofs] = useState<(Proof & { url?: string })[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [prodNotes, setProdNotes] = useState("");
  const [catalog, setCatalog] = useState<Garment[]>([]);
  const [lookingUp, setLookingUp] = useState("");
  // this customer's designs (logos) for the imprint design pickers
  const [designs, setDesigns] = useState<Design[]>([]);
  const [designUrls, setDesignUrls] = useState<Record<string, string>>({});
  // Style not in the catalog yet: pull it from S&S (saves it to the catalog too)
  async function lookupStyle(style: string, styleID?: number): Promise<Garment | null> {
    const key = style.trim().toUpperCase();
    if (!key || lookingUp === key) return null;
    setLookingUp(key);
    try {
      const r = await fetch(`/api/ss/lookup?${styleID ? `styleid=${styleID}` : `style=${encodeURIComponent(key)}`}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.garment) { say(j.error || "Couldn't find that style on S&S."); return null; }
      const g = j.garment as Garment;
      setCatalog((c) => [...c.filter((x) => x.id !== g.id), g].sort((a, b) => a.style.localeCompare(b.style)));
      return g;
    } finally { setLookingUp(""); }
  }
  const [art, setArt] = useState<(ArtFile & { url?: string })[]>([]);
  const [newCust, setNewCust] = useState<null | { company: string; name: string; email: string; phone: string; price_type: PriceType }>(null);
  const [saveState, setSaveState] = useState("");
  const [flash, setFlash] = useState("");
  const [armed, setArmed] = useState("");
  const [confirmRetail, setConfirmRetail] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Order | null>(null);

  const say = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 4000); };
  const arm = (k: string) => { setArmed(k); setTimeout(() => setArmed((a) => (a === k ? "" : a)), 3500); };

  const loadSide = useCallback(async () => {
    const [p, pr, m, e] = await Promise.all([
      sb.from("payments").select("*").eq("order_id", id).order("paid_on"),
      sb.from("proofs").select("*").eq("order_id", id).order("created_at", { ascending: false }),
      sb.from("messages").select("*").eq("order_id", id).order("created_at"),
      sb.from("order_events").select("*").eq("order_id", id).order("created_at", { ascending: false }),
    ]);
    setPayments((p.data || []) as Payment[]);
    setMessages((m.data || []) as Message[]);
    setEvents((e.data || []) as OrderEvent[]);
    const { data: af } = await sb.from("art_files").select("*").eq("order_id", id).order("created_at");
    const arts = (af || []) as ArtFile[];
    if (arts.length) {
      const { data: urls } = await sb.storage.from("proofs").createSignedUrls(arts.map((x) => x.file_path), 3600);
      setArt(arts.map((x, i) => ({ ...x, url: urls?.[i]?.signedUrl || undefined })));
    } else setArt([]);
    const list = (pr.data || []) as Proof[];
    if (list.length) {
      const { data: urls } = await sb.storage.from("proofs").createSignedUrls(list.map((x) => x.file_path), 3600);
      setProofs(list.map((x, i) => ({ ...x, url: urls?.[i]?.signedUrl || undefined })));
    } else setProofs([]);
  }, [sb, id]);

  useEffect(() => {
    (async () => {
      const [ord, cu, st, inn, cat] = await Promise.all([
        sb.from("orders").select("*").eq("id", id).maybeSingle(),
        sb.from("customers").select("*"),
        sb.from("settings").select("data").eq("id", 1).maybeSingle(),
        sb.from("order_internal").select("production_notes").eq("order_id", id).maybeSingle(),
        sb.from("garments").select("*").order("style"),
      ]);
      if (!ord.data) { setMissing(true); return; }
      const d = ord.data as Order;
      d.groups = orderGroups(d);
      if (!d.groups.length) d.groups = [newGroup()];
      d.delivery_method = d.delivery_method || "pickup";
      d.price_type = d.price_type || "retail";
      d.fees = d.fees || [];
      d.discount_pct = +d.discount_pct || 0;
      d.discount_amt = +(d.discount_amt || 0);
      d.discount_type = d.discount_type === "amt" ? "amt" : "pct";
      d.tax_rate = d.tax_rate === null ? null : +d.tax_rate;
      setO(d);
      latest.current = d;
      setCustomers(((cu.data || []) as Customer[]).sort((a, b) => custLabel(a).localeCompare(custLabel(b))));
      setSettings(mergeSettings(st.data?.data));
      setCatalog((cat.data || []) as Garment[]);
      setProdNotes(inn.data?.production_notes || "");
      setSaveState("Saved");
      await loadSide();
      // mark customer messages read
      await sb.from("messages").update({ read_at: new Date().toISOString() }).eq("order_id", id).eq("author_type", "customer").is("read_at", null);
    })();
  }, [sb, id, loadSide]);

  const calc = useMemo(() => (o ? calcOrder(o, settings, payments) : null), [o, settings, payments]);

  const custId = o?.customer_id || "";
  const loadDesigns = useCallback(async () => {
    if (!custId) { setDesigns([]); setDesignUrls({}); return; }
    const { data } = await sb.from("designs").select("*").eq("customer_id", custId).order("number", { ascending: false });
    const list = (data || []) as Design[];
    setDesigns(list);
    setDesignUrls(await previewUrls(sb, list));
  }, [sb, custId]);
  useEffect(() => { loadDesigns(); }, [loadDesigns]);
  async function uploadOrderDesign(file: File, name: string): Promise<Design | null> {
    if (!custId) { say("Pick a customer first. New art is saved to their account."); return null; }
    try {
      const { data: u } = await sb.auth.getUser();
      const d = await uploadDesign(sb, { file, name, customer_id: custId, by: u.user?.email || "" });
      await loadDesigns();
      say(`Saved as ${designLabel(d)} on this customer's account.`);
      return d;
    } catch (e) { say("Upload failed: " + (e instanceof Error ? e.message : String(e))); return null; }
  }

  const save = useCallback(async () => {
    const d = latest.current;
    if (!d) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const c = calcOrder(d, settings);
    setSaveState("Saving…");
    const { error } = await sb.from("orders").update({
      customer_id: d.customer_id || null, nickname: d.nickname, due_date: d.due_date || null, groups: d.groups, lines: [], fees: d.fees,
      price_type: d.price_type || "retail", po_number: d.po_number || "", production_date: d.production_date || null, rush: !!d.rush, delivery_method: d.delivery_method || "pickup",
      ship_to: d.ship_to || "", ship_method: d.ship_method || "", tracking: d.tracking || "",
      discount_pct: +d.discount_pct || 0, discount_amt: +(d.discount_amt || 0), discount_type: d.discount_type === "amt" ? "amt" : "pct", tax_exempt: d.tax_exempt, tax_rate: d.tax_rate === null || (d.tax_rate as unknown) === "" ? null : +d.tax_rate,
      waive_setup: d.waive_setup, notes: d.notes, total: c.total, qty: c.qty,
    }).eq("id", d.id);
    setSaveState(error ? "Save failed: " + error.message : "Saved");
  }, [sb, settings]);

  useEffect(() => () => { if (timer.current) save(); }, [save]);

  function patch(fn: (d: Order) => void) {
    setO((prev) => {
      if (!prev) return prev;
      const n: Order = JSON.parse(JSON.stringify(prev));
      fn(n);
      latest.current = n;
      return n;
    });
    setSaveState("Editing…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 700);
  }
  const setGroup = (i: number, fn: (g: Group) => void) => patch((d) => fn(d.groups[i]));
  const cloneGroup = (g: Group): Group => ({ id: uid(), lines: g.lines.map((l) => ({ ...l, id: uid() })), imprints: g.imprints.map((d) => ({ ...d, id: uid() })), finishing: [...(g.finishing || [])] });

  async function saveToCatalog(l: GLine) {
    const row = { style: l.style.trim(), brand: l.brand || "", description: l.garment, colors: l.color ? [l.color] : [], cost: +l.cost || 0 };
    const { data, error } = await sb.from("garments").insert(row).select("*").single();
    if (error) return say("Couldn't save to catalog: " + error.message);
    setCatalog((c) => [...c, data as Garment].sort((a, b) => a.style.localeCompare(b.style)));
    say(`${row.style} saved to your garment catalog.`);
  }

  async function addCustomer() {
    if (!newCust) return;
    if (!newCust.company.trim() && !newCust.name.trim()) return say("Enter a company or contact name.");
    const { data, error } = await sb.from("customers").insert({ ...newCust, email: newCust.email.trim().toLowerCase() }).select("*").single();
    if (error || !data) return say("Couldn't add customer: " + error?.message);
    setCustomers((cs) => [...cs, data as Customer].sort((a, b) => custLabel(a).localeCompare(custLabel(b))));
    patch((d) => { d.customer_id = data.id; d.price_type = (data.price_type as PriceType) || "retail"; });
    setNewCust(null);
  }

  // art files (shop only)
  const [artUploading, setArtUploading] = useState(false);
  async function uploadArt(files: FileList | null) {
    if (!o || !files?.length) return;
    setArtUploading(true);
    for (const f of Array.from(files)) {
      const path = `art/${o.id}/${uid()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
      const up = await sb.storage.from("proofs").upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (up.error) { say("Upload failed: " + up.error.message); continue; }
      await sb.from("art_files").insert({ order_id: o.id, name: f.name, file_path: path, file_type: f.type });
    }
    setArtUploading(false);
    loadSide();
  }
  async function delArt(a: ArtFile) {
    if (armed !== "art" + a.id) return arm("art" + a.id);
    await sb.storage.from("proofs").remove([a.file_path]);
    await sb.from("art_files").delete().eq("id", a.id);
    loadSide();
  }
  const numOr = (v: string): number | "" => (v === "" ? "" : isNaN(+v) ? "" : +v);

  async function setStatus(k: StatusKey) {
    if (!o || o.status === k) return;
    await save();
    const { error } = await sb.from("orders").update({ status: k, type: ST[k].type }).eq("id", o.id);
    if (error) return say("Couldn't change status: " + error.message);
    await sb.from("order_events").insert({ order_id: o.id, kind: "status", detail: k, actor: "shop" });
    setO((p) => (p ? { ...p, status: k, type: ST[k].type } : p));
    if (latest.current) latest.current = { ...latest.current, status: k, type: ST[k].type };
    loadSide();
  }

  async function send() {
    if (!o) return;
    const bad = (o.groups || []).flatMap((g) => g.imprints).find((d) => (d.method === "embroidery" || (d.method === "screen" && d.colors < 11)) && d.inks.trim() && d.inks.split(/[,;/+]|\s&\s/).map((x) => x.trim()).filter(Boolean).length !== d.colors);
    if (bad) return say(`${bad.location || "An imprint"}: the inks listed don't match its number of colors. Fix that before sending.`);
    const note = (document.getElementById("send-note") as HTMLTextAreaElement | null)?.value || "";
    await save();
    const r = await sendToCustomer(o.id, note);
    if (!r.ok) return say(r.error || "Couldn't send");
    if (o.status === "quote") setO((p) => (p ? { ...p, status: "quote_sent", sent_at: new Date().toISOString() } : p));
    say(r.emailed ? "Emailed the customer a link to their portal." : "Published to their portal. Email is off, so copy the link below and send it.");
    loadSide();
  }

  async function duplicate() {
    if (!o) return;
    await save();
    const { data, error } = await sb.from("orders").insert({
      customer_id: o.customer_id, nickname: (o.nickname || "Job") + " (copy)", groups: o.groups.map(cloneGroup), fees: o.fees, po_number: "",
      delivery_method: o.delivery_method, ship_to: o.ship_to, ship_method: o.ship_method, price_type: o.price_type,
      discount_pct: o.discount_pct, discount_amt: o.discount_amt || 0, discount_type: o.discount_type || "pct", tax_exempt: o.tax_exempt, tax_rate: o.tax_rate, waive_setup: false, notes: o.notes, total: o.total, qty: o.qty,
    }).select("id").single();
    if (error || !data) return say("Couldn't duplicate: " + error?.message);
    router.push(`/shop/orders/${data.id}`);
  }

  async function del() {
    if (!o) return;
    if (armed !== "del") return arm("del");
    if (timer.current) clearTimeout(timer.current);
    latest.current = null;
    const paths = [...proofs.map((p) => p.file_path), ...art.map((a) => a.file_path)];
    if (paths.length) await sb.storage.from("proofs").remove(paths);
    const { error } = await sb.from("orders").delete().eq("id", o.id);
    if (error) return say("Couldn't delete: " + error.message);
    router.push("/shop");
  }

  // payments
  const [payAmt, setPayAmt] = useState("");
  const [payMethod, setPayMethod] = useState("Card");
  const [payDate, setPayDate] = useState(todayISO());
  async function addPayment() {
    if (!o || !+payAmt) return say("Enter a payment amount.");
    const { error } = await sb.from("payments").insert({ order_id: o.id, amount: Math.round(+payAmt * 100) / 100, method: payMethod, paid_on: payDate || todayISO() });
    if (error) return say(error.message);
    await sb.from("order_events").insert({ order_id: o.id, kind: "payment", detail: `${money(+payAmt)} ${payMethod}`, actor: "shop" });
    setPayAmt("");
    loadSide();
  }
  async function delPayment(pid: string) {
    if (armed !== "pay" + pid) return arm("pay" + pid);
    await sb.from("payments").delete().eq("id", pid);
    loadSide();
  }

  // proofs
  const [uploading, setUploading] = useState(false);
  const [proofTitle, setProofTitle] = useState("");
  async function upload(files: FileList | null) {
    if (!o || !files?.length) return;
    setUploading(true);
    for (const f of Array.from(files)) {
      const path = `${o.id}/${uid()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
      const up = await sb.storage.from("proofs").upload(path, f, { contentType: f.type, upsert: false });
      if (up.error) { say("Upload failed: " + up.error.message); continue; }
      await sb.from("proofs").insert({ order_id: o.id, title: proofTitle || f.name.replace(/\.[^.]+$/, ""), file_path: path, file_type: f.type });
    }
    setProofTitle("");
    setUploading(false);
    loadSide();
  }
  async function delProof(p: Proof) {
    if (armed !== "proof" + p.id) return arm("proof" + p.id);
    await sb.storage.from("proofs").remove([p.file_path]);
    await sb.from("proofs").delete().eq("id", p.id);
    loadSide();
  }
  async function askProofs() {
    if (!o) return;
    const r = await requestProofApproval(o.id);
    say(!r.ok ? r.error || "Couldn't send" : r.emailed ? "Emailed the customer to review the proofs." : "Proofs are in their portal. Email is off, so send them the portal link.");
    loadSide();
  }

  // messages
  const [draftMsg, setDraftMsg] = useState("");
  async function postMessage() {
    if (!o || !draftMsg.trim()) return;
    const r = await staffMessage(o.id, draftMsg);
    if (!r.ok) return say(r.error || "Couldn't send");
    setDraftMsg("");
    loadSide();
  }

  function onProdNotes(v: string) {
    setProdNotes(v);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => { sb.from("order_internal").upsert({ order_id: id, production_notes: v }); }, 700);
  }

  if (missing) return <><Link className="back" href="/shop">← Orders</Link><div className="empty">This order was deleted or doesn&apos;t exist.</div></>;
  if (!o || !calc) return <div className="empty">Loading…</div>;

  const st = ST[o.status] || ST.quote;
  const cust = customers.find((c) => c.id === o.customer_id);
  const portalLink = typeof window !== "undefined" ? `${SITE_URL || window.location.origin}/portal/orders/${o.id}` : "";
  const pendingProofs = proofs.filter((p) => p.status === "pending").length;

  return (
    <>
      <Link className="back" href="/shop">← Orders</Link>
      <div className="ed-head" style={{ marginTop: 8 }}>
        <div className="ed-title">
          <div className="eyebrow">{o.type === "quote" ? "Quote" : "Invoice"} · created {fmtDateLong(o.created_at.slice(0, 10))}{o.approved_at ? ` · approved by ${o.approved_name} ${fmtDate(o.approved_at.slice(0, 10))}` : ""}</div>
          <h1><span className="mono">#{o.number}</span> {o.nickname || "Untitled job"}{o.rush && <span className="rush">RUSH</span>}</h1>
        </div>
        <div className="ed-actions">
          <span className="save-state">{saveState}</span>
          <select className="status-select" style={{ ["--sc" as string]: st.c }} aria-label="Status" value={o.status} onChange={(e) => setStatus(e.target.value as StatusKey)}>
            <optgroup label="Quote">{STATUSES.filter((s) => s.type === "quote").map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}</optgroup>
            <optgroup label="Invoice">{STATUSES.filter((s) => s.type === "invoice").map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}</optgroup>
          </select>
          {o.type === "quote" && <button className="btn" type="button" onClick={() => setStatus("approved")}>Convert to invoice</button>}
          <a className="btn" href={`/print/${o.id}`} target="_blank" rel="noreferrer">{o.type === "quote" ? "Quote PDF" : "Invoice PDF"}</a>
          <a className="btn" href={`/print/${o.id}?work=1`} target="_blank" rel="noreferrer">Work order</a>
          <a className="btn" href={`/print/${o.id}/labels`} target="_blank" rel="noreferrer">Box labels</a>
          <button className="btn" type="button" onClick={duplicate}>Duplicate</button>
          <button className={"btn danger" + (armed === "del" ? " armed" : "")} type="button" onClick={del}>{armed === "del" ? "Confirm delete" : "Delete"}</button>
        </div>
      </div>
      {flash && <div className="banner" role="status" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{flash}</div>}

      <div className="ed-grid">
        <div className="stack">
          <div className="top2">
            <section className="panel">
              <div className="panel-h"><h2>Customer</h2>
                {!newCust && <button className="btn sm" type="button" onClick={() => setNewCust({ company: "", name: "", email: "", phone: "", price_type: "retail" })}>+ New customer</button>}
              </div>
              <div className="panel-b stack">
                {newCust ? (
                  <div className="stack" style={{ gap: 8 }}>
                    <div className="grid g2">
                      <div className="field"><label htmlFor="nc-co">Company</label><input id="nc-co" type="text" autoFocus value={newCust.company} onChange={(e) => setNewCust({ ...newCust, company: e.target.value })} /></div>
                      <div className="field"><label htmlFor="nc-nm">Contact name</label><input id="nc-nm" type="text" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} /></div>
                      <div className="field"><label htmlFor="nc-em">Email</label><input id="nc-em" type="email" value={newCust.email} onChange={(e) => setNewCust({ ...newCust, email: e.target.value })} /></div>
                      <div className="field"><label htmlFor="nc-ph">Phone</label><input id="nc-ph" type="tel" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} /></div>
                      <div className="field"><label htmlFor="nc-pt">Customer type</label><select id="nc-pt" value={newCust.price_type} onChange={(e) => setNewCust({ ...newCust, price_type: e.target.value as PriceType })}><option value="retail">Retail (we supply garments)</option><option value="wholesale">Wholesale (they supply garments)</option></select></div>
                    </div>
                    <div className="row"><button className="btn primary sm" type="button" onClick={addCustomer}>Add and use</button><button className="btn ghost sm" type="button" onClick={() => setNewCust(null)}>Cancel</button></div>
                  </div>
                ) : (
                  <>
                    <select aria-label="Customer" value={o.customer_id || ""} onChange={(e) => {
                      const v = e.target.value;
                      const c = customers.find((x) => x.id === v);
                      patch((d) => { d.customer_id = v || null; if (c?.tax_exempt) d.tax_exempt = true; if (c) d.price_type = c.price_type || "retail"; });
                    }}>
                      <option value="">Choose a customer…</option>
                      {customers.map((c) => <option key={c.id} value={c.id}>{custLabel(c)}{c.company && c.name ? " · " + c.name : ""}</option>)}
                    </select>
                    <div className="cust-row">
                      {cust ? (
                        <div className="cust-card">
                          {cust.company && <div className="cc-co">{cust.company}</div>}
                          {cust.name && <div>{cust.name}</div>}
                          {cust.address && <div style={{ whiteSpace: "pre-line" }}>{cust.address}</div>}
                          {cust.email && <div className="sub">{cust.email}</div>}
                          {cust.phone && <div className="sub">{cust.phone}</div>}
                          <Link href={`/shop/customers/${cust.id}`} style={{ fontSize: 12 }}>Edit customer</Link>
                        </div>
                      ) : <div className="faint" style={{ fontSize: 13, flex: 1 }}>Pick a customer, or add a new one without leaving this order.</div>}
                      <div className="pt-box">
                        <div className="chips">
                          <button type="button" className={"chip" + (o.price_type !== "wholesale" ? " on" : "")} onClick={() => { if (o.price_type === "wholesale" && cust?.price_type === "wholesale") setConfirmRetail(true); else patch((d) => { d.price_type = "retail"; }); }}>Retail</button>
                          <button type="button" className={"chip" + (o.price_type === "wholesale" ? " on" : "")} onClick={() => { setConfirmRetail(false); patch((d) => { d.price_type = "wholesale"; }); }}>Wholesale</button>
                        </div>
                        {cust && o.price_type !== (cust.price_type || "retail") && <div className="faint" style={{ fontSize: 11.5 }}>Changed for this order</div>}
                      </div>
                    </div>
                    {confirmRetail && cust && (
                      <div className="confirm-bar">
                        <span><b>{custLabel(cust)}</b> is a wholesale customer. Are you sure you want to price this order as retail?</span>
                        <button type="button" className="btn sm primary" onClick={() => { setConfirmRetail(false); patch((d) => { d.price_type = "retail"; }); }}>Yes, switch to retail</button>
                        <button type="button" className="btn sm ghost" onClick={() => setConfirmRetail(false)}>Cancel</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-h"><h2>Job details</h2>
                <label className="check" style={{ fontSize: 13, color: o.rush ? "var(--danger)" : undefined, fontWeight: o.rush ? 700 : 400 }}><input type="checkbox" checked={!!o.rush} onChange={(e) => patch((d) => { d.rush = e.target.checked; })} /> Rush</label>
              </div>
              <div className="panel-b stack">
                <div className="grid g2">
                  <div className="field"><label htmlFor="o-nick">Job name</label><input id="o-nick" type="text" value={o.nickname} placeholder="Fall league shirts" onChange={(e) => patch((d) => { d.nickname = e.target.value; })} /></div>
                  <div className="field"><label htmlFor="o-po">Customer PO #</label><input id="o-po" type="text" value={o.po_number || ""} onChange={(e) => patch((d) => { d.po_number = e.target.value; })} /></div>
                  <div className="field"><label htmlFor="o-prod">Production date</label><input id="o-prod" type="date" value={o.production_date || ""} onChange={(e) => patch((d) => { d.production_date = e.target.value || null; })} /></div>
                  <div className="field"><label htmlFor="o-due">In-hands date</label><input id="o-due" type="date" value={o.due_date || ""} onChange={(e) => patch((d) => { d.due_date = e.target.value || null; })} /></div>
                  <div className="field"><label htmlFor="o-del">Pickup, ship or delivery</label>
                    <select id="o-del" value={o.delivery_method || "pickup"} onChange={(e) => patch((d) => { d.delivery_method = e.target.value as Delivery; if (d.delivery_method !== "pickup" && !d.ship_to && cust) d.ship_to = cust.ship_address || cust.address || ""; if (d.delivery_method === "ship" && !d.ship_method) d.ship_method = "UPS Ground"; })}>
                      <option value="pickup">Pickup</option><option value="ship">Ship</option><option value="deliver">Delivery</option>
                    </select>
                  </div>
                  {o.delivery_method === "ship" && (
                    <div className="field"><label htmlFor="o-sm">Ship method</label>
                      <select id="o-sm" value={SHIP_METHODS.includes(o.ship_method) ? o.ship_method : o.ship_method ? "__other" : ""} onChange={(e) => patch((d) => { d.ship_method = e.target.value === "__other" ? " " : e.target.value; })}>
                        <option value="">Choose…</option>
                        <optgroup label="UPS">{SHIP_METHODS.filter((m) => m.startsWith("UPS")).map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>
                        <optgroup label="FedEx">{SHIP_METHODS.filter((m) => m.startsWith("FedEx")).map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>
                        <optgroup label="USPS">{SHIP_METHODS.filter((m) => m.startsWith("USPS")).map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>
                        <option value="__other">Other…</option>
                      </select>
                      {o.ship_method && !SHIP_METHODS.includes(o.ship_method) && <input type="text" aria-label="Other ship method" placeholder="Freight, customer's account #…" value={o.ship_method.trim()} onChange={(e) => patch((d) => { d.ship_method = e.target.value || " "; })} style={{ marginTop: 4 }} />}
                    </div>
                  )}
                </div>
                {o.delivery_method !== "pickup" && (
                  <div className="grid g2">
                    <div className="field"><label htmlFor="o-st">{o.delivery_method === "ship" ? "Ship to" : "Deliver to"}</label><textarea id="o-st" rows={3} value={o.ship_to || ""} onChange={(e) => patch((d) => { d.ship_to = e.target.value; })} /></div>
                    {o.delivery_method === "ship" && <div className="field"><label htmlFor="o-tr">Tracking #</label><input id="o-tr" type="text" value={o.tracking || ""} onChange={(e) => patch((d) => { d.tracking = e.target.value; })} /></div>}
                  </div>
                )}
              </div>
            </section>
          </div>

          <datalist id="locs">{LOCATIONS.map((x) => <option key={x} value={x} />)}</datalist>
          {o.groups.map((g, gi) => (
            <GroupEditor key={g.id} gi={gi} g={g} gc={calc.groups[gi]} settings={settings} prices={priceList(settings, o.price_type)} catalog={catalog} canRemove={o.groups.length > 1}
              armed={armed} arm={arm} update={(fn) => setGroup(gi, fn)} onSaveToCatalog={saveToCatalog} onLookup={lookupStyle} lookingUp={lookingUp} designs={designs} designUrls={designUrls} onUploadDesign={uploadOrderDesign}
              onDuplicate={() => patch((d) => { d.groups.splice(gi + 1, 0, cloneGroup(d.groups[gi])); })}
              onRemove={() => patch((d) => { d.groups.splice(gi, 1); })} />
          ))}
          <div className="row">
            <button className="btn" type="button" onClick={() => patch((d) => { d.groups.push(newGroup()); })}>+ Add line item group</button>
            <span className="faint" style={{ fontSize: 12 }}>Garments in the same group share imprints, and their quantities add up for the price break.</span>
          </div>

          <div className="grid g2 fees-notes">
            <section className="panel">
              <div className="panel-h"><h2>Fees & adjustments</h2></div>
              <div className="panel-b stack">
                <div className="fee-row fee-head"><span>Description</span><span>Amount</span><span /></div>
                {(o.fees.length ? o.fees : [{ label: "", amount: "" as number | "" }]).map((f, i) => {
                  // an order with no fees still shows one blank row to type into
                  const edit = (fn: (x: { label: string; amount: number | "" }) => void) => patch((d) => { if (!d.fees[i]) d.fees[i] = { label: "", amount: "" }; fn(d.fees[i]); });
                  return (
                    <div key={i} className="fee-row">
                      <input type="text" aria-label="Fee description" placeholder="Rush fee, art time, shipping…" value={f.label} onChange={(e) => edit((x) => { x.label = e.target.value; })} />
                      <input type="number" step="0.01" aria-label="Fee amount" placeholder="0.00" value={f.amount} onChange={(e) => edit((x) => { x.amount = numOr(e.target.value); })} />
                      {o.fees.length ? <button className="btn icon ghost" type="button" tabIndex={-1} aria-label="Remove fee" onClick={() => patch((d) => { d.fees.splice(i, 1); })}>✕</button> : <span />}
                    </div>
                  );
                })}
                <button className="btn sm add-wide" type="button" onClick={() => patch((d) => { if (!d.fees.length) d.fees.push({ label: "", amount: "" }); d.fees.push({ label: "", amount: "" }); })}>+ Add fee</button>
              </div>
            </section>
            <section className="panel">
              <div className="panel-h"><h2>Notes</h2></div>
              <div className="panel-b stack">
                <div className="field"><label htmlFor="o-notes">Customer notes (shown on quote/invoice)</label><textarea id="o-notes" rows={4} value={o.notes} onChange={(e) => patch((d) => { d.notes = e.target.value; })} /></div>
                <div className="field"><label htmlFor="o-pnotes">Production notes (shop only)</label><textarea id="o-pnotes" rows={4} placeholder="Ink colors, PMS matches, mesh counts, placement…" value={prodNotes} onChange={(e) => onProdNotes(e.target.value)} /></div>
              </div>
            </section>
          </div>




        </div>

        <aside className="ed-aside">
          <section className="panel" id="messages">
            <div className="panel-h"><h2>Customer communication</h2><Pill status={o.status} portal /></div>
            <div className="panel-b stack">
              {o.status !== "quote" && <div className="comm-sum">
                <div><span>Quote</span><b>{o.approved_at ? `Approved by ${o.approved_name || "customer"}` : o.sent_at ? `Sent ${fmtStamp(o.sent_at)}` : "In portal"}</b></div>
                {o.approved_at && <div><span>Approved</span><b>{fmtStamp(o.approved_at)}</b></div>}
                {proofs.length > 0 && <div><span>Proofs</span><b>{[proofs.filter((p) => p.status === "approved").length && `${proofs.filter((p) => p.status === "approved").length} approved`, pendingProofs && `${pendingProofs} waiting`, proofs.filter((p) => p.status === "changes").length && `${proofs.filter((p) => p.status === "changes").length} changes requested`].filter(Boolean).join(" · ")}</b></div>}
                <div><span>Messages</span><b>{messages.length ? `${messages.length} · last ${messages[messages.length - 1].author_type === "staff" ? "from you" : "from customer"} ${fmtStamp(messages[messages.length - 1].created_at)}` : "None yet"}</b></div>
              </div>}
              {o.status === "quote" ? (
                <>
                  <textarea id="send-note" rows={4} placeholder="Message to the customer (goes with the quote)" aria-label="Message to the customer" />
                  <button className="btn primary" type="button" onClick={send}>Send quote to customer</button>
                </>
              ) : (
                <>
                  <div className="muted" style={{ fontSize: 13 }}>{o.sent_at ? `Sent ${fmtStamp(o.sent_at)}.` : "Visible in the customer's portal."} {o.approved_at ? `Approved by ${o.approved_name}.` : o.type === "quote" ? "Waiting for approval." : ""}</div>
                  <textarea id="send-note" rows={2} placeholder="Optional note for the email" aria-label="Note for the email" />
                  <button className="btn" type="button" onClick={send}>Email customer a link</button>
                </>
              )}
              {o.status !== "quote" && (
                <div className="row">
                  <input type="text" readOnly value={portalLink} aria-label="Portal link" onFocus={(e) => e.target.select()} />
                  <button className="btn sm" type="button" onClick={() => navigator.clipboard?.writeText(portalLink).then(() => say("Link copied"))}>Copy</button>
                </div>
              )}
              {o.status !== "quote" && (
                <>
              <div className="lbl" style={{ marginTop: 4 }}>MESSAGES</div>
              {messages.length ? (
                <div className="thread">
                  {messages.map((m) => (
                    <div key={m.id} className={"msg " + (m.author_type === "staff" ? "me" : "them")}>
                      <div className="who">{m.author_type === "staff" ? "You" : m.author_name || m.author_email} · {fmtStamp(m.created_at)}</div>{m.body}
                    </div>
                  ))}
                </div>
              ) : <div className="faint" style={{ fontSize: 13 }}>No messages yet. Customers can write to you from their portal.</div>}
              <div className="composer">
                <textarea aria-label="Message to customer" placeholder="Write to the customer…" value={draftMsg} onChange={(e) => setDraftMsg(e.target.value)} />
                <button className="btn primary" type="button" onClick={postMessage} disabled={!draftMsg.trim()}>Send</button>
              </div>
                </>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Totals</h2><span className="faint num">{calc.qty} pcs</span></div>
            <div className="panel-b">
              <div className="totals">
                <div className="tr"><span>Line items</span><span>{money(calc.items)}</span></div>
                <div className="tr"><span>Setup (screens, digitizing)</span><span>{money(calc.setup)}</span></div>
                {calc.materials ? <div className="tr"><span>2XL+ Materials Charge</span><span>{money(calc.materials)}</span></div> : null}
                {calc.fees ? <div className="tr"><span>Fees</span><span>{money(calc.fees)}</span></div> : null}
                <div className="tr"><span className="row" style={{ gap: 6 }}>Discount
                  <input type="number" step="0.01" min="0" aria-label="Discount" style={{ width: 66, padding: "3px 6px" }} placeholder="0"
                    value={(o.discount_type === "amt" ? o.discount_amt : o.discount_pct) || ""}
                    onChange={(e) => patch((d) => { const v = Math.max(0, +e.target.value || 0); if (d.discount_type === "amt") d.discount_amt = v; else d.discount_pct = Math.min(100, v); })} />
                  <select aria-label="Discount type" style={{ width: 52, padding: "3px 4px" }} value={o.discount_type === "amt" ? "amt" : "pct"}
                    onChange={(e) => patch((d) => { const v = d.discount_type === "amt" ? d.discount_amt || 0 : d.discount_pct || 0; d.discount_type = e.target.value === "amt" ? "amt" : "pct"; if (d.discount_type === "amt") { d.discount_amt = v; d.discount_pct = 0; } else { d.discount_pct = Math.min(100, v); d.discount_amt = 0; } })}>
                    <option value="pct">%</option><option value="amt">$</option>
                  </select></span><span>{calc.discount ? `−${money(calc.discount)}` : money(0)}</span></div>
                <div className="tr"><span className="row" style={{ gap: 6 }}>Tax <input type="number" step="0.01" aria-label="Tax rate percent" style={{ width: 66, padding: "3px 6px" }} placeholder={String(settings.taxRate)} value={o.tax_rate ?? ""} onChange={(e) => patch((d) => { d.tax_rate = e.target.value === "" ? null : +e.target.value; })} />%</span><span>{o.tax_exempt ? "Exempt" : money(calc.tax)}</span></div>
                <label className="check" style={{ fontSize: 12, color: "var(--ink-2)" }}><input type="checkbox" checked={o.tax_exempt} onChange={(e) => patch((d) => { d.tax_exempt = e.target.checked; })} /> Tax exempt</label>
                <div className="tr big"><span>Total</span><span>{money(calc.total)}</span></div>
                <div className="tr"><span>Paid</span><span>{money(calc.paid)}</span></div>
                <div className="tr bal"><span>Balance due</span><span style={{ color: calc.balance > 0.004 ? "var(--ink)" : "var(--ok)" }}>{money(calc.balance)}</span></div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Payments</h2></div>
            <div className="panel-b stack">
              {payments.length ? <div>{payments.map((p) => (
                <div key={p.id} className="pay-row"><span>{fmtDate(p.paid_on)} · {p.method}{p.stripe_session_id ? " (online)" : ""}</span>
                  <span className="row"><b className="num">{money(p.amount)}</b><button className={"btn icon ghost sm" + (armed === "pay" + p.id ? " danger armed" : "")} type="button" aria-label="Remove payment" onClick={() => delPayment(p.id)}>✕</button></span></div>
              ))}</div> : <div className="faint" style={{ fontSize: 13 }}>No payments recorded.</div>}
              <div className="pay-add">
                <input type="number" step="0.01" placeholder="Amount" aria-label="Payment amount" value={payAmt} onChange={(e) => setPayAmt(e.target.value)} />
                <select aria-label="Payment method" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</select>
                <input type="date" aria-label="Payment date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                <button className="btn" type="button" onClick={addPayment}>Record</button>
              </div>
              {calc.balance > 0.004 && calc.total > 0 && (
                <div className="row">
                  <button className="btn sm" type="button" onClick={() => setPayAmt(((calc.total * settings.depositPct) / 100).toFixed(2))}>{settings.depositPct}% deposit</button>
                  <button className="btn sm" type="button" onClick={() => setPayAmt(calc.balance.toFixed(2))}>Full balance</button>
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>History</h2></div>
            <div className="panel-b hist">
              {events.length ? events.map((e) => (
                <div key={e.id}>{e.kind === "status" ? <Pill status={e.detail} /> : <b>{EVENT_LABEL[e.kind] || e.kind}</b>}<span>{e.kind !== "status" && e.detail ? e.detail + " · " : ""}{fmtStamp(e.created_at)}</span></div>
              )) : <div>No activity yet.</div>}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
