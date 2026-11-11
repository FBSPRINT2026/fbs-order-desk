/**
 * What an order's groups, garment lines and prints are made of (Nov 10, Nick: the AI order helper "is struggling with the
 * personalization… it's not using the add personalization tool": it wrote the names into a "personalization" field of
 * its own on each line, which nothing on the order reads, so the names showed nowhere and weren't charged). Every key
 * the order's types have, kept in step with them by the compiler (a new field on GLine, Imprint or Group fails the
 * typecheck until it's added here), so anything that writes an order freely (the order helper's edits) is checked
 * against what the order really has, and a made-up field is refused instead of quietly lost.
 */
import type { GLine, Group, Imprint } from "@/lib/pricing";

export const LINE_KEYS = { id: true, style: true, brand: true, garment: true, color: true, cost: true, hex: true, shade: true, sizes: true, priceOverride: true, spec: true, specialty: true, look: true, called: true, cw: true, note: true, extras: true, extrasPrint: true, extrasFree: true, shopUse: true, oneSize: true, ghost: true, sizeRun: true, sizeUp: true, sizeUpMarkup: true, sizeUpSet: true, prog: true, progOff: true, pers: true, persList: true } satisfies Record<keyof GLine, true>;
export const PRINT_KEYS = { shownArt: true, id: true, method: true, location: true, colors: true, inks: true, size: true, notes: true, inkChanges: true, youth: true, center: true, inkMap: true, stitches: true, emb: true, fromBrand: true, colorway: true, setupFrom: true, roster: true, colorwayBy: true, digitizeFee: true, digitized: true, sewoutCharge: true, artRatio: true, pms: true, pmsCharge: true, underbase: true, screens: true, visualOnly: true, remake: true, pressOnly: true, sample: true, rounds: true, byColor: true, film: true, sizeFrom: true, printStyle: true, distress: true, softHand: true, puff: true, specialInk: true, oversize: true, inkBy: true, spotBy: true, placeRef: true, area: true, custSeps: true, ok: true, supplied: true, patch: true, changeOf: true, fullColor: true, confirm: true, artChanges: true, confirmed: true, aiPlace: true, drop: true, design_id: true, keepLocation: true, sameAs: true } satisfies Record<keyof Imprint, true>;
export const GROUP_KEYS = { id: true, name: true, youthTogether: true, allIn: true, description: true, lines: true, imprints: true, finishing: true, mockupZoom: true, customFin: true, tagPrice: true, neckLabel: true, youth: true, youthSet: true, mockupAt: true, mockupKind: true, mockupBg: true, mockupBgBy: true, view: true, masterMockup: true, mockupArt: true, mockupSkipped: true, mockupThumbs: true, mockupSize: true, mockupOffsets: true, fromMockup: true, reprintOf: true, customerMockups: true, visualMockup: true, tagArt: true, pvArt: true, pvRef: true, reorderFrom: true, specialtyInk: true, specialtyInkSet: true, fabricNote: true, remake: true, fromGroup: true, reprintAsked: true, screenFee: true } satisfies Record<keyof Group, true>;

/** keys on the order's groups, lines and prints that the order doesn't have ("line personalization") */
export function strangeKeys(groups: unknown): string[] {
  const out = new Set<string>();
  const check = (o: unknown, known: Record<string, true>, what: string) => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return;
    for (const k of Object.keys(o)) if (!(k in known)) out.add(`${what} "${k}"`);
  };
  for (const g of Array.isArray(groups) ? groups : []) {
    check(g, GROUP_KEYS, "group");
    for (const l of Array.isArray(g?.lines) ? g.lines : []) check(l, LINE_KEYS, "garment line");
    for (const p of Array.isArray(g?.imprints) ? g.imprints : []) check(p, PRINT_KEYS, "print");
  }
  return [...out];
}
