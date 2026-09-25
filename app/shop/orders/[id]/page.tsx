"use client";
import { SITE_URL } from "@/lib/config";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  calcOrder, LOCATIONS, mergeSettings, METHODS, newLine, PAY_METHODS, SIZES, ST, STATUSES, uid,
  type Customer, type Decoration, type Line, type Message, type Order, type OrderEvent, type Payment, type Proof, type Settings, type StatusKey,
} from "@/lib/pricing";
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
  const [saveState, setSaveState] = useState("");
  const [flash, setFlash] = useState("");
  const [armed, setArmed] = useState("");
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
    const list = (pr.data || []) as Proof[];
    if (list.length) {
      const { data: urls } = await sb.storage.from("proofs").createSignedUrls(list.map((x) => x.file_path), 3600);
      setProofs(list.map((x, i) => ({ ...x, url: urls?.[i]?.signedUrl || undefined })));
    } else setProofs([]);
  }, [sb, id]);

  useEffect(() => {
    (async () => {
      const [ord, cu, st, inn] = await Promise.all([
        sb.from("orders").select("*").eq("id", id).maybeSingle(),
        sb.from("customers").select("*"),
        sb.from("settings").select("data").eq("id", 1).maybeSingle(),
        sb.from("order_internal").select("production_notes").eq("order_id", id).maybeSingle(),
      ]);
      if (!ord.data) { setMissing(true); return; }
      const d = ord.data as Order;
      d.lines = d.lines?.length ? d.lines : [newLine()];
      d.fees = d.fees || [];
      d.discount_pct = +d.discount_pct || 0;
      d.tax_rate = d.tax_rate === null ? null : +d.tax_rate;
      setO(d);
      latest.current = d;
      setCustomers(((cu.data || []) as Customer[]).sort((a, b) => custLabel(a).localeCompare(custLabel(b))));
      setSettings(mergeSettings(st.data?.data));
      setProdNotes(inn.data?.production_notes || "");
      setSaveState("Saved");
      await loadSide();
      // mark customer messages read
      await sb.from("messages").update({ read_at: new Date().toISOString() }).eq("order_id", id).eq("author_type", "customer").is("read_at", null);
    })();
  }, [sb, id, loadSide]);

  const calc = useMemo(() => (o ? calcOrder(o, settings, payments) : null), [o, settings, payments]);

  const save = useCallback(async () => {
    const d = latest.current;
    if (!d) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const c = calcOrder(d, settings);
    setSaveState("Saving…");
    const { error } = await sb.from("orders").update({
      customer_id: d.customer_id || null, nickname: d.nickname, due_date: d.due_date || null, lines: d.lines, fees: d.fees,
      discount_pct: +d.discount_pct || 0, tax_exempt: d.tax_exempt, tax_rate: d.tax_rate === null || (d.tax_rate as unknown) === "" ? null : +d.tax_rate,
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
  const setLine = (i: number, fn: (l: Line) => void) => patch((d) => fn(d.lines[i]));
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
      customer_id: o.customer_id, nickname: (o.nickname || "Job") + " (copy)", lines: o.lines.map((l) => ({ ...l, id: uid() })), fees: o.fees,
      discount_pct: o.discount_pct, tax_exempt: o.tax_exempt, tax_rate: o.tax_rate, waive_setup: true, notes: o.notes, total: o.total, qty: o.qty,
    }).select("id").single();
    if (error || !data) return say("Couldn't duplicate: " + error?.message);
    router.push(`/shop/orders/${data.id}`);
  }

  async function del() {
    if (!o) return;
    if (armed !== "del") return arm("del");
    if (timer.current) clearTimeout(timer.current);
    latest.current = null;
    const paths = proofs.map((p) => p.file_path);
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
          <h1><span className="mono">#{o.number}</span> {o.nickname || "Untitled job"}</h1>
        </div>
        <div className="ed-actions">
          <span className="save-state">{saveState}</span>
          <select className="status-select" style={{ ["--sc" as string]: st.c }} aria-label="Status" value={o.status} onChange={(e) => setStatus(e.target.value as StatusKey)}>
            <optgroup label="Quote">{STATUSES.filter((s) => s.type === "quote").map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}</optgroup>
            <optgroup label="Invoice">{STATUSES.filter((s) => s.type === "invoice").map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}</optgroup>
          </select>
          {o.type === "quote" && <button className="btn" type="button" onClick={() => setStatus("approved")}>Convert to invoice</button>}
          <a className="btn" href={`/print/${o.id}`} target="_blank" rel="noreferrer">Print / PDF</a>
          <button className="btn" type="button" onClick={duplicate}>Duplicate</button>
          <button className={"btn danger" + (armed === "del" ? " armed" : "")} type="button" onClick={del}>{armed === "del" ? "Confirm delete" : "Delete"}</button>
        </div>
      </div>
      {flash && <div className="banner" role="status" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{flash}</div>}

      <div className="ed-grid">
        <div className="stack">
          <section className="panel">
            <div className="panel-h"><h2>Job details</h2></div>
            <div className="panel-b stack">
              <div className="grid g3">
                <div className="field"><label htmlFor="o-cust">Customer</label>
                  <select id="o-cust" value={o.customer_id || ""} onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__new") { router.push("/shop/customers"); return; }
                    const c = customers.find((x) => x.id === v);
                    patch((d) => { d.customer_id = v || null; if (c?.tax_exempt) d.tax_exempt = true; });
                  }}>
                    <option value="">Choose a customer…</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{custLabel(c)}{c.company && c.name ? " · " + c.name : ""}</option>)}
                    <option value="__new">+ Add a new customer…</option>
                  </select>
                </div>
                <div className="field"><label htmlFor="o-nick">Job name</label><input id="o-nick" type="text" value={o.nickname} placeholder="e.g. Fall league shirts" onChange={(e) => patch((d) => { d.nickname = e.target.value; })} /></div>
                <div className="field"><label htmlFor="o-due">Due date</label><input id="o-due" type="date" value={o.due_date || ""} onChange={(e) => patch((d) => { d.due_date = e.target.value || null; })} /></div>
              </div>
              {cust && <div className="sub">{[cust.name, cust.email, cust.phone].filter(Boolean).join(" · ")} · <Link href={`/shop/customers/${cust.id}`}>View customer</Link></div>}
            </div>
          </section>

          {o.lines.map((l, i) => (
            <LineEditor key={l.id} i={i} l={l} lc={calc.lines[i]} settings={settings} canRemove={o.lines.length > 1}
              setLine={(fn) => setLine(i, fn)} numOr={numOr} armed={armed === "line" + i}
              onDup={() => patch((d) => { const c: Line = JSON.parse(JSON.stringify(d.lines[i])); c.id = uid(); c.color = ""; c.sizes = {}; c.decorations.forEach((x) => (x.id = uid())); d.lines.splice(i + 1, 0, c); })}
              onRemove={() => { if (armed !== "line" + i) return arm("line" + i); patch((d) => { d.lines.splice(i, 1); }); }} />
          ))}
          <div className="row">
            <button className="btn" type="button" onClick={() => patch((d) => { d.lines.push(newLine()); })}>+ Add line item</button>
            <span className="faint" style={{ fontSize: 12 }}>Each garment and color gets its own line. Quantity breaks are figured per line.</span>
          </div>

          <section className="panel">
            <div className="panel-h"><h2>Fees & adjustments</h2><button className="btn sm" type="button" onClick={() => patch((d) => { d.fees.push({ label: "", amount: "" }); })}>+ Add fee</button></div>
            <div className="panel-b stack">
              {o.fees.length ? o.fees.map((f, i) => (
                <div key={i} className="fee-row">
                  <input type="text" aria-label="Fee description" placeholder="Rush fee, art time, shipping…" value={f.label} onChange={(e) => patch((d) => { d.fees[i].label = e.target.value; })} />
                  <input type="number" step="0.01" aria-label="Fee amount" placeholder="0.00" value={f.amount} onChange={(e) => patch((d) => { d.fees[i].amount = numOr(e.target.value); })} />
                  <button className="btn icon ghost" type="button" aria-label="Remove fee" onClick={() => patch((d) => { d.fees.splice(i, 1); })}>✕</button>
                </div>
              )) : <div className="faint" style={{ fontSize: 13 }}>No extra fees. Screens and digitizing are added automatically from each line&apos;s decorations.</div>}
              <div className="row" style={{ gap: 18 }}>
                <label className="check"><input type="checkbox" checked={o.waive_setup} onChange={(e) => patch((d) => { d.waive_setup = e.target.checked; })} /> Waive setup fees (reorder, screens on file)</label>
                <div className="row"><label className="lbl" htmlFor="o-disc">Discount %</label><input id="o-disc" type="number" step="0.5" min="0" max="100" style={{ width: 80 }} value={o.discount_pct} onChange={(e) => patch((d) => { d.discount_pct = +e.target.value || 0; })} /></div>
              </div>
            </div>
          </section>

          <section className="panel" id="proofs">
            <div className="panel-h"><h2>Artwork proofs</h2>
              {pendingProofs > 0 && o.status !== "quote" && <button className="btn sm primary" type="button" onClick={askProofs}>Ask customer to approve</button>}
            </div>
            <div className="panel-b stack">
              {proofs.length > 0 && (
                <div className="proofs">
                  {proofs.map((p) => (
                    <div key={p.id} className="proof">
                      <a className="img" href={p.url} target="_blank" rel="noreferrer">{p.file_type.startsWith("image/") && p.url ? <img src={p.url} alt={p.title} /> : <span className="file">{p.file_type.includes("pdf") ? "PDF" : "File"}: {p.title}</span>}</a>
                      <div className="pb">
                        <b>{p.title}</b>
                        <span className={"proof-status " + p.status}>{p.status === "pending" ? "Waiting on customer" : p.status === "approved" ? `Approved by ${p.decided_name || "customer"}` : "Changes requested"}</span>
                        {p.customer_comment && <span className="muted">“{p.customer_comment}”</span>}
                        <button className={"btn sm danger" + (armed === "proof" + p.id ? " armed" : "")} type="button" onClick={() => delProof(p)}>{armed === "proof" + p.id ? "Confirm remove" : "Remove"}</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="row">
                <input type="text" placeholder="Proof name (optional), e.g. Front v2" value={proofTitle} onChange={(e) => setProofTitle(e.target.value)} style={{ maxWidth: 260 }} aria-label="Proof name" />
                <label className="btn" style={{ cursor: "pointer" }}>{uploading ? "Uploading…" : "Upload mockup"}<input type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} /></label>
                <span className="faint" style={{ fontSize: 12 }}>PNG, JPG or PDF. Customers approve or reject each one.</span>
              </div>
            </div>
          </section>

          <section className="panel" id="messages">
            <div className="panel-h"><h2>Messages with customer</h2></div>
            <div className="panel-b stack">
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
                <textarea aria-label="Message to customer" placeholder={o.status === "quote" ? "Customers see messages once the quote is sent" : "Write to the customer…"} value={draftMsg} onChange={(e) => setDraftMsg(e.target.value)} />
                <button className="btn primary" type="button" onClick={postMessage} disabled={!draftMsg.trim()}>Send</button>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Notes</h2></div>
            <div className="panel-b grid g2">
              <div className="field"><label htmlFor="o-notes">Customer notes (shown on quote/invoice)</label><textarea id="o-notes" rows={4} value={o.notes} onChange={(e) => patch((d) => { d.notes = e.target.value; })} /></div>
              <div className="field"><label htmlFor="o-pnotes">Production notes (shop only)</label><textarea id="o-pnotes" rows={4} placeholder="Ink colors, PMS matches, mesh counts, placement…" value={prodNotes} onChange={(e) => onProdNotes(e.target.value)} /></div>
            </div>
          </section>
        </div>

        <aside className="ed-aside">
          <section className="panel">
            <div className="panel-h"><h2>Customer portal</h2><Pill status={o.status} portal /></div>
            <div className="panel-b stack">
              {o.status === "quote" ? (
                <>
                  <div className="muted" style={{ fontSize: 13 }}>This quote is a draft. The customer can&apos;t see it until you send it.</div>
                  <textarea id="send-note" rows={2} placeholder="Optional note for the email" aria-label="Note for the email" />
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
            </div>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Totals</h2><span className="faint num">{calc.qty} pcs</span></div>
            <div className="panel-b">
              <div className="totals">
                <div className="tr"><span>Line items</span><span>{money(calc.items)}</span></div>
                <div className="tr"><span>Setup (screens, digitizing)</span><span>{money(calc.setup)}</span></div>
                {calc.fees ? <div className="tr"><span>Fees</span><span>{money(calc.fees)}</span></div> : null}
                {calc.discount ? <div className="tr"><span>Discount ({o.discount_pct}%)</span><span>−{money(calc.discount)}</span></div> : null}
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

function LineEditor({ i, l, lc, settings, canRemove, setLine, numOr, onDup, onRemove, armed }: {
  i: number; l: Line; lc: ReturnType<typeof calcOrder>["lines"][number]; settings: Settings; canRemove: boolean; armed: boolean;
  setLine: (fn: (l: Line) => void) => void; numOr: (v: string) => number | ""; onDup: () => void; onRemove: () => void;
}) {
  const calcText = lc.hasOv
    ? <><b>{money(lc.each)}</b> each (override; calculated {money(lc.calcEach)}) · {lc.tierMin}+ tier</>
    : <>Blank {money(lc.garmentEach)} + print {money(lc.decoEach)} = <b>{money(lc.each)}</b> each · {lc.tierMin}+ tier</>;
  return (
    <section className="line">
      <div className="line-h">
        <span className="idx">LINE {i + 1}</span><b>{[l.style, l.garment].filter(Boolean).join(" · ") || "New garment"}</b><span className="spacer" />
        <button className="btn sm ghost" type="button" onClick={onDup}>Duplicate</button>
        {canRemove && <button className={"btn sm ghost danger" + (armed ? " armed" : "")} type="button" onClick={onRemove}>{armed ? "Remove line?" : "Remove"}</button>}
      </div>
      <div className="line-b">
        <div className="garment">
          <div className="field"><label>Garment</label><input type="text" placeholder="Unisex heavy cotton tee" value={l.garment} onChange={(e) => setLine((x) => { x.garment = e.target.value; })} /></div>
          <div className="field"><label>Style #</label><input type="text" placeholder="Gildan 5000" value={l.style} onChange={(e) => setLine((x) => { x.style = e.target.value; })} /></div>
          <div className="field"><label>Color</label><input type="text" placeholder="Sport Grey" value={l.color} onChange={(e) => setLine((x) => { x.color = e.target.value; })} /></div>
          <div className="field"><label>Blank cost</label><input type="number" step="0.01" min="0" placeholder="0.00" value={l.cost} onChange={(e) => setLine((x) => { x.cost = numOr(e.target.value); })} /></div>
        </div>
        <div className="sizes-wrap">
          <table className="sizes">
            <thead><tr>{SIZES.map((s) => <th key={s}>{s}{settings.upcharges[s] ? <small>+{money(settings.upcharges[s])}</small> : null}</th>)}<th>Qty</th></tr></thead>
            <tbody><tr>
              {SIZES.map((s) => (
                <td key={s}><input type="number" min="0" step="1" inputMode="numeric" aria-label={`${s} quantity`} className={l.sizes?.[s] ? "has" : ""} value={l.sizes?.[s] || ""}
                  onChange={(e) => setLine((x) => { const v = Math.max(0, Math.floor(+e.target.value || 0)); if (v) x.sizes[s] = v; else delete x.sizes[s]; })} /></td>
              ))}
              <td className="tot">{lc.qty}</td>
            </tr></tbody>
          </table>
        </div>
        <div className="decos">
          <div className="deco-h"><span>DECORATION</span><span>LOCATION</span><span>INK COLORS</span><span>EACH</span><span /></div>
          {(l.decorations || []).map((d, j) => (
            <div key={d.id} className="deco">
              <select aria-label="Decoration method" value={d.method} onChange={(e) => setLine((x) => { x.decorations[j].method = e.target.value as Decoration["method"]; })}>
                {Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input type="text" list="locs" aria-label="Print location" value={d.location} onChange={(e) => setLine((x) => { x.decorations[j].location = e.target.value; })} />
              {d.method === "screen" ? (
                <select aria-label="Ink colors" value={d.colors} onChange={(e) => setLine((x) => { x.decorations[j].colors = +e.target.value; })}>
                  {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} color{n > 1 ? "s" : ""}</option>)}
                </select>
              ) : <span className="faint" style={{ fontSize: 12 }}>{d.method === "embroidery" ? "Stitch count flat" : "Full color"}</span>}
              <span className="each">{money(lc.decos[j]?.each)}</span>
              <button className="btn icon ghost" type="button" aria-label="Remove decoration" onClick={() => setLine((x) => { x.decorations.splice(j, 1); })}>✕</button>
            </div>
          ))}
          <div><button className="btn sm" type="button" onClick={() => setLine((x) => { const used = x.decorations.map((d) => d.location); x.decorations.push({ id: uid(), method: "screen", location: LOCATIONS.find((z) => !used.includes(z)) || "", colors: 1 }); })}>+ Add location</button></div>
          <datalist id="locs">{LOCATIONS.map((x) => <option key={x} value={x} />)}</datalist>
        </div>
        {lc.belowMin && <div className="warnline">{lc.qty} pcs is under your {settings.tiers[0]}-piece minimum. Priced at the {settings.tiers[0]}+ tier.</div>}
        <div className="price-strip">
          <div className="calc">{calcText}{lc.upTotal ? ` · ${money(lc.upTotal)} size upcharges` : ""}</div>
          <label className="ov">Override each<input type="number" step="0.01" min="0" placeholder={lc.calcEach.toFixed(2)} value={l.priceOverride ?? ""} onChange={(e) => setLine((x) => { x.priceOverride = e.target.value === "" ? null : +e.target.value; })} /></label>
          <div className="lt"><div className="sub">{lc.setup ? `+ ${money(lc.setup)} setup` : " "}</div><b>{money(lc.sub)}</b></div>
        </div>
      </div>
    </section>
  );
}
