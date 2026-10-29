"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { proofCopyLink, proofSend, proofSendPreview, type ProofTarget } from "@/app/shop/proof-send-actions";

/**
 * THE way a proof goes to the customer, from anywhere (the order's art proofs, the Digitizing page's sew-outs, the Proofs
 * page): Oct 29, Nick: "preview proof to customer, and then you click actually send… copy a link that makes, like, a
 * little button… so I can just type an email and go, hey, here's your proof, and then just click the button below".
 *
 * - Preview: the email exactly as the customer gets it, then Send.
 * - Copy link / Copy as a button: the proof is made (the same as sending, without the email) and its link copied, plain
 *   or as a blue "Review and approve" button to paste into your own email.
 * Both open the customer's proof page (/proof/…, lib/proofLinks.ts). mode "copy" shows only the two copy buttons (a proof
 * already out with the customer).
 */
export default function SendProofTool({ target, label = "Send to customer", mode = "send", primary = true, onDone, disabled }: {
  target: ProofTarget; label?: string; mode?: "send" | "copy"; primary?: boolean; onDone?: (msg: string) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pv, setPv] = useState<{ to: string; subject: string; html: string } | null>(null);
  const [note, setNote] = useState(target.note || "");
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [copied, setCopied] = useState("");
  const t = { ...target, note };

  async function load() {
    setErr(""); setBusy("load");
    const r = await proofSendPreview(t);
    setBusy("");
    if (!r.ok) { setErr(r.error); return; }
    setPv({ to: r.to, subject: r.subject, html: r.html });
  }
  useEffect(() => { if (open) void load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function copy(as: "link" | "button") {
    setErr(""); setBusy(as);
    const r = await proofCopyLink(t);
    setBusy("");
    if (!r.ok || !r.url) { setErr((!r.ok && r.error) || "Couldn't make the link."); return; }
    const what = target.kind === "art" ? "proof" : "sew-out";
    try {
      if (as === "button" && typeof ClipboardItem !== "undefined") {
        const html = `<a href="${r.url}" style="display:inline-block;background:#0E9BD8;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:15px">Review and approve your ${what}</a>`;
        await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([r.url], { type: "text/plain" }) })]);
      } else await navigator.clipboard.writeText(r.url);
      setCopied(as);
      setTimeout(() => setCopied(""), 2500);
      onDone?.(as === "button" ? `The ${what}'s button is copied. Paste it into your email.` : `The ${what}'s link is copied.`);
    } catch { setErr(`Couldn't copy. Here's the link: ${r.url}`); }
  }
  async function send() {
    setErr(""); setBusy("send");
    const r = await proofSend(t);
    setBusy("");
    if (!r.ok) { setErr(r.error); return; }
    setOpen(false);
    onDone?.(r.msg);
  }

  const copyBtns = <>
    <button type="button" className="btn sm" disabled={!!busy || disabled} title="Copies a blue Review and approve button to paste into your own email" onClick={() => void copy("button")}>{busy === "button" ? "Copying…" : copied === "button" ? "Copied" : "Copy as a button"}</button>
    <button type="button" className="btn sm" disabled={!!busy || disabled} title="Copies the link to the customer's proof page" onClick={() => void copy("link")}>{busy === "link" ? "Copying…" : copied === "link" ? "Copied" : "Copy link"}</button>
  </>;
  if (mode === "copy") return <span className="spt-copy">{copyBtns}{err && <span className="pv-err" style={{ margin: 0 }}>{err}</span>}</span>;

  return (
    <>
      <button type="button" className={"btn" + (primary ? " primary" : "")} disabled={disabled} onClick={() => setOpen(true)}>{label}</button>
      {open && createPortal(
        <div className="mk-modal-back" role="dialog" aria-modal="true" aria-labelledby="spt-t" onKeyDown={(e) => { if (e.key === "Escape" && !busy) setOpen(false); }}>
          <div className="mk-modal spt">
            <div className="spt-h"><h2 id="spt-t">{target.kind === "art" ? "Send the proof" : "Send the sew-out"}</h2><span className="faint">Preview: this is what the customer gets</span></div>
            {pv && <div className="spt-meta"><div><span>To</span><b>{pv.to || "No email on the customer"}</b></div><div><span>Subject</span><b>{pv.subject}</b></div></div>}
            {target.kind === "art" && <label className="spt-note"><span className="imp-l">What did you change? (goes with the proof)</span>
              <textarea rows={2} value={note} placeholder="e.g. Picked PMS 157 for the logo like you asked" onChange={(e) => setNote(e.target.value)} onBlur={() => void load()} /></label>}
            <div className="spt-mail">{pv ? <iframe title="The email" srcDoc={pv.html} sandbox="" /> : <div className="faint" style={{ padding: 20 }}>{busy === "load" ? "Making the preview…" : ""}</div>}</div>
            {err && <div className="pv-err">{err}</div>}
            <div className="spt-foot">
              {copyBtns}
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy === "send"}>Cancel</button>
              <button type="button" className="btn primary" disabled={!!busy || !pv?.to} onClick={() => void send()}>{busy === "send" ? "Sending…" : "Send"}</button>
            </div>
          </div>
        </div>, document.body)}
    </>
  );
}
