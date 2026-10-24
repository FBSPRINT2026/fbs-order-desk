"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Message, Proof } from "@/lib/pricing";
import { fmtStamp } from "@/lib/format";
import PayPanel, { type PayItem } from "@/components/PayPanel";
import { approveQuote, archiveMyQuote, customerMessage, requestCancellation, requestQuoteChanges, startCheckout, withdrawSentRequest } from "../../actions";
import { reorderRequest } from "../../request-actions";

/** "Reorder": copies this order into a new request the customer can change and send in. */
export function ReorderButton({ orderId, disabled }: { orderId: string; disabled: boolean }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <button className="btn" type="button" disabled={disabled || pending} title={disabled ? PREVIEW : "Start a new order with the same garments, sizes and logos"}
        onClick={() => start(async () => { setErr(""); const r = await reorderRequest(orderId); if (r.ok && r.id) router.push(`/portal/request/${r.id}`); else setErr(r.error || "Couldn't start the reorder."); })}>
        {pending ? "Starting…" : "Reorder"}
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

/**
 * What the customer can do with this order (Oct 24, Nick): a request we haven't opened can be deleted (asked first); once
 * we've seen it, or it's an order, they ask us to cancel with a reason; a quote can be archived ("not going ahead").
 */
export function OrderActions({ orderId, kind, archived, cancelAsked, disabled }: { orderId: string; kind: "unseen" | "seen" | "quote" | "order"; archived?: boolean; cancelAsked?: boolean; disabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<"" | "delete" | "cancel">("");
  const [reason, setReason] = useState("The customer canceled"), [note, setNote] = useState("");
  const [err, setErr] = useState(""), [done, setDone] = useState("");
  const [pending, start] = useTransition();
  if (done) return <span className="faint oa-done">{done}</span>;
  if (kind === "quote") return (
    <button type="button" className="btn ghost" disabled={disabled || pending} title={disabled ? PREVIEW : archived ? "Back to your quotes" : "Not going ahead with this quote: it moves to your archived quotes"}
      onClick={() => start(async () => { const r = await archiveMyQuote(orderId, !archived); if (r.ok) { setDone(archived ? "Back in your quotes." : "Archived. Find it under Show older quotes and archived."); router.refresh(); } else setErr(r.error || ""); })}>
      {archived ? "Unarchive quote" : "Archive quote"}
    </button>
  );
  if (cancelAsked) return <span className="pill oa-asked">Cancellation requested</span>;
  return (
    <>
      {kind === "unseen"
        ? <button type="button" className="btn ghost danger" disabled={disabled} title={disabled ? PREVIEW : undefined} onClick={() => setOpen("delete")}>Delete</button>
        : <button type="button" className="btn" disabled={disabled} title={disabled ? PREVIEW : undefined} onClick={() => setOpen("cancel")}>Request cancellation</button>}
      {open && (
        <div className="dla-bg" role="dialog" aria-modal="true" aria-label={open === "delete" ? "Delete this order?" : "Request cancellation"} onClick={() => !pending && setOpen("")}>
          <div className="dla" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            {open === "delete" ? <>
              <h3>Delete this order?</h3>
              <p className="dla-sub">FBS hasn&apos;t opened it yet, so it can still be taken back. Are you sure?</p>
            </> : <>
              <h3>Ask us to cancel this order</h3>
              <p className="dla-sub">We&apos;ve already seen it, so we&apos;ll check where it is and reply in Messages.</p>
              <div className="field"><label htmlFor="oa-why">Why?</label><select id="oa-why" value={reason} onChange={(e) => setReason(e.target.value)}>
                {["The customer canceled", "Entered twice by mistake", "Ordered the wrong thing", "Other"].map((x) => <option key={x}>{x}</option>)}</select></div>
              <div className="field"><label htmlFor="oa-note">Anything else? (optional)</label><textarea id="oa-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            </>}
            {err && <div className="banner" role="alert">{err}</div>}
            <div className="dla-acts">
              <button type="button" className="btn ghost" disabled={pending} onClick={() => setOpen("")}>Keep it</button>
              <button type="button" className={"btn " + (open === "delete" ? "danger" : "primary")} disabled={pending} onClick={() => start(async () => {
                setErr("");
                const r = open === "delete" ? await withdrawSentRequest(orderId) : await requestCancellation(orderId, reason, note);
                if (!r.ok) return setErr(r.error || "Couldn't do that.");
                setOpen("");
                if (open === "delete") router.push("/portal?area=orders"); else { setDone("Cancellation requested. We'll reply in Messages."); router.refresh(); }
              })}>{pending ? "Working…" : open === "delete" ? "Yes, delete it" : "Send the request"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Pay this order (Oct 24, Nick: "get rid of that payment tab the way it is… exactly the same panel and button that's on the
 * payment screen"): what's owed and one Pay button; the pay window opens over the page, same as the Payments tab.
 */
export function PayButton({ item, pay, staxToken, canAct, receiptEmail }: { item: PayItem; pay: { cardFeePct: number; zelle: string; venmo: string }; staxToken: string; canAct: boolean; receiptEmail: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="pb-due"><span>Balance due</span><b className="num">{fmtMoney(item.balance)}</b></div>
      {item.deposit && item.deposit < item.balance - 0.004 ? <div className="faint" style={{ fontSize: 12.5 }}>Deposit to get started: {fmtMoney(item.deposit)}</div> : null}
      <button type="button" className="btn primary pb-go" disabled={!canAct} title={canAct ? undefined : PREVIEW} onClick={() => setOpen(true)}>Pay now</button>
      {open && <PayPanel modal receiptEmail={receiptEmail} items={[item]} pay={pay} staxToken={staxToken} canAct={canAct} onClose={() => setOpen(false)} />}
    </>
  );
}
const fmtMoney = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
