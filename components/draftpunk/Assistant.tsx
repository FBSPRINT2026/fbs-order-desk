"use client";
import { useState } from "react";
import { r1 } from "@/lib/draftpunk/calc";
import type { Proposal } from "@/lib/draftpunk/proposal";
import { styleById } from "@/lib/draftpunk/styles";
import type { Recipe } from "@/lib/draftpunk/types";
import type { AssistantReply } from "@/app/api/draftpunk/assistant/route";

/** a proposed recipe at a glance: the numbers, the grain bill by percent, hops, yeast, mash and fermentation */
export function ProposalView({ p }: { p: Proposal }) {
  const pts = (p.og - 1) * 1000;
  const when = (h: Proposal["hops"][number]) => (h.use === "dry_hop" ? `dry hop ${h.days || 4} d` : h.use === "whirlpool" ? `whirlpool ${h.min ?? 20} min${h.tempF ? ` @ ${h.tempF}°F` : ""}` : h.use === "first_wort" ? "first wort" : h.use === "mash" ? "mash" : `${h.min ?? 60} min`);
  return (
    <div className="dp-prop">
      <div className="dp-row" style={{ gap: 8 }}>
        {p.styleId && <span className="dp-chip dp-beer">{styleById(p.styleId)?.name || p.styleId}</span>}
        <span className="dp-chip">OG {p.og.toFixed(3)}</span>{p.fg ? <span className="dp-chip">FG {p.fg.toFixed(3)}</span> : null}
        <span className="dp-chip">{Math.round(p.ibu)} IBU</span><span className="dp-chip">BU:GU {r1(p.ibu / Math.max(1, pts), 2)}</span>{p.srm ? <span className="dp-chip">SRM {p.srm}</span> : null}
      </div>
      <ul className="dp-list">
        {p.ferms.map((f) => <li key={f.name}><b>{r1(f.pct, 1)}%</b> {f.name}</li>)}
        {p.hops.map((h, i) => <li key={`h${i}`}>{h.name}{h.oz ? ` ${r1(h.oz, 2)} oz` : ""} · {when(h)}</li>)}
        {p.yeasts.map((y) => <li key={y.name}>{y.name}{y.tempF ? ` @ ${y.tempF}°F` : ""}</li>)}
        {p.mash?.length ? <li>Mash {p.mash.map((s) => `${s.tempF}°F ${s.min} min`).join(", ")}</li> : null}
        {p.ferment?.length ? <li>Ferment {p.ferment.map((s) => `${s.name} ${s.days} d @ ${s.tempF}°F`).join(", ")}</li> : null}
        {p.water?.so4 || p.water?.cl ? <li>Water: Ca {p.water.ca ?? "-"}, SO₄ {p.water.so4 ?? "-"}, Cl {p.water.cl ?? "-"} ppm</li> : null}
      </ul>
      {p.notes && <p className="dp-dim" style={{ whiteSpace: "pre-wrap" }}>{p.notes}</p>}
    </div>
  );
}

/**
 * The brewing assistant (Nick, Nov 24 2026: "I'm doing an Oktoberfest… you need Melanoidin and I'd recommend it to this
 * percent"). One tool, in every place it helps: a recipe's toolbar (about that recipe, its changes put on the working
 * copy), its Versions tab ("suggest the next version" from the scoresheets), and the Assistant page (a new beer).
 */
export default function Assistant({ recipe, recipeId, styleId, goal, mode = "ask", onApply, applyLabel = "Put these changes on the working copy", prompts }: {
  recipe?: Recipe; recipeId?: string; styleId?: string; goal?: "house" | "competition"; mode?: "ask" | "next";
  onApply?: (p: Proposal) => void; applyLabel?: string; prompts?: string[];
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [reply, setReply] = useState<AssistantReply | null>(null);
  const ask = async (question: string) => {
    if (mode === "ask" && !question.trim()) { setErr("Type a question first"); return; }
    setBusy(true); setErr(""); setReply(null);
    try {
      const res = await fetch("/api/draftpunk/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(mode === "next" ? { mode, recipeId, recipe, question } : { mode, question, recipe, styleId, goal }) });
      const j = await res.json();
      if (!res.ok) setErr(j.error || "The assistant couldn't answer"); else setReply(j);
    } catch { setErr("The assistant couldn't be reached"); }
    setBusy(false);
  };
  const quick = prompts || (recipe ? ["What would you change to make this a medal winner?", "Check my bitterness ratio and gravity for the style", "Make it a competition version"] : []);
  return (
    <div className="dp-asst">
      <form className="dp-row" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <textarea rows={2} value={q} onChange={(e) => { setQ(e.target.value); setErr(""); }} placeholder={mode === "next" ? "Anything to focus on? (optional)" : recipe ? "Ask about this recipe" : "What are you brewing? e.g. an Oktoberfest for NHC"} style={{ flex: "1 1 260px" }} />
        <button className="dp-btn dp-go" disabled={busy}>{busy ? "Thinking…" : mode === "next" ? "Suggest the next version" : "Ask"}</button>
      </form>
      {err && <p className="dp-red">{err}</p>}
      {!!quick.length && !reply && !busy && (
        <div className="dp-row" style={{ gap: 6, marginTop: 8 }}>{quick.map((x) => <button key={x} type="button" className="dp-chip dp-linkbtn" onClick={() => { setQ(x); ask(x); }}>{x}</button>)}</div>
      )}
      {busy && <p className="dp-dim">Reading the style, your recipes and your results…</p>}
      {reply && (
        <div className="dp-asst-a">
          <p style={{ whiteSpace: "pre-wrap" }}>{reply.answer}</p>
          {!!reply.changes?.length && <><h3 className="dp-h">Changes</h3><ul className="dp-list">{reply.changes.map((c) => <li key={c}>{c}</li>)}</ul></>}
          {reply.proposal && <><h3 className="dp-h">{recipe ? "The recipe with these changes" : "The recipe"}</h3><ProposalView p={reply.proposal} /></>}
          {reply.proposal && onApply && <p className="dp-row"><button className="dp-btn dp-go" onClick={() => onApply(reply.proposal!)}>{applyLabel}</button><span className="dp-dim">{recipe ? "Then save it as the next version if you like it." : ""}</span></p>}
        </div>
      )}
    </div>
  );
}
