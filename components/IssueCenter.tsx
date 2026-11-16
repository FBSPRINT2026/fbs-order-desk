"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSticky } from "@/lib/useSticky";
import { issueAssign, issueCenter, issueFix, issueReopen, issueTell, type CenterCtx, type CenterIssue, type FixHow } from "@/app/shop/issue-center-actions";
import { issueEmail, mailto, supplierName, type IssueItem } from "@/lib/goodsIssueShared";
import { fmtPhone } from "@/lib/phone";
import { openOrderGoodsForOrder } from "@/components/tools/OrderGoodsTool";

/**
 * The Issue Center (Goods & Receiving; Nick, Nov 16 2026, from the mockup): every goods problem in one place, worked
 * through to done. The list on the left (Needs us: nobody told yet; Waiting: told, or a fix on the way), the picked one on
 * the right: who's on it, Found → Told them → Fix on the way → Closed, what's wrong by style and size, a message to the
 * customer already written (portal + their email, or a text from the shop's phone), the supplier rep's email when it's
 * ours to chase, the ways it gets fixed, and its history. Server side: app/shop/issue-center-actions.ts.
 */
const AWAY = 2 * 3600 * 1000;
const day = (d: string | null) => (d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" }) : "");
const when = (iso: string) => {
  const d = new Date(iso), today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(" ", "").toLowerCase() : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const lineOf = (it: IssueItem) => [it.style, it.color, it.size].filter(Boolean).join(" ");
const stage = (i: CenterIssue) => (i.closed_at ? 3 : i.status === "replacing" ? 2 : i.status === "reported" || i.told_at ? 1 : 0);
const needsUs = (i: CenterIssue) => !i.closed_at && stage(i) === 0;

/** what's wrong, in a line a customer reads */
function problem(i: CenterIssue) {
  const short = i.items.filter((it) => it.issue === "short"), bad = i.items.filter((it) => it.issue === "damaged" || it.issue === "mispick"), over = i.items.filter((it) => it.issue === "over");
  const parts = [
    ...short.map((it) => `${lineOf(it)}: ${it.owed} short (we got ${it.received} of ${it.expected})`),
    ...bad.map((it) => `${lineOf(it)}: ${it.owed || it.bad} ${it.issue === "mispick" ? "wrong" : "damaged"}`),
    ...over.map((it) => `${lineOf(it)}: ${it.received - it.expected} extra`),
  ];
  return parts.length ? parts : [i.detail];
}
function draft(i: CenterIssue, shop: string) {
  const first = (i.contact || "").split(/\s+/)[0];
  const owed = i.items.reduce((a, it) => a + (it.owed || 0), 0);
  const job = `#${i.number}${i.nickname ? ` (${i.nickname})` : ""}`;
  const runs = i.runs ? ` It's set to run ${day(i.runs)}.` : "";
  const ask = i.kind === "over" && !owed ? "Do you want the extras sent back, or should we hold them for you?"
    : i.kind === "tracking" ? "Can you check on it with the carrier?"
    : owed ? `Can you send ${owed} more, or should we print it short?` : "How would you like us to handle it?";
  return `Hi${first ? ` ${first}` : ""}, it's ${shop}. Your goods for ${job} came in with a problem:\n${problem(i).map((p) => `- ${p}`).join("\n")}\n${runs ? runs.trim() + " " : ""}${ask}`;
}

export default function IssueCenter({ onCount }: { onCount?: (n: number) => void }) {
  const [d, setD] = useState<CenterCtx | null>(null), [err, setErr] = useState("");
  const [tab, setTab] = useSticky<"open" | "mine" | "closed">("receiving.issueTab", "open", AWAY);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<string>("");
  const load = useCallback(async () => { const r = await issueCenter(); if (r.ok) { setD(r); setErr(""); } else setErr(r.error); }, []);
  useEffect(() => { void load(); }, [load]);
  const open = useMemo(() => (d?.issues || []).filter((i) => !i.closed_at), [d]);
  useEffect(() => { onCount?.(open.length); }, [open.length, onCount]);
  const list = useMemo(() => {
    if (!d) return [];
    const t = q.trim().toLowerCase();
    const base = tab === "closed" ? d.issues.filter((i) => i.closed_at) : tab === "mine" ? open.filter((i) => i.assignee === d.me) : open;
    const found = t ? base.filter((i) => `${i.number} ${i.nickname} ${i.customer} ${i.detail}`.toLowerCase().includes(t)) : base;
    // needs us first, then the one that runs soonest
    return [...found].sort((a, b) => Number(needsUs(b)) - Number(needsUs(a)) || (a.runs || "9999").localeCompare(b.runs || "9999") || b.created_at.localeCompare(a.created_at));
  }, [d, tab, q, open]);
  const cur = list.find((i) => i.id === pick) || list[0] || null;

  if (err) return <div className="banner bad">{err}</div>;
  if (!d) return <div className="empty">Loading the issues…</div>;
  const soon = [...open].filter((i) => i.runs).sort((a, b) => a.runs!.localeCompare(b.runs!))[0];
  const week = Date.now() - 7 * 864e5;
  return (
    <div className="isc">
      <div className="stats">
        <button type="button" className="stat" onClick={() => setTab("open")}><span className={"v" + (open.some(needsUs) ? " alert" : "")}>{open.filter(needsUs).length}</span><span className="k">Needs us · nobody told yet</span></button>
        <button type="button" className="stat" onClick={() => setTab("open")}><span className="v">{open.filter((i) => !needsUs(i)).length}</span><span className="k">Waiting on the customer or supplier</span></button>
        <button type="button" className="stat" onClick={() => soon && setPick(soon.id)}><span className="v">{soon ? day(soon.runs) : "—"}</span><span className="k">{soon ? `Runs soonest: #${soon.number}` : "Runs soonest"}</span></button>
        <button type="button" className="stat" onClick={() => setTab("closed")}><span className="v">{d.issues.filter((i) => i.closed_at && Date.parse(i.closed_at) > week).length}</span><span className="k">Closed this week</span></button>
      </div>
      <div className="isc-grid">
        <section className="panel isc-list">
          <div className="toolbar">
            <div className="chips">
              <button type="button" className={"chip" + (tab === "open" ? " on" : "")} onClick={() => setTab("open")}>Open {open.length}</button>
              <button type="button" className={"chip" + (tab === "mine" ? " on" : "")} onClick={() => setTab("mine")}>Mine</button>
              <button type="button" className={"chip" + (tab === "closed" ? " on" : "")} onClick={() => setTab("closed")}>Closed</button>
            </div>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Job, customer, style" aria-label="Search issues" />
          </div>
          {!list.length && <div className="isc-none">{tab === "closed" ? "Nothing closed this week." : tab === "mine" ? "Nothing given to you." : "No open issues. Everything counted came in right."}</div>}
          {list.map((i) => (
            <button key={i.id} type="button" className={"isc-row" + (cur?.id === i.id ? " on" : "")} onClick={() => setPick(i.id)}>
              <span className="isc-r1"><b>#{i.number}</b><span className="isc-who">{[i.nickname, i.customer].filter(Boolean).join(" · ")}</span>
                <span className={"isc-tag " + (i.closed_at ? "done" : needsUs(i) ? "us" : "wait")}>{i.closed_at ? "Closed" : needsUs(i) ? "Needs us" : i.status === "replacing" ? "Fix on the way" : "Told them"}</span></span>
              <span className="isc-r2">{i.title} · {problem(i)[0]}</span>
              <span className="isc-r3">{[i.runs ? `Runs ${day(i.runs)}` : "", `found ${when(i.created_at)}`, i.assignee ? (d.staff.find((p) => p.email === i.assignee)?.name || i.assignee) : ""].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
        </section>
        {cur ? <Detail key={cur.id} i={cur} ctx={d} reload={load} /> : <section className="panel isc-detail"><div className="isc-none">Pick an issue.</div></section>}
      </div>
    </div>
  );
}

function Detail({ i, ctx, reload }: { i: CenterIssue; ctx: CenterCtx; reload: () => Promise<void> }) {
  const [how, setHow] = useState<"portal" | "text">(i.order_id ? "portal" : "text");
  const [msg, setMsg] = useState(() => draft(i, ctx.shop));
  const [busy, setBusy] = useState(""), [say, setSay] = useState(""), [bad, setBad] = useState("");
  const [other, setOther] = useState<FixHow | null>(null), [words, setWords] = useState("");
  const go = async (k: string, f: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(k); setBad(""); setSay("");
    const r = await f(); setBusy("");
    if (!r.ok) { setBad(r.error || "Couldn't."); return; }
    setSay(done); await reload();
  };
  const st = stage(i), owed = i.items.reduce((a, it) => a + (it.owed || 0), 0);
  const rep = ctx.reps.find((r) => r.supplier === (i.supplier || "other"))?.email || "";
  const repMail = i.owner === "shop" ? issueEmail(i, { shipTo: ctx.shipTo, signer: ctx.shop }) : null;
  const phone = i.phone ? fmtPhone(i.phone) : "";
  const smsHref = i.phone ? `sms:${i.phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(msg)}` : "";
  const fixes: { k: FixHow; t: string; s: string }[] = [
    { k: "sending", t: "They're sending more", s: "stays open until it's counted in" },
    { k: "short", t: "Print it short", s: "they OK'd it · closes it" },
    { k: "ordering", t: "We order them", s: "Order goods · stays open" },
    { k: "extras", t: "Used our extras", s: "from the blanks · closes it" },
    { k: "recount", t: "Counted again, it's fine", s: "closes it" },
    { k: "other", t: "Something else", s: "write what happened" },
  ];
  return (
    <section className="panel isc-detail">
      <div className="isc-dh">
        <div className="isc-dt">
          <h2>#{i.number}{i.nickname ? ` · ${i.nickname}` : ""}</h2>
          <span className="faint">{[i.customer, i.contact && i.contact !== i.customer ? i.contact : "", i.owner === "shop" ? `our order${i.supplier ? ` from ${supplierName(i.supplier)}` : ""}` : `customer supplied${i.supplier ? ` (${supplierName(i.supplier)})` : ""}`, i.runs ? `runs ${day(i.runs)}${i.press ? ` on ${i.press}` : ""}` : "not on the schedule yet"].filter(Boolean).join(" · ")}</span>
        </div>
        <label className="isc-who-f"><span>Who&apos;s working it</span>
          <select value={i.assignee} onChange={(e) => void go("who", () => issueAssign(i.id, e.target.value), "Saved.")} disabled={!!busy}>
            <option value="">Nobody yet</option>
            {ctx.staff.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}
          </select>
        </label>
        {(i.order_id || i.archived_order_id) && <Link className="btn" href={i.order_id ? `/shop/orders/${i.order_id}` : `/shop/archive/${i.archived_order_id}`}>Open job</Link>}
      </div>

      <ol className="isc-steps" aria-label="Where it is">
        {["Found", "Told them", "Fix on the way", "Closed"].map((t, k) => <li key={t} className={k < st || (k === 3 && st === 3) ? "done" : k === st ? "now" : ""}><span>{k < st || (k === 3 && st === 3) ? "✓" : k + 1}</span>{t}</li>)}
      </ol>

      <div className="isc-sec">
        <div className="isc-k">What&apos;s wrong</div>
        {i.items.length ? (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Style</th><th>Color</th><th>Size</th><th className="r">Ordered</th><th className="r">Got</th><th className="r">Owed</th><th>Note</th></tr></thead>
            <tbody>{i.items.map((it, k) => <tr key={k}><td>{it.style}</td><td>{it.color}</td><td>{it.size}</td><td className="r">{it.expected}</td><td className="r">{it.received}</td><td className={"r" + (it.owed ? " isc-owed" : "")}>{it.issue === "over" ? `+${it.received - it.expected}` : it.owed}</td><td className="sub">{[it.issue === "short" ? "" : it.issue, it.note].filter(Boolean).join(" · ")}</td></tr>)}</tbody>
          </table></div>
        ) : <p>{i.detail}</p>}
        {(i.photoUrls || []).length > 0 && <div className="isc-pics">{(i.photoUrls || []).map((u, k) => <a key={k} href={u} target="_blank" rel="noreferrer"><img src={u} alt={`Photo ${k + 1}`} /></a>)}</div>}
      </div>

      {!i.closed_at && <div className="isc-tell">
        <div className="isc-tell-h"><b>Tell {i.contact ? i.contact.split(/\s+/)[0] : "the customer"}</b><span className="faint">written for you · nothing goes until you press it</span></div>
        <div className="isc-how" role="radiogroup" aria-label="How to tell them">
          <button type="button" role="radio" aria-checked={how === "portal"} className={how === "portal" ? "on" : ""} disabled={!i.order_id} onClick={() => setHow("portal")}>Portal + email</button>
          <button type="button" role="radio" aria-checked={how === "text"} className={how === "text" ? "on" : ""} onClick={() => setHow("text")}>Text{phone ? ` ${phone}` : ""}</button>
        </div>
        <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={6} aria-label="Message to the customer" />
        <div className="isc-act">
          {how === "portal"
            ? <button type="button" className="btn primary" disabled={!!busy || !msg.trim()} onClick={() => void go("tell", () => issueTell(i.id, "portal", msg), "Sent to their portal (and email, by their settings).")}>{busy === "tell" ? "Sending…" : "Send"}</button>
            : <>
              {smsHref ? <a className="btn primary" href={smsHref}>Open in Messages</a> : <span className="faint">No phone on the account.</span>}
              <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(msg).then(() => setSay("Copied."))}>Copy</button>
              <button type="button" className="btn" disabled={!!busy || !msg.trim()} onClick={() => void go("tell", () => issueTell(i.id, "text", msg), "Marked as texted.")} title="After you've sent it from the phone">I texted it</button>
            </>}
          {i.told_at && <span className="faint">Told them {when(i.told_at)}</span>}
        </div>
      </div>}

      {!i.closed_at && repMail && <div className="isc-tell">
        <div className="isc-tell-h"><b>Email {supplierName(i.supplier)}</b><span className="faint">it&apos;s our order, so we chase the {owed ? "replacements" : "problem"}</span></div>
        <pre className="isc-mail">{repMail.subject}{"\n\n"}{repMail.body}</pre>
        <div className="isc-act"><a className="btn" href={mailto(rep, repMail.subject, repMail.body)}>Open in my email</a><button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(`${repMail.subject}\n\n${repMail.body}`).then(() => setSay("Copied."))}>Copy</button>{!rep && <span className="faint">No rep email on file yet.</span>}</div>
      </div>}

      {!i.closed_at ? <div className="isc-sec">
        <div className="isc-k">How it gets fixed</div>
        <div className="isc-fix">
          {fixes.map((f) => <button key={f.k} type="button" disabled={!!busy} className={other === f.k ? "on" : ""} onClick={() => { setOther(f.k); setWords(""); }}><b>{f.t}</b><small>{f.s}</small></button>)}
        </div>
        {other && <div className="isc-act">
          <input type="text" value={words} onChange={(e) => setWords(e.target.value)} placeholder={other === "other" ? "What happened" : "A note (optional): tracking, who OK'd it…"} aria-label="Note" style={{ flex: "1 1 240px", minWidth: 0 }} />
          <button type="button" className="btn primary" disabled={!!busy || (other === "other" && !words.trim())} onClick={() => void go("fix", () => issueFix(i.id, other, words), "Saved.").then(() => setOther(null))}>Save</button>
          {other === "ordering" && i.order_id && <button type="button" className="btn" onClick={() => openOrderGoodsForOrder(i.order_id!)}>Order goods</button>}
        </div>}
      </div> : <div className="isc-act"><span>Closed {when(i.closed_at)}: {i.closed_how}</span><button type="button" className="btn" disabled={!!busy} onClick={() => void go("re", () => issueReopen(i.id), "Opened again.")}>Open again</button></div>}

      {say && <div className="isc-ok" role="status">{say}</div>}
      {bad && <div className="isc-bad" role="alert">{bad}</div>}

      <div className="isc-sec">
        <div className="isc-k">History</div>
        <AddNote id={i.id} reload={reload} />
        {[...i.log].reverse().map((e, k) => <div key={k} className="isc-ev"><span>{when(e.at)}</span><span>{e.what}<small> · {(ctx.staff.find((p) => p.email === e.by)?.name) || e.by.split("@")[0]}</small></span></div>)}
        <div className="isc-ev"><span>{when(i.created_at)}</span><span>Found{i.source === "checkin" ? " at count in" : i.source === "tracking" ? " watching the tracking" : ""}: {i.detail}</span></div>
      </div>
    </section>
  );
}

function AddNote({ id, reload }: { id: string; reload: () => Promise<void> }) {
  const [t, setT] = useState(""), [busy, setBusy] = useState(false);
  return (
    <div className="isc-act">
      <input type="text" value={t} onChange={(e) => setT(e.target.value)} placeholder="Add a note: a call, what they said…" aria-label="Add a note" style={{ flex: "1 1 240px", minWidth: 0 }}
        onKeyDown={async (e) => { if (e.key === "Enter" && t.trim() && !busy) { setBusy(true); await issueFix(id, "note", t); setT(""); setBusy(false); await reload(); } }} />
      <button type="button" className="btn" disabled={busy || !t.trim()} onClick={async () => { setBusy(true); await issueFix(id, "note", t); setT(""); setBusy(false); await reload(); }}>Add</button>
    </div>
  );
}
