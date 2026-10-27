import type { SupabaseClient } from "@supabase/supabase-js";
import { designOther, SIZES, type Design, type Garment, type Group, type Imprint } from "@/lib/pricing";
import { guessHex, garmentHex, registerAreas, spotFor } from "@/lib/mockup";
import { bodyAt, bodyOf, smallestOrdered, sortSizes } from "@/lib/garmentBody";

/**
 * How an order group's prints look, for the papers and screens that show them (the work order, the invoice, the
 * customer's art review): its designs, the shirt color behind the art, and the largest each print can be on the
 * smallest size ordered (one screen prints every size).
 */
export type MaxArea = { w: number; h: number; on: string } | null;
type Cat = Pick<Garment, "style" | "sizes" | "specs" | "color_images">;

export async function loadGroupLook(admin: SupabaseClient, groups: Group[]) {
  // custom spots (a typed location with its own area) sized like any other (lib/mockup.ts registerAreas)
  registerAreas(groups.flatMap((g) => g.imprints || []));
  const dIds = [...new Set(groups.flatMap((g) => g.imprints.map((d) => d.design_id).filter(Boolean) as string[]))];
  const styles = [...new Set(groups.flatMap((g) => g.lines.map((l) => (l.style || "").trim()).filter(Boolean)))];
  const [{ data: dz }, { data: gz }] = await Promise.all([
    dIds.length ? admin.from("designs").select("*").in("id", dIds) : Promise.resolve({ data: [] }),
    styles.length ? admin.from("garments").select("style, sizes, specs, color_images").in("style", styles) : Promise.resolve({ data: [] }),
  ]);
  const designs: Record<string, Design> = Object.fromEntries(((dz || []) as Design[]).map((d) => [d.id, d]));
  const cat = (gz || []) as Cat[];
  const garOf = (style: string) => cat.find((x) => x.style.toLowerCase() === (style || "").trim().toLowerCase()) || null;
  const key = (c: string) => (c || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const hexes = groups.map((g) => {
    const l = g.lines.find((x) => (x.style || "").trim()) || g.lines[0];
    if (!l) return "#9aa1ab";
    const ci = Object.entries(garOf(l.style)?.color_images || {}).find(([k]) => key(k) === key(l.color))?.[1];
    return garmentHex(ci?.hex, l.color) || "#9aa1ab";
  });
  /** every garment color's own shirt color (lower-case letters and digits → hex): a color change's close-ups (Oct 26) */
  const colorHexes: Record<string, string> = {};
  for (const g of groups) for (const l of g.lines) {
    if (!l.color || colorHexes[key(l.color)]) continue;
    const ci = Object.entries(garOf(l.style)?.color_images || {}).find(([k]) => key(k) === key(l.color))?.[1];
    const h = garmentHex(ci?.hex, l.color);
    if (h) colorHexes[key(l.color)] = h;
  }
  const maxes: MaxArea[][] = groups.map((g) => {
    const l = g.lines.find((x) => (x.style || "").trim()) || g.lines[0];
    const gar = l ? garOf(l.style) : null;
    const ordered = [...new Set(g.lines.flatMap((x) => SIZES.filter((z) => x.sizes?.[z])))] as string[];
    const run = sortSizes(ordered);
    const shown = g.mockupSize && run.includes(g.mockupSize) ? bodyAt(gar, g.mockupSize) : bodyOf(gar, run);
    const b = smallestOrdered(gar, ordered, shown) || shown;
    return g.imprints.map((d) => {
      if (!d.location) return null;
      const sp = spotFor(d.location, b);
      return sp.maxW && sp.maxH ? { w: sp.maxW, h: sp.maxH, on: b.kind === "adult" ? "" : b.size } : null;
    });
  });
  /** the size the mockup is shown on (the middle of the run, or the one picked in the Mockup Creator) */
  const shownSizes = groups.map((g) => {
    const l = g.lines.find((x) => (x.style || "").trim()) || g.lines[0];
    const ordered = [...new Set(g.lines.flatMap((x) => SIZES.filter((z) => x.sizes?.[z])))] as string[];
    const run = sortSizes(ordered);
    return g.mockupSize && run.includes(g.mockupSize) ? g.mockupSize : bodyOf(l ? garOf(l.style) : null, run).size;
  });
  return { designs, hexes, maxes, shownSizes, colorHexes };
}

const fmtIn = (n: number) => (n ? `${+n.toFixed(2)}"` : `?"`);
/** the print's size in inches: the size typed ("8\" wide") and the other side from the art's proportions */
export function printSize(d: Imprint, des?: Design | null) {
  const m = (d.size || "").match(/^([\d.]+)\D*(wide|tall)?/i);
  const val = m ? +m[1] : 0, given: "W" | "H" = m && /tall/i.test(m[2] || "") ? "H" : "W";
  const other = des && val ? designOther(des, val, given) : 0;
  const w = given === "W" ? val : other, h = given === "W" ? other : val;
  return { w, h, label: val ? `${fmtIn(w)} × ${fmtIn(h)}` : d.size || "" };
}
