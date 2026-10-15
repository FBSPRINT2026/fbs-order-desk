"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Message, Proof } from "@/lib/pricing";
import { fmtStamp } from "@/lib/format";
import { approveQuote, customerMessage, requestQuoteChanges, startCheckout } from "../../actions";
import { reorderRequest } from "../../request-actions";

/** "Order this again": copies this order into a new request the customer can change and send in. */
export function ReorderButton({ orderId, disabled }: { orderId: string; disabled: boolean }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <button className="btn" type="button" disabled={disabled || pending} title={disabled ? PREVIEW : "Start a new order with the same garments, sizes and logos"}
        onClick={() => start(async () => { setErr(""); const r = await reorderRequest(orderId); if (r.ok && r.id) router.push(`/portal/request/${r.id}`); else setErr(r.error || "Couldn't start the reorder."); })}>
        {pending ? "Starting…" : "Order this again"}
      </button>
      {err && <span className="err">{err}</span>}
    </>
  );
}

const PREVIEW = "Turned off in preview";

export function QuoteApproval({ orderId, total, terms, disabled }: { orderId: string; total: string; terms: string; disabled: boolean; defaultName: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"approve" | "changes">("approve");
  const [name, setName] = useState(""); // typed by the customer, never filled in (Oct 15, Nick)
  const [agree, setAgree] = useState(false);
  const [comment, setComment] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const [pending, start] = useTransition();

  const approve = () => start(async () => {
    setErr("");
    const r = await approveQuote(orderId, name);
    if (!r.ok) return setErr(r.error || "");
    setDone("Approved. Thank you! You can pay your deposit below.");
    router.refresh();
  });
  const changes = () => start(async () => {
    setErr("");
    const r = await requestQuoteChanges(orderId, comment);
    if (!r.ok) return setErr(r.error || "");
    setComment("");
    setDone("Sent. We'll update the quote and let you know.");
    router.refresh();
  });

  if (done) return <div className="callout good"><h2>{done}</h2></div>;
  return (
    <div className="callout">
      <div className="row"><h2>Ready to approve this quote?</h2><span className="spacer" /><b className="num" style={{ fontSize: 18 }}>{total}</b></div>
      <div className="chips" style={{ alignSelf: "flex-start" }}>
        <button type="button" className={"chip" + (mode === "approve" ? " on" : "")} onClick={() => setMode("approve")}>Approve</button>
        <button type="button" className={"chip" + (mode === "changes" ? " on" : "")} onClick={() => setMode("changes")}>Request changes</button>
      </div>
      {mode === "approve" ? (
        <div className="sig">
          <div className="field"><label htmlFor="sig-name">Type your full name to sign</label><input id="sig-name" type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
          <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I approve this quote, including sizes, colors and quantities{terms ? `, and agree to the terms: ${terms}` : "."}</label>
          <button className="btn primary" type="button" disabled={disabled || pending || !agree || name.trim().length < 2} onClick={approve} title={disabled ? PREVIEW : ""} style={{ alignSelf: "flex-start" }}>{pending ? "Approving…" : "Approve and sign"}</button>
        </div>
      ) : (
        <div className="sig">
          <div className="field"><label htmlFor="chg">What should we change?</label><textarea id="chg" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Different color, add 10 more larges, move the logo…" /></div>
          <button className="btn primary" type="button" disabled={disabled || pending || !comment.trim()} onClick={changes} title={disabled ? PREVIEW : ""} style={{ alignSelf: "flex-start" }}>{pending ? "Sending…" : "Send change request"}</button>
        </div>
      )}
      {err && <div className="err">{err}</div>}
    </div>
  );
}

/** A proof on the order page: the whole mockup, its status, and "Review art" (Oct 15, Nick: one button that opens
 *  the full review, instead of approve / request changes here). */
export function ProofCard({ proof, reviewHref }: { proof: Proof & { url: string | null }; reviewHref: string }) {
  const isImg = proof.file_type.startsWith("image/");
  const pending = proof.status === "pending";
  return (
    <div className="proof">
      <a className="img" href={pending ? reviewHref : proof.url || undefined} target={pending ? undefined : "_blank"} rel="noreferrer" title={pending ? "Review art" : "Open full size"}>
        {isImg && proof.url ? <img src={proof.url} alt={proof.title} /> : <span className="file">{proof.file_type.includes("pdf") ? "PDF proof" : "Proof file"}<br />Tap to open</span>}
      </a>
      <div className="pb">
        <b>{proof.title}</b>
        <span className={"proof-status " + proof.status}>
          {pending ? "Waiting for your review" : proof.status === "approved" ? `${proof.customer_comment ? "Approved with changes" : "Approved"} by ${proof.decided_name} · ${fmtStamp(proof.decided_at)}` : "You asked for changes"}
        </span>
        {proof.customer_comment && <span className="muted" style={{ whiteSpace: "pre-line" }}>“{proof.customer_comment}”</span>}
        {pending ? <a className="btn primary sm" href={reviewHref}>Review art</a> : <a className="btn ghost sm" href={reviewHref}>See the review</a>}
      </div>
    </div>
  );
}

export function MessageThread({ orderId, messages, disabled, shopName }: { orderId: string; messages: Message[]; disabled: boolean; shopName: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const send = () => start(async () => {
    setErr("");
    const r = await customerMessage(orderId, text);
    if (!r.ok) return setErr(r.error || "");
    setText("");
    router.refresh();
  });
  return (
    <div className="stack">
      {messages.length ? (
        <div className="thread">
          {messages.map((m) => (
            <div key={m.id} className={"msg " + (m.author_type === "customer" ? "me" : "them")}>
              <div className="who">{m.author_type === "customer" ? "You" : shopName} · {fmtStamp(m.created_at)}</div>{m.body}
            </div>
          ))}
        </div>
      ) : <div className="muted" style={{ fontSize: 13 }}>Questions about this order? Send us a message and we&apos;ll reply here and by email.</div>}
      <div className="composer">
        <textarea aria-label="Message" placeholder="Write a message…" value={text} onChange={(e) => setText(e.target.value)} disabled={disabled} />
        <button className="btn primary" type="button" disabled={disabled || pending || !text.trim()} onClick={send} title={disabled ? PREVIEW : ""}>{pending ? "Sending…" : "Send"}</button>
      </div>
      {err && <div className="err">{err}</div>}
    </div>
  );
}

export function PayBox({ orderId, disabled, balance, deposit }: { orderId: string; disabled: boolean; balance: string; deposit: { pct: number; label: string } | null }) {
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const pay = (kind: "deposit" | "balance") => start(async () => {
    setErr("");
    const r = await startCheckout(orderId, kind);
    if (!r.ok || !r.url) return setErr(r.error || "Couldn't start the payment.");
    window.location.href = r.url;
  });
  return (
    <div className="stack" style={{ gap: 8 }}>
      {deposit && <button className="btn primary" type="button" disabled={disabled || pending} title={disabled ? PREVIEW : ""} onClick={() => pay("deposit")}>Pay {deposit.pct}% deposit · {deposit.label}</button>}
      <button className={"btn" + (deposit ? "" : " primary")} type="button" disabled={disabled || pending} title={disabled ? PREVIEW : ""} onClick={() => pay("balance")}>{pending ? "Opening checkout…" : `Pay full balance · ${balance}`}</button>
      <span className="sub">Secure card payment through Stripe.</span>
      {err && <div className="err">{err}</div>}
    </div>
  );
}
