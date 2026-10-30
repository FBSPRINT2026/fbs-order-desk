"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StepView } from "@/lib/customerSend";
import ProofAnswer from "./ProofAnswer";
import { answerProof, answerQuote, approveAll, payByLink } from "./actions";

/**
 * The order's customer page, one screen at a time (Oct 29, Nick: "you would click on the first thing, the proof, when it
 * opens up, and you would say, looks good or need changes… if they say looks good, then you'd move on to the next screen,
 * which is review quote… a button that says submit final approval for quote and art… then you got the approval
 * confirmation"). Each proof and sew-out: Looks good (a note rides along as a small change, no new proof) or Needs
 * changes. The last screen (the quote, or the last proof when there's no quote) lists what they looked over and takes
 * their name once for all of it (actions.ts approveAll). Then the confirmation, and the deposit.
 */
const m = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const whoWhen = (s: StepView) => [s.who, s.when ? new Date(s.when).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""].filter(Boolean).join(" · ");
const listOf = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] || "");

export default function OrderSteps({ id, steps }: { id: string; orderId?: string; steps: StepView[] }) {
  const router = useRouter();
  const todo = steps.filter((s) => (s.state === "todo" || s.state === "locked") && s.kind !== "deposit");
  const [cur, setCur] = useState((todo[0] || steps.find((s) => s.state === "todo") || steps[0])?.key || "");
  const [ok, setOk] = useState<Record<string, string>>({}); // looked over and good, with their note
  const [final, setFinal] = useState(false);
  const [doneMsg, setDoneMsg] = useState("");
  // what they sent back from this page (changes, or the quote declined), so the right side shows it at once
  const [back, setBack] = useState<Record<string, { kind: "changes" | "declined"; note: string }>>({});
  const frame = useRef<HTMLIFrameElement | null>(null), paneNow = useRef("");
  // the stamp sits in the document's own top row (app/print/[id]/StampSlot.tsx): tell it what to show, and answer when it asks
  const tell = () => frame.current?.contentWindow?.postMessage({ fbsStamp: paneNow.current }, location.origin);
  useEffect(() => {
    const on = (e: MessageEvent) => { if (e.origin === location.origin && e.data?.fbsStampAsk && e.source === frame.current?.contentWindow) tell(); };
    addEventListener("message", on);
    return () => removeEventListener("message", on);
  }, []);
  const step = steps.find((s) => s.key === cur) || steps[0];
  if (!step) return <div className="pfl-body"><aside className="pfl-side"><p>Nothing is waiting on you right now.</p></aside></div>;
  const idx = todo.findIndex((s) => s.key === step.key);
  const next = idx >= 0 ? todo[idx + 1] : undefined;
  const last = todo[todo.length - 1];
  const quote = todo.find((s) => s.kind === "quote" || s.kind === "invoice");
  const showFinal = !doneMsg && (final || ((step.kind === "quote" || step.kind === "invoice") && (step.state === "todo" || step.state === "locked")));
  const pdfStep = showFinal && quote ? quote : step;
  const name0 = (s: StepView) => (s.kind === "art" ? "the proof" : s.kind === "sewout" ? "the sew-out" : s.kind === "invoice" ? "the invoice" : "the quote");
  // the right side follows what they did on the left (Oct 29, Nick: "when you do something on the left, it needs to affect
  // the view on the right, whether it's approved, revisions"): sent back → grayed with what they asked; approved or looked
  // over → the approved check across it
  const sentBack = back[pdfStep.key] || (pdfStep.state === "changes" ? { kind: /declined/i.test(pdfStep.title) ? "declined" as const : "changes" as const, note: pdfStep.comment || "" } : null);
  const pane: "" | "ok" | "looks" | "changes" | "declined" = sentBack ? sentBack.kind : doneMsg || pdfStep.state === "done" ? "ok" : pdfStep.key in ok ? "looks" : "";
  paneNow.current = pane;
  if (typeof window !== "undefined") queueMicrotask(tell);
  const what0 = pdfStep.kind === "art" ? "proof" : pdfStep.kind === "sewout" ? "sew-out" : pdfStep.kind === "invoice" ? "invoice" : "quote";
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
          {doneMsg ? (() => { const dp = steps.find((s) => s.kind === "deposit" && s.state === "todo"); return dp
              ? <><Result tone="ok" title="Thank you for your approval!" line={`Here's your ${dp.title === "Pay now" ? "payment" : "deposit"} of ${m(dp.amount || 0)}. Once we have it, we'll get started.`} /><PayNow id={id} label={`${dp.title} · ${m(dp.amount || 0)}`} /></>
              : <Result tone="ok" title="You're all set. Thank you!" line={doneMsg} />; })()
            : showFinal ? <Final key="final" id={id} todo={todo} ok={ok} goTo={(k) => { setCur(k); setFinal(false); }} onDone={(msg) => { setDoneMsg(msg); router.refresh(); }} onBack={(kind, note) => { if (quote) setBack((b) => ({ ...b, [quote.key]: { kind, note } })); router.refresh(); }} />
            : (step.kind === "art" || step.kind === "sewout") && step.state === "todo"
              ? <LookOver key={step.key} id={id} step={step} note0={ok[step.key] || ""} nextLabel={next ? (next.kind === "quote" || next.kind === "invoice" ? `review ${name0(next)}` : `see ${name0(next)}`) : ""} isLast={!next} onGood={goNext} onChanges={(note) => { setBack((b) => ({ ...b, [step.key]: { kind: "changes", note } })); router.refresh(); }} />
            : (step.kind === "art" || step.kind === "sewout")
              ? <ProofAnswer key={step.key} id={id} kind={step.kind} status={step.state === "done" ? "approved" : step.state === "changes" ? "changes" : "pending"} decidedName={step.who || ""} decidedAt={step.when || ""} comment={step.comment || ""}
                  target={step.kind === "art" ? { kind: "art" } : { kind: "sewout", id: step.sewoutId! }} onAnswered={() => router.refresh()} />
            : step.kind === "quote" || step.kind === "invoice" ? (step.state === "changes"
              ? <Result tone={/declined/i.test(step.title) ? "no" : "chg"} title={step.title} line={/declined/i.test(step.title) ? "We'll look at what you said and get back to you." : `We're making the changes and will send you a new ${step.kind === "invoice" ? "invoice" : "quote"}.`} note={step.comment} who={whoWhen(step)} />
              : <Result tone="ok" title="All approved" line="Thank you!" who={whoWhen(step)} />)
            : step.kind === "deposit" && (step.state === "done"
              ? <Result tone="ok" title={step.title} line={step.sub} />
              : <div className="pfl-ans"><div style={{ fontSize: 14 }}><b>{m(step.amount || 0)}</b> {step.title === "Pay now" ? "is due to start your order" : "starts production"}.</div>
                  <PayNow id={id} label={step.title} /></div>)}
          {!doneMsg && !showFinal && last && !(step.key in ok) && idx >= 0 && <div className="pfl-fine" style={{ marginTop: 8 }}>Step {idx + 1} of {todo.length}. You&apos;ll approve everything together at the end.</div>}
        </div>
      </aside>
      <section className={"pfl-pdf" + (pane ? ` is-${pane}` : "")}>
        <div className="pfl-bar"><span>{pdfStep.title} · {pdfStep.sub}</span><span className="pfl-sp" /><a href={pdfStep.pdf} target="_blank" rel="noreferrer">Open the PDF</a></div>
        <div className="pfl-frame">
          <iframe ref={frame} onLoad={tell} key={pdfStep.pdf} src={`${pdfStep.pdf}&embed=1`} title={pdfStep.title} aria-hidden={pane === "changes" || pane === "declined"} />
          {(pane === "changes" || pane === "declined") && <div className="pfl-over" role="status">
            <span className="pfl-over-i" aria-hidden>{pane === "declined" ? "×" : "✎"}</span>
            <b>{pane === "declined" ? "Quote declined" : "Changes requested"}</b>
            {sentBack?.note && <q>{sentBack.note}</q>}
            <span>{pane === "declined" ? "We'll look at what you said and get back to you." : `We'll make the changes and send you a new ${what0} to look over.`}</span>
          </div>}
        </div>
      </section>
    </div>
  );
}

/** one proof or sew-out: Looks good (a note is a small change, no new proof), or Needs changes (a new one comes) */
function LookOver({ id, step, note0, nextLabel, isLast, onGood, onChanges }: { id: string; step: StepView; note0: string; nextLabel: string; isLast: boolean; onGood: (note: string) => void; onChanges: (note: string) => void }) {
  const what = step.kind === "art" ? "proof" : "sew-out";
  const [note, setNote] = useState(note0), [mode, setMode] = useState<"" | "changes">(""), [err, setErr] = useState(""), [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  if (sent) return <Result tone="chg" title="Changes sent" line={`We'll make them and send you a new ${what} to look over.`} note={note} />;
  const sendChanges = () => start(async () => {
    setErr("");
    const r = await answerProof(id, "changes", "", note, step.kind === "art" ? { kind: "art" } : { kind: "sewout", id: step.sewoutId! });
    if (!r.ok) { setErr(r.error); return; }
    setSent(true); onChanges(note.trim());
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

/** the last screen: what they looked over, their name once, Submit approval; under it, Request changes and Decline the
 *  quote (Oct 29, Nick: "two small buttons under submit approval… request changes… decline the quote") */
function Final({ id, todo, ok, goTo, onDone, onBack }: { id: string; todo: StepView[]; ok: Record<string, string>; goTo: (k: string) => void; onDone: (msg: string) => void; onBack: (kind: "changes" | "declined", note: string) => void }) {
  const [name, setName] = useState(""), [err, setErr] = useState(""), [mode, setMode] = useState<"" | "changes" | "decline">(""), [why, setWhy] = useState(""), [sent, setSent] = useState<"" | "changes" | "declined">("");
  const [pending, start] = useTransition();
  const quote = todo.find((s) => s.kind === "quote" || s.kind === "invoice");
  const isInv = quote?.kind === "invoice";
  const looks = todo.filter((s) => s.kind !== "quote" && s.kind !== "invoice");
  const missing = looks.find((s) => !(s.key in ok));
  const parts = [...(looks.some((s) => s.kind === "art") ? ["art"] : []), ...(looks.some((s) => s.kind === "sewout") ? ["sew-out"] : [])];
  const priceWord = isInv ? "invoice" : "quote";
  const label = quote ? (parts.length ? `${priceWord} and ${listOf(parts)}` : priceWord) : listOf(parts);
  if (sent) return <Result tone={sent === "declined" ? "no" : "chg"} title={sent === "declined" ? "Quote declined" : "Changes sent"} line={sent === "declined" ? "Thanks for letting us know. We'll look at what you said and get back to you." : `We'll fix the ${priceWord} and send you a new one to approve.`} note={why} />;
  const submit = () => start(async () => {
    setErr("");
    const art = looks.find((s) => s.kind === "art");
    const r = await approveAll(id, name, { art: art ? { note: ok[art.key] || "" } : null, sewouts: looks.filter((s) => s.kind === "sewout").map((s) => ({ id: s.sewoutId!, note: ok[s.key] || "" })), quote: !!quote && !isInv, invoice: isInv });
    if (!r.ok) { setErr(r.error); return; }
    onDone(`We've got your approval for the ${label}. We'll take it from here.`);
  });
  const sendBack = (decision: "changes" | "decline") => start(async () => {
    setErr("");
    const r = await answerQuote(id, decision, name, why);
    if (!r.ok) { setErr(r.error); return; }
    const k = decision === "decline" ? "declined" : "changes";
    setSent(k); onBack(k, why.trim());
  });
  if (missing) return (
    <div className="pfl-ans"><div className="pfl-q">Look over {missing.kind === "art" ? "your proof" : "your sew-out"} first, then come back to approve everything together.</div>
      <button type="button" className="btn primary pfl-big" onClick={() => goTo(missing.key)}>Go to {missing.title.toLowerCase()}</button></div>
  );
  return (
    <div className="pfl-ans">
      {mode === "" ? <>
        <div className="pfl-q">{quote ? `Review your ${isInv ? "final invoice" : "quote"}, then approve everything.` : "Ready to approve?"}</div>
        <ul className="pfl-sum">
          {looks.map((s) => <li key={s.key}><span className="pfl-tick">✓</span><span><b>{s.kind === "art" ? "Proof" : "Sew-out"}</b><small>{s.sub}</small>{ok[s.key] ? <small>Your note: “{ok[s.key]}”</small> : null}</span><button type="button" className="linkbtn" onClick={() => goTo(s.key)}>View</button></li>)}
          {quote && <li><span className="pfl-tick">✓</span><span><b>{isInv ? "Final invoice" : "Quote"}</b>{quote.sub.split(" · ").map((x, i) => <small key={i}>{x}</small>)}</span></li>}
        </ul>
        <label className="pfl-lbl" htmlFor="pfl-fn">Your name</label>
        <input id="pfl-fn" type="text" autoComplete="name" placeholder="Your full name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="btn primary pfl-ok pfl-big" disabled={pending || name.trim().length < 2} onClick={submit}>{pending ? "Sending…" : "Submit approval"}</button>
        {/* short on the button, what it means under it (Oct 29, Nick: "just say submit for approve, and something says below… submit final approval for invoice") */}
        <div className="pfl-sub-ok">Final approval for the {label}</div>
        <div className="pfl-fine">Typing your name approves {quote ? `the ${priceWord} and says the art is ready to make as shown` : "it as shown"}.</div>
        {quote && <div className="pfl-alt">
          <button type="button" className="btn sm" onClick={() => setMode("changes")}>Request changes</button>
          {!isInv && <button type="button" className="btn sm" onClick={() => setMode("decline")}>Decline the quote</button>}
        </div>}
      </> : <div className="pfl-step">
        <label className="pfl-lbl" htmlFor="pfq-why">{mode === "changes" ? `What should we change on the ${priceWord}?` : "Why are you declining?"}</label>
        <textarea id="pfq-why" rows={4} autoFocus placeholder={mode === "changes" ? "e.g. The sizes are wrong: it should be 5 2XLs" : "Tell us what's not right"} value={why} onChange={(e) => setWhy(e.target.value)} />
        <input type="text" autoComplete="name" placeholder="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="pfl-btns"><button type="button" className="btn" onClick={() => setMode("")}>Back</button>
          <button type="button" className="btn primary" disabled={pending || !why.trim()} onClick={() => sendBack(mode === "changes" ? "changes" : "decline")}>{pending ? "Sending…" : mode === "changes" ? "Send my changes" : "Decline quote"}</button></div>
      </div>}
      {err && <div className="pv-err">{err}</div>}
    </div>
  );
}

/** what happened, after they answer: an icon, one line, their note (Oct 29, Nick: "don't love this little box… rethink") */
function Result({ tone, title, line, note, who }: { tone: "ok" | "chg" | "no"; title: string; line: string; note?: string; who?: string }) {
  return (
    <div className={"pfl-res " + tone} role="status">
      <span className="pfl-res-i" aria-hidden>{tone === "ok" ? "✓" : tone === "no" ? "×" : "✎"}</span>
      <div><b>{title}</b><span>{line}</span>{note?.trim() && <q>{note.trim()}</q>}{who && <small>{who}</small>}</div>
    </div>
  );
}

/** pay what's due now by card, right here (no sign-in): opens Stripe, and the payment lands on the order by itself */
function PayNow({ id, label }: { id: string; label: string }) {
  const [err, setErr] = useState(""), [pending, start] = useTransition();
  const go = () => start(async () => {
    setErr("");
    const r = await payByLink(id);
    if (!r.ok) { setErr(r.error); return; }
    window.location.href = r.url;
  });
  return (
    <div className="pfl-pay">
      <button type="button" className="btn primary pfl-ok pfl-big" disabled={pending} onClick={go}>{pending ? "Opening the payment page…" : label}</button>
      <div className="pfl-fine">Secure card payment through Stripe.</div>
      {err && <div className="pv-err">{err}</div>}
    </div>
  );
}
