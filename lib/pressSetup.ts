import type { Station } from "@/lib/production";

/**
 * How a separation is set up on a press: what goes on each head, so the press operator doesn't decide, he follows it.
 * Starts from the press's own layout (flashes and the roller that live there, heads that are down) with the screens
 * placed in print order (the underbase just before the first flash); the shop can then put any screen on any head,
 * leave heads empty so the print cools between hits, and add or move flashes and the roller for this job.
 *
 * A head is one of: "p:<plate key>" (a screen), "flash", "roller", "cool" (left empty on purpose), "" (free), or
 * "down" (out of service, from Equipment Status; can't be used).
 */
export type Slot = string;
export type PressSetup = { press: string; heads: Slot[]; at?: string };
export type SetupPlate = { key: string; name: string; hex: string; kind: string; mesh?: number };

export const plateOf = (s: Slot) => (s.startsWith("p:") ? s.slice(2) : null);
const fixedOf = (st: Station): Slot => (st === "flash" || st === "flashdown" ? "flash" : st === "roller" ? "roller" : st === "cool" ? "cool" : st === "down" ? "down" : "");

/**
 * The automatic setup: the press's flashes and roller where they live, the underbase on the free head just before the
 * first flash, the other screens on the free heads after it in print order. `spread`: leave a cool-down head between
 * screens when the press has room.
 */
export function autoSetup(lay: Station[], plates: SetupPlate[], spread = false): Slot[] {
  const heads: Slot[] = lay.map(fixedOf);
  const free = (i: number) => i >= 0 && i < heads.length && heads[i] === "";
  const seq = [...plates];
  let at = 0;
  if (seq[0]?.kind === "underbase") {
    const f = heads.findIndex((s, i) => s === "flash" && free(i - 1));
    if (f > 0) { heads[f - 1] = "p:" + seq.shift()!.key; at = f + 1; }
  }
  const room = heads.slice(at).filter((s) => s === "").length;
  const gap = spread && room >= seq.length * 2 - 1;
  for (let i = at; i < heads.length && seq.length; i++) {
    if (!free(i)) continue;
    heads[i] = "p:" + seq.shift()!.key;
    if (gap && seq.length && free(i + 1)) { heads[i + 1] = "cool"; i++; }
  }
  // didn't fit after the flash: the free heads before it (they print before the underbase; the check says so)
  for (let i = 0; i < heads.length && seq.length; i++) if (free(i)) heads[i] = "p:" + seq.shift()!.key;
  return heads;
}

/**
 * A saved setup made to fit the press and screens as they are now: heads that went down lose what was on them,
 * screens that no longer exist come off, and new screens go on the next free heads.
 */
export function fitSetup(saved: Slot[] | null | undefined, lay: Station[], plates: SetupPlate[]): { heads: Slot[]; off: SetupPlate[] } {
  if (!saved || saved.length !== lay.length) { const heads = autoSetup(lay, plates); return { heads, off: plates.filter((p) => !heads.includes("p:" + p.key)) }; }
  const keys = new Set(plates.map((p) => p.key));
  const heads = saved.map((s, i) => (lay[i] === "down" ? "down" : s === "down" ? fixedOf(lay[i]) : plateOf(s) && !keys.has(plateOf(s)!) ? "" : s));
  // a screen on two heads (shouldn't happen): keep the first
  const seen = new Set<string>();
  heads.forEach((s, i) => { const k = plateOf(s); if (k) { if (seen.has(k)) heads[i] = ""; else seen.add(k); } });
  const off: SetupPlate[] = [];
  for (const p of plates) {
    if (heads.includes("p:" + p.key)) continue;
    const last = Math.max(-1, ...heads.map((s, i) => (plateOf(s) ? i : -1)));
    let i = heads.findIndex((s, j) => s === "" && j > last);
    if (i < 0) i = heads.indexOf("");
    if (i < 0) off.push(p); else heads[i] = "p:" + p.key;
  }
  return { heads, off };
}

/** the screens in the order a pallet reaches them (head 1 first) */
export const printOrder = (heads: Slot[]) => heads.map(plateOf).filter((k): k is string => !!k);

/** the layout to draw: each head's kind (screens print) */
export const drawLayout = (heads: Slot[]): (Station | "cool")[] => heads.map((s) => (plateOf(s) ? "print" : s === "flash" ? "flash" : s === "roller" ? "roller" : s === "cool" ? "cool" : s === "down" ? "down" : "print"));

/**
 * Things the operator has to do differently from how the press usually sits (move a flash, put the roller on), and
 * problems with the setup (a color before the underbase, no flash after it, more flashes than the press has).
 */
export function checkSetup(heads: Slot[], lay: Station[], plates: SetupPlate[], dark: boolean) {
  const moves: string[] = [], warn: string[] = [];
  const list = (xs: number[]) => (xs.length === 1 ? `head ${xs[0]}` : `heads ${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  for (const kind of ["flash", "roller", "cool"] as const) {
    const usual = lay.flatMap((s, i) => (fixedOf(s) === kind ? [i + 1] : [])), now = heads.flatMap((s, i) => (s === kind ? [i + 1] : []));
    const add = now.filter((h) => !usual.includes(h)), take = usual.filter((h) => !now.includes(h));
    if (kind === "cool") {
      // nothing to move for an empty head: just say which heads stay empty this job, or get a screen
      if (add.length) moves.push(`Leave ${list(add)} empty (cool down)`);
      if (take.length) moves.push(`${list(take).replace(/^./, (ch) => ch.toUpperCase())}: usually a cool-down station, used for a screen this job`);
      continue;
    }
    const word = kind === "flash" ? "flash" : "roller screen";
    if (add.length && take.length && add.length === take.length) moves.push(`Move the ${word}${add.length > 1 ? "es" : ""} from ${list(take)} to ${list(add)}`);
    else {
      if (add.length) moves.push(`Put a ${word} on ${list(add)}`);
      if (take.length) moves.push(`Take the ${word}${take.length > 1 ? (kind === "flash" ? "es" : "s") : ""} off ${list(take)}${kind === "flash" ? " (or leave it off)" : ""}`);
    }
    if (kind === "flash") {
      const units = lay.filter((s) => s === "flash" || s === "flashdown").length;
      if (now.length > units) warn.push(`Uses ${now.length} flashes; this press has ${units} flash unit${units === 1 ? "" : "s"}.`);
    }
  }
  const base = plates.find((p) => p.kind === "underbase");
  if (base) {
    const b = heads.indexOf("p:" + base.key);
    if (b >= 0) {
      const before = heads.slice(0, b).map(plateOf).filter(Boolean);
      if (before.length) warn.push(`${before.length === 1 ? "A color prints" : `${before.length} colors print`} before the underbase.`);
      const next = heads.findIndex((s, i) => i > b && (plateOf(s) || s === "flash"));
      if (dark && next >= 0 && heads[next] !== "flash") warn.push("No flash between the underbase and the next color.");
    }
  }
  return { moves, warn };
}
