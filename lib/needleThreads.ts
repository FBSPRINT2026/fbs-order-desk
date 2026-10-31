import { threadByName, threadLabel, threads as allThreads, type Thread } from "@/lib/embroidery";
import type { SheetThread, Stop, Worksheet } from "@/lib/worksheet";
import { guessHex } from "@/lib/mockup";

/**
 * THE thread on each needle of a stitch file, for every place that names or draws it: the digitizing page (its picture,
 * chips and sew sequence), the work order, the sew-out proof and the sew-out's "what we sewed" (Oct 29, Nick on #40188's
 * Embark E: the order says Madeira 1842 True Blue, the digitizing page drew it gray on gray as "8 Dark Blue · needle 8").
 *
 * - A worksheet with real threads (Madeira / Isacord charts): that thread.
 * - A worksheet on Wilcom's Default chart names no thread, only a color ("8 Dark Blue": the needle's slot and a color word;
 *   Nick: "sometimes they won't specify the thread and just indicate a color"). Each such needle gets the order's thread
 *   closest to that color (each order thread used once; in sew order when the color word says nothing). With fewer
 *   order threads than needles, the rest are drawn in the color the worksheet says.
 * - No worksheet: the order's threads in turn.
 * - A needle with our own thread (SheetThread.ours: picked on the logo's page, or the client's standard thread for that logo
 *   color, Oct 31): that thread, whatever the sheet said (the digitizer picks from their chart, not our wall).
 * `sewn` (needle → thread name) is what was actually sewn, when a sew-out recorded it, and wins.
 */
export type NeedleThread = { needle: number; label: string; hex: string; thread: Thread | null; from: "sheet" | "order" | "default" | "ours";
  /** "ours": what the worksheet said instead ("Madeira 1800 Black") and whether staff picked it or the client's standard did */ sheet?: string; why?: "staff" | "standard" };

const isDefault = (chart: string) => /^default$/i.test(chart || "");
const lineOf = (chart: string): Thread["line"] => (/isacord/i.test(chart) ? "Isacord 40" : /classic|rayon/i.test(chart) ? "Classic Rayon 40" : "Polyneon 40");
export const sheetThread = (x: Pick<SheetThread, "code" | "chart">): Thread | null => (isDefault(x.chart) ? null : allThreads().find((t) => t.line === lineOf(x.chart) && t.code === x.code) || null);
const orderThreads = (inks: string) => (inks || "").split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
/** a default-chart name's color ("Dark Blue", "Black"), else gray */
const defaultHex = (name: string) => guessHex(name || "") || "#9aa1ab";

function fromName(n: string, needle: number, from: NeedleThread["from"]): NeedleThread {
  const t = threadByName(n);
  return { needle, label: t ? threadLabel(t) : n, hex: t?.hex || guessHex(n), thread: t, from };
}

export function needleThreads(ws: Worksheet | null | undefined, inks: string, sewn?: Record<number, string> | null): NeedleThread[] {
  const ordered = orderThreads(inks);
  if (!ws?.threads?.length) return ordered.map((n, i) => (sewn?.[i + 1] ? fromName(sewn[i + 1], i + 1, "order") : fromName(n, i + 1, "order")));
  // the Default chart's needles: the order's thread nearest each one's color word, each used once
  const rgb = (h: string) => { const v = parseInt((h || "#9aa1ab").slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  const dist = (a: string, b: string) => { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
  const left = ordered.map((n) => ({ n, hex: threadByName(n)?.hex || guessHex(n) }));
  const pickFor = (name: string) => {
    if (!left.length) return "";
    const want = defaultHex(name);
    const i = want === "#9aa1ab" ? 0 : left.reduce((b, c, j) => (dist(c.hex, want) < dist(left[b].hex, want) ? j : b), 0);
    return left.splice(i, 1)[0].n;
  };
  return ws.threads.map((x) => {
    if (sewn?.[x.needle]) return fromName(sewn[x.needle], x.needle, "order");
    // the thread we really run (picked on the logo's page, or the client's standard for that color) wins over the sheet
    if (x.ours) { const st = sheetThread(x); return { ...fromName(x.ours, x.needle, "ours"), sheet: st ? threadLabel(st) : `${x.code}${x.name ? ` ${x.name}` : ""}`, why: x.oursFrom || "staff" }; }
    if (!isDefault(x.chart)) {
      const t = sheetThread(x);
      return { needle: x.needle, label: t ? threadLabel(t) : `${x.code}${x.name ? ` ${x.name}` : ""}`, hex: t?.hex || defaultHex(x.name), thread: t, from: "sheet" };
    }
    const n = pickFor(x.name);
    if (n) return fromName(n, x.needle, "order");
    return { needle: x.needle, label: `${x.name || "No thread named"} (worksheet color)`, hex: defaultHex(x.name), thread: null, from: "default" };
  });
}

/** each color stop's color, for drawing the DST (the stops' needles → the threads on them; no worksheet: the threads in turn) */
export function stopColors(ws: Worksheet | null | undefined, inks: string, sewn?: Record<number, string> | null): string[] {
  const nt = needleThreads(ws, inks, sewn);
  if (!ws?.sequence?.length) return nt.map((t) => t.hex);
  const by = new Map(nt.map((t) => [t.needle, t.hex]));
  return ws.sequence.map((s: Stop) => by.get(s.needle) || (isDefault(s.chart) ? defaultHex(s.name) : sheetThread(s)?.hex || "#333333"));
}
