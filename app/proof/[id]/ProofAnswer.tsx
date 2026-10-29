"use client";
import { useState, useTransition } from "react";
import { answerProof } from "./actions";

type Status = "pending" | "approved" | "changes" | "replaced" | "gone";

/**
 * Approve or Requires changes, on the customer's proof page (Oct 29, Nick: "change notes and approve it, requires
 * changes. When you say requires changes… make a minor change, but no need to reproof, or…"). Approving asks for their
 * name; a change asks which kind and what.
 */
export default function ProofAnswer({ id, kind, status, decidedName, decidedAt, comment }: { id: string; kind: "art" | "sewout"; status: Status; decidedName: string; decidedAt: string; comment: string }) {
  const [step, setStep] = useState<"" | "approve" | "changes">("");
  const [small, setSmall] = useState(true);
  const [note, setNote] = useState(""), [name, setName] = useState("");
  const [err, setErr] = useState(""), [done, setDone] = useState<"" | "approved" | "approved_changes" | "changes">("");
  const [pending, start] = useTransition();
  const what = kind === "art" ? "proof" : "sew-out";
  const when = (s: string) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

  if (done || status === "approved" || status === "changes") {
    const d = done || (status === "approved" ? (comment ? "approved_changes" : "approved") : "changes");
    return (
      <div className={"pfl-done " + (d === "changes" ? "chg" : "ok")} role="status">
        <b>{d === "approved" ? `Approved. Thank you!` : d === "approved_changes" ? "Approved with your change. Thank you!" : "Thanks, we've got your changes."}</b>
        <span>{d === "approved" ? "We'll get it into production." : d === "approved_changes" ? `We'll make the change and go ahead, with no new ${what}.` : `We'll make them and send you a new ${what} to approve.`}</span>
        {!done && decidedName && <small>{decidedName}{decidedAt ? ` · ${when(decidedAt)}` : ""}</small>}
        {(done ? note : comment) && <small>“{done ? note : comment}”</small>}
      </div>
    );
  }
  if (status === "replaced") return <div className="pfl-done chg"><b>A newer {what} was sent</b><span>Please open the newest {what} email to approve it.</span></div>;
  if (status === "gone") return <div className="pfl-done chg"><b>This {what} isn&apos;t available</b><span>Ask us and we&apos;ll send it again.</span></div>;

  const send = (decision: "approved" | "approved_changes" | "changes") => start(async () => {
    setErr("");
    const r = await answerProof(id, decision, name, note);
    if (!r.ok) { setErr(r.error); return; }
    setDone(decision);
  });
  return (
    <div className="pfl-ans">
      <label className="pfl-lbl" htmlFor="pfl-note">Change notes</label>
      <textarea id="pfl-note" rows={4} placeholder="Add your comments" value={note} onChange={(e) => setNote(e.target.value)} />
      {step === "" && <div className="pfl-btns">
        <button type="button" className="btn primary pfl-ok" onClick={() => setStep("approve")}>Approve</button>
        <button type="button" className="btn" onClick={() => setStep("changes")}>Requires changes</button>
      </div>}
      {step === "approve" && <div className="pfl-step">
        <label className="pfl-lbl" htmlFor="pfl-name">Your name</label>
        <input id="pfl-name" type="text" autoFocus autoComplete="name" placeholder="Your full name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="pfl-fine">By approving, you&apos;re saying it&apos;s ready to make as shown: spelling, colors, sizes and placement.{note.trim() ? " Your note goes with it." : ""}</div>
        <div className="pfl-btns">
          <button type="button" className="btn" onClick={() => setStep("")}>Back</button>
          <button type="button" className="btn primary pfl-ok" disabled={pending || name.trim().length < 2} onClick={() => send(note.trim() ? "approved_changes" : "approved")}>{pending ? "Sending…" : "Approve"}</button>
        </div>
      </div>}
      {step === "changes" && <div className="pfl-step">
        <div className="pfl-lbl">What kind of change?</div>
        <label className={"pfl-opt" + (small ? " on" : "")}><input type="radio" name="pfl-k" checked={small} onChange={() => setSmall(true)} /><span><b>A small change, no new {what} needed</b>Make it and go ahead. You won&apos;t see it again.</span></label>
        <label className={"pfl-opt" + (!small ? " on" : "")}><input type="radio" name="pfl-k" checked={!small} onChange={() => setSmall(false)} /><span><b>Make changes and send a new {what}</b>We&apos;ll send another {what} to approve before anything is made.</span></label>
        {small && <><label className="pfl-lbl" htmlFor="pfl-name2">Your name</label>
          <input id="pfl-name2" type="text" autoComplete="name" placeholder="Your full name" value={name} onChange={(e) => setName(e.target.value)} /></>}
        {!note.trim() && <div className="pfl-fine">Write what to change in the change notes above.</div>}
        <div className="pfl-btns">
          <button type="button" className="btn" onClick={() => setStep("")}>Back</button>
          <button type="button" className="btn primary" disabled={pending || !note.trim() || (small && name.trim().length < 2)} onClick={() => send(small ? "approved_changes" : "changes")}>{pending ? "Sending…" : "Send changes"}</button>
        </div>
      </div>}
      {err && <div className="pv-err">{err}</div>}
    </div>
  );
}
