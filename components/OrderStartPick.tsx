"use client";
import { useEffect, useMemo, useState } from "react";
import type { EODraft, EOPart, PastJob } from "@/lib/emailOrderShared";

/**
 * Create order from an email: first ask what it is (Oct 20, Nick: "it pops up and says, okay, is this an order or
 * should I try to find it as a reorder?"). Little Groupies' "order for The Bottles" was read as a new order and came
 * in with no art; picking the old job here makes it a real reorder (its art, film and lines).
 *  - New order: built from the email.
 *  - Reorder of a past job: their jobs, the ones whose name is in the email first.
 *  - Reorder, let the AI find the job.
 */
export type OrderStart = { told?: string; job?: string; /** several past jobs reordered together in one order (a group per design) */ jobs?: string[]; /** several orders in the email (one per design), each read on its own */ parts?: EOPart[];
  /** open the full form to check every detail before it's made (otherwise it's made in one go, QuickOrder) */ review?: boolean;
  /** which emails make up the order (Oct 24, Nick): other emails brought in, and conversation emails left out */ include?: string[]; exclude?: string[];
  /** New order / Reorder / Reorder with changes, picked on the card: the order's Order type */ orderType?: "new" | "reorder" | "reorder_changes" };
const STOP = new Set(["the", "and", "for", "order", "orders", "reorder", "new", "shirts", "shirt", "tees", "tee", "printavo", "with", "from", "re", "fw", "fwd"]);
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const fmt = (d: string) => (d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

export default function OrderStartPick({ activityId, text, guess, onPick: onPick0, onClose, suggested, dock }: { activityId: string;
  /** a panel on the right, the page still usable beside it (Oct 23, Nick: "I can't see anything once we create an order… a
   *  pop-up on the right, like Claude in Chrome… so I can still click the attachments") */ dock?: boolean; /** the email's subject and summary: past jobs named in it go first */ text: string; guess: "new" | "reorder" | ""; onPick: (s: OrderStart) => void; onClose: () => void;
  /** what the Assistant suggested ("Create the reorder of #31174") */ suggested?: { label: string; told?: string; job?: string } }) {
  // screen printing or embroidery (Oct 23, Nick: "some orders are both"): asked on each order's card, not first (Oct 24)
  const HOW_TOLD = { screen: "Every print on this order is SCREEN PRINTED.", embroidery: "Every print on this order is EMBROIDERED (method embroidery): threads, not inks; give each print's finished size.", both: "This order has BOTH embroidery and screen printing: say which method each print is (e.g. embroidered left chest, screen printed back)." } as const;
  // which emails make up the order (Oct 24, Nick: "you should first scan the email and maybe even ask me… I noticed these
  // other messages. Are we bringing in all this information… Sometimes you need three or four emails"): the conversation's
  // other emails are in (untick to leave one out), other recent emails from the customer are out (tick to bring one in)
  type Mail = { id: string; at: string; out: boolean; from: string; subject: string; files: string[] };
  const [mails, setMails] = useState<null | { convo: Mail[]; others: Mail[] }>(null);
  const [mOff, setMOff] = useState<Set<string>>(new Set()), [mOn, setMOn] = useState<Set<string>>(new Set());
  /** the emails question: one line to answer, the list only when choosing, a small chip once answered (Oct 24, Nick:
   *  "this panel here is good, but it's too long… you should be able to X out of it or minimize it or say yes, no") */
  // every email in the conversation comes in without asking (Oct 24, Nick: "by default you should just know conversation…
  // you shouldn't ask that there"): one line says what was read, "change" opens the list
  const [mView, setMView] = useState<"ask" | "list" | "done">("done");
  useEffect(() => {
    let live = true;
    fetch(`/api/inbox/order/emails?activity=${encodeURIComponent(activityId)}`).then((r) => r.json()).then((j) => { if (live) setMails({ convo: j.convo || [], others: j.others || [] }); }).catch(() => { if (live) setMails({ convo: [], others: [] }); });
    return () => { live = false; };
  }, [activityId]);
  const onPick = (st0: OrderStart) => {
    const st = { ...st0, ...(mOn.size ? { include: [...mOn] } : {}), ...(mOff.size ? { exclude: [...mOff] } : {}) };
    onPick0(st);
  };
  const [past, setPast] = useState<PastJob[] | null>(null);
  // "same as order 85254", "screen print process same as PO 85254", "like job #31174": the past job a new order points at
  const like = (() => {
    const m = (text || "").match(/\b(?:same|like|match(?:es|ing)?)\b[^.\n]{0,40}?\b(?:order|po|job|invoice)\s*#?\s*(\d{4,6})\b/i);
    return m ? m[1] : "";
  })();
  // the order already read in the background (lib/ai/prepareOrders.ts): one click to open it ready to approve
  const [ready, setReady] = useState<{ draft: EODraft; created: string | null } | null>(null);
  // how many orders the email holds (Oct 20, Nick: Dear Heart's one email = four reorders, one per design)
  const [plan, setPlan] = useState<null | { parts: EOPart[]; note: string; error?: string }>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/inbox/order/plan?activity=${encodeURIComponent(activityId)}`).then((r) => r.json()).then((j) => { if (live) setPlan(j.error ? { parts: [], note: "", error: j.error } : { parts: j.parts || [], note: j.note || "" }); }).catch(() => { if (live) setPlan({ parts: [], note: "", error: "x" }); });
    return () => { live = false; };
  }, [activityId]);
  const [err, setErr] = useState("");
  const [pickFirst, setPickFirst] = useState(false); // "one at a time": choosing which order to make first
  const [q, setQ] = useState("");
  // several jobs ticked: one order reordering them together (Oct 22, Nick: Hutchins T10A is #33633 and T11A is #33676,
  // "is there an option when we create a reorder to select multiple orders and bring those in as different line items?")
  const [sel, setSel] = useState<PastJob[]>([]);
  const tick = (p: PastJob) => setSel((x) => (x.some((y) => y.ref === p.ref) ? x.filter((y) => y.ref !== p.ref) : [...x, p]));
  const name = (p: PastJob) => p.label.replace(/\s*\(Printavo\)$/, "");
  useEffect(() => {
    let live = true;
    fetch(`/api/inbox/order?activity=${encodeURIComponent(activityId)}`).then((r) => r.json()).then((j) => { if (!live) return; setPast(Array.isArray(j?.past) ? j.past : []); if (j?.draft && !j.created) setReady({ draft: j.draft, created: j.created }); }).catch(() => { if (live) { setPast([]); setErr("Couldn't load their past jobs."); } });
    return () => { live = false; };
  }, [activityId]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  // a search looks through every job on the account, not just the recent ones (Oct 20, Nick: "bottles only returns
  // three… it should pull up all the orders for that style on that account")
  const [found, setFound] = useState<PastJob[] | null>(null), [looking, setLooking] = useState(false);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setFound(null); return; }
    let live = true; setLooking(true);
    const h = setTimeout(() => { fetch(`/api/inbox/order/jobs?${new URLSearchParams({ activity: activityId, q: t })}`).then((r) => r.json()).then((j) => { if (live) { setFound(Array.isArray(j?.jobs) ? j.jobs : []); setLooking(false); } }).catch(() => { if (live) setLooking(false); }); }, 300);
    return () => { live = false; clearTimeout(h); };
  }, [q, activityId]);
  const list = useMemo(() => {
    const w = words(text), t = q.trim().toLowerCase();
    return (found || past || [])
      // a job the email names (their PO number, the job's name) goes to the top
      .map((p) => { const pw = words(p.label.replace(/^#\d+\s*/, "")); let hit = /matches|matching/i.test(p.note || "") ? 10 : 0; pw.forEach((x) => { if (w.has(x)) hit++; }); return { p, hit }; })
      .filter(({ p }) => !!found || !t || p.label.toLowerCase().includes(t))
      .sort((a, b) => b.hit - a.hit || b.p.date.localeCompare(a.p.date));
  }, [past, found, text, q]);

  // each past job's mockup, to see which one it is (Oct 23, Nick: "they're all named very similar… I should be able to
  // click… the picture attached… and say yep, this is the reorder")
  const [pics, setPics] = useState<Record<string, { thumb: string; full: string; pdf: boolean }>>({});
  // the picture in their email matched to a past job's mockup (Oct 23, Nick: Peticolas sent the Velvet Hammer mockup
  // we'd sent him: "that visual should be matched… this is the last one that used this artwork")
  const [look, setLook] = useState<null | "wait" | { ref?: string; label?: string; why?: string; sure?: string; none?: boolean }>("wait");
  useEffect(() => {
    let live = true;
    fetch("/api/inbox/order/look", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activity: activityId }) }).then((r) => r.json())
      .then((j) => { if (live) setLook(j && !j.error ? j : null); }).catch(() => { if (live) setLook(null); });
    return () => { live = false; };
  }, [activityId]);
  const [big, setBig] = useState<{ ref: string; url: string } | null>(null);
  const picRefs = list.slice(0, 40).map(({ p }) => p.ref).filter((r) => !(r in pics)).join(",");
  useEffect(() => {
    if (!picRefs) return;
    let live = true;
    const refs = picRefs.split(",");
    fetch("/api/jobs/pics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refs }) }).then((r) => r.json())
      .then((j: { pics?: Record<string, { thumb: string; full: string; pdf: boolean }> }) => { if (live) setPics((x) => ({ ...x, ...Object.fromEntries(refs.map((r) => [r, j.pics?.[r] || { thumb: "", full: "", pdf: false }])) })); }).catch(() => null);
    return () => { live = false; };
  }, [picRefs]);
  async function showBig(ref: string) {
    const pc = pics[ref]; if (!pc?.full) return;
    if (big?.ref === ref) return setBig(null);
    if (!pc.pdf) return setBig({ ref, url: pc.full });
    setBig({ ref, url: pc.thumb });
    try {
      const { pdfPicture } = await import("@/lib/printavoArt");
      const c = await pdfPicture(await (await fetch(pc.full)).arrayBuffer(), 900);
      setBig((b) => (b?.ref === ref ? { ref, url: c.toDataURL("image/jpeg", 0.85) } : b));
    } catch { /* the small picture stays */ }
  }
  const what = (p: PastJob) => {
    const shirts = [...new Set(p.groups.flatMap((g) => g.lines.map((l) => [l.style, l.color].filter(Boolean).join(" "))).filter(Boolean))];
    const prints = [...new Set(p.groups.flatMap((g) => g.imprints.map((im) => `${im.location}${im.colors ? ` ${im.colors}c` : ""}`)))];
    return [shirts.slice(0, 2).join(", ") + (shirts.length > 2 ? ` +${shirts.length - 2}` : ""), prints.slice(0, 3).join(", ")].filter(Boolean).join(" · ");
  };

  // ---- one card per order (Oct 24, Nick: "rethink this screen… the how's it decorated should be asked later… I don't
  // get to select new order or whatever"): each order the email holds gets a card with what the AI read, and its order
  // type, past job and decoration can be changed right there; the next one to make is open, the rest are one line each
  type How = "" | "screen" | "embroidery" | "both"; type OT = "new" | "reorder" | "reorder_changes";
  type Card = { type: OT; job: string | null; jobLabel: string; how: How };
  const SOLO = "_solo";
  const [over, setOver] = useState<Record<string, Partial<Card>>>({});
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [jobFor, setJobFor] = useState<string | null>(null); // the card whose past job is being picked from the list
  const multi = !!plan && plan.parts.length > 1;
  const lookHit = look && look !== "wait" && look.ref ? look : null;
  const baseOf = (p: EOPart | null): Card => p
    ? { type: p.kind === "new" ? "new" : p.changes ? "reorder_changes" : "reorder", job: p.job, jobLabel: p.jobLabel || "", how: "" }
    : suggested?.job ? { type: "reorder", job: suggested.job, jobLabel: suggested.label.replace(/^Create (the )?reorder of\s*/i, ""), how: "" }
    : lookHit ? { type: "reorder", job: lookHit.ref!, jobLabel: lookHit.label || "", how: "" }
    : { type: guess === "reorder" ? "reorder" : "new", job: null, jobLabel: "", how: "" };
  const cardOf = (key: string, p: EOPart | null): Card => ({ ...baseOf(p), ...(over[key] || {}) });
  const setCard = (key: string, c: Partial<Card>) => setOver((o) => ({ ...o, [key]: { ...(o[key] || {}), ...c } }));
  const OT_LABEL: Record<OT, string> = { new: "New order", reorder: "Reorder", reorder_changes: "Reorder with changes" };
  const HOW_LABEL: Record<Exclude<How, "">, string> = { screen: "Screen print", embroidery: "Embroidery", both: "Both" };
  const toldOf = (c: Card) => [
    c.type === "new" ? "This is a NEW order, not a reorder of a past job." : c.job ? `This is a reorder of ${c.jobLabel || "the picked past job"}${lookHit && c.job === lookHit.ref ? ": the picture in the email is its mockup" : ""}.` : "This is a reorder of a past job: find the job it repeats.",
    c.type === "reorder_changes" ? "Some things change from the past job: take what's different from the emails." : c.type === "reorder" ? "It's an exact reprint of the past job: same prints, inks and placement." : "",
    c.how ? HOW_TOLD[c.how] : "",
  ].filter(Boolean).join(" ");
  const partFor = (p: EOPart): EOPart => {
    const c = cardOf(p.key, p), touched = !!over[p.key];
    return touched ? { ...p, kind: c.type === "new" ? "new" : "reorder", job: c.type === "new" ? "" : c.job, jobLabel: c.jobLabel || p.jobLabel, changes: c.type === "reorder" ? "" : p.changes, told: toldOf(c), orderType: c.type } : { ...p, orderType: c.type };
  };
  const makeSolo = () => {
    const c = cardOf(SOLO, null);
    // nothing changed and it was already read in the background: use that reading
    if (ready && !over[SOLO]) return onPick({ orderType: c.type });
    onPick({ told: toldOf(c), job: c.type === "new" ? undefined : c.job || undefined, orderType: c.type });
  };
  const pickJob = (p: PastJob) => {
    if (!jobFor) return;
    setCard(jobFor, { job: p.ref, jobLabel: name(p), ...(cardOf(jobFor, null).type === "new" ? { type: "reorder" as OT } : {}) });
    setJobFor(null); setQ(""); setSel([]);
  };
  const cardBody = (key: string, p: EOPart | null) => {
    const c = cardOf(key, p);
    return (
      <div className="osp-cb">
        <div className="osp-cb-f">
          <div className="field"><label htmlFor={`ot-${key}`}>Order type</label>
            <select id={`ot-${key}`} value={c.type} onChange={(e) => setCard(key, { type: e.target.value as OT })}>
              {(Object.keys(OT_LABEL) as OT[]).map((k) => <option key={k} value={k}>{OT_LABEL[k]}</option>)}
            </select>
          </div>
          {c.type !== "new" && (
            <div className="field"><label>Of past job</label>
              <button type="button" className="osp-jobf" onClick={() => setJobFor(jobFor === key ? null : key)} aria-expanded={jobFor === key}>
                <span>{c.job ? c.jobLabel || "The picked job" : "The AI finds it"}</span><span className="faint">{jobFor === key ? "close" : "change"}</span>
              </button>
            </div>
          )}
        </div>
        <div className="osp-cb-how" role="group" aria-label="How it's decorated">
          <span className="faint">Decoration</span>
          <div className="chips">{(Object.keys(HOW_LABEL) as Exclude<How, "">[]).map((k) => <button key={k} type="button" className={"chip" + (c.how === k ? " on" : "")} aria-pressed={c.how === k} onClick={() => setCard(key, { how: c.how === k ? "" : k })}>{HOW_LABEL[k]}</button>)}</div>
          {!c.how && <span className="faint">from the email</span>}
        </div>
      </div>
    );
  };
  const summary = (p: EOPart) => {
    const c = cardOf(p.key, p);
    return [c.type === "new" ? "New order" : `${OT_LABEL[c.type]}${c.job ? ` of ${(c.jobLabel || "").replace(/\s*\(Printavo\)$/, "")}` : ""}`, c.how ? HOW_LABEL[c.how].toLowerCase() : "", p.pieces ? `${p.pieces.toLocaleString("en-US")} pcs` : "", p.names?.length ? `${p.names.length} file${p.names.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
  };

  const mailLine = mails && (() => {
    const conv = mails.convo.length > 0, total = mails.convo.length + 1;
    const inN = total - mails.convo.filter((m) => mOff.has(m.id)).length, extra = mOn.size;
    const said = conv ? (inN === total ? `Read from all ${total} emails in this conversation` : inN === 1 ? "Read from this email only" : `Read from ${inN} of ${total} emails`) : "Read from this email";
    const more = extra ? ` + ${extra} other${extra === 1 ? "" : "s"}` : "";
    if (mView !== "list") return (
      <div className="osp-mline"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
        <span>{said}{more}</span>{(conv || mails.others.length > 0) && <button type="button" className="linkbtn" onClick={() => setMView("list")}>change</button>}</div>
    );
    return (
      <div className="osp-mails osp-mq open">
        <ul>
          {mails.convo.map((m) => (
            <li key={m.id}><label><input type="checkbox" checked={!mOff.has(m.id)} onChange={() => setMOff((x) => { const y = new Set(x); if (y.has(m.id)) y.delete(m.id); else y.add(m.id); return y; })} />
              <span><b>{m.from}</b> · {fmt(m.at)}{m.files.length ? <span className="faint"> · {m.files.length} file{m.files.length === 1 ? "" : "s"}: {m.files.slice(0, 3).join(", ")}</span> : null}<br /><span className="faint">{m.subject}</span></span></label></li>
          ))}
          {mails.others.length > 0 && <li className="osp-mails-sep faint">Other emails from them in the last two weeks</li>}
          {mails.others.map((m) => (
            <li key={m.id}><label><input type="checkbox" checked={mOn.has(m.id)} onChange={() => setMOn((x) => { const y = new Set(x); if (y.has(m.id)) y.delete(m.id); else y.add(m.id); return y; })} />
              <span><b>{m.from}</b> · {fmt(m.at)}{m.files.length ? <span className="faint"> · {m.files.length} file{m.files.length === 1 ? "" : "s"}: {m.files.slice(0, 3).join(", ")}</span> : null}<br /><span className="faint">{m.subject}</span></span></label></li>
          ))}
        </ul>
        <div className="osp-mq-done"><button type="button" className="btn sm" onClick={() => setMView("done")}>Done</button></div>
      </div>
    );
  })();

  const jobList = (
    <>
      <div className="osp-h">
        <span>{jobFor ? "Pick the past job:" : "Their past jobs:"}</span>
        <input className="osp-q" placeholder={looking ? "Searching…" : "Find any job: name or #"} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a past job" />
      </div>
      {past === null ? <p className="faint">Loading their past jobs…</p> : err ? <p className="err">{err}</p> : list.length === 0 ? <p className="faint">{q ? "No job matches." : "No past jobs on file for this customer."}</p> : (
        <div className="osp-list">
          {list.slice(0, 40).map(({ p, hit }) => {
            const on = sel.some((y) => y.ref === p.ref);
            return (
              <div key={p.ref} className={"osp-jobrow" + (on ? " on" : "")}>
                {jobFor === SOLO ? <label className="osp-tick" title="Tick several jobs to reorder them together in one order"><input type="checkbox" checked={on} onChange={() => tick(p)} aria-label={`Add ${name(p)} to one reorder`} /></label> : <span />}
                <button type="button" className={"osp-pic" + (big?.ref === p.ref ? " on" : "")} disabled={!pics[p.ref]?.full} title={pics[p.ref]?.full ? "See this job's mockup" : p.ref in pics ? "No mockup on this job" : "Loading its mockup…"} aria-label={`See the mockup of ${name(p)}`} onClick={() => void showBig(p.ref)}>
                  {pics[p.ref]?.thumb ? <img src={pics[p.ref].thumb} alt="" /> : <span aria-hidden>{p.ref in pics ? "–" : ""}</span>}
                </button>
                <button type="button" className={"osp-job" + (hit ? " hit" : "")} onClick={() => (sel.length ? tick(p) : pickJob(p))}>
                  <b>{name(p)}</b>
                  <span className="faint">{fmt(p.date)} · {p.qty.toLocaleString("en-US")} pcs{p.ref.startsWith("a:") ? " · Printavo" : ""}</span>
                  {what(p) && <span className="osp-what" data-notranslate>{what(p)}</span>}
                  {lookHit && lookHit.ref === p.ref ? <em>Matches their picture</em> : hit > 0 && <em>Named in the email</em>}
                </button>
                {big?.ref === p.ref && <div className="osp-big-pic"><img src={big.url} alt={`The mockup of ${name(p)}`} /><button type="button" className="btn sm primary" onClick={() => pickJob(p)}>This one</button></div>}
              </div>
            );
          })}
        </div>
      )}
      {jobFor === SOLO && sel.length > 0 && (
        <div className="osp-multi">
          <span>{sel.length === 1 ? `${name(sel[0])}: tick another job to reorder them together` : `One order, a group for each: ${sel.map((p) => name(p).replace(/^(#\d+).*/, "$1")).join(" + ")}`}</span>
          <button type="button" className="btn ghost sm" onClick={() => setSel([])}>Clear</button>
          <button type="button" className="btn primary sm" onClick={() => (sel.length === 1 ? pickJob(sel[0]) : onPick({ job: sel[0].ref, jobs: sel.map((p) => p.ref), told: `This is ONE order that reorders these past jobs together, each design its own group: ${sel.map(name).join("; ")}.`, orderType: "reorder" }))}>{sel.length === 1 ? "Use it" : `Reorder these ${sel.length} together`}</button>
        </div>
      )}
    </>
  );

  return (
    <div className={"dla-bg" + (dock ? " dock" : "")} role="dialog" aria-modal={dock ? undefined : true} aria-label="Create order" onClick={dock ? undefined : onClose}>
      <div className="dla osp" onClick={(e) => e.stopPropagation()}>
        <h3>Create order</h3>
        {mailLine}
        {plan === null ? <p className="osp-plan-wait">Reading the emails for how many orders are in them…</p> : multi ? (() => {
          const all = plan.parts, done = all.filter((p) => p.made), left = all.filter((p) => !p.made);
          const cur = openKey && left.some((p) => p.key === openKey) ? openKey : left[0]?.key || null;
          return (
            <div className="osp-cards">
              <div className="osp-plan-h">
                <b>{done.length === 0 ? `${all.length} orders in this email` : left.length === 0 ? `All ${all.length} orders in this email are made` : `${done.length} of ${all.length} orders made from this email`}</b>
                <span className="faint">{left.length ? "Check what each one is, then make them one at a time." : plan.note || "One per design, each from its own files"}</span>
              </div>
              {all.map((p, i) => p.made ? (
                <div key={p.key} className="osp-card made"><span><b>{i + 1}. {p.label}</b></span><a className="osp-made" href={`/shop/orders/${p.made.id}`} target="_blank" rel="noreferrer" title="Open it in a new tab">✓ #{p.made.number}</a></div>
              ) : p.key === cur ? (
                <div key={p.key} className="osp-card open">
                  <div className="osp-card-t"><b>{i + 1}. {p.label}</b><span className="faint">{[p.pieces ? `${p.pieces.toLocaleString("en-US")} pcs` : "", p.names?.length ? `${p.names.length} file${p.names.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")}</span></div>
                  {p.changes && <div className="faint osp-card-n">New: {p.changes}</div>}
                  {cardBody(p.key, p)}
                  {jobFor === p.key && <div className="osp-card-jobs">{jobList}</div>}
                  <div className="osp-card-go"><button type="button" className="btn primary" onClick={() => onPick({ parts: [partFor(p)] })} title="Makes this one; you check it in the Order chat, then come back for the next">Make this one</button></div>
                </div>
              ) : (
                <div key={p.key} className="osp-card"><span><b>{i + 1}. {p.label}</b><br /><span className="faint">{summary(p)}</span></span><button type="button" className="linkbtn" onClick={() => { setOpenKey(p.key); setJobFor(null); }}>edit</button></div>
              ))}
              {left.length > 1 && <div className="osp-card-all"><button type="button" className="btn" onClick={() => onPick({ parts: left.map(partFor) })} title="Each one stops when it's made; you open it and go on to the next">Make all {left.length} at once</button></div>}
            </div>
          );
        })() : (
          <div className="osp-cards">
            {/* one order: the same card (Oct 24) */}
            {suggested && !suggested.job && <button type="button" className="osp-big sug osp-sugg" onClick={() => onPick({ told: suggested.told, job: suggested.job })}><b>{suggested.label}</b><span>What the Assistant suggested</span></button>}
            {like && <button type="button" className="osp-big sug osp-sugg" onClick={() => onPick({ told: `This is a NEW order (their new art), printed the same way as their order ${like} (find that job: ${like} may be their PO number on it). Copy how it printed (inks, size, placement) onto the matching prints.`, orderType: "new" })}>
              <b>New order, printed like their order {like}</b><span>The art and garments from these files; the inks, size and placement from that past job, where the prints match</span>
            </button>}
            <div className="osp-card open">
              <div className="osp-card-t"><b>{ready?.draft.nickname || "This order"}</b>{ready && <span className="faint">already read: ready to make</span>}</div>
              {look === "wait" ? <div className="faint osp-card-n">Comparing the picture in the email with their past jobs&apos; mockups…</div> : lookHit && cardOf(SOLO, null).job === lookHit.ref ? <div className="faint osp-card-n">{lookHit.why}{lookHit.sure === "low" ? " (not sure: check it)" : ""}</div> : null}
              {cardBody(SOLO, null)}
              {jobFor === SOLO && <div className="osp-card-jobs">{jobList}</div>}
              <div className="osp-card-go"><button type="button" className="btn primary" onClick={makeSolo}>Make the order</button></div>
            </div>
          </div>
        )}
        <div className="dla-acts"><button type="button" className="eo-link osp-review" onClick={() => onPick({ review: true })} title="The AI's reading in a form you check and fix before the order is made">Check every detail first</button><span className="spacer" /><button type="button" className="btn ghost" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}
