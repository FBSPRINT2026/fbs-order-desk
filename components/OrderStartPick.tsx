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
  /** open the full form to check every detail before it's made (otherwise it's made in one go, QuickOrder) */ review?: boolean };
const STOP = new Set(["the", "and", "for", "order", "orders", "reorder", "new", "shirts", "shirt", "tees", "tee", "printavo", "with", "from", "re", "fw", "fwd"]);
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const fmt = (d: string) => (d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

export default function OrderStartPick({ activityId, text, guess, onPick, onClose, suggested, dock }: { activityId: string;
  /** a panel on the right, the page still usable beside it (Oct 23, Nick: "I can't see anything once we create an order… a
   *  pop-up on the right, like Claude in Chrome… so I can still click the attachments") */ dock?: boolean; /** the email's subject and summary: past jobs named in it go first */ text: string; guess: "new" | "reorder" | ""; onPick: (s: OrderStart) => void; onClose: () => void;
  /** what the Assistant suggested ("Create the reorder of #31174") */ suggested?: { label: string; told?: string; job?: string } }) {
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

  return (
    <div className={"dla-bg" + (dock ? " dock" : "")} role="dialog" aria-modal={dock ? undefined : true} aria-label="Create order" onClick={dock ? undefined : onClose}>
      <div className="dla osp" onClick={(e) => e.stopPropagation()}>
        <h3>Create order</h3>
        <p className="dla-sub">Is this a new order, or a reorder of something we&apos;ve printed for them before? A reorder brings in the old job&apos;s art, film and garments.</p>
        {plan === null ? <p className="osp-plan-wait">Reading the emails for how many orders are in them…</p> : plan.parts.length > 1 && (
          <div className="osp-plan">
            <div className="osp-plan-h"><b>{plan.parts.length} orders in this email</b><span className="faint">{plan.note || "One per design, each from its own files"}</span></div>
            <ol>
              {plan.parts.map((p) => (
                <li key={p.key}><b>{p.label}</b> <span className="faint">{p.kind === "reorder" ? (p.jobLabel ? `reorder of ${p.jobLabel}` : "reorder") : "new"}{" · "}{p.changes ? `new: ${p.changes}` : "exact reprint"}{p.pieces ? ` · ${p.pieces.toLocaleString("en-US")} pcs` : ""}{p.names?.length ? ` · ${p.names.length} file${p.names.length === 1 ? "" : "s"}` : ""}</span></li>
              ))}
            </ol>
            <button type="button" className="btn primary" onClick={() => onPick({ parts: plan.parts })}>Make these {plan.parts.length} orders</button>
          </div>
        )}
        {ready && !(plan && plan.parts.length > 1) && (() => {
          const d = ready.draft, pcs = d.groups.reduce((n, g) => n + g.lines.reduce((m, l) => m + Object.values(l.sizes || {}).reduce((a, v) => a + (+v || 0), 0), 0), 0);
          const job = d.reorderOf ? (past || []).find((p) => p.ref === d.reorderOf) : null;
          return (
            <button type="button" className="osp-big sug osp-sugg osp-ready" onClick={() => onPick({})}>
              <b>Ready to approve: {d.kind === "reorder" ? `reorder of ${job ? job.label.replace(/\s*\(Printavo\)$/, "") : "a past order"}` : `new order${d.nickname ? `, ${d.nickname}` : ""}`}{pcs ? ` · ${pcs.toLocaleString("en-US")} pcs` : ""}</b>
              <span>{d.summary || "Already read from the email and its files"}{d.questions.length ? ` · ${d.questions.length} question${d.questions.length === 1 ? "" : "s"} for the customer` : ""}</span>
            </button>
          );
        })()}
        {look === "wait" && <p className="osp-plan-wait">Comparing the picture in the email with their past jobs&apos; mockups…</p>}
        {look && look !== "wait" && look.ref && (
          <button type="button" className="osp-big sug osp-sugg" onClick={() => onPick({ job: look.ref, told: `This is a reorder of ${look.label}: the picture in the email is its mockup.` })}>
            <b>Reorder {look.label}: the same mockup as their picture</b><span>{look.why}{look.sure === "low" ? " (not sure: check it)" : ""}</span>
          </button>
        )}
        {suggested && <button type="button" className="osp-big sug osp-sugg" onClick={() => onPick({ told: suggested.told, job: suggested.job })}><b>{suggested.label}</b><span>What the Assistant suggested</span></button>}
        {/* a new order that points at a past job ("not a repeat… screen print process same as order 85254"): its own choice,
            so it's clear it's new art printed the way that job was (Oct 23, Nick: "I don't think it's going to be clear for my
            employees to choose either new order or reorder in this situation") */}
        {like && <button type="button" className="osp-big sug osp-sugg" onClick={() => onPick({ told: `This is a NEW order (their new art), printed the same way as their order ${like} (find that job: ${like} may be their PO number on it). Copy how it printed (inks, size, placement) onto the matching prints.` })}>
          <b>New order, printed like their order {like}</b><span>The art and garments from these files; the inks, size and placement from that past job, where the prints match</span>
        </button>}
        <div className="osp-two">
          <button type="button" className={"osp-big" + (guess === "new" && !like ? " sug" : "")} onClick={() => onPick({ told: "This is a new order, not a reorder of a past job." })}>
            <b>New order</b><span>New art or garments, built from these files. A past job they mention is used for how it printed</span>{guess === "new" && !like && <em>The AI&apos;s guess</em>}
          </button>
          <button type="button" className={"osp-big" + (guess === "reorder" ? " sug" : "")} onClick={() => onPick({ told: "This is a reorder of a past job: find the job it repeats." })}>
            <b>Reorder: the same job again</b><span>Exactly like a past job: same art, same mockup, new sizes. The AI picks which job</span>{guess === "reorder" && <em>The AI&apos;s guess</em>}
          </button>
        </div>
        <div className="osp-h">
          <span>Or a reorder of this job:</span>
          <input className="osp-q" placeholder={looking ? "Searching…" : "Find any job: name or #"} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a past job" />
        </div>
        {past === null ? <p className="faint">Loading their past jobs…</p> : err ? <p className="err">{err}</p> : list.length === 0 ? <p className="faint">{q ? "No job matches." : "No past jobs on file for this customer."}</p> : (
          <div className="osp-list">
            {list.slice(0, 40).map(({ p, hit }) => {
              const on = sel.some((y) => y.ref === p.ref);
              return (
                <div key={p.ref} className={"osp-jobrow" + (on ? " on" : "")}>
                  <label className="osp-tick" title="Tick several jobs to reorder them together in one order"><input type="checkbox" checked={on} onChange={() => tick(p)} aria-label={`Add ${name(p)} to one reorder`} /></label>
                  <button type="button" className={"osp-pic" + (big?.ref === p.ref ? " on" : "")} disabled={!pics[p.ref]?.full} title={pics[p.ref]?.full ? "See this job's mockup" : p.ref in pics ? "No mockup on this job" : "Loading its mockup…"} aria-label={`See the mockup of ${name(p)}`} onClick={() => void showBig(p.ref)}>
                    {pics[p.ref]?.thumb ? <img src={pics[p.ref].thumb} alt="" /> : <span aria-hidden>{p.ref in pics ? "–" : ""}</span>}
                  </button>
                  <button type="button" className={"osp-job" + (hit ? " hit" : "")} onClick={() => (sel.length ? tick(p) : onPick({ job: p.ref, told: `This is a reorder of ${name(p)}.` }))}>
                    <b>{name(p)}</b>
                    <span className="faint">{fmt(p.date)} · {p.qty.toLocaleString("en-US")} pcs{p.ref.startsWith("a:") ? " · Printavo" : ""}</span>
                    {what(p) && <span className="osp-what" data-notranslate>{what(p)}</span>}
                    {look && look !== "wait" && look.ref === p.ref ? <em>Matches their picture</em> : hit > 0 && <em>Named in the email</em>}
                  </button>
                  {big?.ref === p.ref && <div className="osp-big-pic"><img src={big.url} alt={`The mockup of ${name(p)}`} /><button type="button" className="btn sm primary" onClick={() => onPick({ job: p.ref, told: `This is a reorder of ${name(p)}.` })}>Reorder this one</button></div>}
                </div>
              );
            })}
          </div>
        )}
        {sel.length > 0 && (
          <div className="osp-multi">
            <span>{sel.length === 1 ? `${name(sel[0])}: tick another job to reorder them together` : `One order, a group for each: ${sel.map((p) => name(p).replace(/^(#\d+).*/, "$1")).join(" + ")}`}</span>
            <button type="button" className="btn ghost sm" onClick={() => setSel([])}>Clear</button>
            <button type="button" className="btn primary sm" onClick={() => onPick(sel.length === 1 ? { job: sel[0].ref, told: `This is a reorder of ${name(sel[0])}.` } : { job: sel[0].ref, jobs: sel.map((p) => p.ref), told: `This is ONE order that reorders these past jobs together, each design its own group: ${sel.map(name).join("; ")}.` })}>{sel.length === 1 ? "Reorder it" : `Reorder these ${sel.length} together`}</button>
          </div>
        )}
        <div className="dla-acts"><button type="button" className="eo-link osp-review" onClick={() => onPick({ review: true })} title="The AI's reading in a form you check and fix before the order is made">Check every detail first</button><span className="spacer" /><button type="button" className="btn ghost" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}
