"use client";
import { useMemo, useState } from "react";
import { findThreads, threadByName, threadLabel } from "@/lib/embroidery";
import { sewVersions } from "@/lib/digitizeStatus";
import { needleThreads } from "@/lib/needleThreads";
import type { Worksheet } from "@/lib/worksheet";

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

/** the threads to ask about: each needle's thread (lib/needleThreads.ts: the worksheet's, else the order's), else the order's */
function rowsFor(file: SewFileLite | undefined, inks: string): SewnValue["threads"] {
  const ws = file?.ws?.threads?.length ? file.ws : null;
  if (ws) return needleThreads(ws as unknown as Worksheet, inks).map((t) => ({ needle: t.needle, ordered: t.label, sewn: t.label }));
  return (inks || "").split(/\s*,\s*/).filter(Boolean).map((n) => ({ ordered: n, sewn: n }));
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

/** a thread, typed or picked (Madeira or Isacord), with its color beside it */
function ThreadPick({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [q, setQ] = useState(value);
  const list = useMemo(() => (q.trim().length >= 2 ? [...findThreads(q, "Polyneon 40", 12), ...findThreads(q, "Isacord 40", 12)] : []), [q]);
  const cur = threadByName(value);
  return (
    <div className="swp">
      <div className="swp-f">
        <i className="swp-sw" style={{ background: cur?.hex || "#ccc" }} aria-hidden />
        <input id={id} type="text" list={`${id}-l`} value={q} placeholder="Type a thread number or color" onChange={(e) => { setQ(e.target.value); const t = threadByName(e.target.value); if (t) onChange(threadLabel(t)); }} onBlur={() => { const t = threadByName(q); if (t) setQ(threadLabel(t)); }} />
        <datalist id={`${id}-l`}>{list.map((t) => <option key={t.line + t.code} value={threadLabel(t)} />)}</datalist>
      </div>
    </div>
  );
}

/**
 * Only what was sewn: each needle's thread (Oct 29, Nick: "you're going too far… all we're trying to get from this screen
 * is… what we did… change the thread of what we did. And then any notes"). The stitch file is the one on the order.
 */
export default function SewnPanel({ value, onChange }: { ctx: SewCtx; value: SewnValue; onChange: (v: SewnValue) => void }) {
  return (
    <div className="swn">
      <div className="imp-l">What we sewed</div>
      {value.threads.map((t, i) => (
        <div className="field" key={`${t.needle || ""}-${i}`}>
          <label htmlFor={`swn-t${i}`}>{t.needle ? `Needle ${t.needle}` : value.threads.length > 1 ? `Thread ${i + 1}` : "Thread"}</label>
          <ThreadPick id={`swn-t${i}`} value={t.sewn} onChange={(v) => onChange({ ...value, threads: value.threads.map((x, j) => (j === i ? { ...x, sewn: v } : x)) })} />
        </div>
      ))}
      {!value.threads.length && <div className="faint" style={{ fontSize: 12.5 }}>No threads on the order for this print yet.</div>}
    </div>
  );
}
