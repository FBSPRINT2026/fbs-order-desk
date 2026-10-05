import type { Station } from "@/lib/production";
import type { Slot } from "@/lib/pressSetup";

/**
 * The suggested press layout for a separation: which screen on which head, where the flashes go, which heads stay
 * empty. Built from how printers set up wet-on-wet jobs:
 *   - underbase first, then a flash, then (when there's room) an empty head so the pallet and the flashed base cool
 *     before the next screen (a hot, tacky base builds ink up on the next screens);
 *   - the colors lightest to darkest, smaller areas before bigger ones (a later screen touches every wet color before
 *     it, so the big wet areas should be the last ones it has to cross), detail and black late, highlight white last;
 *   - a flash before a light color that prints on top of a darker wet color (light over dark wet goes muddy);
 *   - the roller (a dead screen that flattens the flashed base) comes after the flash, before the colors;
 *   - the press's own flashes, roller and cool-down stations stay where they are unless a flash has to move;
 *   - screens on the heads nearest the load and unload stations, where the operator can watch the inks; the empty
 *     heads on the far side of the press.
 */
export type PlanPlate = { key: string; name: string; hex: string; kind: string; coverage: number; tonal?: boolean };
export type PressPlan = { heads: Slot[]; order: string[]; why: string[]; ok: boolean };

const lum = (hex: string) => {
  const n = parseInt(hex.replace("#", ""), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; });
  const Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return 116 * (Y > 0.008856 ? Math.cbrt(Y) : 7.787 * Y + 16 / 116) - 16; // L* 0–100
};

/** how much of each screen's ink sits on another's: ov[i][j] = share of j's ink area that is also i's ink */
export function overlaps(alphas: Uint8Array[], step = 4): number[][] {
  const n = alphas.length, len = alphas[0]?.length || 0, area = new Array(n).fill(0), both = alphas.map(() => new Array(n).fill(0));
  for (let p = 0; p < len; p += step) {
    const on: number[] = [];
    for (let i = 0; i < n; i++) if (alphas[i][p] > 110) { on.push(i); area[i]++; }
    for (const i of on) for (const j of on) if (i !== j) both[i][j]++;
  }
  return both.map((row) => row.map((v, j) => (area[j] ? v / area[j] : 0)));
}

/**
 * The print order: underbase, colors light → dark (bigger areas a little later), black last of the colors, highlight
 * white last. A color that sits on top of another in the art (most of it lands on the other's ink, and it's the
 * smaller of the two: white type on a red block) prints after it, whatever its shade.
 */
export function printSequence(plates: PlanPlate[], ov?: number[][], all: PlanPlate[] = plates): PlanPlate[] {
  const base = plates.filter((p) => p.kind === "underbase"), top = plates.filter((p) => p.kind === "highlight");
  const colors = plates.filter((p) => p.kind !== "underbase" && p.kind !== "highlight");
  const key = (p: PlanPlate) => (lum(p.hex) < 18 ? 200 : 0) + (100 - lum(p.hex)) + 25 * Math.min(1, p.coverage * 2.5);
  const at = (p: PlanPlate) => all.indexOf(p);
  // a before b when b sits on a
  const on = (a: PlanPlate, b: PlanPlate) => !!ov && (ov[at(a)]?.[at(b)] || 0) > 0.5 && b.coverage < a.coverage;
  const left = [...colors], out: PlanPlate[] = [];
  while (left.length) {
    const free = left.filter((b) => !left.some((a) => a !== b && on(a, b)));
    const pick = (free.length ? free : left).sort((a, b) => key(a) - key(b))[0];
    out.push(pick); left.splice(left.indexOf(pick), 1);
  }
  return [...base, ...out, ...top];
}

export function recommendSetup(lay: Station[], plates: PlanPlate[], o: { dark: boolean; ov?: number[][]; allPlates?: PlanPlate[] }): PressPlan {
  const N = lay.length, why: string[] = [];
  const seq = printSequence(plates, o.ov, o.allPlates || plates);
  const hasBase = seq.some((p) => p.kind === "underbase");
  const idx = (p: PlanPlate) => (o.allPlates || plates).indexOf(p);
  const units = lay.filter((s) => s === "flash" || s === "flashdown").length;
  // the items to place in order: screens and the flashes they need
  type Item = { t: "screen"; p: PlanPlate } | { t: "flash"; why: string; must: boolean };
  const items: Item[] = [];
  seq.forEach((p, k) => {
    if (k > 0) {
      const prev = seq[k - 1];
      if (prev.kind === "underbase") items.push({ t: "flash", why: `Flash after the underbase so the colors print on a dry, bright base${o.dark ? " (dark shirt)" : ""}.`, must: true });
      else if (p.kind !== "highlight" && o.ov) {
        // a lighter color printed on top of a darker one still wet: flash before it
        const wet = seq.slice(0, k).filter((q) => q.kind !== "underbase" && lum(q.hex) + 15 < lum(p.hex) && (o.ov![idx(q)]?.[idx(p)] || 0) > 0.25);
        const sinceFlash = items.slice(items.map((x) => x.t).lastIndexOf("flash") + 1).filter((x) => x.t === "screen").map((x) => (x as { p: PlanPlate }).p);
        const hit = wet.find((q) => sinceFlash.includes(q));
        if (hit) items.push({ t: "flash", why: `Flash before ${p.name}: it prints on top of ${hit.name} while that's still wet (light over dark goes muddy).`, must: false });
      }
    }
    items.push({ t: "screen", p });
  });
  // more flashes than the press has: keep the underbase flash, drop the others (and say so)
  let fl = items.filter((x) => x.t === "flash").length;
  for (let i = items.length - 1; i >= 0 && fl > units; i--) { const x = items[i]; if (x.t === "flash" && !x.must) { why.push(`Wanted a flash before the next color (${x.why.split(":")[0].replace("Flash before ", "")}) but the press has ${units} flash unit${units === 1 ? "" : "s"}: print it wet-on-wet with light pressure, or two passes.`); items.splice(i, 1); fl--; } }

  // place them on the heads: the press's flashes, roller and cool-down stations stay; screens near load / unload
  const roller = lay.indexOf("roller");
  const vis = (h: number) => Math.min(h, N - 1 - h);
  type St = { cost: number; moved: number; skipped: number; prev: St | null; h: number; put: Slot | null };
  const INF = 1e9;
  const key = (k: number, mv: number, sk: number, pf: number) => `${k}|${mv}|${sk}|${pf}`;
  let layer = new Map<string, St & { k: number; mv: number; sk: number; pf: number }>();
  layer.set(key(0, 0, 0, 0), { cost: 0, moved: 0, skipped: 0, prev: null, h: -1, put: null, k: 0, mv: 0, sk: 0, pf: 0 });
  const add = (m: typeof layer, s: St & { k: number; mv: number; sk: number; pf: number }) => { const kk = key(s.k, s.mv, s.sk, s.pf), cur = m.get(kk); if (!cur || s.cost < cur.cost) m.set(kk, s); };
  for (let h = 0; h < N; h++) {
    const next = new Map<string, St & { k: number; mv: number; sk: number; pf: number }>();
    const st = lay[h];
    for (const s of layer.values()) {
      const base = { prev: s, h, moved: s.mv, skipped: s.sk };
      const it = items[s.k];
      if (st === "down") { add(next, { ...base, cost: s.cost, put: "down", k: s.k, mv: s.mv, sk: s.sk, pf: 0 }); continue; }
      if (st === "roller" || st === "cool") {
        // a dead head right after a flash is the cool-down the base needs
        add(next, { ...base, cost: s.cost - (s.pf ? 3 : 0), put: st, k: s.k, mv: s.mv, sk: s.sk, pf: 0 });
        // a big job can use it for a screen (the roller comes off / no cool-down there), when there's no other room
        if (it?.t === "screen") add(next, { ...base, cost: s.cost + vis(h) + (st === "roller" ? 12 : 8) + (s.pf ? 3 : 0), put: "p:" + it.p.key, k: s.k + 1, mv: s.mv, sk: s.sk, pf: 0 });
        continue;
      }
      if (st === "flash" || st === "flashdown") {
        if (it?.t === "flash") add(next, { ...base, cost: s.cost, put: "flash", k: s.k + 1, mv: s.mv, sk: s.sk, pf: 1 });
        // not needed here: the flash comes off (or is turned off) and the head stays empty, or takes a screen
        add(next, { ...base, cost: s.cost + 1 - (s.pf ? 3 : 0), put: "", k: s.k, mv: s.mv, sk: s.sk + 1, pf: 0 });
        if (it?.t === "screen") add(next, { ...base, cost: s.cost + vis(h) + 5 + (s.pf ? 3 : 0), put: "p:" + it.p.key, k: s.k + 1, mv: s.mv, sk: s.sk + 1, pf: 0 });
        continue;
      }
      // a free head: leave it empty, or put the next item on it
      add(next, { ...base, cost: s.cost - (s.pf ? 3 : 0), put: "", k: s.k, mv: s.mv, sk: s.sk, pf: 0 });
      if (it?.t === "screen") {
        const beforeRoller = hasBase && roller >= 0 && h < roller && it.p.kind !== "underbase" ? 4 : 0;
        // (a hair more for later heads: on a tie, the screens stay together)
        add(next, { ...base, cost: s.cost + vis(h) + h * 0.01 + (s.pf ? 3 : 0) + beforeRoller, put: "p:" + it.p.key, k: s.k + 1, mv: s.mv, sk: s.sk, pf: 0 });
      } else if (it?.t === "flash") {
        add(next, { ...base, cost: s.cost + 6, put: "flash", k: s.k + 1, mv: s.mv + 1, sk: s.sk, pf: 1 });
      }
    }
    layer = next;
  }
  let best: (St & { k: number; mv: number; sk: number }) | null = null;
  for (const s of layer.values()) if (s.k === items.length && s.mv <= s.sk && (!best || s.cost < best.cost)) best = s;
  if (!best) return { heads: [], order: seq.map((p) => p.key), why: [`${seq.length} screens and ${fl} flash${fl === 1 ? "" : "es"} don't fit on ${N} heads: two rounds, or another press.`], ok: false };
  const heads: Slot[] = new Array(N).fill("");
  for (let s: St | null = best; s && s.h >= 0; s = s.prev) heads[s.h] = s.put ?? "";

  // why, in shop words
  const names = (ps: PlanPlate[]) => ps.map((p) => p.name).join(", ");
  const cols = seq.filter((p) => p.kind !== "underbase" && p.kind !== "highlight");
  if (seq[0]?.kind === "underbase") why.unshift(`Underbase on head ${heads.indexOf("p:" + seq[0].key) + 1}, then the flash.`);
  const fh = heads.findIndex((x) => x === "flash");
  if (fh >= 0 && fh + 1 < N && !heads[fh + 1].startsWith("p:")) why.push(`Head ${fh + 2} stays empty after the flash so the pallet and base cool before the next screen (a hot, tacky base builds ink up on the screens).`);
  if (cols.length > 1) why.push(`Colors lightest to darkest, smaller areas before bigger ones, black last: ${names(cols)}${seq.some((p) => p.kind === "highlight") ? "; highlight white last" : ""}.`);
  if (o.ov) for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
    const a = cols[i], b = cols[j];
    if ((o.ov[idx(a)]?.[idx(b)] || 0) > 0.5 && b.coverage < a.coverage && lum(b.hex) > lum(a.hex) + 15) why.push(`${b.name} prints after ${a.name} because it sits on top of it.`);
  }
  for (const x of items) if (x.t === "flash" && !x.must) why.push(x.why);
  const mv = heads.map((x, i) => (x === "flash" && lay[i] !== "flash" && lay[i] !== "flashdown" ? i + 1 : 0)).filter(Boolean);
  if (mv.length) why.push(`Moves a flash to head ${mv.join(" and ")} for this job.`);
  if (roller >= 0 && heads[roller] === "roller" && hasBase) why.push(`Roller stays on head ${roller + 1}: it flattens the flashed base before the colors.`);
  const took = heads.map((x, i) => (x.startsWith("p:") && lay[i] !== "print" ? `head ${i + 1} (${lay[i] === "roller" ? "roller off" : lay[i] === "cool" ? "no cool-down there" : "flash off"})` : "")).filter(Boolean);
  if (took.length) why.push(`Not enough open heads, so a screen goes on ${took.join(" and ")}.`);
  const empty = heads.map((x, i) => (x === "" && (lay[i] === "print" || lay[i] === "flash") ? i + 1 : 0)).filter(Boolean);
  if (empty.length) why.push(`Screens kept by the load and unload stations where the operator can see the inks; ${empty.length === 1 ? `head ${empty[0]}` : `heads ${empty.slice(0, -1).join(", ")} and ${empty[empty.length - 1]}`} left open on the far side.`);
  return { heads, order: seq.map((p) => p.key), why, ok: true };
}
