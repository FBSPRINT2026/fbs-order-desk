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
 * out, sent from their own email (Open in my email / Copy). Only shows when there are issues.
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
  if (!list.length) return null;
  const needYou = live.filter((i) => i.owner === "customer").length, ours = live.length - needYou;
  return (
    <section className="gis" aria-label="Goods issues">
      <div className="gis-h">
        <b>Issues · {live.length}</b>
        <span className="gis-sum">{[needYou && (portal ? `${needYou} need you` : `${needYou} the customer works`), ours && (portal ? `${ours} we're on` : `${ours} we work`), list.length > live.length && `${list.length - live.length} closed this week`].filter(Boolean).join(" · ")}</span>
      </div>
      {list.map((i) => <Row key={i.id} i={i} d={d} portal={portal} as={as} open={open === i.id} onToggle={() => setOpen(open === i.id ? null : i.id)} onDone={() => setRev((n) => n + 1)} href={href} />)}
    </section>
  );
}

function Row({ i, d, portal, as, open, onToggle, onDone, href }: { i: GoodsIssue; d: IssueCtx; portal: boolean; as?: string; open: boolean; onToggle: () => void; onDone: () => void; href?: (i: GoodsIssue) => string }) {
  const sup = supplierName(i.supplier);
  const theirs = i.owner === "customer";
  const tone = i.closed_at ? "done" : i.kind === "tracking" ? "watch" : "bad";
  const tag = i.closed_at ? `Closed ${when(i.closed_at)}` : theirs ? (portal ? `You: tell ${sup}` : `Customer tells ${sup}`) : portal ? "We're on it" : i.kind === "tracking" ? "We're watching it" : `We tell ${sup}`;
  const owedN = i.items.reduce((a, it) => a + (it.owed || 0), 0);
  return (
    <div className={"gis-row gis-" + tone + (open ? " open" : "")}>
      <button type="button" className="gis-line" onClick={onToggle} aria-expanded={open}>
        <span className="gis-bar" aria-hidden />
        <span className="gis-what">
          <b>{i.number ? `#${i.number}` : "Order"}{i.nickname ? ` ${i.nickname}` : ""}</b> · {i.title}
          <small>{[i.supplier_order && `${sup} ${i.supplier_order}`, i.tracking && i.kind === "tracking" && `tracking ${i.tracking}`, `found ${when(i.created_at)}`, i.status === "reported" && `reported ${when(i.reported_at)}`, i.status === "replacing" && "replacement on the way"].filter(Boolean).join(" · ")}</small>
        </span>
        <span className={"gis-tag gis-tag-" + (i.closed_at ? "done" : theirs ? "you" : "us")}>{tag}</span>
        <span className="gis-go">{open ? "Close" : i.closed_at ? "Details" : theirs && portal && i.status === "open" ? "Report it" : "Details"}</span>
      </button>
      {open && <Detail i={i} d={d} portal={portal} as={as} owedN={owedN} onDone={onDone} href={href} />}
    </div>
  );
}

function Detail({ i, d, portal, as, owedN, onDone, href }: { i: GoodsIssue; d: IssueCtx; portal: boolean; as?: string; owedN: number; onDone: () => void; href?: (i: GoodsIssue) => string }) {
  const sup = supplierName(i.supplier);
  const theirs = i.owner === "customer";
  // the email: the customer's own rep for their goods, ours for our blank orders
  const rep = d.reps.find((r) => r.supplier === (i.supplier || "other") && (theirs ? r.customer_id === i.customer_id : r.customer_id === null))?.email || "";
  const draft = issueEmail(i, { shipTo: d.shipTo, signer: d.signer });
  const [to, setTo] = useState(rep), [subject, setSubject] = useState(draft.subject), [body, setBody] = useState(draft.body);
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState("");
  const canEmail = !i.closed_at && (portal ? theirs : true);
  const step = STEPS.findIndex((s) => s.k === i.status);
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
      <ol className="gis-steps" aria-label="Where it is">{STEPS.map((s, k) => <li key={s.k} className={k < step ? "done" : k === step ? "on" : ""}>{s.label}</li>)}</ol>
      {i.kind === "tracking"
        ? <p className="gis-p">{i.detail}{i.tracking ? <> · <a href={trackingUrl("", i.tracking)} target="_blank" rel="noreferrer">See the tracking</a></> : null}</p>
        : (
          <div className="tbl-wrap gis-items"><table className="tbl">
            <thead><tr><th>Item</th><th className="r">Expected</th><th className="r">Got</th><th className="r">Still owed</th><th>Note</th></tr></thead>
            <tbody>{i.items.map((it, k) => <tr key={k}><td data-notranslate>{[it.style, it.color, it.size].filter(Boolean).join(" ")}</td><td className="r num">{it.expected}</td><td className="r num">{it.received}{it.bad ? <span className="sub"> {it.bad} {it.issue === "mispick" ? "wrong" : "damaged"}</span> : null}</td><td className={"r num" + (it.owed ? " gis-owed" : "")}>{it.owed || "—"}</td><td>{it.note || ""}</td></tr>)}</tbody>
          </table></div>
        )}
      {owedN > 0 && !i.closed_at && <p className="gis-note">When a box with {owedN === 1 ? "this piece" : `these ${owedN} pieces`} shows up on a later {sup} list, it goes to this issue, and checking it in closes it.</p>}
      {(i.photoUrls || []).length > 0 && <div className="gis-pics">{(i.photoUrls || []).map((u, k) => <a key={k} href={u} target="_blank" rel="noreferrer"><img src={u} alt={`Photo ${k + 1}`} /></a>)}</div>}
      {i.closed_at && <p className="gis-note">Closed {when(i.closed_at)}{i.closed_how ? `: ${i.closed_how}` : ""}.</p>}
      {canEmail && (
        <div className="gis-mail">
          <div className="gis-mail-h"><b>{portal ? `Tell ${sup}` : theirs ? `The email for the customer to send ${sup}` : `Email our ${sup} rep`}</b><span className="faint">{portal ? "We wrote it for you. It opens in your own email, so their reply comes to you." : "Written out; it opens in your own email."}</span></div>
          <label className="gis-f"><span>To</span><input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder={`Your ${sup} rep's email (we'll remember it)`} /></label>
          <label className="gis-f"><span>Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          <label className="gis-f"><span>Email</span><textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <div className="gis-acts">
            <a className="btn primary" href={mailto(to, subject, body)} onClick={() => setMsg("Opened in your email. Press \"I've reported it\" once it's sent.")}>Open in my email</a>
            <button type="button" className="btn" onClick={() => { void navigator.clipboard.writeText(`To: ${to}\nSubject: ${subject}\n\n${body}`); setMsg("Copied."); }}>Copy email</button>
            <span className="spacer" />
            {i.status === "open" && <button type="button" className="btn" disabled={!!busy} onClick={() => void reported()}>{busy || "I've reported it"}</button>}
          </div>
        </div>
      )}
      {!portal && (
        <div className="gis-staff">
          <span className="faint">Who works it</span>
          <span className="gis-seg" role="radiogroup" aria-label="Who works it">{(["customer", "shop"] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={i.owner === k} className={i.owner === k ? "on" : ""} disabled={!!busy || !!i.closed_at} onClick={() => void staff("owner", k)}>{k === "customer" ? "The customer" : "We do"}</button>)}</span>
          <span className="spacer" />
          {href && <a className="btn sm" href={href(i)}>Open the order</a>}
          {!i.closed_at ? <>
            {i.status !== "replacing" && i.kind !== "tracking" && <button type="button" className="btn sm" disabled={!!busy} onClick={() => void staff("replacing")}>Replacement coming</button>}
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
