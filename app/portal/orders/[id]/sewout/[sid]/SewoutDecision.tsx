"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerSewout } from "@/app/portal/sewout-actions";

/** Approve the sew-out (the customer types their own name) or ask for changes. */
export default function SewoutDecision({ id, orderId, disabled }: { id: string; orderId: string; disabled: boolean }) {
  const router = useRouter();
  const [pick, setPick] = useState<"approved" | "changes" | "">("");
  const [note, setNote] = useState(""), [name, setName] = useState(""), [checked, setChecked] = useState(false), [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const ready = !!pick && !disabled && (pick === "changes" ? !!note.trim() : name.trim().length >= 2 && checked);
  const send = () => start(async () => {
    setErr("");
    const r = await answerSewout(id, pick as "approved" | "changes", name, note);
    if (!r.ok) return setErr(r.error || "Something went wrong.");
    router.push(`/portal/orders/${orderId}?sewout=${pick}`);
    router.refresh();
  });
  const opt = (k: "approved" | "changes", title: string, about: string, more?: React.ReactNode) => (
    <div className={"ar-opt" + (pick === k ? " on" : "")}>
      <label><input type="radio" name="sw-pick" checked={pick === k} onChange={() => { setPick(k); setErr(""); }} /><b>{title}</b></label>
      <p>{about}</p>
      {pick === k && more}
    </div>
  );
  return (
    <div className="ar-form">
      {opt("approved", "Approve", "It looks right. We run your order with this sew-out.")}
      {opt("changes", "Make changes", "Tell us what to fix. You'll get a new sew-out to approve.", <div className="ar-more">
        <textarea rows={3} aria-label="What to change" placeholder="Tell us what to change (a thread color, the size, a detail)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>)}
      {pick === "approved" && (
        <div className="ar-sign">
          <input type="text" aria-label="Your full name" placeholder="Your full name" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="check"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />I checked the spelling, thread colors and size.</label>
        </div>
      )}
      {pick && <button type="button" className="btn primary ar-go" disabled={!ready || pending} onClick={send}>{pending ? "Sending…" : pick === "approved" ? "Approve the sew-out" : "Send changes"}</button>}
      {disabled && <div className="muted">Buttons are turned off in preview.</div>}
      {err && <div className="err">{err}</div>}
    </div>
  );
}
