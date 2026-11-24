"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { r1 } from "@/lib/draftpunk/calc";
import { fmtDate } from "@/lib/draftpunk/defaults";
import { entryScore, MEDAL_LABEL, type Sheet } from "@/lib/draftpunk/judging";
import type { Proposal } from "@/lib/draftpunk/proposal";
import { saveVersion, versionsOf, type Version } from "@/lib/draftpunk/recipeStore";
import type { Recipe } from "@/lib/draftpunk/types";
import { autoNote, diffRecipes } from "@/lib/draftpunk/versions";
import Assistant from "./Assistant";
import { Win } from "./ui";

type Brew = { id: string; brewed_on: string; version_id: string | null; recipe_snapshot: Recipe; notes: string };
type Entry = { id: string; competition: string; held_on: string | null; version_id: string | null; scores: Sheet[]; place: string };
export type Status = "developing" | "dialed" | "retired";

/**
 * A recipe's life (Nick, Nov 24 2026: "these recipes are a living breathing thing… you'll continue to make a recipe
 * until you've got it completely awesome"): where it is (developing, dialed in, retired), what the working copy has
 * changed since the last version, every version with why and what changed, the brews and competition results under
 * each, the scores over time, and the assistant's next version from the scoresheets.
 */
export default function Versions({ recipeId, userId, r, owner, status, goal, onStatus, onGoal, onRestore, onApply, refreshKey }: {
  recipeId: string; userId: string; r: Recipe; owner: boolean; status: Status; goal: "house" | "competition";
  onStatus: (s: Status) => void; onGoal: (g: "house" | "competition") => void; onRestore: (data: Recipe, num: number) => void; onApply: (p: Proposal) => void; refreshKey?: number;
}) {
  const [vers, setVers] = useState<Version[] | null>(null);
  const [brews, setBrews] = useState<Brew[]>([]);
  const [ents, setEnts] = useState<Entry[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [cmp, setCmp] = useState<[number, number] | null>(null);
  const [asst, setAsst] = useState(false);
  const load = async () => {
    const sb = createClient();
    const [v, { data: b }, { data: e }] = await Promise.all([
      versionsOf(recipeId),
      sb.from("dp_brews").select("id, brewed_on, version_id, recipe_snapshot, notes").eq("recipe_id", recipeId).order("brewed_on"),
      sb.from("dp_entries").select("id, competition, held_on, version_id, scores, place").eq("recipe_id", recipeId).order("held_on"),
    ]);
    setVers(v); setBrews((b || []) as Brew[]); setEnts((e || []) as Entry[]);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [recipeId, refreshKey]);

  const last = vers?.[vers.length - 1];
  const pending = useMemo(() => (last ? diffRecipes(last.data, r) : []), [last, r]);
  const saveNew = async () => {
    setBusy(true);
    const res = await saveVersion(recipeId, userId, r, note || (last ? autoNote(pending) : "First version"));
    setBusy(false);
    if (res.version) { setNote(""); load(); }
  };

  // scores over time, oldest first, each point labeled with its version
  const vnum = (id: string | null) => vers?.find((v) => v.id === id)?.num;
  const scored = ents.map((e) => ({ ...e, score: entryScore(e.scores) })).filter((e) => e.score > 0);

  if (!vers) return <p className="dp-dim">Loading versions…</p>;
  return (
    <>
      <Win title="Where this recipe is">
        <div className="dp-row" style={{ gap: 12 }}>
          <span className="dp-seg" role="group" aria-label="Status">
            {([["developing", "Developing"], ["dialed", "Dialed in"], ["retired", "Retired"]] as const).map(([k, l]) => <button key={k} type="button" disabled={!owner} className={status === k ? "on" : ""} onClick={() => onStatus(k)}>{l}</button>)}
          </span>
          <span className="dp-seg" role="group" aria-label="Brewed for">
            {([["house", "House beer"], ["competition", "Competition"]] as const).map(([k, l]) => <button key={k} type="button" disabled={!owner} className={goal === k ? "on" : ""} onClick={() => onGoal(k)}>{l}</button>)}
          </span>
        </div>
        <p className="dp-dim" style={{ marginBottom: 0 }}>Competition aims the gravity and bitterness targets at what wins. Dialed in recipes teach the style targets too.</p>
      </Win>

      {owner && (
        <Win title={last ? `Working copy · changes since v${last.num}` : "Working copy"} note={last ? (pending.length ? `${pending.length} change${pending.length === 1 ? "" : "s"}` : "same as v" + last.num) : "no versions yet"}>
          {!last && <p>Save it as v1 when it's ready to brew. Every brew then says which version it used.</p>}
          {!!pending.length && <ul className="dp-list">{pending.map((l) => <li key={l}>{l}</li>)}</ul>}
          {(!last || pending.length > 0) && (
            <div className="dp-row">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={last ? `Why? (blank: "${autoNote(pending)}")` : "First version"} style={{ flex: "1 1 260px" }} aria-label="Why this version" />
              <button className="dp-btn dp-go" disabled={busy} onClick={saveNew}>Save as v{(last?.num || 0) + 1}</button>
              {last && <button className="dp-btn" onClick={() => onRestore(last.data, last.num)}>Throw away, back to v{last.num}</button>}
            </div>
          )}
          {last && !pending.length && <p className="dp-dim" style={{ margin: 0 }}>Change anything and it shows here. Brew it as is, or save the changes as v{last.num + 1}. Changes you only make for one brew stay on that brew.</p>}
        </Win>
      )}

      {scored.length > 0 && (
        <Win title="Scores over time" note={`${scored.length} scored entr${scored.length === 1 ? "y" : "ies"}`}>
          <ScoreChart points={scored.map((e) => ({ label: `${e.competition}${vnum(e.version_id) ? ` · v${vnum(e.version_id)}` : ""}`, score: e.score, place: e.place, date: e.held_on || "" }))} />
        </Win>
      )}

      <Win title="Suggest the next version" note="from the scoresheets, brew notes and what wins">
        {asst || !owner ? <Assistant mode="next" recipe={r} recipeId={recipeId} onApply={onApply} /> : (
          <p className="dp-row" style={{ margin: 0 }}><button className="dp-btn dp-go" onClick={() => setAsst(true)}>Ask the assistant</button><span className="dp-dim">It reads every judge's comments on this recipe and says what to change and why.</span></p>
        )}
      </Win>

      <Win title="Versions" note={vers.length ? `${vers.length} · newest first` : undefined}>
        {!vers.length && <p className="dp-dim">No versions yet.</p>}
        {vers.length > 1 && (
          <div className="dp-row" style={{ marginBottom: 10 }}>
            <span className="dp-dim">Compare</span>
            <select value={cmp?.[0] ?? ""} onChange={(e) => setCmp([Number(e.target.value), cmp?.[1] ?? last!.num])} aria-label="From version"><option value="">v…</option>{vers.map((v) => <option key={v.id} value={v.num}>v{v.num}</option>)}</select>
            <span className="dp-dim">with</span>
            <select value={cmp?.[1] ?? ""} onChange={(e) => setCmp([cmp?.[0] ?? 1, Number(e.target.value)])} aria-label="To version"><option value="">v…</option>{vers.map((v) => <option key={v.id} value={v.num}>v{v.num}</option>)}<option value={0}>working copy</option></select>
          </div>
        )}
        {cmp && (() => {
          const a = vers.find((v) => v.num === cmp[0])?.data, b = cmp[1] === 0 ? r : vers.find((v) => v.num === cmp[1])?.data;
          const d = a && b ? diffRecipes(a, b) : [];
          return <div className="dp-note">{d.length ? <ul className="dp-list" style={{ margin: 0 }}>{d.map((l) => <li key={l}>{l}</li>)}</ul> : "No differences."}</div>;
        })()}
        {[...vers].reverse().map((v, i, arr) => {
          const prev = arr[i + 1];
          const vb = brews.filter((b) => b.version_id === v.id), ve = ents.filter((e) => e.version_id === v.id);
          const d = prev ? diffRecipes(prev.data, v.data) : [];
          return (
            <div key={v.id} className="dp-ver">
              <div className="dp-ver-h">
                <b>v{v.num}</b><span>{v.note}</span><span className="dp-dim">{fmtDate(v.made_on)}</span>
                {owner && <button className="dp-linkbtn" onClick={() => onRestore(v.data, v.num)}>{v.num === last?.num ? "Reset working copy to this" : "Go back to this"}</button>}
                {d.length > 0 && <button className="dp-linkbtn" onClick={() => setOpen(open === v.id ? null : v.id)}>{open === v.id ? "Hide" : `${d.length} change${d.length === 1 ? "" : "s"}`}</button>}
              </div>
              {open === v.id && <ul className="dp-list">{d.map((l) => <li key={l}>{l}</li>)}</ul>}
              {(vb.length > 0 || ve.length > 0) && (
                <div className="dp-ver-sub">
                  {vb.map((b) => { const t = diffRecipes(v.data, b.recipe_snapshot); return <Link key={b.id} href={`/draftpunk/brews/${b.id}`} className="dp-chip">Brewed {fmtDate(b.brewed_on)}{t.length ? ` · ${t.length} change${t.length === 1 ? "" : "s"} that day` : ""}</Link>; })}
                  {ve.map((e) => { const s = entryScore(e.scores); return <span key={e.id} className="dp-chip">{e.competition}{s ? ` · ${r1(s, 1)}` : ""}{e.place ? ` · ${MEDAL_LABEL[e.place as keyof typeof MEDAL_LABEL] || e.place}` : ""}</span>; })}
                </div>
              )}
            </div>
          );
        })}
      </Win>
    </>
  );
}

/** score by entry, oldest to newest, a line through them and the medals marked */
function ScoreChart({ points }: { points: { label: string; score: number; place: string; date: string }[] }) {
  const W = 640, H = 200, padL = 34, padR = 12, padT = 12, padB = 26;
  const lo = Math.max(0, Math.floor(Math.min(...points.map((p) => p.score)) / 5) * 5 - 5), hi = 50;
  const x = (i: number) => padL + (points.length === 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (points.length - 1));
  const y = (s: number) => padT + ((hi - s) * (H - padT - padB)) / (hi - lo);
  return (
    <svg className="dp-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Scores over time">
      {[lo, (lo + hi) / 2, hi].map((g) => <g key={g}><line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} className="dp-chart-grid" /><text x={padL - 6} y={y(g) + 4} textAnchor="end" className="dp-chart-t">{g}</text></g>)}
      {points.length > 1 && <polyline fill="none" className="dp-chart-line" points={points.map((p, i) => `${x(i)},${y(p.score)}`).join(" ")} />}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.score)} r={p.place && p.place !== "hm" ? 7 : 4.5} className={p.place && p.place !== "hm" ? `dp-chart-medal dp-medal-${p.place}` : "dp-chart-dot"}><title>{`${p.label} · ${r1(p.score, 1)}${p.place ? ` · ${p.place}` : ""}`}</title></circle>
          <text x={x(i)} y={H - 8} textAnchor="middle" className="dp-chart-t">{p.date ? fmtDate(p.date) : ""}</text>
        </g>
      ))}
    </svg>
  );
}
