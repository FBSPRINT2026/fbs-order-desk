"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Activity } from "@/lib/pricing";
import { fmtStamp } from "@/lib/format";
import { logActivity } from "@/app/shop/ai-actions";

const KINDS: { k: Activity["kind"]; label: string }[] = [
  { k: "note", label: "Note" }, { k: "call", label: "Call" }, { k: "email", label: "Email" }, { k: "meeting", label: "Meeting" }, { k: "sms", label: "Text" },
];

/**
 * The CRM timeline: calls, notes, pasted or forwarded emails, meetings. On a customer page it
 * shows everything for that customer; on an order it shows that order's entries.
 */
export default function Timeline({ customerId, orderId, orderNumbers, compact }: { customerId: string | null; orderId?: string; orderNumbers?: Record<string, number>; compact?: boolean }) {
  const sb = useMemo(() => createClient(), []);
  const [items, setItems] = useState<Activity[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<null | { kind: Activity["kind"]; direction: Activity["direction"]; subject: string; body: string; when: string; busy?: boolean }>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    if (!customerId && !orderId) { setLoaded(true); return; }
    let q = sb.from("activities").select("*").order("occurred_at", { ascending: false }).limit(compact ? 20 : 200);
    q = orderId ? q.eq("order_id", orderId) : q.eq("customer_id", customerId!);
    const { data, error } = await q;
    if (error) setMissing(true);
    setItems((data || []) as Activity[]);
    setLoaded(true);
  }, [sb, customerId, orderId, compact]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form) return;
    setForm({ ...form, busy: true });
    const r = await logActivity({ customerId, orderId: orderId || null, kind: form.kind, direction: form.kind === "note" ? "none" : form.direction, subject: form.subject, body: form.body, occurredAt: form.when ? new Date(form.when).toISOString() : undefined });
    if (!r.ok) { setForm({ ...form, busy: false }); setMsg(r.error || "Couldn't save."); return; }
    setForm(null);
    setMsg(r.aiNote || "");
    load();
  }

  if (missing) return null;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {form ? (
        <div className="tl-form">
          <div className="row" style={{ gap: 6 }}>
            <div className="chips">{KINDS.map((k) => <button key={k.k} type="button" className={"chip" + (form.kind === k.k ? " on" : "")} onClick={() => setForm({ ...form, kind: k.k, direction: k.k === "note" ? "none" : form.direction === "none" ? "out" : form.direction })}>{k.label}</button>)}</div>
            {form.kind !== "note" && (
              <select aria-label="Direction" style={{ width: "auto" }} value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as Activity["direction"] })}>
                <option value="out">{form.kind === "email" ? "We sent" : form.kind === "call" ? "We called" : "Outgoing"}</option>
                <option value="in">{form.kind === "email" ? "They sent" : form.kind === "call" ? "They called" : "Incoming"}</option>
              </select>
            )}
            <input type="datetime-local" aria-label="When" title="When (leave blank for now)" style={{ width: "auto" }} value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} />
          </div>
          {form.kind !== "note" && <input type="text" aria-label="Subject" placeholder={form.kind === "email" ? "Subject" : "Topic (optional)"} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />}
          <textarea rows={form.kind === "email" ? 6 : 3} aria-label="Details" placeholder={form.kind === "email" ? "Paste the email text" : form.kind === "call" ? "What was discussed, what's next" : "Note"} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <div className="row"><button type="button" className="btn primary sm" disabled={form.busy || (!form.body.trim() && !form.subject.trim())} onClick={save}>{form.busy ? "Saving…" : "Save"}</button><button type="button" className="btn ghost sm" onClick={() => setForm(null)}>Cancel</button></div>
        </div>
      ) : (
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn sm" onClick={() => setForm({ kind: "call", direction: "out", subject: "", body: "", when: "" })}>+ Log a call</button>
          <button type="button" className="btn sm ghost" onClick={() => setForm({ kind: "note", direction: "none", subject: "", body: "", when: "" })}>+ Note</button>
          <button type="button" className="btn sm ghost" onClick={() => setForm({ kind: "email", direction: "in", subject: "", body: "", when: "" })}>+ Paste an email</button>
        </div>
      )}
      {msg && <div className="okmsg">{msg}</div>}
      {!loaded ? <div className="faint" style={{ fontSize: 13 }}>Loading…</div> : items.length ? (
        <div className="tl">
          {items.map((a) => (
            <div key={a.id} className="tl-i">
              <span className={"tl-k " + a.kind}>{a.kind === "sms" ? "text" : a.kind}{a.direction === "in" ? " in" : a.direction === "out" ? " out" : ""}</span>
              <div className="tl-h">
                <b>{a.subject || (a.kind === "note" ? "Note" : a.kind === "call" ? (a.direction === "in" ? "They called" : "Called them") : a.kind)}</b>
                <span>{fmtStamp(a.occurred_at)}{a.created_by && !a.created_by.includes("email") ? ` · ${a.created_by.split("@")[0]}` : a.from_email ? ` · ${a.from_email}` : ""}</span>
                {!orderId && a.order_id && orderNumbers?.[a.order_id] && <Link href={`/shop/orders/${a.order_id}`} style={{ fontSize: 12 }}>#{orderNumbers[a.order_id]}</Link>}
                {typeof (a.meta as { triage?: { summary?: string } })?.triage?.summary === "string" && <span className="tag">AI: {(a.meta as { triage: { summary: string } }).triage.summary.slice(0, 90)}</span>}
              </div>
              {a.body && <div className={"tl-b" + (open[a.id] ? " open" : "")} onClick={() => setOpen((o) => ({ ...o, [a.id]: !o[a.id] }))} title={open[a.id] ? "" : "Click to show all"}>{a.body}</div>}
            </div>
          ))}
        </div>
      ) : <div className="faint" style={{ fontSize: 13 }}>{orderId ? "No calls or notes on this order yet." : "No calls, notes or emails logged yet."}</div>}
    </div>
  );
}
