"use client";
import { useEffect, useState } from "react";
import type { Group } from "@/lib/pricing";
import type { Check } from "@/lib/orderChecks";
import type { ProposedOrder } from "@/lib/ai/normalize";
import { aiOrderFromText, aiReorderCheck, aiReviewOrder, applyReorderFix } from "@/app/shop/ai-actions";
import type { ReorderCheck, ReorderFix } from "@/lib/ai/reorderCheck";

/** "Order check" panel: rule checks now, plus an optional AI review. */
export function ChecksPanel({ checks, orderId, save, reorder }: { checks: Check[]; orderId: string; save: () => Promise<void>; /** a reorder of an earlier job: the AI compares it with that job */ reorder?: boolean }) {
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
        {reorder && <ReorderCheckBox orderId={orderId} save={save} />}
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

const FIELD: Record<ReorderFix["field"], string> = { size: "Size", location: "Location", inks: "Inks", colors: "Colors", drop: "Drop" };
/**
 * Reorder check: the AI looks over the reorder next to the old job (its files, the film, the art on each print and
 * our mockup). Runs by itself the first time the order opens; each suggested fix applies with a click.
 */
function ReorderCheckBox({ orderId, save }: { orderId: string; save: () => Promise<void> }) {
  const [c, setC] = useState<ReorderCheck | null>(null);
  const [busy, setBusy] = useState<"" | "run" | number>("");
  const [note, setNote] = useState("");
  const [told, setTold] = useState<string | null>(null);
  async function run(onlyIfNone: boolean) {
    setBusy("run"); setNote("");
    if (!onlyIfNone) await save();
    const r = await aiReorderCheck(orderId, onlyIfNone, onlyIfNone || told == null ? undefined : told);
    setBusy("");
    if (!r.ok) return setNote(r.error || "The reorder check didn't work.");
    setC(r.check);
    setTold(r.check.told || "");
  }
  useEffect(() => { void run(true); }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function apply(i: number, f: ReorderFix) {
    setBusy(i); setNote("");
    await save();
    const r = await applyReorderFix(orderId, f);
    if (!r.ok) { setBusy(""); return setNote(r.error || "Couldn't apply that."); }
    location.reload();
  }
  const tone = c?.verdict === "good" ? "ok" : c?.verdict === "problems" ? "high" : "medium";
  return (
    <div className="ai-box">
      <h3>✦ Reorder check</h3>
      {busy === "run" && !c && <div className="muted" style={{ fontSize: 13 }}>Comparing with the old job: its files, the film, the art and our mockup…</div>}
      {c && (
        <>
          <div className={"chk " + tone}>{c.summary}</div>
          {c.issues.length > 0 && <div className="chk-list">{c.issues.map((x, i) => <div key={i} className={"chk " + x.severity}>{x.text}</div>)}</div>}
          {c.fixes.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              {c.fixes.map((f, i) => (
                <div key={i} className="row" style={{ gap: 8, fontSize: 13, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span><b>{FIELD[f.field] || f.field} → {f.value}</b> <span className="muted">{f.why}</span></span>
                  <button type="button" className="btn sm" disabled={busy !== ""} onClick={() => apply(i, f)}>{busy === i ? "Applying…" : "Apply"}</button>
                </div>
              ))}
            </div>
          )}
          {c.at && <div className="faint" style={{ fontSize: 12 }}>Checked {new Date(c.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>}
        </>
      )}
      <label className="stack" style={{ gap: 4, fontSize: 13 }}>
        <span className="muted">Tell it what you know about this job (it looks the rest up)</span>
        <textarea rows={2} value={told || ""} placeholder='e.g. "We used the LA Lakers PMS colors" or "The back print was 3 inches wide"' onChange={(e) => setTold(e.target.value)} />
      </label>
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="btn sm ghost" onClick={() => run(false)} disabled={busy !== ""}>{busy === "run" ? "Checking…" : c ? "Check again" : "Run the reorder check"}</button>
        {note && <span className="ai-off">{note}</span>}
      </div>
    </div>
  );
}
