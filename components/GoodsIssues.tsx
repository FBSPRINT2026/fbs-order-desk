"use client";
import { useEffect, useState } from "react";
import { issuesFor, reportIssue, staffIssue, type IssueCtx } from "@/app/goods-issue-actions";
import { issueEmail, mailto, STEPS, supplierName, type GoodsIssue } from "@/lib/goodsIssueShared";
import { trackingUrl } from "@/lib/goods";
import { fmtDateLong } from "@/lib/format";

const when = (d?: string | null) => (d ? fmtDateLong(d.slice(0, 10)).replace(/, \d{4}$/, "") : "");

/**
 * Issues at the top of Goods (Nov 2, Nick: "something at the top that says issues… whether the customer needs to work it
 * or whether we're working the issue… an easy tool… for S&S… on this order, we received this… we were short here"),
 * the same piece for the shop (Goods & Receiving) and the customer (their Goods tab). Each issue: what's wrong and what's
 * still owed, its steps (Found → Reported → Replacement coming → Closed), who works it, and the email to the rep written
 * out, sent from their own email (Open in my email / Copy). With none, it says so with a green check.
 */
export default function GoodsIssues({ as, customerId, href }: { /** the customer's portal (preview id when staff) */ as?: string; /** the shop: one customer's */ customerId?: string; href?: (i: GoodsIssue) => string }) {
  const [d, setD] = useState<IssueCtx | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  useEffect(() => { let live = true; void issuesFor({ as, customerId }).then((r) => { if (live && r.ok) setD(r); }); return () => { live = false; }; }, [as, customerId, rev]);
  if (!d) return null;
  const portal = as !== undefined || !d.staff;
  const list = d.issues;
  const live = list.filter((i) => !i.closed_at);
  // always there: nothing wrong says so (Nov 2, Nick: "the issues box always there… no issues, all good to go right now")
  if (!list.length) return (
    <section className="gis gis-none" aria-label="Goods issues">
      <span className="gis-ok" aria-hidden><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg></span>
      <b>No issues</b><span className="gis-sum">All good to go right now. Anything short, damaged or stuck in shipping shows up here.</span>
    </section>
  );
  const needYou = live.filter((i) => i.owner === "customer").length, ours = live.length - needYou;
  return (
    <section className="gis" aria-label="Goods issues">
      <div className="gis-h">
        <b>Issues</b>
        <span className="gis-sum">{[needYou && (portal ? `${needYou} ${needYou === 1 ? "needs" : "need"} you` : `${needYou} the customer contacts`), ours && (portal ? `${ours} we're handling` : `${ours} we contact`), list.length > live.length && `${list.length - live.length} closed this week`].filter(Boolean).join(" · ")}</span>
      </div>
      {list.map((i) => <Row key={i.id} i={i} d={d} portal={portal} as={as} open={open === i.id} onToggle={() => setOpen(open === i.id ? null : i.id)} onDone={() => setRev((n) => n + 1)} href={href} />)}
    </section>
  );
}

/** each item in words: "4 short", "1 damaged", "2 wrong", then what it is and what came (Nov 2, Nick: "I don't like how it
 *  reads with the expected 40") */
function itemLine(it: GoodsIssue["items"][number]) {
  const short = Math.max(0, (it.expected || 0) - (it.received || 0));
  const bad = it.bad || 0;
  const head = [short ? `${short} short` : "", bad ? `${bad} ${it.issue === "mispick" ? "wrong" : "damaged"}` : ""].filter(Boolean).join(", ") || (it.owed ? `${it.owed} owed` : "Checked");
  const came = it.expected ? `came ${it.received} of ${it.expected}` : "";
  return { head, what: [it.style, it.color].filter(Boolean).join(" ") + (it.size ? ` · ${it.size}` : ""), detail: [short ? came : "", it.note || ""].filter(Boolean).join(" · ") };
}

function Row({ i, d, portal, as, open, onToggle, onDone, href }: { i: GoodsIssue; d: IssueCtx; portal: boolean; as?: string; open: boolean; onToggle: () => void; onDone: () => void; href?: (i: GoodsIssue) => string }) {
  const sup = supplierName(i.supplier);
  const theirs = i.owner === "customer";
  const closed = !!i.closed_at;
  const tone = closed ? "done" : i.kind === "tracking" ? "watch" : theirs ? "bad" : "us";
  // what to do about it, said plainly (Nov 2, Nick: "suggested action, contact S&S… not you tell SanMar")
  const tag = closed ? `Closed ${when(i.closed_at)}`
    : i.kind === "tracking" ? (portal ? "We're watching it" : "Watching the tracking")
    : theirs ? (portal ? `Suggested action: contact ${sup}` : `Customer contacts ${sup}`)
    : portal ? `We're contacting ${sup}` : `We contact ${sup}`;
  // where it is, in plain words: checked in → contacted → replacements on the way → all here
  const who = theirs ? (portal ? "You" : "Customer") : "We";
  const steps = [
    { k: "open", label: i.source === "tracking" ? `Spotted ${when(i.created_at)}` : `Checked in ${when(i.created_at)}` },
    { k: "reported", label: i.reported_at ? `${who} contacted ${sup} ${when(i.reported_at)}` : `${who} contact${who === "We" || who === "You" ? "" : "s"} ${sup}` },
    { k: "replacing", label: "Replacements on the way" },
    { k: "closed", label: closed ? `${i.closed_how || "Closed"} ${when(i.closed_at)}` : "All here" },
  ];
  const at = STEPS.findIndex((x) => x.k === i.status);
  return (
    <div className={"gis-row gis-" + tone}>
      <div className="gis-top">
        <span className="gis-bar" aria-hidden />
        <div className="gis-what">
          <b>{i.number ? `#${i.number}` : "Order"}{i.nickname ? ` ${i.nickname}` : ""} · {i.title}</b>
          <small>{[i.supplier_order && `${sup} order ${i.supplier_order}`, i.tracking && i.kind === "tracking" && `tracking ${i.tracking}`].filter(Boolean).join(" · ")}</small>
        </div>
        <span className={"gis-tag gis-tag-" + (closed ? "done" : theirs && i.kind !== "tracking" ? "you" : "us")}>{tag}</span>
      </div>
      {!closed && <div className="gis-body">
        {i.kind === "tracking"
          ? <p className="gis-p">{i.detail}{i.tracking ? <> · <a href={trackingUrl("", i.tracking)} target="_blank" rel="noreferrer">See the tracking</a></> : null}</p>
          : <ul className="gis-items">{i.items.map((it, k) => { const x = itemLine(it); return <li key={k}><span className="gis-q">{x.head}</span><span className="gis-it" data-notranslate>{x.what}</span>{x.detail ? <span className="gis-dt">{x.detail}</span> : null}</li>; })}</ul>}
        <ol className="gis-steps" aria-label="Where it is">{steps.map((s0, k) => <li key={s0.k} className={k < at ? "done" : k === at ? "on" : ""}>{k < at ? "✓ " : k === at ? "● " : "○ "}{s0.label}</li>)}</ol>
        <div className="gis-acts">
          {(portal ? theirs && i.kind !== "tracking" : i.kind !== "tracking") && <button type="button" className={"btn sm" + (i.status === "open" ? " primary" : "")} onClick={onToggle} aria-expanded={open}>{open ? "Hide the email" : `Write the email to ${sup}`}</button>}
          {(i.photoUrls || []).length > 0 && <a className="btn sm" href={(i.photoUrls || [])[0]} target="_blank" rel="noreferrer">See photos ({(i.photoUrls || []).length})</a>}
          {!portal && href && <a className="btn sm" href={href(i)}>Open the order</a>}
        </div>
      </div>}
      {(open || (!portal && !closed)) && <Detail i={i} d={d} portal={portal} as={as} mail={open} onDone={onDone} />}
      {closed && !portal && <Detail i={i} d={d} portal={portal} as={as} mail={false} onDone={onDone} />}
    </div>
  );
}

function Detail({ i, d, portal, as, mail, onDone }: { i: GoodsIssue; d: IssueCtx; portal: boolean; as?: string; mail: boolean; onDone: () => void }) {
  const sup = supplierName(i.supplier);
  const theirs = i.owner === "customer";
  // the email: the customer's own rep for their goods, ours for the ones we work
  const rep = d.reps.find((r) => r.supplier === (i.supplier || "other") && (theirs ? r.customer_id === i.customer_id : r.customer_id === null))?.email || "";
  const draft = issueEmail(i, { shipTo: d.shipTo, signer: d.signer });
  const [to, setTo] = useState(rep), [subject, setSubject] = useState(draft.subject), [body, setBody] = useState(draft.body);
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState("");
  async function reported() {
    setBusy("Saving…"); setMsg("");
    const r = await reportIssue(i.id, { email: to }, as);
    setBusy(""); if (!r.ok) return setMsg(r.error); onDone();
  }
  async function staff(action: "owner" | "close" | "reopen" | "replacing", value = "") {
    setBusy("Saving…"); setMsg("");
    const r = await staffIssue(i.id, action, value);
    setBusy(""); if (!r.ok) return setMsg(r.error); onDone();
  }
  return (
    <div className="gis-d">
      {mail && !i.closed_at && (
        <div className="gis-mail">
          <div className="gis-mail-h"><b>{portal || !theirs ? `Email ${sup}` : `The email for the customer to send ${sup}`}</b><span className="faint">{portal ? "We wrote it for you. It opens in your own email, so their reply comes to you." : "Written out; it opens in your own email."}</span></div>
          <label className="gis-f"><span>To</span><input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder={`Your ${sup} rep's email (we'll remember it)`} /></label>
          <label className="gis-f"><span>Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          <label className="gis-f"><span>Email</span><textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <div className="gis-acts">
            <a className="btn primary" href={mailto(to, subject, body)} onClick={() => setMsg(`Opened in your email. Press "I contacted ${sup}" once it's sent.`)}>Open in my email</a>
            <button type="button" className="btn" onClick={() => { void navigator.clipboard.writeText(`To: ${to}\nSubject: ${subject}\n\n${body}`); setMsg("Copied."); }}>Copy email</button>
            <span className="spacer" />
            {i.status === "open" && <button type="button" className="btn" disabled={!!busy} onClick={() => void reported()}>{busy || `I contacted ${sup}`}</button>}
          </div>
        </div>
      )}
      {!portal && (
        <div className="gis-staff">
          <span className="faint">Who contacts {sup}</span>
          <span className="gis-seg" role="radiogroup" aria-label={`Who contacts ${sup}`}>{(["customer", "shop"] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={i.owner === k} className={i.owner === k ? "on" : ""} disabled={!!busy || !!i.closed_at} onClick={() => void staff("owner", k)}>{k === "customer" ? "The customer" : "We do"}</button>)}</span>
          <span className="spacer" />
          {!i.closed_at ? <>
            {i.status === "open" && !theirs && i.kind !== "tracking" && <button type="button" className="btn sm" disabled={!!busy} onClick={() => void reported()}>We contacted {sup}</button>}
            {i.status !== "replacing" && i.kind !== "tracking" && <button type="button" className="btn sm" disabled={!!busy} onClick={() => void staff("replacing")}>Replacements on the way</button>}
            <select className="gis-close" value="" disabled={!!busy} onChange={(e) => e.target.value && void staff("close", e.target.value)} aria-label="Close it">
              <option value="">Close it…</option><option>Replaced</option><option>Credited instead</option><option>Not needed</option><option>It arrived</option>
            </select>
          </> : <button type="button" className="btn sm" disabled={!!busy} onClick={() => void staff("reopen")}>Open it again</button>}
        </div>
      )}
      {msg && <p className="gis-note">{msg}</p>}
    </div>
  );
}
