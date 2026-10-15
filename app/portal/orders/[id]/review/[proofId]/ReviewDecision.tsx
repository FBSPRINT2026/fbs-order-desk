"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideProof } from "@/app/portal/actions";

type Choice = "approved" | "approved_changes" | "changes";

/** Approve, approve with changes (no new proof), or make changes (tell us, or change it yourself). */
export default function ReviewDecision({ proofId, orderId, disabled, changeHref }: { proofId: string; orderId: string; disabled: boolean; changeHref: string }) {
  const router = useRouter();
  const [pick, setPick] = useState<Choice | "">("");
  const [note, setNote] = useState("");
  // the customer types their own name to approve (Oct 15, Nick: "don't automatically fill in the name")
  const [name, setName] = useState("");
  const [checked, setChecked] = useState(false);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const ready = !!pick && !disabled && (pick === "changes" ? !!note.trim() : name.trim().length >= 2 && checked && (pick === "approved" || !!note.trim()));
  const send = () => start(async () => {
    setErr("");
    const r = await decideProof(proofId, pick as Choice, name, note);
    if (!r.ok) return setErr(r.error || "Something went wrong.");
    router.push(`/portal/orders/${orderId}?reviewed=${pick}`);
    router.refresh();
  });

  const opt = (k: Choice, title: string, about: string, more?: React.ReactNode) => (
    <div className={"ar-opt" + (pick === k ? " on" : "")}>
      <label><input type="radio" name="ar-pick" checked={pick === k} onChange={() => { setPick(k); setErr(""); }} /><b>{title}</b></label>
      <p>{about}</p>
      {pick === k && more}
    </div>
  );

  return (
    <div className="ar-form">
      {opt("approved", "Approve", "Everything looks right. We start printing.")}
      {opt("approved_changes", "Approve with changes", "Small fixes we can make without sending another proof.", <div className="ar-more">
        <textarea rows={3} aria-label="The changes to make" placeholder="What should we change? (e.g. make the logo 8.5&quot; wide)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="ar-note y"><b>You won&apos;t see another proof.</b> We&apos;ll make these changes and print.</div>
      </div>)}
      {opt("changes", "Make changes", "Send it back. You'll get a new proof to approve before we print.", <div className="ar-more">
        <textarea rows={3} aria-label="What to change" placeholder="Tell us what to change" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="ar-or"><span>or</span></div>
        <a className={"btn" + (disabled ? " disabled" : "")} href={disabled ? undefined : changeHref}>Change it myself in the Mockup Creator</a>
        <div className="ar-note b">Change the shirt color, the size or where it sits. We&apos;ll check it and send you a new proof.</div>
      </div>)}
      {pick && pick !== "changes" && (
        <div className="ar-sign">
          <input type="text" aria-label="Your full name" placeholder="Your full name" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="check"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />I checked the spelling, colors, sizes and placement.</label>
        </div>
      )}
      {pick && <button type="button" className="btn primary ar-go" disabled={!ready || pending} onClick={send}>
        {pending ? "Sending…" : pick === "approved" ? "Approve artwork" : pick === "approved_changes" ? "Approve with changes" : "Send changes"}
      </button>}
      {disabled && <div className="muted">Buttons are turned off in preview.</div>}
      {err && <div className="err">{err}</div>}
    </div>
  );
}
