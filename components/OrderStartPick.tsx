"use client";
import { useEffect, useMemo, useState } from "react";
import type { EOPart, PastJob } from "@/lib/emailOrderShared";

/**
 * Create order from an email: first ask what it is (Oct 20, Nick: "it pops up and says, okay, is this an order or
 * should I try to find it as a reorder?"). Little Groupies' "order for The Bottles" was read as a new order and came
 * in with no art; picking the old job here makes it a real reorder (its art, film and lines).
 *  - New order: built from the email.
 *  - Reorder of a past job: their jobs, the ones whose name is in the email first.
 *  - Reorder, let the AI find the job.
 */
export type OrderStart = { told?: string; job?: string; /** several orders in the email (one per design), each read on its own */ parts?: EOPart[] };
const STOP = new Set(["the", "and", "for", "order", "orders", "reorder", "new", "shirts", "shirt", "tees", "tee", "printavo", "with", "from", "re", "fw", "fwd"]);
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const fmt = (d: string) => (d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

export default function OrderStartPick({ activityId, text, guess, onPick, onClose, suggested }: { activityId: string; /** the email's subject and summary: past jobs named in it go first */ text: string; guess: "new" | "reorder" | ""; onPick: (s: OrderStart) => void; onClose: () => void;
  /** what the Assistant suggested ("Create the reorder of #31174") */ suggested?: { label: string; told?: string; job?: string } }) {
  const [past, setPast] = useState<PastJob[] | null>(null);
  // how many orders the email holds (Oct 20, Nick: Dear Heart's one email = four reorders, one per design)
  const [plan, setPlan] = useState<null | { parts: EOPart[]; note: string; error?: string }>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/inbox/order/plan?activity=${encodeURIComponent(activityId)}`).then((r) => r.json()).then((j) => { if (live) setPlan(j.error ? { parts: [], note: "", error: j.error } : { parts: j.parts || [], note: j.note || "" }); }).catch(() => { if (live) setPlan({ parts: [], note: "", error: "x" }); });
    return () => { live = false; };
  }, [activityId]);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    let live = true;
    fetch(`/api/inbox/order?activity=${encodeURIComponent(activityId)}`).then((r) => r.json()).then((j) => { if (live) setPast(Array.isArray(j?.past) ? j.past : []); }).catch(() => { if (live) { setPast([]); setErr("Couldn't load their past jobs."); } });
    return () => { live = false; };
  }, [activityId]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const list = useMemo(() => {
    const w = words(text), t = q.trim().toLowerCase();
    return (past || [])
      .map((p) => { const pw = words(p.label.replace(/^#\d+\s*/, "")); let hit = 0; pw.forEach((x) => { if (w.has(x)) hit++; }); return { p, hit }; })
      .filter(({ p }) => !t || p.label.toLowerCase().includes(t))
      .sort((a, b) => b.hit - a.hit || b.p.date.localeCompare(a.p.date));
  }, [past, text, q]);

  return (
    <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Create order" onClick={onClose}>
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
        {suggested && <button type="button" className="osp-big sug osp-sugg" onClick={() => onPick({ told: suggested.told, job: suggested.job })}><b>{suggested.label}</b><span>What the Assistant suggested</span></button>}
        <div className="osp-two">
          <button type="button" className={"osp-big" + (guess === "new" ? " sug" : "")} onClick={() => onPick({ told: "This is a new order, not a reorder of a past job." })}>
            <b>New order</b><span>Built from this email and its files</span>{guess === "new" && <em>The AI&apos;s guess</em>}
          </button>
          <button type="button" className={"osp-big" + (guess === "reorder" ? " sug" : "")} onClick={() => onPick({ told: "This is a reorder of a past job: find the job it repeats." })}>
            <b>Reorder: find the job</b><span>The AI picks which past job it repeats</span>{guess === "reorder" && <em>The AI&apos;s guess</em>}
          </button>
        </div>
        <div className="osp-h">
          <span>Or a reorder of this job:</span>
          {(past?.length || 0) > 6 && <input className="osp-q" placeholder="Find a job" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a past job" />}
        </div>
        {past === null ? <p className="faint">Loading their past jobs…</p> : err ? <p className="err">{err}</p> : list.length === 0 ? <p className="faint">{q ? "No job matches." : "No past jobs on file for this customer."}</p> : (
          <div className="osp-list">
            {list.slice(0, 40).map(({ p, hit }) => (
              <button key={p.ref} type="button" className={"osp-job" + (hit ? " hit" : "")} onClick={() => onPick({ job: p.ref, told: `This is a reorder of ${p.label.replace(/\s*\(Printavo\)$/, "")}.` })}>
                <b>{p.label.replace(/\s*\(Printavo\)$/, "")}</b>
                <span className="faint">{fmt(p.date)} · {p.qty.toLocaleString("en-US")} pcs{p.ref.startsWith("a:") ? " · Printavo" : ""}</span>
                {hit > 0 && <em>Named in the email</em>}
              </button>
            ))}
          </div>
        )}
        <div className="dla-acts"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}
