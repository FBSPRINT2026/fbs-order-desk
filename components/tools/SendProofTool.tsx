"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { bundleCopy, bundlePreview, bundleSend, orderLinkAction, sendOptionsAction } from "@/app/shop/proof-send-actions";

/**
 * THE Send to customer, from anywhere (the order, the Proof Center, the Digitizing page's sew-outs). Oct 29, Nick:
 * "preview proof to customer, and then you click actually send… copy a link that makes, like, a little button… sometimes
 * we would send a proof without sending an invoice or a quote. Ideally, it all comes together… one email" (option A).
 *
 * - Tick what goes: the proof (the order's current mockups as the next version), the quote, each sew-out. What's ready is
 *   ticked to start with; the button you came from ticks its own.
 * - The email exactly as the customer gets it, then Send. Or Copy link / Copy as a button for your own email (made the
 *   same, without the email).
 * - One link for the order: the customer's page with every step waiting on them (lib/customerSend.ts).
 * mode "copy": just the two copy buttons, for the order's page as it is (nothing new sent).
 */
type Target = { kind: "art" | "sewout" | "order"; orderId: string; sewoutId?: string; note?: string; live?: boolean };
type Opts = { to: string; name: string; proof: { version: number; mockups: number; unsent: boolean; waiting: boolean } | null; quote: { total: number; status: string; deposit: number; /** what's due when they approve, by their terms */ due?: string } | null; sewouts: { id: string; label: string; sent: boolean }[] };
type Pick3 = { proof?: boolean; quote?: boolean; sewouts?: string[]; note?: string };

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function SendProofTool({ target, label = "Send to customer", mode = "send", primary = true, onDone, disabled, before }: {
  target: Target; label?: string; mode?: "send" | "copy"; primary?: boolean; onDone?: (msg: string) => void; disabled?: boolean;
  /** run first (the order page saves and checks the order); false stops */ before?: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<Opts | null>(null);
  const [pick, setPick] = useState<Pick3>({});
  const [pv, setPv] = useState<{ to: string; subject: string; html: string } | null>(null);
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [copied, setCopied] = useState("");
  const what = target.kind === "sewout" ? "sew-out" : "proof";

  async function start() {
    if (before && !(await before())) return;
    setErr(""); setPv(null); setOpts(null); setOpen(true); setBusy("load");
    const r = await sendOptionsAction(target.orderId);
    setBusy("");
    if (!r.ok) { setErr(r.error); return; }
    setOpts(r);
    // what's ready, and what this button is for
    setPick({
      proof: !!r.proof && (target.kind === "art" ? true : target.kind === "order" ? r.proof.unsent : false) && (r.proof.unsent || target.kind === "art"),
      quote: !!r.quote && r.quote.status !== "quote_sent" && target.kind !== "sewout",
      sewouts: target.kind === "sewout" && target.sewoutId ? [target.sewoutId] : target.kind === "order" ? r.sewouts.filter((s) => !s.sent).map((s) => s.id) : [],
      note: target.note || "",
    });
  }
  const any = !!(pick.proof || pick.quote || (pick.sewouts || []).length);
  // the preview follows what's ticked
  const key = JSON.stringify({ p: pick.proof, q: pick.quote, s: pick.sewouts });
  useEffect(() => {
    if (!open || !opts) return;
    if (!any) { setPv(null); return; }
    let live = true;
    void bundlePreview(target.orderId, pick).then((r) => { if (!live) return; if (r.ok) setPv({ to: r.to, subject: r.subject, html: r.html }); else setErr(r.error); });
    return () => { live = false; };
  }, [open, opts, key]); // eslint-disable-line react-hooks/exhaustive-deps

  async function copyText(url: string, as: "link" | "button") {
    if (as === "button" && typeof ClipboardItem !== "undefined") {
      const html = `<a href="${url}" style="display:inline-block;background:#0E9BD8;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:15px">Review and approve</a>`;
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([url], { type: "text/plain" }) })]);
    } else await navigator.clipboard.writeText(url);
  }
  async function copy(as: "link" | "button") {
    setErr(""); setBusy(as);
    const r = mode === "copy" ? await orderLinkAction(target.orderId) : await bundleCopy(target.orderId, pick);
    setBusy("");
    if (!r.ok || !r.url) { setErr((!r.ok && r.error) || "Couldn't make the link."); return; }
    try {
      await copyText(r.url, as);
      setCopied(as); setTimeout(() => setCopied(""), 2500);
      onDone?.(as === "button" ? "The button is copied. Paste it into your email." : "The link is copied.");
      if (mode !== "copy") setOpen(false);
    } catch { setErr(`Couldn't copy. Here's the link: ${r.url}`); }
  }
  async function send() {
    setErr(""); setBusy("send");
    const r = await bundleSend(target.orderId, pick);
    setBusy("");
    if (!r.ok) { setErr(r.error); return; }
    setOpen(false);
    onDone?.(r.msg);
  }

  const copyBtns = (dis: boolean) => <>
    <button type="button" className="btn sm" disabled={!!busy || dis || disabled} title="Copies a blue Review and approve button to paste into your own email" onClick={() => void copy("button")}>{busy === "button" ? "Copying…" : copied === "button" ? "Copied" : "Copy as a button"}</button>
    <button type="button" className="btn sm" disabled={!!busy || dis || disabled} title="Copies the link to the customer's page" onClick={() => void copy("link")}>{busy === "link" ? "Copying…" : copied === "link" ? "Copied" : "Copy link"}</button>
  </>;
  if (mode === "copy") return <span className="spt-copy">{copyBtns(false)}{err && <span className="pv-err" style={{ margin: 0 }}>{err}</span>}</span>;

  const tick = (on: boolean, set: (v: boolean) => void, title: string, sub: string, key2: string) => (
    <label key={key2} className={"spt-chk" + (on ? " on" : "")}><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /><span><b>{title}</b><small>{sub}</small></span></label>
  );
  return (
    <>
      <button type="button" className={"btn" + (primary ? " primary" : "")} disabled={disabled} onClick={() => void start()}>{label}</button>
      {open && createPortal(
        <div className="mk-modal-back" role="dialog" aria-modal="true" aria-labelledby="spt-t" onKeyDown={(e) => { if (e.key === "Escape" && !busy) setOpen(false); }}>
          <div className="mk-modal spt">
            <div className="spt-h"><h2 id="spt-t">Send to {opts?.name || "the customer"}</h2><span className="faint">One email with what you tick</span></div>
            {!opts && <div className="faint">{busy === "load" ? "Loading…" : ""}</div>}
            {opts && <div className="spt-picks">
              {opts.proof && tick(!!pick.proof, (v) => setPick((p) => ({ ...p, proof: v })), `Proof, version ${opts.proof.version}`, `${opts.proof.mockups} mockup${opts.proof.mockups === 1 ? "" : "s"}${opts.proof.unsent ? "" : opts.proof.waiting ? " · already sent, waiting on them" : " · already sent"}`, "proof")}
              {opts.quote && tick(!!pick.quote, (v) => setPick((p) => ({ ...p, quote: v })), `Quote · ${money(opts.quote.total)}`, `${opts.quote.due || `Deposit to start: ${money(opts.quote.deposit)}`}${opts.quote.status === "quote_sent" ? " · already sent" : ""}`, "quote")}
              {opts.sewouts.map((s) => tick((pick.sewouts || []).includes(s.id), (v) => setPick((p) => ({ ...p, sewouts: v ? [...(p.sewouts || []), s.id] : (p.sewouts || []).filter((x) => x !== s.id) })), s.label, s.sent ? "already sent" : "photo saved, not sent yet", s.id))}
              {!opts.proof && !opts.quote && !opts.sewouts.length && <div className="faint">Nothing to send yet: make a mockup, or the quote, first.</div>}
            </div>}
            {opts && <label className="spt-note"><span className="imp-l">A note (optional, goes in the email)</span>
              <textarea rows={2} value={pick.note || ""} placeholder={`e.g. Here's the ${what} we talked about`} onChange={(e) => setPick((p) => ({ ...p, note: e.target.value }))} onBlur={() => { if (any) void bundlePreview(target.orderId, pick).then((r) => { if (r.ok) setPv({ to: r.to, subject: r.subject, html: r.html }); }); }} /></label>}
            {pv && <div className="spt-meta"><div><span>To</span><b>{pv.to || "No email on the customer"}</b></div><div><span>Subject</span><b>{pv.subject}</b></div></div>}
            {opts && <div className="spt-mail">{pv ? <iframe title="The email" srcDoc={pv.html} sandbox="" /> : <div className="faint" style={{ padding: 20 }}>{any ? "Making the preview…" : "Tick what to send."}</div>}</div>}
            {err && <div className="pv-err">{err}</div>}
            <div className="spt-foot">
              {copyBtns(!any)}
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy === "send"}>Cancel</button>
              <button type="button" className="btn primary" disabled={!!busy || !any || !pv?.to} onClick={() => void send()}>{busy === "send" ? "Sending…" : "Send"}</button>
            </div>
          </div>
        </div>, document.body)}
    </>
  );
}
