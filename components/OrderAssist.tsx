"use client";
import { useState } from "react";
import type { Group } from "@/lib/pricing";
import type { Check } from "@/lib/orderChecks";
import type { ProposedOrder } from "@/lib/ai/normalize";
import { aiOrderFromText, aiReviewOrder } from "@/app/shop/ai-actions";

/** "Order check" panel: rule checks now, plus an optional AI review. */
export function ChecksPanel({ checks, orderId, save }: { checks: Check[]; orderId: string; save: () => Promise<void> }) {
  const [ai, setAi] = useState<null | { summary: string; issues: Check[] }>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  async function review() {
    setBusy(true); setNote("");
    await save();
    const r = await aiReviewOrder(orderId);
    setBusy(false);
    if (!r.ok) return setNote(r.error || "The AI review didn't work.");
    setAi({ summary: r.summary, issues: r.issues.map((x) => ({ level: x.severity, text: x.text })) });
  }
  const high = checks.filter((c) => c.level === "high").length;
  return (
    <section className="panel">
      <div className="panel-h"><h2>Order check</h2><span className={"faint num"} style={{ color: high ? "var(--danger)" : undefined }}>{checks.length ? `${checks.length} to look at` : "Looks good"}</span></div>
      <div className="panel-b stack" style={{ gap: 10 }}>
        <div className="chk-list">
          {checks.length ? checks.map((c, i) => <div key={i} className={"chk " + c.level}>{c.text}</div>) : <div className="chk ok">No problems found.</div>}
        </div>
        {ai && (
          <div className="ai-box">
            <h3>AI review</h3>
            {ai.summary && <div className="muted" style={{ fontSize: 13 }}>{ai.summary}</div>}
            <div className="chk-list">{ai.issues.length ? ai.issues.map((c, i) => <div key={i} className={"chk " + c.level}>{c.text}</div>) : <div className="chk ok">Nothing else stood out.</div>}</div>
          </div>
        )}
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn sm ghost" onClick={review} disabled={busy}>{busy ? "Reviewing…" : "✦ AI review"}</button>
          {note && <span className="ai-off">{note}</span>}
        </div>
      </div>
    </section>
  );
}

/** Paste a customer's email or call notes and let the AI fill in the order groups. */
export function FillFromText({ orderId, hasContent, onApply }: { orderId: string; hasContent: boolean; onApply: (groups: Group[], p: ProposedOrder, mode: "replace" | "add") => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<null | { groups: Group[]; proposal: ProposedOrder }>(null);
  async function run() {
    setBusy(true); setErr(""); setRes(null);
    const r = await aiOrderFromText(text, orderId);
    setBusy(false);
    if (!r.ok) return setErr(r.error || "Couldn't read that.");
    if (!r.groups.length) return setErr("Didn't find any garments or prints in that text.");
    setRes({ groups: r.groups, proposal: r.proposal });
  }
  if (!open) return <button type="button" className="btn sm ghost" onClick={() => setOpen(true)} title="Paste an email or call notes and let the AI fill in the garments, sizes and prints">✦ Fill from an email</button>;
  const pcs = res ? res.groups.reduce((a, g) => a + g.lines.reduce((b, l) => b + Object.values(l.sizes || {}).reduce((c, v) => c + (+v || 0), 0), 0), 0) : 0;
  return (
    <div className="ai-box" style={{ flex: "1 1 100%" }}>
      <h3>✦ Fill in this order from an email or notes</h3>
      <textarea rows={5} aria-label="Customer's email or notes" placeholder="Paste the customer's email, a text message, or your notes from the call…" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="btn sm primary" disabled={busy || text.trim().length < 10} onClick={run}>{busy ? "Reading…" : "Read it"}</button>
        <button type="button" className="btn sm ghost" onClick={() => { setOpen(false); setRes(null); setErr(""); }}>Close</button>
        {err && <span className="ai-off">{err}</span>}
      </div>
      {res && (
        <div className="stack" style={{ gap: 6, fontSize: 13 }}>
          <div><b>Found {res.groups.length} group{res.groups.length === 1 ? "" : "s"}, {pcs} pieces</b>{res.proposal.confidence ? ` · ${res.proposal.confidence} confidence` : ""}. Prices come from your price list; blank costs fill in when you pick each style.</div>
          {res.proposal.questions?.length ? <div className="muted">Still need to ask: {res.proposal.questions.join(" · ")}</div> : null}
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn sm primary" onClick={() => { onApply(res.groups, res.proposal, hasContent ? "add" : "replace"); setOpen(false); setRes(null); setText(""); }}>{hasContent ? "Add to this order" : "Use these"}</button>
            {hasContent && <button type="button" className="btn sm" onClick={() => { onApply(res.groups, res.proposal, "replace"); setOpen(false); setRes(null); setText(""); }}>Replace what&apos;s here</button>}
          </div>
        </div>
      )}
    </div>
  );
}
