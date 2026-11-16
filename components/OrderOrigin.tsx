"use client";
import { useEffect, useState } from "react";
import JobPanel from "@/app/shop/jobs/JobPanel";
import { orderOriginLoad, undoDeclined } from "@/app/shop/jobs/actions";
import type { OriginItem } from "@/lib/orderOrigin";
import type { JobItem } from "@/lib/jobCenter";

/**
 * The order's "Where it came from" tab (Nick, Nov 16 2026, option A: "I can see the document, but I can't see where he
 * originally submitted the order"): on the left what the customer sent, word for word, with their files (lib/orderOrigin.ts:
 * their ClickUp job, portal order, emails and texts about it); on the right the Job Center's own view of the job, the one
 * component the Job Center shows (app/shop/jobs/JobPanel.tsx), never a copy.
 */
const when = (s: string) => { if (!s) return ""; const d = new Date(s); return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`; };
const kb = (n: number) => !n ? "" : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
const ICON: Record<OriginItem["kind"], string> = {
  clickup: "M4 4h16v16H4zM8 9h8M8 13h8M8 17h5",
  portal: "M3 5h18v12H3zM8 21h8M12 17v4",
  email: "M3 6h18v12H3zM3 7l9 6 9-6",
  text: "M4 5h16v11H10l-5 4v-4H4z",
  other: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v5",
};

export default function OrderOrigin({ order, customer, onSay }: { order: { id: string; number: number; nickname: string; created_at: string; due_date: string | null; customer_id: string | null; status: string }; customer: string; onSay: (m: string) => void }) {
  const [items, setItems] = useState<OriginItem[] | null>(null), [err, setErr] = useState("");
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    void orderOriginLoad(order.id, order.number).then((r) => { if (!live) return; if (r.ok) setItems(r.items); else setErr(r.error); });
    return () => { live = false; };
  }, [order.id, order.number]);
  const it: JobItem = { key: `o:${order.id}`, type: "order", steps: [], at: order.created_at, due: order.due_date, orderId: order.id, number: order.number, customer, customerId: order.customer_id, title: order.nickname || `#${order.number}`, depts: [], tracks: [], status: order.status };
  return (
    <div className="orig">
      <section className="panel orig-sent">
        <div className="panel-h"><h2>What they sent</h2><span className="faint">{items?.length ? `${items.length} thing${items.length === 1 ? "" : "s"}, oldest first` : ""}</span></div>
        <div className="panel-b">
          {err ? <div className="pv-err">{err}</div> : !items ? <div className="faint">Loading…</div>
            : !items.length ? <div className="faint">Nothing on file from the customer for this order: it was made here (or in Printavo) without an email, portal order or ClickUp job linked to it.</div>
            : items.map((x, i) => {
              const long = x.text.length > 700 || x.text.split("\n").length > 14, show = i === 0 || open[i] || !long;
              return (
                <article key={i} className={"orig-it" + (i === 0 ? " first" : "")}>
                  <div className="orig-src">
                    <span className="orig-ic" aria-hidden><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICON[x.kind]} /></svg></span>
                    <div className="orig-who"><b>{x.who || x.whoEmail || "The customer"}</b> <span className="faint">{i === 0 ? "sent it in" : "wrote"} · {x.label}</span>
                      <div className="faint orig-when">{when(x.at)}{x.subject ? <> · <span data-notranslate>{x.subject}</span></> : null}</div></div>
                  </div>
                  {x.text && <div className={"orig-txt" + (show ? "" : " cut")} data-notranslate>{x.text}</div>}
                  {long && i > 0 && <button type="button" className="orig-more" onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>{open[i] ? "Show less" : "Show all"}</button>}
                  {x.files.length > 0 && <div className="orig-files">{x.files.map((f, k) => (
                    <a key={k} className="orig-file" href={f.href} target="_blank" rel="noreferrer"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M14 3H6v18h12V7z" /><path d="M14 3v4h4" /></svg><span data-notranslate>{f.name}</span>{f.size > 0 && <small>{kb(f.size)}</small>}</a>))}</div>}
                  {x.notes.length > 0 && <div className="orig-notes">{x.notes.map((c, k) => <div key={k}><b>{c.who}</b> <span className="faint">{when(c.at)}</span><div data-notranslate>{c.text}</div></div>)}</div>}
                  {x.link && <a className="btn sm" href={x.link} target="_blank" rel="noreferrer">Open in ClickUp</a>}
                </article>
              );
            })}
        </div>
      </section>
      <section className="panel orig-jc">
        <JobPanel key={n} it={it} step="approved" after={(m) => { onSay(m); setN((v) => v + 1); }} onClose={() => setN((v) => v + 1)} onLead={() => { /* an order already */ }}
          onUndo={() => void undoDeclined(order.id).then((r) => { onSay(r.ok ? "Back on the Job Center." : r.error); setN((v) => v + 1); })} />
      </section>
    </div>
  );
}
