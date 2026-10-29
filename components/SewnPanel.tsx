"use client";
import { useMemo, useState } from "react";
import { closestThreads, findThreads, threadByName, threadKey, threadLabel, type Thread } from "@/lib/embroidery";
import { sewVersions } from "@/lib/digitizeStatus";

/**
 * "What we sewed", next to the sew-out photo (Oct 29, Nick: "we sewed out 1739 and we used a different thread… we might
 * not even have the thread in stock… so we use something close. Used another brand. So then we go in, select the real
 * thread we used. It needs to go back and change it on the order form"). The stitch file version sewn (its size and
 * stitches) and, for each needle, the thread ordered and the thread sewn: any Madeira or Isacord thread, with the closest
 * ones on the wall offered first. What differs from the order is listed, and saving changes the order to match
 * (lib/sewouts.ts saveSewout).
 */
export type SewFileLite = { path: string; name: string; wIn: number; hIn: number; stitches: number; at?: string; ws?: { threads?: { needle: number; code: string; name: string; chart?: string }[] } | null };
export type SewCtx = { files: SewFileLite[]; current?: string; inks: string; size: string; stitches?: number; stock: string[] };
export type SewnValue = { filePath: string; threads: { needle?: number; ordered: string; sewn: string }[] };

const inch = (n: number) => `${Math.round(n * 100) / 100}"`;
const day = (s?: string) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" }) : "");
const widthOf = (size: string) => { const m = /(\d+(?:\.\d+)?)/.exec(size || ""); return m ? +m[1] : null; };

/** the threads to ask about: the file's needles (from the digitizer's worksheet), else the order's threads */
function rowsFor(file: SewFileLite | undefined, inks: string): SewnValue["threads"] {
  const ordered = (inks || "").split(/\s*,\s*/).filter(Boolean);
  const ws = file?.ws?.threads || [];
  if (ws.length) return ws.map((t) => {
    const mine = ordered.find((n) => threadByName(n)?.code === t.code);
    const th = threadByName(`${/isacord/i.test(t.chart || "") ? "Isacord" : "Madeira"} ${t.code}`);
    const label = mine || (th ? threadLabel(th) : `${t.code} ${t.name}`);
    return { needle: t.needle, ordered: label, sewn: label };
  });
  return ordered.map((n) => ({ ordered: n, sewn: n }));
}
export function startSewn(ctx: SewCtx): SewnValue {
  const v = sewVersions(ctx.files);
  const file = v.find((f) => f.path === ctx.current) || v[v.length - 1];
  return { filePath: file?.path || "", threads: rowsFor(file, ctx.inks) };
}

/** what saving will change on the order (the same rules as the server) */
export function sewnChanges(ctx: SewCtx, val: SewnValue): string[] {
  const out: string[] = [];
  for (const t of val.threads) if (t.sewn.trim() && t.sewn.trim().toLowerCase() !== t.ordered.toLowerCase()) out.push(`Thread${t.needle ? ` (needle ${t.needle})` : ""}: ${t.ordered} → ${t.sewn.trim()}`);
  const f = ctx.files.find((x) => x.path === val.filePath);
  if (f) {
    const w = widthOf(ctx.size);
    if (f.wIn && (w === null || Math.abs(w - f.wIn) > 0.05)) out.push(`Size: ${ctx.size || "not set"} → ${inch(f.wIn)} wide`);
    if (f.stitches && f.stitches !== ctx.stitches) out.push(`Stitches: ${ctx.stitches ? ctx.stitches.toLocaleString() : "estimate"} → ${f.stitches.toLocaleString()}`);
  }
  return out;
}

function ThreadPick({ id, value, ordered, stock, onChange }: { id: string; value: string; ordered: string; stock: Set<string>; onChange: (v: string) => void }) {
  const [q, setQ] = useState(value);
  const base = threadByName(ordered);
  // the closest threads we carry, from both brands, best first
  const near = useMemo(() => {
    if (!base) return [] as (Thread & { dE: number; word: string; stocked: boolean })[];
    const all = [...closestThreads(base.hex, { line: "Polyneon 40", stock, n: 6 }), ...closestThreads(base.hex, { line: "Isacord 40", stock, n: 6 })]
      .filter((t) => !(t.line === base.line && t.code === base.code));
    return all.sort((a, b) => Number(b.stocked) - Number(a.stocked) || a.dE - b.dE).slice(0, 3);
  }, [base, stock]);
  const list = useMemo(() => (q.trim().length >= 2 ? [...findThreads(q, "Polyneon 40", 12), ...findThreads(q, "Isacord 40", 12)] : []), [q]);
  const cur = threadByName(value);
  const set = (v: string) => { setQ(v); onChange(v); };
  const inStock = base ? stock.has(threadKey(base.line, base.code)) : true;
  return (
    <div className="swp">
      <div className="swp-f">
        <i className="swp-sw" style={{ background: cur?.hex || "#ccc" }} aria-hidden />
        <input id={id} type="text" list={`${id}-l`} value={q} placeholder="Type a thread number or color" onChange={(e) => { setQ(e.target.value); const t = threadByName(e.target.value); if (t) onChange(threadLabel(t)); }} onBlur={() => { const t = threadByName(q); if (t) setQ(threadLabel(t)); }} />
        <datalist id={`${id}-l`}>{list.map((t) => <option key={t.line + t.code} value={threadLabel(t)} />)}</datalist>
      </div>
      <div className="swp-was">Ordered: {ordered}{base && stock.size > 0 && !inStock ? " (not on the wall)" : ""}</div>
      <div className="swp-sug">
        {near.map((t) => { const l = threadLabel(t); return <button key={l} type="button" className={"swp-chip" + (l === value ? " on" : "")} onClick={() => set(l)}><i className="swp-sw" style={{ background: t.hex }} aria-hidden />{l.replace(/^Madeira /, "")} · {t.word}{t.stocked ? " · in stock" : ""}</button>; })}
        {value !== ordered && <button type="button" className="swp-chip" onClick={() => set(ordered)}>As ordered</button>}
      </div>
    </div>
  );
}

export default function SewnPanel({ ctx, value, onChange }: { ctx: SewCtx; value: SewnValue; onChange: (v: SewnValue) => void }) {
  const stock = useMemo(() => new Set(ctx.stock), [ctx.stock]);
  const versions = useMemo(() => sewVersions(ctx.files), [ctx.files]);
  const changes = sewnChanges(ctx, value);
  return (
    <div className="swn">
      <div className="imp-l">What we sewed</div>
      {versions.length > 0 && <div className="field"><label htmlFor="swn-file">Stitch file sewn</label>
        <select id="swn-file" value={value.filePath} onChange={(e) => { const f = versions.find((x) => x.path === e.target.value); onChange({ filePath: e.target.value, threads: rowsFor(f, ctx.inks).map((r) => ({ ...r, sewn: value.threads.find((t) => t.ordered === r.ordered)?.sewn || r.sewn })) }); }}>
          {[...versions].reverse().map((f) => <option key={f.path} value={f.path}>Version {f.v} · {inch(f.wIn)} × {inch(f.hIn)} · {f.stitches.toLocaleString()} stitches · {day(f.at)}</option>)}
        </select></div>}
      {value.threads.map((t, i) => (
        <div className="field" key={`${t.needle || ""}-${i}`}>
          <label htmlFor={`swn-t${i}`}>{t.needle ? `Needle ${t.needle} · ` : ""}Thread sewn</label>
          <ThreadPick id={`swn-t${i}`} value={t.sewn} ordered={t.ordered} stock={stock} onChange={(v) => onChange({ ...value, threads: value.threads.map((x, j) => (j === i ? { ...x, sewn: v } : x)) })} />
        </div>
      ))}
      {!value.threads.length && <div className="faint" style={{ fontSize: 12.5 }}>No threads on the order for this print yet.</div>}
      {changes.length > 0 && <div className="swn-chg"><b>Saving changes the order to match what was sewn:</b>{changes.map((c) => <div key={c}>{c}</div>)}</div>}
    </div>
  );
}
