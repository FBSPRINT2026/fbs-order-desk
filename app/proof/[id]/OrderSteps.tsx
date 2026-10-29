"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StepView } from "@/lib/customerSend";
import ProofAnswer from "./ProofAnswer";
import { answerQuote } from "./actions";

/**
 * The order's customer page (Oct 29, Nick, option A): the steps waiting on them on the left (the proof, each sew-out,
 * the quote, the deposit), the one picked on the right with its PDF, and its answer under the steps. The quote waits
 * until the proofs are answered; declining it asks why and sends it back to the shop.
 */
export default function OrderSteps({ id, orderId, steps }: { id: string; orderId: string; steps: StepView[] }) {
  const first = steps.find((s) => s.state === "todo") || steps[0];
  const [pick, setPick] = useState(first?.key || "");
  const router = useRouter();
  const cur = steps.find((s) => s.key === pick) || first;
  const m = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  if (!cur) return <div className="pfl-body"><aside className="pfl-side"><p>Nothing is waiting on you right now.</p></aside></div>;
  return (
    <div className="pfl-body">
      <aside className="pfl-side">
        <ol className="pfl-steps">
          {steps.map((s, i) => (
            <li key={s.key}>
              <button type="button" className={"pfl-step-b " + s.state + (s.key === cur.key ? " on" : "")} onClick={() => setPick(s.key)} aria-current={s.key === cur.key}>
                <span className="pfl-num">{s.state === "done" ? "✓" : i + 1}</span>
                <span><b>{s.title}</b><small>{s.sub}{s.state === "locked" ? " · after the proof" : ""}</small></span>
              </button>
            </li>
          ))}
        </ol>
        <div className="pfl-ans-wrap">
          {(cur.kind === "art" || cur.kind === "sewout") && (
            <ProofAnswer key={cur.key} id={id} kind={cur.kind} status={cur.state === "done" ? "approved" : cur.state === "changes" ? "changes" : "pending"} decidedName={cur.who || ""} decidedAt={cur.when || ""} comment={cur.comment || ""}
              target={cur.kind === "art" ? { kind: "art" } : { kind: "sewout", id: cur.sewoutId! }} onAnswered={() => router.refresh()} />
          )}
          {cur.kind === "quote" && <QuoteAnswer key={cur.key} id={id} step={cur} onAnswered={() => router.refresh()} total={m(cur.amount || 0)} />}
          {cur.kind === "deposit" && (cur.state === "done"
            ? <div className="pfl-done ok"><b>{cur.title}</b><span>{cur.sub}</span></div>
            : <div className="pfl-ans"><div style={{ fontSize: 14 }}>Your deposit of <b>{m(cur.amount || 0)}</b> starts production.</div>
                <a className="btn primary pfl-ok" style={{ justifyContent: "center", height: 38 }} href={`/portal/orders/${orderId}`}>Pay the deposit</a>
                <div className="pfl-fine">Card or bank transfer. You&apos;ll sign in to your account with your email to pay.</div></div>)}
        </div>
      </aside>
      <section className="pfl-pdf">
        <div className="pfl-bar"><span>{cur.title} · {cur.sub}</span><span className="pfl-sp" /><a href={cur.pdf} target="_blank" rel="noreferrer">Open the PDF</a></div>
        <iframe key={cur.pdf} src={`${cur.pdf}&embed=1`} title={cur.title} />
      </section>
    </div>
  );
}

function QuoteAnswer({ id, step, total, onAnswered }: { id: string; step: StepView; total: string; onAnswered: () => void }) {
  const [mode, setMode] = useState<"" | "approve" | "decline">("");
  const [name, setName] = useState(""), [why, setWhy] = useState(""), [err, setErr] = useState(""), [done, setDone] = useState<"" | "approve" | "decline">("");
  const [pending, start] = useTransition();
  if (done === "approve" || step.state === "done") return <div className="pfl-done ok"><b>Quote approved. Thank you!</b><span>{done ? "Next, the deposit starts production." : `${step.who || ""}${step.when ? ` · ${new Date(step.when).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}`}</span></div>;
  if (done === "decline") return <div className="pfl-done chg"><b>Thanks, we&apos;ve got it.</b><span>We&apos;ll look at what you said and send you an updated quote.</span></div>;
  if (step.state === "locked") return <div className="pfl-done chg"><b>Approve the proof first</b><span>The quote is ready once the proof is approved.</span></div>;
  const go = (d: "approve" | "decline") => start(async () => {
    setErr("");
    const r = await answerQuote(id, d, name, why);
    if (!r.ok) { setErr(r.error); return; }
    setDone(d); onAnswered();
  });
  return (
    <div className="pfl-ans">
      <div style={{ fontSize: 14 }}>Quote total <b>{total}</b></div>
      {mode === "" && <div className="pfl-btns">
        <button type="button" className="btn primary pfl-ok" onClick={() => setMode("approve")}>Approve</button>
        <button type="button" className="btn" onClick={() => setMode("decline")}>Decline</button>
      </div>}
      {mode === "approve" && <div className="pfl-step">
        <label className="pfl-lbl" htmlFor="pfq-name">Your name</label>
        <input id="pfq-name" type="text" autoFocus autoComplete="name" placeholder="Your full name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="pfl-fine">Typing your name signs the quote.</div>
        <div className="pfl-btns"><button type="button" className="btn" onClick={() => setMode("")}>Back</button>
          <button type="button" className="btn primary pfl-ok" disabled={pending || name.trim().length < 2} onClick={() => go("approve")}>{pending ? "Sending…" : "Approve quote"}</button></div>
      </div>}
      {mode === "decline" && <div className="pfl-step">
        <label className="pfl-lbl" htmlFor="pfq-why">Why are you declining?</label>
        <textarea id="pfq-why" rows={4} autoFocus placeholder="Tell us what's not right, and we'll send an updated quote" value={why} onChange={(e) => setWhy(e.target.value)} />
        <input type="text" autoComplete="name" placeholder="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="pfl-btns"><button type="button" className="btn" onClick={() => setMode("")}>Back</button>
          <button type="button" className="btn primary" disabled={pending || !why.trim()} onClick={() => go("decline")}>{pending ? "Sending…" : "Decline quote"}</button></div>
      </div>}
      {err && <div className="pv-err">{err}</div>}
    </div>
  );
}
