"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
type Opts = { to: string; name: string; proof: { version: number; mockups: number; unsent: boolean; waiting: boolean; approved?: { version: number | null; by: string; at: string; another: boolean } | null } | null; quote: { kind?: "quote" | "invoice"; total: number; status: string; sent?: boolean; deposit: number; /** what's due when they approve, by their terms */ due?: string } | null; sewouts: { id: string; label: string; sent: boolean }[];
  /** the account's people, ticked when their email settings send them approvals */ people?: { email: string; name: string; on: boolean }[] };
/** what's ticked, who it goes to this time, and whether it goes from the person's own mailbox as a reply (lib/customerSend.ts) */
type Pick3 = { proof?: boolean; quote?: boolean; sewouts?: string[]; note?: string; to?: string[]; fromMe?: boolean; reply?: { messageId: string } | null; after?: string };
type Choice = { messageId: string; subject: string; from: string; fromEmail: string; at: string; likely?: boolean; thread?: boolean };

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
    // both go by default, the proof and the quote, untick one to send the other alone (Nov 10, Nick: "by default… it should
    // send proof and quote… you wouldn't want to just have one or the other just to start"); art the customer already
    // already has (sent, nothing changed) isn't ticked: there's nothing new to send
    const proof0 = !!r.proof && target.kind !== "sewout" && (r.proof.unsent || target.kind === "art");
    const sew0 = target.kind === "sewout" && target.sewoutId ? [target.sewoutId] : target.kind === "order" ? r.sewouts.filter((s) => !s.sent).map((s) => s.id) : [];
    // the price goes with whatever's sent, like a mockup's quote: a sew-out takes the final invoice (Oct 29, Nick: "check
    // sew-out and then also estimate, just like you do with a normal mock-up"). Nothing new to send (the quote went out
    // already, no new proof): the quote is ticked to send again, so the dialog never opens empty (Nov 4, Nick)
    const quote0 = !!r.quote && (r.quote.kind !== "invoice" ? target.kind !== "sewout" || (!r.quote.sent && r.quote.status !== "quote_sent") : target.kind === "sewout");
    setPick({
      proof: proof0,
      quote: quote0 || (!!r.quote && target.kind === "order" && !proof0 && !sew0.length),
      sewouts: sew0,
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


  return (
    <>
      <button type="button" className={"btn" + (primary ? " primary" : "")} disabled={disabled} onClick={() => void start()}>{label}</button>
      {open && createPortal(
        <div className="mk-modal-back" role="dialog" aria-modal="true" aria-labelledby="spt-t" onKeyDown={(e) => { if (e.key === "Escape" && !busy) setOpen(false); }}>
          <div className="mk-modal spt">
            {/* Option A (Nov 3, Nick): like writing an email. What to send as ticks on the title line; From, To and Reply to
                as the email's header lines; then the email itself, big, its boxes growing as you type (no scroll bars in
                them); the preview on the right */}
            <div className="spt-h"><h2 id="spt-t">Send to {opts?.name || "the customer"}</h2>
              {opts && <div className="spt-ticks">
                {opts.proof && <label className={"spt-tk" + (pick.proof ? " on" : "")} title={`${opts.proof.mockups} mockup${opts.proof.mockups === 1 ? "" : "s"}${opts.proof.unsent ? "" : opts.proof.waiting ? " · already sent, waiting on them" : " · already sent"}`}><input type="checkbox" checked={!!pick.proof} onChange={(e) => setPick((p) => ({ ...p, proof: e.target.checked }))} /> Proof v{opts.proof.version}{!opts.proof.unsent && <small> · sent</small>}</label>}
                {opts.quote && <label className={"spt-tk" + (pick.quote ? " on" : "")} title={`${opts.quote.due || `Deposit to start: ${money(opts.quote.deposit)}`}${opts.quote.sent || opts.quote.status === "quote_sent" ? " · already sent" : ""}`}><input type="checkbox" checked={!!pick.quote} onChange={(e) => setPick((p) => ({ ...p, quote: e.target.checked }))} /> {opts.quote.kind === "invoice" ? "Final invoice" : "Quote"} · {money(opts.quote.total)}{(opts.quote.sent || opts.quote.status === "quote_sent") && <small> · sent</small>}</label>}
                {opts.sewouts.map((x) => { const on = (pick.sewouts || []).includes(x.id); return <label key={x.id} className={"spt-tk" + (on ? " on" : "")} title={x.sent ? "already sent" : "photo saved, not sent yet"}><input type="checkbox" checked={on} onChange={(e) => setPick((p) => ({ ...p, sewouts: e.target.checked ? [...(p.sewouts || []), x.id] : (p.sewouts || []).filter((y) => y !== x.id) }))} /> {x.label}</label>; })}
                {!opts.proof && !opts.quote && !opts.sewouts.length && <span className="faint">Nothing to send yet: make a mockup, or the quote, first.</span>}
              </div>}
            </div>
            {/* the art is already approved: sending a proof asks them again and takes that approval off (Nov 10, Nick, #40444) */}
            {opts?.proof?.approved && pick.proof && opts.proof.unsent && <div className="spt-apw" role="note"><b>Already approved</b> Version {opts.proof.approved.version} was {opts.proof.approved.another ? "approved another way" : "approved"}{opts.proof.approved.by ? ` (${opts.proof.approved.by}${opts.proof.approved.at ? `, ${new Date(opts.proof.approved.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""})` : ""}. Sending version {opts.proof.version} takes that approval off, and they approve again.</div>}
            {!opts && <div className="faint">{busy === "load" ? "Loading…" : ""}</div>}
            {opts && <div className="spt-cols">
            <div className="spt-left">
              <div className="spt-mailbox">
                {box && <div className="spt-row"><span className="spt-rl">From</span>
                  <div className="spt-seg" role="radiogroup" aria-label="Send from">
                    <button type="button" role="radio" aria-checked={!pick.fromMe} className={!pick.fromMe ? "on" : ""} onClick={() => setPick((p) => ({ ...p, fromMe: false }))}>FBS Print (portal@)</button>
                    <button type="button" role="radio" aria-checked={!!pick.fromMe} className={pick.fromMe ? "on" : ""} onClick={() => { const g = pick.reply === undefined ? choices.find((x) => x.likely) : undefined; if (g) answer(g); else setPick((p) => ({ ...p, fromMe: true })); }} data-notranslate>My email ({box.split("@")[0]}@)</button>
                  </div></div>}
                {/* who gets it this time; their email settings stay as they are (Nov 3, Nick: "override settings and just send to this person") */}
                {(opts.people || []).length > 0 && <div className="spt-row"><span className="spt-rl">To</span>
                  <div className="spt-ppl" title="Just this time: their email settings don't change">{(opts.people || []).map((x) => {
                    const on = (pick.to || []).includes(x.email);
                    return <button key={x.email} type="button" className={"spt-who" + (on ? " on" : "")} aria-pressed={on} title={x.email} data-notranslate
                      onClick={() => setPick((p) => ({ ...p, to: on ? (p.to || []).filter((y) => y !== x.email) : [...(p.to || []), x.email] }))}>{on ? "" : "+ "}{x.name || x.email}{on && <span aria-hidden> ×</span>}</button>;
                  })}</div></div>}
                {pick.fromMe && <div className="spt-row"><span className="spt-rl">Reply to</span>
                  <div className="spt-rv"><select value={pick.reply?.messageId || ""} aria-label="As a reply to" onChange={(e) => { const g = choices.find((x) => x.messageId === e.target.value); if (g) answer(g); else setPick((p) => ({ ...p, reply: null })); }}>
                    <option value="">A new email (not a reply)</option>
                    {choices.map((c) => <option key={c.messageId} value={c.messageId}>{c.thread ? `${c.from}'s message on this order` : c.subject}{c.thread ? "" : ` · ${c.from}`} · {new Date(c.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</option>)}
                  </select>
                  {(() => { const g = choices.find((x) => x.messageId === pick.reply?.messageId && x.likely); return g ? <small className="spt-guess" data-notranslate>Looks like you&apos;re answering {g.from.split(/\s+/)[0]}&apos;s {g.thread ? "message on this order" : "email"} from {new Date(g.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</small> : null; })()}</div></div>}
                {/* the email itself: your words, the FBS card as a little bar, your closing, your signature */}
                <div className="spt-body">
                  <AutoText value={pick.note || ""} placeholder={pick.fromMe ? "Hi …" : `A note (optional): e.g. Here's the ${what} we talked about`} label={pick.fromMe ? "Your message, above the card" : "A note (optional, goes in the email)"}
                    onChange={(v) => { setTyped((t) => ({ ...t, note: true })); setPick((p) => ({ ...p, note: v })); }} onBlur={() => { if (any) void bundlePreview(target.orderId, pick).then((r) => { if (r.ok) setPv({ to: r.to, subject: r.subject, html: r.html, from: r.from }); }); }} />
                  <div className="spt-dcard" aria-hidden="true"><div className="spt-dbar"><img src="/email/launch/logo-white.png" alt="" /><span>Your {whatLine}{pick.reply ? "" : " · ready to review"}</span></div><div className="spt-drb"><i /><i /><i /></div><small>The {whatLine} and the Review and approve button go here</small></div>
                  {pick.fromMe && <>
                    <AutoText value={pick.after || ""} placeholder="Please let me know if this is approved." label="After the card"
                      onChange={(v) => { setTyped((t) => ({ ...t, after: true })); setPick((p) => ({ ...p, after: v })); }} onBlur={() => { if (any) void bundlePreview(target.orderId, pick).then((r) => { if (r.ok) setPv({ to: r.to, subject: r.subject, html: r.html, from: r.from }); }); }} />
                    <small className="faint spt-sig">Your signature goes here{pick.reply ? ", then their email under it" : ""}.</small>
                  </>}
                </div>
              </div>
            </div>
            <div className="spt-right">
            {pv && <div className="spt-meta"><div><span>To</span><b>{pv.to || (pick.to && opts?.people?.length ? "Pick who gets it" : "No email on the customer")}</b></div><div><span>Subject</span><b>{pv.subject}</b></div></div>}
            <div className="spt-mail">{pv ? <iframe title="The email" srcDoc={pv.html} sandbox="" /> : <div className="faint" style={{ padding: 20 }}>{any ? "Making the preview…" : "Tick what to send."}</div>}</div>
            </div>
            </div>}
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

/** a box that grows with what's typed, so it never has a scroll bar of its own (Nov 3, Nick: "I don't want those two scroll
 *  bars. I just want to be able to type like normal") */
function AutoText({ value, onChange, onBlur, placeholder, label }: { value: string; onChange: (v: string) => void; onBlur?: () => void; placeholder?: string; label: string }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => { const t = ref.current; if (!t) return; t.style.height = "auto"; t.style.height = `${t.scrollHeight + 2}px`; }, [value]);
  return <textarea ref={ref} className="spt-auto" rows={2} aria-label={label} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />;
}
