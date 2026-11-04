"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { emailButton } from "@/lib/emailParts";
import { bundleCopy, bundlePreview, bundleSend, orderLinkAction, sendFromChoices, sendOptionsAction } from "@/app/shop/proof-send-actions";

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
type Opts = { to: string; name: string; proof: { version: number; mockups: number; unsent: boolean; waiting: boolean } | null; quote: { kind?: "quote" | "invoice"; total: number; status: string; sent?: boolean; deposit: number; /** what's due when they approve, by their terms */ due?: string } | null; sewouts: { id: string; label: string; sent: boolean }[];
  /** the account's people, ticked when their email settings send them approvals */ people?: { email: string; name: string; on: boolean }[] };
/** what's ticked, who it goes to this time, and whether it goes from the person's own mailbox as a reply (lib/customerSend.ts) */
type Pick3 = { proof?: boolean; quote?: boolean; sewouts?: string[]; note?: string; to?: string[]; fromMe?: boolean; reply?: { messageId: string } | null; after?: string };
type Choice = { messageId: string; subject: string; from: string; fromEmail: string; at: string; likely?: boolean };

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function SendProofTool({ target, label = "Send to customer", mode = "send", primary = true, onDone, disabled, before }: {
  target: Target; label?: string; mode?: "send" | "copy"; primary?: boolean; onDone?: (msg: string) => void; disabled?: boolean;
  /** run first (the order page saves and checks the order); false stops */ before?: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<Opts | null>(null);
  const [pick, setPick] = useState<Pick3>({});
  const [pv, setPv] = useState<{ to: string; subject: string; html: string; from?: string } | null>(null);
  // their own mailbox (empty: not connected) and the emails from the people picked that a send could answer
  const [box, setBox] = useState(""), [choices, setChoices] = useState<Choice[]>([]);
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [copied, setCopied] = useState("");
  const what = target.kind === "sewout" ? "sew-out" : "proof";

  async function start() {
    if (before && !(await before())) return;
    setErr(""); setPv(null); setOpts(null); setOpen(true); setBusy("load"); setTyped({ note: false, after: false });
    const r = await sendOptionsAction(target.orderId);
    setBusy("");
    if (!r.ok) { setErr(r.error); return; }
    setOpts(r);
    // what's ready, and what this button is for
    setPick({
      proof: !!r.proof && (target.kind === "art" ? true : target.kind === "order" ? r.proof.unsent : false) && (r.proof.unsent || target.kind === "art"),
      // the price goes with whatever's sent, like a mockup's quote: a sew-out takes the final invoice (Oct 29, Nick: "check
      // sew-out and then also estimate, just like you do with a normal mock-up")
      quote: !!r.quote && !r.quote.sent && r.quote.status !== "quote_sent" && (r.quote.kind !== "invoice" || target.kind === "sewout"),
      sewouts: target.kind === "sewout" && target.sewoutId ? [target.sewoutId] : target.kind === "order" ? r.sewouts.filter((s) => !s.sent).map((s) => s.id) : [],
      note: target.note || "",
      to: (r.people || []).filter((x) => x.on).map((x) => x.email),
    });
    // from their own mailbox, as a reply to the email this send most likely answers, to whoever wrote it (Nov 3, Nick:
    // "Fossil hasn't emailed me in like 4 weeks… can't you just read and go like, hey, we think you're responding to
    // Michael here"): read from everyone at the account and its company domain, not just who's ticked
    const c = await sendFromChoices(target.orderId, (r.people || []).map((x) => x.email));
    if (c.ok && c.box) {
      setBox(c.box); setChoices(c.choices);
      const g = c.choices.find((x) => x.likely);
      if (g) answer(g, r);
    }
  }
  /** reply to this email: from your mailbox, to the person who wrote it (added to the list if they're new) */
  function answer(g: Choice, base = opts) {
    if (base && !(base.people || []).some((x) => x.email === g.fromEmail)) setOpts({ ...base, people: [...(base.people || []), { email: g.fromEmail, name: g.from !== g.fromEmail ? g.from : "", on: false }] });
    setPick((p) => ({ ...p, fromMe: true, reply: { messageId: g.messageId }, to: [g.fromEmail] }));
  }
  const any = !!(pick.proof || pick.quote || (pick.sewouts || []).length);
  // from your own mailbox: your words before and after the card, written for you until you change them (Nov 3, Nick: "hello
  // such and such, thank you for the quote request. Please see and review your quote below… please let me know if this
  // is approved. Thank you")
  const [typed, setTyped] = useState({ note: false, after: false });
  const firsts = (opts?.people || []).filter((x) => (pick.to || []).includes(x.email)).map((x) => (x.name || "").trim().split(/\s+/)[0]).filter(Boolean);
  const hiTo = firsts.length ? (firsts.length === 1 ? firsts[0] : `${firsts.slice(0, -1).join(", ")} and ${firsts[firsts.length - 1]}`) : "there";
  const invoice = opts?.quote?.kind === "invoice";
  const sendWhat = [pick.quote ? (invoice ? "final invoice" : "quote") : "", pick.proof ? "proof" : "", (pick.sewouts || []).length ? "sew-out" : ""].filter(Boolean);
  const whatLine = sendWhat.length > 1 ? `${sendWhat.slice(0, -1).join(", ")} and ${sendWhat[sendWhat.length - 1]}` : sendWhat[0] || "order";
  const defBefore = `Hi ${hiTo},\n\n${pick.quote && !invoice ? "Thank you for the quote request. " : invoice ? "Thank you for your order. " : ""}Please review your ${whatLine} below.`;
  const defAfter = `Please let me know if ${sendWhat.length > 1 ? "everything" : "this"} is approved.`;
  useEffect(() => {
    if (!opts) return;
    setPick((p) => p.fromMe ? { ...p, note: typed.note ? p.note : defBefore, after: typed.after ? p.after : defAfter } : { ...p, note: typed.note ? p.note : target.note || "", after: undefined });
  }, [opts, pick.fromMe, defBefore, defAfter]); // eslint-disable-line react-hooks/exhaustive-deps
  // the preview follows what's ticked
  const key = JSON.stringify({ p: pick.proof, q: pick.quote, s: pick.sewouts, t: pick.to, f: pick.fromMe, r: pick.reply?.messageId, n: typed.note ? "" : pick.note, a: typed.after ? "" : pick.after });
  useEffect(() => {
    if (!open || !opts) return;
    if (!any) { setPv(null); return; }
    let live = true;
    void bundlePreview(target.orderId, pick).then((r) => { if (!live) return; if (r.ok) setPv({ to: r.to, subject: r.subject, html: r.html, from: r.from }); else setErr(r.error); });
    return () => { live = false; };
  }, [open, opts, key]); // eslint-disable-line react-hooks/exhaustive-deps

  async function copyText(url: string, as: "link" | "button") {
    if (as === "button" && typeof ClipboardItem !== "undefined") {
      const html = emailButton(url, "Review and approve").replace('align="center" style="margin:0 auto"', 'style="margin:0"');
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
            <div className="spt-cols">
            <div className="spt-left">
            {opts && <div className="spt-picks">
              {opts.proof && tick(!!pick.proof, (v) => setPick((p) => ({ ...p, proof: v })), `Proof, version ${opts.proof.version}`, `${opts.proof.mockups} mockup${opts.proof.mockups === 1 ? "" : "s"}${opts.proof.unsent ? "" : opts.proof.waiting ? " · already sent, waiting on them" : " · already sent"}`, "proof")}
              {opts.quote && tick(!!pick.quote, (v) => setPick((p) => ({ ...p, quote: v })), `${opts.quote.kind === "invoice" ? "Final invoice" : "Quote"} · ${money(opts.quote.total)}`, `${opts.quote.due || `Deposit to start: ${money(opts.quote.deposit)}`}${opts.quote.sent || opts.quote.status === "quote_sent" ? " · already sent" : ""}`, "quote")}
              {opts.sewouts.map((s) => tick((pick.sewouts || []).includes(s.id), (v) => setPick((p) => ({ ...p, sewouts: v ? [...(p.sewouts || []), s.id] : (p.sewouts || []).filter((x) => x !== s.id) })), s.label, s.sent ? "already sent" : "photo saved, not sent yet", s.id))}
              {!opts.proof && !opts.quote && !opts.sewouts.length && <div className="faint">Nothing to send yet: make a mockup, or the quote, first.</div>}
            </div>}
            {/* who gets it this time; their email settings stay as they are (Nov 3, Nick: "override settings and just send to this person") */}
            {opts && (opts.people || []).length > 0 && <div className="spt-to">
              <span className="imp-l">To: just this time, their email settings don&apos;t change</span>
              <div className="spt-ppl">{(opts.people || []).map((x) => {
                const on = (pick.to || []).includes(x.email);
                return <label key={x.email} className={"spt-person" + (on ? " on" : "")}><input type="checkbox" checked={on} onChange={(e) => setPick((p) => ({ ...p, to: e.target.checked ? [...(p.to || []), x.email] : (p.to || []).filter((y) => y !== x.email) }))} />
                  <span><b data-notranslate>{x.name || x.email}</b>{x.name && <small data-notranslate>{x.email}</small>}</span></label>;
              })}</div>
            </div>}
            {/* from the portal's address, or their own mailbox as a reply in the customer's thread */}
            {opts && box && <div className="spt-from">
              <span className="imp-l">Send from</span>
              <div className="spt-seg" role="radiogroup" aria-label="Send from">
                <button type="button" role="radio" aria-checked={!pick.fromMe} className={!pick.fromMe ? "on" : ""} onClick={() => setPick((p) => ({ ...p, fromMe: false }))}>FBS Print (portal@)</button>
                <button type="button" role="radio" aria-checked={!!pick.fromMe} className={pick.fromMe ? "on" : ""} onClick={() => { const g = pick.reply === undefined ? choices.find((x) => x.likely) : undefined; if (g) answer(g); else setPick((p) => ({ ...p, fromMe: true })); }} data-notranslate>My email ({box.split("@")[0]}@)</button>
              </div>
              {pick.fromMe && <label className="spt-reply"><span className="imp-l">As a reply to</span>
                <select value={pick.reply?.messageId || ""} onChange={(e) => { const g = choices.find((x) => x.messageId === e.target.value); if (g) answer(g); else setPick((p) => ({ ...p, reply: null })); }}>
                  <option value="">A new email (not a reply)</option>
                  {choices.map((c) => <option key={c.messageId} value={c.messageId}>{c.subject} · {c.from} · {new Date(c.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</option>)}
                </select>
                {(() => { const g = choices.find((x) => x.messageId === pick.reply?.messageId && x.likely); return g ? <small className="spt-guess" data-notranslate>Looks like you&apos;re answering {g.from.split(/\s+/)[0]}&apos;s email from {new Date(g.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</small> : null; })()}</label>}
            </div>}
            {/* the email, short: your words, the FBS card as a little bar, your closing (Nov 3, Nick: "make an email that shows
                the default first sentence, then that little FBS bar… cut it off, and then the below") */}
            {opts && (pick.fromMe ? <div className="spt-draft"><span className="imp-l">The email</span>
              <div className="spt-dbox">
                <textarea rows={3} value={pick.note || ""} placeholder={`e.g. Here's the ${what} we talked about`} onChange={(e) => { setTyped((t) => ({ ...t, note: true })); setPick((p) => ({ ...p, note: e.target.value })); }} onBlur={() => { if (any) void bundlePreview(target.orderId, pick).then((r) => { if (r.ok) setPv({ to: r.to, subject: r.subject, html: r.html, from: r.from }); }); }} />
                <div className="spt-dcard" aria-hidden="true"><div className="spt-dbar"><img src="/email/launch/logo-white.png" alt="" /><span>Your {whatLine}{pick.reply ? "" : " · ready to review"}</span></div><div className="spt-drb"><i /><i /><i /></div><small>The {whatLine} and the Review and approve button go here</small></div>
                <textarea rows={2} value={pick.after || ""} onChange={(e) => { setTyped((t) => ({ ...t, after: true })); setPick((p) => ({ ...p, after: e.target.value })); }} onBlur={() => { if (any) void bundlePreview(target.orderId, pick).then((r) => { if (r.ok) setPv({ to: r.to, subject: r.subject, html: r.html, from: r.from }); }); }} />
                <small className="faint">Your signature goes under it{pick.reply ? ", then their email" : ""}.</small>
              </div></div>
              : <label className="spt-note"><span className="imp-l">A note (optional, goes in the email)</span>
              <textarea rows={2} value={pick.note || ""} placeholder={`e.g. Here's the ${what} we talked about`} onChange={(e) => { setTyped((t) => ({ ...t, note: true })); setPick((p) => ({ ...p, note: e.target.value })); }} onBlur={() => { if (any) void bundlePreview(target.orderId, pick).then((r) => { if (r.ok) setPv({ to: r.to, subject: r.subject, html: r.html, from: r.from }); }); }} /></label>)}
            </div>
            <div className="spt-right">
            {pv && <div className="spt-meta">{pv.from && <div><span>From</span><b data-notranslate>{pv.from}</b></div>}<div><span>To</span><b>{pv.to || (pick.to && opts?.people?.length ? "Tick who gets it" : "No email on the customer")}</b></div><div><span>Subject</span><b>{pv.subject}</b></div></div>}
            {opts && <div className="spt-mail">{pv ? <iframe title="The email" srcDoc={pv.html} sandbox="" /> : <div className="faint" style={{ padding: 20 }}>{any ? "Making the preview…" : "Tick what to send."}</div>}</div>}
            </div>
            </div>
            {err && <div className="pv-err">{err}</div>}
            <div className="spt-foot">
              {copyBtns(!any)}
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy === "send"}>Cancel</button>
              <button type="button" className="btn primary" disabled={!!busy || !any || !pv?.to} onClick={() => void send()}>{busy === "send" ? "Sending…" : pick.fromMe ? "Send from my email" : "Send"}</button>
            </div>
          </div>
        </div>, document.body)}
    </>
  );
}
