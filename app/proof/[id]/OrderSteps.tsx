"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StepView } from "@/lib/customerSend";
import ProofAnswer from "./ProofAnswer";
import { answerProof, answerQuote, approveAll } from "./actions";

/**
 * The order's customer page, one screen at a time (Oct 29, Nick: "you would click on the first thing, the proof, when it
 * opens up, and you would say, looks good or need changes… if they say looks good, then you'd move on to the next screen,
 * which is review quote… a button that says submit final approval for quote and art… then you got the approval
 * confirmation"). Each proof and sew-out: Looks good (a note rides along as a small change, no new proof) or Needs
 * changes. The last screen (the quote, or the last proof when there's no quote) lists what they looked over and takes
 * their name once for all of it (actions.ts approveAll). Then the confirmation, and the deposit.
 */
const m = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const listOf = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] || "");

export default function OrderSteps({ id, orderId, steps }: { id: string; orderId: string; steps: StepView[] }) {
  const router = useRouter();
  const todo = steps.filter((s) => (s.state === "todo" || s.state === "locked") && s.kind !== "deposit");
  const [cur, setCur] = useState((todo[0] || steps.find((s) => s.state === "todo") || steps[0])?.key || "");
  const [ok, setOk] = useState<Record<string, string>>({}); // looked over and good, with their note
  const [final, setFinal] = useState(false);
  const [doneMsg, setDoneMsg] = useState("");
  const step = steps.find((s) => s.key === cur) || steps[0];
  if (!step) return <div className="pfl-body"><aside className="pfl-side"><p>Nothing is waiting on you right now.</p></aside></div>;
  const idx = todo.findIndex((s) => s.key === step.key);
  const next = idx >= 0 ? todo[idx + 1] : undefined;
  const last = todo[todo.length - 1];
  const quote = todo.find((s) => s.kind === "quote");
  const showFinal = !doneMsg && (final || (step.kind === "quote" && (step.state === "todo" || step.state === "locked")));
  const pdfStep = showFinal && quote ? quote : step;
  const name0 = (s: StepView) => (s.kind === "art" ? "the proof" : s.kind === "sewout" ? "the sew-out" : "the quote");
  const goNext = (note: string) => {
    setOk((o) => ({ ...o, [step.key]: note }));
    if (next) { setCur(next.key); setFinal(false); } else setFinal(true);
  };
  return (
    <div className="pfl-body">
      <aside className="pfl-side">
        <ol className="pfl-steps">
          {steps.map((s, i) => { const good = s.key in ok; const st = good ? "done" : s.state === "locked" ? "todo" : s.state; return (
            <li key={s.key}>
              <button type="button" className={"pfl-step-b " + st + (s.key === step.key ? " on" : "")} onClick={() => { setCur(s.key); setFinal(false); }} aria-current={s.key === step.key}>
                <span className="pfl-num">{s.state === "done" || good ? "✓" : i + 1}</span>
                <span><b>{s.title}</b><small>{good ? "Looks good" : s.sub}</small></span>
              </button>
            </li>); })}
        </ol>
        <div className="pfl-ans-wrap">
          {doneMsg ? <div className="pfl-done ok" role="status"><b>You&apos;re all set. Thank you!</b><span>{doneMsg}</span>
              {steps.some((s) => s.kind === "deposit" && s.state === "todo") && <a className="btn primary pfl-ok" style={{ justifyContent: "center", height: 38, marginTop: 6 }} href={`/portal/orders/${orderId}`}>Pay the deposit</a>}</div>
            : showFinal ? <Final key="final" id={id} todo={todo} ok={ok} goTo={(k) => { setCur(k); setFinal(false); }} onDone={(msg) => { setDoneMsg(msg); router.refresh(); }} onDeclined={() => router.refresh()} />
            : (step.kind === "art" || step.kind === "sewout") && step.state === "todo"
              ? <LookOver key={step.key} id={id} step={step} note0={ok[step.key] || ""} nextLabel={next ? (next.kind === "quote" ? "review the quote" : `see ${name0(next)}`) : ""} isLast={!next} onGood={goNext} onChanges={() => router.refresh()} />
            : (step.kind === "art" || step.kind === "sewout")
              ? <ProofAnswer key={step.key} id={id} kind={step.kind} status={step.state === "done" ? "approved" : step.state === "changes" ? "changes" : "pending"} decidedName={step.who || ""} decidedAt={step.when || ""} comment={step.comment || ""}
                  target={step.kind === "art" ? { kind: "art" } : { kind: "sewout", id: step.sewoutId! }} onAnswered={() => router.refresh()} />
            : step.kind === "quote" ? <div className="pfl-done ok"><b>Quote approved. Thank you!</b><span>{step.who}{step.when ? ` · ${new Date(step.when).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}</span></div>
            : step.kind === "deposit" && (step.state === "done"
              ? <div className="pfl-done ok"><b>{step.title}</b><span>{step.sub}</span></div>
              : <div className="pfl-ans"><div style={{ fontSize: 14 }}>Your deposit of <b>{m(step.amount || 0)}</b> starts production.</div>
                  <a className="btn primary pfl-ok" style={{ justifyContent: "center", height: 38 }} href={`/portal/orders/${orderId}`}>Pay the deposit</a>
                  <div className="pfl-fine">Card or bank transfer. You&apos;ll sign in to your account with your email to pay.</div></div>)}
          {!doneMsg && !showFinal && last && !(step.key in ok) && idx >= 0 && <div className="pfl-fine" style={{ marginTop: 8 }}>Step {idx + 1} of {todo.length}. You&apos;ll approve everything together at the end.</div>}
        </div>
      </aside>
      <section className="pfl-pdf">
        <div className="pfl-bar"><span>{pdfStep.title} · {pdfStep.sub}</span><span className="pfl-sp" /><a href={pdfStep.pdf} target="_blank" rel="noreferrer">Open the PDF</a></div>
        <iframe key={pdfStep.pdf} src={`${pdfStep.pdf}&embed=1`} title={pdfStep.title} />
      </section>
    </div>
  );
}

/** one proof or sew-out: Looks good (a note is a small change, no new proof), or Needs changes (a new one comes) */
function LookOver({ id, step, note0, nextLabel, isLast, onGood, onChanges }: { id: string; step: StepView; note0: string; nextLabel: string; isLast: boolean; onGood: (note: string) => void; onChanges: () => void }) {
  const what = step.kind === "art" ? "proof" : "sew-out";
  const [note, setNote] = useState(note0), [mode, setMode] = useState<"" | "changes">(""), [err, setErr] = useState(""), [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  if (sent) return <div className="pfl-done chg" role="status"><b>Thanks, we&apos;ve got your changes.</b><span>We&apos;ll make them and send you a new {what} to look over.</span></div>;
  const sendChanges = () => start(async () => {
    setErr("");
    const r = await answerProof(id, "changes", "", note, step.kind === "art" ? { kind: "art" } : { kind: "sewout", id: step.sewoutId! });
    if (!r.ok) { setErr(r.error); return; }
    setSent(true); onChanges();
  });
  return (
    <div className="pfl-ans">
      <div className="pfl-q">Does the {what} look right? Check the spelling, colors, sizes and placement.</div>
      {mode === "" && <>
        <label className="pfl-lbl" htmlFor="pfl-note">Notes (optional)</label>
        <textarea id="pfl-note" rows={3} placeholder="A small tweak we can make without a new proof" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className="btn primary pfl-ok pfl-big" onClick={() => onGood(note.trim())}>{isLast ? "Looks good" : `Looks good, ${nextLabel}`} →</button>
        <button type="button" className="btn pfl-big" onClick={() => setMode("changes")}>Needs changes</button>
        {note.trim() && <div className="pfl-fine">We&apos;ll make your note as a small change, with no new {what}.</div>}
      </>}
      {mode === "changes" && <div className="pfl-step">
        <label className="pfl-lbl" htmlFor="pfl-chg">What should we change?</label>
        <textarea id="pfl-chg" rows={4} autoFocus placeholder="Tell us what to change" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="pfl-fine">We&apos;ll make the changes and send you a new {what} before anything is made. For a small tweak you don&apos;t need to see again, go back and add it as a note on Looks good.</div>
        <div className="pfl-btns"><button type="button" className="btn" onClick={() => setMode("")}>Back</button>
          <button type="button" className="btn primary" disabled={pending || !note.trim()} onClick={sendChanges}>{pending ? "Sending…" : "Send my changes"}</button></div>
      </div>}
      {err && <div className="pv-err">{err}</div>}
    </div>
  );
}

/** the last screen: what they looked over, their name once, and Submit final approval (or decline the quote) */
function Final({ id, todo, ok, goTo, onDone, onDeclined }: { id: string; todo: StepView[]; ok: Record<string, string>; goTo: (k: string) => void; onDone: (msg: string) => void; onDeclined: () => void }) {
  const [name, setName] = useState(""), [err, setErr] = useState(""), [mode, setMode] = useState<"" | "decline">(""), [why, setWhy] = useState(""), [declined, setDeclined] = useState(false);
  const [pending, start] = useTransition();
  const quote = todo.find((s) => s.kind === "quote");
  const looks = todo.filter((s) => s.kind !== "quote");
  const missing = looks.find((s) => !(s.key in ok));
  const parts = [...(looks.some((s) => s.kind === "art") ? ["art"] : []), ...(looks.some((s) => s.kind === "sewout") ? ["sew-out"] : [])];
  const label = quote ? (parts.length ? `quote and ${listOf(parts)}` : "quote") : listOf(parts);
  if (declined) return <div className="pfl-done chg" role="status"><b>Thanks, we&apos;ve got it.</b><span>We&apos;ll look at what you said and send you an updated quote.</span></div>;
  const submit = () => start(async () => {
    setErr("");
    const art = looks.find((s) => s.kind === "art");
    const r = await approveAll(id, name, { art: art ? { note: ok[art.key] || "" } : null, sewouts: looks.filter((s) => s.kind === "sewout").map((s) => ({ id: s.sewoutId!, note: ok[s.key] || "" })), quote: !!quote });
    if (!r.ok) { setErr(r.error); return; }
    onDone(`We've got your approval for the ${label}. We'll take it from here.`);
  });
  const decline = () => start(async () => {
    setErr("");
    const r = await answerQuote(id, "decline", name, why);
    if (!r.ok) { setErr(r.error); return; }
    setDeclined(true); onDeclined();
  });
  if (missing) return (
    <div className="pfl-ans"><div className="pfl-q">Look over {missing.kind === "art" ? "your proof" : "your sew-out"} first, then come back to approve everything together.</div>
      <button type="button" className="btn primary pfl-big" onClick={() => goTo(missing.key)}>Go to {missing.title.toLowerCase()}</button></div>
  );
  return (
    <div className="pfl-ans">
      {mode === "" ? <>
        <div className="pfl-q">{quote ? "Review your quote, then approve everything." : "Ready to approve?"}</div>
        <ul className="pfl-sum">
          {looks.map((s) => <li key={s.key}><span className="pfl-tick">✓</span><span><b>{s.kind === "art" ? "Proof" : "Sew-out"}</b> · {s.sub}{ok[s.key] ? <small>Your note: “{ok[s.key]}”</small> : null}</span><button type="button" className="linkbtn" onClick={() => goTo(s.key)}>View</button></li>)}
          {quote && <li><span className="pfl-tick">✓</span><span><b>Quote</b> · {quote.sub}</span></li>}
        </ul>
        <label className="pfl-lbl" htmlFor="pfl-fn">Your name</label>
        <input id="pfl-fn" type="text" autoComplete="name" placeholder="Your full name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="btn primary pfl-ok pfl-big" disabled={pending || name.trim().length < 2} onClick={submit}>{pending ? "Sending…" : `Submit final approval for ${label}`}</button>
        <div className="pfl-fine">Typing your name approves {quote ? "the quote and says the art is ready to make as shown" : "it as shown"}.</div>
        {quote && <button type="button" className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => setMode("decline")}>Decline the quote</button>}
      </> : <div className="pfl-step">
        <label className="pfl-lbl" htmlFor="pfq-why">Why are you declining?</label>
        <textarea id="pfq-why" rows={4} autoFocus placeholder="Tell us what's not right, and we'll send an updated quote" value={why} onChange={(e) => setWhy(e.target.value)} />
        <input type="text" autoComplete="name" placeholder="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="pfl-btns"><button type="button" className="btn" onClick={() => setMode("")}>Back</button>
          <button type="button" className="btn primary" disabled={pending || !why.trim()} onClick={decline}>{pending ? "Sending…" : "Decline quote"}</button></div>
      </div>}
      {err && <div className="pv-err">{err}</div>}
    </div>
  );
}
