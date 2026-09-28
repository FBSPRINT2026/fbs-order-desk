"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { greeting } from "@/lib/greeting";
import { portalAssist, reorderArchived, type AssistAction, type AssistTurn } from "@/app/portal/assist-actions";
import { describeMyOrder, reorderRequest, startRequest } from "@/app/portal/request-actions";
import { portalSend } from "@/app/portal/message-actions";

type Turn = AssistTurn & { actions?: AssistAction[]; done?: string };

const IDEAS = ["Where's my order?", "I'd like to pay my bill", "Reorder my last job", "Place a new order", "Make a mockup"];

/**
 * The dashboard's helper: "What can I help you with today?". The customer types what they need;
 * it answers from their own account and offers buttons. Nothing changes until they press one.
 */
export default function PortalAssistant({ qs, canAct, wholesale }: { qs: string; canAct: boolean; wholesale: boolean }) {
  const router = useRouter();
  const [hello, setHello] = useState("Hello");
  useEffect(() => setHello(greeting()), []);
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [doing, setDoing] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" }); }, [turns.length, busy]);
  const url = (p: string) => (qs ? `${p}${p.includes("?") ? "&" : "?"}${qs.slice(1)}` : p);

  async function ask(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setQ("");
    const next: Turn[] = [...turns, { role: "user", text: t }];
    setTurns(next); setBusy(true);
    const r = canAct ? await portalAssist(next.map(({ role, text }) => ({ role, text }))) : { ok: false, error: "The helper is turned off in the preview." };
    setBusy(false);
    setTurns([...next, { role: "assistant", text: r.ok ? r.reply || "" : r.error || "Something went wrong.", actions: r.ok ? r.actions : [] }]);
  }

  async function act(a: AssistAction, i: number) {
    if (!canAct || doing) return;
    const mark = (done: string) => setTurns((ts) => ts.map((x, k) => (k === i ? { ...x, done } : x)));
    setDoing(a.label);
    try {
      switch (a.kind) {
        case "open_order": router.push(url(a.href || "/portal")); break;
        case "open_orders": router.push(url("/portal?area=orders")); break;
        case "open_payments": router.push(url("/portal?area=payments")); break;
        case "pay": router.push(url(`/portal?area=payments&find=${encodeURIComponent(a.text || "everything")}`)); break;
        case "open_statement": router.push(url("/portal/statement")); break;
        case "open_goods": router.push(url("/portal?area=receive")); break;
        case "open_artwork": router.push(url("/portal?area=artwork")); break;
        case "open_mockup": router.push(url("/portal/mockup")); break;
        case "new_order": { const r = await startRequest(); if (r.ok && r.id) router.push(`/portal/request/${r.id}`); else mark(r.error || "Couldn't start it."); break; }
        case "new_order_from_text": {
          const r = await startRequest();
          if (!r.ok || !r.id) { mark(r.error || "Couldn't start it."); break; }
          if (a.text) await describeMyOrder(r.id, a.text);
          router.push(`/portal/request/${r.id}`); break;
        }
        case "reorder": {
          if (a.archived && a.orderId) { const r = await reorderArchived(a.orderId); mark(r.ok ? "Sent! We'll put together a quote and message you here." : r.error || "Couldn't send it."); break; }
          if (!a.orderId) break;
          const r = await reorderRequest(a.orderId);
          if (r.ok && r.id) router.push(`/portal/request/${r.id}`); else mark(r.error || "Couldn't start the reorder.");
          break;
        }
        case "message_shop": { const r = await portalSend(null, a.text || turns.filter((x) => x.role === "user").pop()?.text || ""); mark(r.ok ? "Sent to the shop. You'll see their reply in Messages." : r.error || "Couldn't send it."); router.refresh(); break; }
      }
    } finally { setDoing(""); }
  }

  const ideas = wholesale ? [...IDEAS.slice(0, 4), "Where are my goods?"] : IDEAS;
  return (
    <section className="pa" aria-label="Help">
      <h2 className="pa-hello">{hello}</h2>
      <form className="pa-in" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <span className="pa-spark" aria-hidden="true">✨</span>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="What can I help you with today?" aria-label="What can I help you with today?" autoComplete="off" />
        <button type="submit" className="btn primary" disabled={busy || !q.trim()}>{busy ? "Thinking…" : "Ask"}</button>
      </form>
      {!turns.length && <div className="pa-ideas">{ideas.map((s) => <button key={s} type="button" onClick={() => ask(s)}>{s}</button>)}</div>}
      {turns.length > 0 && (
        <div className="pa-talk" ref={box}>
          {turns.map((t, i) => (
            <div key={i} className={"pa-t " + t.role}>
              <div className="pa-b">{t.text}</div>
              {t.actions && t.actions.length > 0 && !t.done && (
                <div className="pa-acts">{t.actions.map((a, k) => <button key={k} type="button" className={"btn sm" + (k === 0 ? " primary" : "")} disabled={!!doing || !canAct} onClick={() => act(a, i)}>{doing === a.label ? "Working…" : a.label}</button>)}</div>
              )}
              {t.done && <div className="pa-done">{t.done}</div>}
            </div>
          ))}
          {busy && <div className="pa-t assistant"><div className="pa-b pa-dots"><span /><span /><span /></div></div>}
          <div className="pa-foot"><button type="button" className="pd-link" onClick={() => setTurns([])}>Start over</button></div>
        </div>
      )}
    </section>
  );
}
