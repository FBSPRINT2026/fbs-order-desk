"use client";
import { threadByName } from "@/lib/embroidery";
import { cleanPrintNotes, inkNames, shopNotes, isLightColor, lineQty, pmsInks, screensFor, ADULT_SIZES, BABY_SIZES, TODDLER_SIZES, FULL_COLOR, designLabel, designOther, INK_COLORS, THREAD_COLORS, LOCATIONS, METHODS, ONE_SIZE, SIZES, YOUTH_SIZES, newGLine, newImprint, uid, type Design, type GLine, type Garment, type Group, type GroupCalc, type Method, type PriceList, type Settings, type Size, colorCosts, sizeUpEach, supplierSizeUp } from "@/lib/pricing";
import { money } from "@/lib/format";
import { guessHex, garmentHex, smallerSpot } from "@/lib/mockup";
import { colorHex, repaintLogo } from "@/lib/inkColors";
import { loadInkFormulas } from "@/lib/inkFormulas";
import { createClient } from "@/lib/supabase/client";
import type { Imprint } from "@/lib/pricing";
import { plainlyMeans, rankColors } from "@/lib/colorMatch";
import DesignSearch from "@/components/DesignSearch";
import FinishingPicker from "@/components/FinishingPicker";
import { isRelabel } from "@/components/NeckLabelPick";
import { labelFor } from "@/components/NeckLabelView";
import { mainSize, setFor, type NeckLabelSet } from "@/lib/neckLabels";

/** save a custom finishing to the sometimes-used list (retail, or the wholesale contract list for a wholesale job) */
export const saveFinishing = (wholesale: boolean) => async (f: { name: string; price: number }) =>
  fetch("/api/settings/finishing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, wholesale }) }).then((r) => r.ok).catch(() => false);
import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Props = {
  /** where finishing is picked: in this group (default), or once for the whole order below the groups */
  finishingAt?: "group" | "order";
  /** the customer's neck label sets (Private Label prints one) and who they are */
  neckSets?: NeckLabelSet[]; customerId?: string;
  gi: number;
  g: Group;
  gc: GroupCalc;
  settings: Settings;
  prices: PriceList;
  catalog: Garment[];
  canRemove: boolean;
  armed: string;
  arm: (k: string) => void;
  update: (fn: (g: Group) => void) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onSaveToCatalog: (l: GLine) => void;
  onLookup?: (style: string, styleID?: number, supplier?: string) => Promise<Garment | null>;
  designs?: Design[];
  onMockup?: () => void;
  /** take the group's mockup off the order to make a new one (archived, not deleted; Oct 21, Nick: #40091) */
  onRemoveMockup?: () => void;
  /** why a mockup can't be made yet (no customer / no garment) */
  mockupBlock?: string;
  /** signed links for the group's saved mockup thumbnails */
  thumbUrls?: Record<string, string>;
  onStarDesign?: (d: Design, starred: boolean) => void;
  designUrls?: Record<string, string>;
  onUploadDesign?: (file: File, name: string) => Promise<Design | null>;
  lookingUp?: string;
  /** customer-built orders: no costs, prices or totals anywhere */
  hidePrices?: boolean;
  /** don't gray out imprints waiting on a mockup (customer requests come with their own details) */
  noLock?: boolean;
  /** the portal: the prints stay grayed out until the group has a mockup (made, uploaded or picked), with this note
   *  (Oct 24, Nick: "gray out the print area… I don't want them to fill it in. I want them to make the mock-up") */ needMockup?: string;
  /** buttons under the mockup spot beside the prints (the portal: Create mockup / Upload your own mockup, Oct 24) */ mockupExtra?: React.ReactNode;
  /** the customer's order made from their mockup (Oct 24, Nick: "it should look exactly like it does on our order screen with
   *  the imprints blown up… you shouldn't be able to change anything at that point"): the prints read only like a group with
   *  a mockup, the garments and colors fixed; only the sizes are theirs to fill in */ fixed?: boolean;
  /** a reorder print waiting on production details: where production confirms it */
  detailsHref?: string;
};

/** Screen prints: the inks listed must match the number of colors chosen. */
const inkCount = (s: string) => (s || "").split(/[,;/+]|\s&\s/).map((x) => x.trim()).filter(Boolean).length;
const inkMismatch = (d: { method: string; colors: number; inks: string }) => {
  if (d.method === "dtf" || (d.method === "screen" && d.colors >= FULL_COLOR)) return "";
  const n = inkCount(d.inks);
  if (!n || n === d.colors) return "";
  const what = d.method === "embroidery" ? "thread" : "ink";
  return `${n} ${what}${n > 1 ? "s" : ""} listed for ${d.colors} color${d.colors > 1 ? "s" : ""}`;
};
const lineTotal = (l: GLine) => SIZES.reduce((a, z) => a + (+(l.sizes?.[z] || 0)), 0);
const numOr =(v: string): number | "" => (v === "" ? "" : isNaN(+v) ? "" : +v);

/** Printavo-style line item group: garment rows sharing a set of imprints. */
export default function GroupEditor({ finishingAt = "group", neckSets, customerId, gi, g, gc, settings, prices, catalog, canRemove, armed, arm, update, onDuplicate, onRemove, onRemoveMockup, onSaveToCatalog, fixed = false, mockupExtra, needMockup, onLookup, lookingUp, designs, designUrls, onUploadDesign, onMockup, mockupBlock, thumbUrls, onStarDesign, hidePrices, noLock, detailsHref }: Props) {
  // the Ink Room's PMS formulas for the ink swatches (2178 C and the rest the old chart doesn't have)
  const [, setFormulas] = useState(0);
  useEffect(() => { loadInkFormulas(createClient()).then(setFormulas).catch(() => {}); }, []);
  const [askSkip, setAskSkip] = useState(false);
  // a price typed on one line: the rest of the group too? (Oct 20, Nick: "change the price to 2.25… a quick pop-up: do
  // you want to change all the items on this group to 2.25?")
  const [askAll, setAskAll] = useState<null | { li: number; v: number }>(null);
  const [blockMsg, setBlockMsg] = useState("");
  /**
   * "+ Add youth" (Oct 21, Nick: "1717… the corresponding youth is the 9018… Gildan 5000 → 5000B… if you don't know,
   * ask me and I can key it in and you can remember it"): the adult garment's youth style goes on a new line in the
   * same color. Known pairs (/api/garments/youth) and one clear catalog match go straight on; otherwise it asks, with
   * the catalog's best guesses, and remembers the answer.
   */
  type YGuess = { style: string; brand: string; title: string; supplier: string; sure?: boolean };
  const [yth, setYth] = useState<null | { li: number; fix: number | null; adult: string; brand: string; guesses: YGuess[]; typed: string; busy: boolean }>(null);
  const [ythNote, setYthNote] = useState<null | { text: string; li: number; youthLi: number; adult: string; brand: string }>(null);
  const adultLi = () => { for (let i = g.lines.length - 1; i >= 0; i--) { const l = g.lines[i]; if (l.style.trim() && !(l.sizeRun || []).some((z) => (YOUTH_SIZES as readonly string[]).includes(z))) return i; } return -1; };
  async function putYouth(li: number, fix: number | null, style: string, brand: string, supplier: string | undefined, learn: "staff" | "catalog" | false) {
    const adult = g.lines[li];
    const st = style.trim().toUpperCase();
    const at = fix ?? g.lines.length;
    if (fix == null) update((x) => { x.lines.push({ ...newGLine(), color: adult.color }); });
    const hit = findStyle(st, brand) || findStyle(st) || (onLookup ? await onLookup(st, undefined, supplier === "sanmar" ? "sanmar" : undefined) : null);
    onStyle(at, hit?.style || st, hit || undefined);
    if (learn) void fetch("/api/garments/youth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adult: adult.style, adultBrand: adult.brand, youth: hit?.style || st, youthBrand: hit?.brand || brand, source: learn }) }).catch(() => null);
    setYth(null);
    setYthNote({ text: `Youth of ${adult.style}: ${hit?.style || st}${hit?.description ? ` · ${hit.description}` : ""}${learn === "catalog" ? " (matched in the catalog)" : learn === "staff" ? " (remembered for next time)" : ""}`, li, youthLi: at, adult: adult.style, brand: adult.brand || "" });
  }
  async function addYouth(fix: number | null = null, liIn?: number) {
    const li = liIn ?? adultLi();
    setYthNote(null);
    if (li < 0) { setYthNote({ text: "Pick the adult style first, then Add youth.", li: -1, youthLi: -1, adult: "", brand: "" }); return; }
    const l = g.lines[li];
    setYth({ li, fix, adult: l.style.trim(), brand: l.brand || "", guesses: [], typed: "", busy: true });
    const j = await fetch(`/api/garments/youth?style=${encodeURIComponent(l.style.trim())}&brand=${encodeURIComponent(l.brand || "")}&title=${encodeURIComponent(l.garment || "")}`).then((r) => r.json()).catch(() => ({})) as { known?: { style: string; brand: string } | null; guesses?: YGuess[] };
    if (fix == null && j.known) { await putYouth(li, null, j.known.style, j.known.brand, undefined, false); return; }
    const sure = fix == null ? (j.guesses || []).find((x) => x.sure) : undefined;
    if (sure) { await putYouth(li, null, sure.style, sure.brand, sure.supplier, "catalog"); return; }
    setYth({ li, fix, adult: l.style.trim(), brand: l.brand || "", guesses: j.guesses || [], typed: "", busy: false });
  }
  /**
   * "+ Add companion style" (Oct 21, Nick: "should really say Add Companion Style… pop up… the youth is 3001Y, the
   * women's is this model, the long sleeve is this model, just like SanMar does"): SanMar's companion styles for the
   * garment, by kind; a pick goes on a new line in the same color. A youth pick is remembered (Add youth's pairs).
   */
  type CItem = { style: string; brand: string; title: string; image: string | null; inColor: boolean | null; remembered?: boolean };
  const [cmp, setCmp] = useState<null | { li: number; busy: boolean; title: string; kinds: { kind: string; items: CItem[] }[]; typed: string; err: string }>(null);
  async function openCompanions() {
    const li = adultLi();
    setYthNote(null); setYth(null);
    if (li < 0) { setYthNote({ text: "Pick a style first, then Add companion style.", li: -1, youthLi: -1, adult: "", brand: "" }); return; }
    const l = g.lines[li];
    setCmp({ li, busy: true, title: "", kinds: [], typed: "", err: "" });
    const j = await fetch(`/api/garments/companions?style=${encodeURIComponent(l.style.trim())}&brand=${encodeURIComponent(l.brand || "")}&color=${encodeURIComponent(l.color || "")}`).then((r) => r.json()).catch(() => ({ error: "Couldn't reach SanMar." })) as { title?: string; kinds?: { kind: string; items: CItem[] }[]; error?: string };
    setCmp((c) => (c && c.li === li ? { ...c, busy: false, title: j.title || "", kinds: j.kinds || [], err: j.error || "" } : c));
  }
  async function putCompanion(li: number, style: string, brand: string, kind: string, remember: boolean) {
    const adult = g.lines[li];
    const st = style.trim().toUpperCase();
    if (!st) return;
    const at = g.lines.length;
    update((x) => { x.lines.push({ ...newGLine(), color: adult.color }); });
    setCmp(null);
    const hit = findStyle(st, brand) || findStyle(st) || (onLookup ? await onLookup(st, undefined, "sanmar") : null);
    onStyle(at, hit?.style || st, hit || undefined);
    if (remember) void fetch("/api/garments/youth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adult: adult.style, adultBrand: adult.brand, youth: hit?.style || st, youthBrand: hit?.brand || brand, source: "staff" }) }).catch(() => null);
    setYthNote({ text: `${kind} for ${adult.style}: ${hit?.style || st}${hit?.description ? ` · ${hit.description}` : ""}${remember ? " (remembered for next time)" : ""}`, li, youthLi: kind === "Youth" ? at : -1, adult: adult.style, brand: adult.brand || "" });
  }
  // once the group has a mockup, its prints are changed in the Mockup Creator only (Oct 15, Nick: "being able to change
  // any of the imprint information doesn't make sense once a mockup is created")
  const frozen = fixed || (!!onMockup && !!g.mockupAt && !g.mockupSkipped);
  // the group's shirt color (first garment): behind each print's logo, like the Mockup Creator's close-ups (Oct 15, Nick)
  const shirtHex = (() => {
    const l = g.lines.find((x) => (x.style || "").trim()) || g.lines[0];
    if (!l) return "#9aa1ab";
    const key = (c: string) => (c || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const gar = catalog.find((x) => x.style.toLowerCase() === (l.style || "").trim().toLowerCase());
    const ci = gar?.color_images?.[l.color] || Object.entries(gar?.color_images || {}).find(([k]) => key(k) === key(l.color))?.[1];
    return garmentHex(ci?.hex, l.color) || "#9aa1ab";
  })();
  const startMockup = () => { if (mockupBlock) { setBlockMsg(mockupBlock); return; } setBlockMsg(""); onMockup?.(); };
  // exact style match; if the same number exists under several brands, only the brand given (or none) counts
  const findStyle = (style: string, brand?: string) => {
    const hits = catalog.filter((x) => x.style.toLowerCase() === style.trim().toLowerCase());
    if (brand) return hits.find((x) => x.brand.toLowerCase() === brand.toLowerCase());
    return hits.length === 1 ? hits[0] : undefined;
  };

  function onStyle(li: number, style: string, found?: Garment) {
    update((x) => {
      const l = x.lines[li];
      l.style = style;
      const hit = found || findStyle(style);
      if (hit) {
        // 2XL+ material charge = supplier's size price above the base price
        Object.assign(l, supplierSizeUp(hit, settings, l.color));
        // picking a catalog style always refreshes its details and blank cost (this color's, when the supplier prices colors apart)
        l.garment = hit.description;
        l.brand = hit.brand;
        if (!gc.wholesale) l.cost = +colorCosts(hit, l.color).base || +hit.cost || "";
        // the catalog decides which sizes this garment comes in
        const run = (hit.sizes || []).filter((z) => (SIZES as readonly string[]).includes(z));
        if (run.length) {
          const os = run.length === 1 && run[0] === ONE_SIZE;
          const keep: GLine["sizes"] = {};
          if (os) { const q = lineTotal(l); if (q) keep[ONE_SIZE] = q; }
          else for (const z of run) { const v = l.sizes?.[z as keyof GLine["sizes"]]; if (v) keep[z as keyof GLine["sizes"]] = v; }
          l.sizes = keep;
          l.sizeRun = run;
          l.oneSize = os;
        }
      }
    });
  }

  // Sizes shown for a row: the catalog's size run for that style, otherwise the adult run (plus baby, toddler or
  // youth when the row already has quantities in those, e.g. from the AI reading an email or an older order).
  const colsFor = (l: GLine): string[] => {
    const run = (l.sizeRun || []).filter((z) => z !== ONE_SIZE);
    const has = (list: readonly string[]) => list.some((z) => l.sizes?.[z as keyof GLine["sizes"]]);
    if (run.length) return [...run, ...[...BABY_SIZES, ...TODDLER_SIZES, ...YOUTH_SIZES, ...ADULT_SIZES].filter((z) => !run.includes(z) && l.sizes?.[z as keyof GLine["sizes"]])];
    const baby = has(BABY_SIZES), tod = has(TODDLER_SIZES), youth = !!g.youth || has(YOUTH_SIZES);
    // little ones only: no adult columns to scroll past
    if ((baby || tod) && !has(ADULT_SIZES)) return [...(baby ? BABY_SIZES : []), ...(tod ? TODDLER_SIZES : []), ...(youth ? YOUTH_SIZES : [])];
    return [...(baby ? BABY_SIZES : []), ...(tod ? TODDLER_SIZES : []), ...(youth ? YOUTH_SIZES : []), ...ADULT_SIZES];
  };
  // one set of size columns for the whole group, so S sits under S on every garment even when one style has no XS
  // (Oct 20, Nick: "the sizes line up across multiple garments"); a size a garment doesn't come in is an empty slot
  const groupCols: string[] = (() => {
    const all = new Set(g.lines.filter((l) => !l.oneSize).flatMap((l) => colsFor(l)));
    const order = [...BABY_SIZES, ...TODDLER_SIZES, ...YOUTH_SIZES, ...ADULT_SIZES] as readonly string[];
    return [...order.filter((z) => all.has(z)), ...[...all].filter((z) => !order.includes(z))];
  })();
  // How the garment rows fit (Oct 22, Nick: "dynamic column widths so that as the page shrinks, everything shrinks… keep
  // the sizes up on that row as long as possible… the same thing with the pricing on the right… fill the space in
  // widescreen"). Every column is exactly as wide as the widest thing in it for this group (measured in the page's own
  // fonts, tabular numbers included, so a number is never cut off). Then, as the box gets narrower:
  //   w1  one line: style · brand · color | the sizes | cost · qty × each · total. The size boxes fill the room (up to
  //       BOXMAX, then the sizes sit centered); as it narrows the boxes shrink to what their numbers need, then the gaps
  //   w1c the same, with the gray cost tucked under the price
  //   w   the sizes on their own line under the shirt (the shirt and its money still on one line)
  //   s   stacked, like a phone (phones always stack): each row's own sizes, as big as fit on one line
  // The numbers are set as CSS variables (globals.css "Garments: one grid").
  // the group description box, opened from "+ Add group description" before anything is typed
  // a line's note box, opened from its ✎ before anything is typed
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const glRef = useRef<HTMLDivElement | null>(null);
  const [glFit, setGlFit] = useState<"w0" | "w1" | "w1c" | "w" | "s">("w");
  const hasCost = !gc.wholesale && !hidePrices;
  const glSig = JSON.stringify([groupCols, hasCost, gc.qty, gc.sub, g.lines.map((l, i) => [l.style, l.brand, l.color, l.cost, l.priceOverride, l.sizes, l.sizeUpSet, l.sizeUp, gc.lines[i]?.qty, gc.lines[i]?.sub, gc.lines[i]?.calcEach])]);
  useEffect(() => {
    const el = glRef.current; if (!el) return;
    // a hidden copy of the text in the same font settings (canvas can't do tabular numbers, which are wider)
    const probe = document.createElement("span");
    probe.setAttribute("aria-hidden", "true"); probe.setAttribute("data-notranslate", "");
    probe.style.cssText = "position:fixed;left:0;top:0;visibility:hidden;white-space:pre;pointer-events:none;padding:0;border:0;margin:0";
    document.body.appendChild(probe);
    const textW = (node: Element, text: string) => {
      if (!text) return 0;
      const cs = getComputedStyle(node), ps = probe.style;
      ps.fontFamily = cs.fontFamily; ps.fontSize = cs.fontSize; ps.fontWeight = cs.fontWeight; ps.fontStyle = cs.fontStyle;
      ps.fontStretch = cs.fontStretch; ps.fontVariantNumeric = cs.fontVariantNumeric; ps.fontFeatureSettings = cs.fontFeatureSettings;
      ps.letterSpacing = cs.letterSpacing; ps.textTransform = cs.textTransform;
      probe.textContent = text;
      return Math.ceil(probe.getBoundingClientRect().width);
    };
    // the widest value in a column (an input: what's typed, else the placeholder it shows), plus its padding, kept within lo…hi
    const widest = (sel: string, pad: number, lo: number, hi: number) => {
      let m = 0;
      el.querySelectorAll<HTMLElement>(sel).forEach((node) => {
        if (node instanceof HTMLInputElement) m = Math.max(m, textW(node, node.value || node.placeholder || ""));
        else m = Math.max(m, textW(node, (node.textContent || "").trim()));
      });
      return Math.max(lo, Math.min(hi, m + pad));
    };
    const n = Math.max(1, groupCols.length);
    // the youth/adult divider: 12px at the normal size gap, 10 and 8 as it tightens
    const yx = groupCols.indexOf("YXL"), hasSep = yx >= 0 && yx < groupCols.length - 1;
    const sepOf = (sg: number) => (hasSep ? sg * 2 + 4 : 0);
    const BOX = 36, BOXMAX = 46, BOXPHONE = 40;
    let X = 22; // the remove button's column, measured below
    type M = { deB: number; st: number; br: number; co: number; cs: number; qt: number; ea: number; to: number; boxMin: number; own: number };
    let m: M | null = null, mPhone: boolean | null = null;
    const measure = (): M => {
      // the words of each row sit close together ("245 Tultex White/ Royal", Nick: "shrink between 245 Tultex and the
      // color"): each row's style and brand columns are as wide as its own words (2px of padding after them, +3 to
      // spare), the colors of one style keep their first row's widths so they line up under it, and every row's color
      // column ends at the same place, so the sizes still start at the same place on every row
      const own1 = (i: HTMLInputElement | null) => (i ? textW(i, i.value || i.placeholder || "") + 5 : 0);
      // (Oct 22, Nick: "the colors still sync up… white and royal, white and Kelly, and the next white and royal all line
      // up"): the color column starts at the same place on every row; the room a short style/brand doesn't need sits
      // before the color. On the widest screens the description moves up between the brand and the color (fit-w0).
      const ownDe = (i: HTMLInputElement | null) => (i && i.value ? textW(i, i.value) + 11 : 0); // 7px padding each side, less the 8px it reaches left
      let lead = { st: 0, br: 0, de: 0 };
      const per = [...el.querySelectorAll<HTMLElement>(".gl-list > .gl")].map((r) => {
        if (!r.classList.contains("same")) lead = { st: Math.max(24, own1(r.querySelector(".a-st input"))), br: Math.max(20, own1(r.querySelector(".a-br input"))), de: ownDe(r.querySelector(".a-de input")) };
        return { r, ...lead, co: Math.max(44, own1(r.querySelector(".a-co input"))) };
      });
      const A = Math.max(80, ...per.map((x) => x.st + x.br)); // style + brand, the widest row
      const B = Math.max(80, ...per.map((x) => x.st + x.br + x.de)); // style + brand + description
      const coMax = Math.max(44, ...per.map((x) => x.co));
      per.forEach((x) => { const v = (k: string, n: number) => x.r.style.setProperty(k, `${n}px`); v("--str", x.st); v("--brr", A - x.st); v("--brr0", x.br); v("--der", B - x.st - x.br); });
      const st = per[0]?.st ?? 60, br = A - st, co = coMax, deB = B - A;
      const cs = hasCost ? widest(".gl .a-cs input", 14, 34, 90) : 0;
      const qt = Math.max(widest(".gl .a-qt input", 10, 30, 80), widest(".grp-total > .a-qt", 4, 30, 80));
      const ea = widest(".gl .a-ea input", 28, 54, 120);
      const to = Math.max(widest(".gl .a-to b", 4, 52, 150), widest(".grp-total > .a-to", 4, 52, 150));
      // a size box is never narrower than its number (+6 for the border and room to spare; +8 for a phone's tap button,
      // which has 2px of padding), its size name, or its 2XL+ charge underneath (which may use the gap)
      const num = Math.max(widest(".gl .a-sz input.sz", 6, 0, 80), widest(".gl .a-sz .sz-tap", 8, 0, 80));
      const name = widest(".gl .a-sz .szc > span:first-child", 2, 0, 80);
      const upc = widest(".gl .a-sz .szc > :is(small.upc,.upc-btn)", 0, 0, 80);
      const boxMin = Math.max(24, num, name, upc - 2);
      // the most sizes any one garment has (a stacked row shows only its own)
      let own = 1;
      el.querySelectorAll<HTMLElement>(".gl .a-sz .szrow").forEach((r) => { own = Math.max(own, r.querySelectorAll(".szc:not(.szc-off)").length); });
      // each row's own style width, for the stacked layout (no gap after a short style number)
      el.querySelectorAll<HTMLElement>(".gl .a-st").forEach((c) => { const i = c.querySelector("input"); if (i) c.style.setProperty("--stw", `${Math.max(24, textW(i, i.value || i.placeholder || "") + 4)}px`); });
      // the ✎ and ✕ buttons side by side
      let xw = 0;
      el.querySelectorAll<HTMLElement>(".gl .a-x").forEach((c) => { const bs = [...c.querySelectorAll<HTMLElement>("button")]; xw = Math.max(xw, bs.reduce((a, b) => a + Math.ceil(b.getBoundingClientRect().width), 0) + Math.max(0, bs.length - 1) * 2); });
      X = Math.max(22, xw);
      return { deB, st, br, co, cs, qt, ea, to, boxMin, own };
    };
    const fit = () => {
      const list = el.querySelector<HTMLElement>(".gl-list") || el;
      const W = list.clientWidth;
      if (!W) return;
      const phone = typeof window.matchMedia === "function" && window.matchMedia("(max-width:760px)").matches;
      // measured once per change (and again when the phone layout comes or goes: its fonts differ a little)
      if (!m || mPhone !== phone) { m = measure(); mPhone = phone; }
      const { deB, st, br, co, cs, qt, ea, to, boxMin, own } = m;
      const run = (b: number, sg: number) => n * b + (n - 1) * sg + sepOf(sg);
      // everything but the size boxes on one line, at a gap of g between columns and sg between sizes
      // w0 has the description on the shirt line too: one more column and gap
      const fixed = (g: number, sg: number, cost: boolean, w0 = false) => st + g + br + g + (w0 ? deB + g : 0) + co + g + run(0, sg) + g + (cost && cs ? cs + g : 0) + qt + g + ea + g + to + g + X;
      // tighter and tighter: [gap between columns, gap between sizes, the smallest box at that step]
      const steps: [number, number, number][] = [[10, 4, 34], [8, 3, 31], [6, 2, 0]];
      let mode: "w0" | "w1" | "w1c" | "w" | "s" = "s", box = BOX, gap = 10, sg = 4;
      const one = (cost: boolean, w0 = false) => {
        for (const [g2, s2, t] of steps) {
          const b = Math.floor((W - fixed(g2, s2, cost, w0)) / n);
          if (b >= Math.max(boxMin, t)) { box = Math.min(BOXMAX, b); gap = g2; sg = s2; return true; }
        }
        return false;
      };
      if (!phone) {
        // everything on one line whenever it fits (Oct 22, Nick: "when you have the ability to make everything one line")
        if (deB > 0 && one(true, true)) mode = "w0";
        else if (one(true)) mode = "w1";
        else if (cs && one(false)) mode = "w1c";
        else {
          // the shirt line: the empty middle column has a gap on each side
          for (const [g2] of steps) if (st + g2 + br + g2 + co + g2 + g2 + (cs ? cs + g2 : 0) + qt + g2 + ea + g2 + to + g2 + X <= W) { mode = "w"; gap = g2; break; }
          if (mode === "w") {
            box = BOX; sg = 4;
            while (box > boxMin && run(box, sg) > W) box--;
            if (run(box, sg) > W) sg = 2;
            if (run(box, sg) > W) mode = "s";
          }
        }
      }
      if (mode === "s") { gap = 10; sg = 4; box = Math.max(boxMin, Math.min(BOXPHONE, Math.floor((W - (own - 1) * 4) / own))); }
      // on one line the description may run on under the empty room left of the sizes (they sit centered)
      let dew = 0;
      if (mode === "w1" || mode === "w1c") {
        const cost = mode === "w1" && !!cs;
        const other = st + br + co + (cost ? cs : 0) + qt + ea + to + X + gap * (cost ? 8 : 7);
        dew = st + br + co + 3 * gap + Math.max(0, Math.floor((W - other - run(box, sg)) / 2)) - 12;
      }
      const px = (k: string, v: number) => el.style.setProperty(k, `${v}px`);
      px("--st", st); px("--br", br); px("--co", co); px("--cs", cs); px("--qt", qt); px("--ea", ea); px("--to", to); px("--x", X);
      px("--gap", gap); px("--sg", sg); px("--szw", box); px("--dew", dew); px("--sep", sepOf(sg) || 12);
      setGlFit(mode);
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => fit()) : null;
    ro?.observe(el);
    let live = true;
    // the fonts arriving late change every width: measure again
    document.fonts?.ready?.then(() => { if (live) { m = null; fit(); } }).catch(() => {});
    return () => { live = false; ro?.disconnect(); probe.remove(); };
  }, [glSig]); // eslint-disable-line react-hooks/exhaustive-deps
  // Imprints and finishing stay grayed out until the group has a mockup (or staff choose to skip it)
  const locked = (!!onMockup || !!needMockup) && !noLock && !g.mockupAt && !g.mockupSkipped && !(g.customerMockups || []).length;
  // wholesale (contract) jobs use the contract's own finishing list and prices
  const finList = gc.wholesale && settings.wholesale.finishing?.length ? settings.wholesale.finishing : settings.finishing;
  // embroidery extras (specialty thread, 3D puff…): only on a group with embroidery
  const embList = gc.wholesale && g.imprints.some((d) => d.method === "embroidery") ? settings.wholesale.embExtras || [] : [];
  // screens (contract jobs): per screen print, its colors + the underbase when it gets one, or set by hand
  const wpl = settings.wholesale;
  const scrImps = gc.wholesale ? g.imprints.filter((d) => d.method === "screen" && d.colors < FULL_COLOR) : [];
  const allLight = !g.lines.some((l) => lineQty(l) > 0 && !isLightColor(l.color, wpl));
  const num0 = (v: unknown) => (isNaN(+(v as number)) ? 0 : +(v as number));
  const embImps = gc.wholesale ? g.imprints.filter((d) => d.method === "embroidery") : [];
  const inkRate = wpl.specialtyInk?.length ? wpl.specialtyInk[Math.min(gc.ti, wpl.specialtyInk.length - 1)] : 0;
  const setPms = (di: number, name: string, v: boolean | undefined) => update((x) => { const m = { ...(x.imprints[di].pmsCharge || {}) }; if (v == null) delete m[name.toLowerCase()]; else m[name.toLowerCase()] = v; x.imprints[di].pmsCharge = Object.keys(m).length ? m : undefined; });
  // the tag print (Oct 21, Nick: "move the tag imprints out of the finishing… under imprints… add tag imprint, use it on
  // file, and it calculates it to the dollar"): still the "relabel" finishing for the price, shown with the prints. Not
  // frozen with the prints once there's a mockup (it was finishing before, and it doesn't change the mockup's art)
  const tagFin = finList.find((f) => isRelabel(f));
  const tagOn = !!tagFin && (g.finishing || []).includes(tagFin.id);
  const tick = (id: string, on: boolean) => update((x) => { const set = new Set(x.finishing || []); if (on) set.add(id); else set.delete(id); x.finishing = [...set]; });
  // a print's screens, on its own line (Oct 15, Nick: "make the screens incorporate into the imprint lines")
  const screenCtl = (d: Group["imprints"][number]) => {
    if (!scrImps.includes(d)) return null;
    const di = g.imprints.indexOf(d), sc = screensFor(d, wpl, allLight), rm = !!(d.remake ?? g.remake);
    const fee = rm && wpl.remakeFee != null ? wpl.remakeFee : wpl.screenFee;
    return (
      <ScreensLine key={d.id} summary={<>{sc.n} screen{sc.n === 1 ? "" : "s"}{!hidePrices && <> · <b className="num">{money(sc.n * (+fee || 0))}</b></>}
        {sc.under && !allLight ? <span className="pr-scr-tag">underbase</span> : null}{d.printStyle === "fashion" ? <span className="pr-scr-tag fashion">fashion hit</span> : null}{d.softHand ? <span className="pr-scr-tag">soft hand</span> : null}{rm ? <span className="pr-scr-tag">remake</span> : null}</>}>
        {/* a fashion hit: no underbase, each color printed, flashed and printed again (Oct 16, Nick); priced the same */}
        <label className="check" title="No underbase: each color printed, flashed and printed again through the same screen. Priced the same as with an underbase (two rounds on press)."><input type="checkbox" checked={d.printStyle === "fashion"} onChange={(e) => update((x) => { x.imprints[di].printStyle = e.target.checked ? "fashion" : undefined; if (e.target.checked) x.imprints[di].underbase = undefined; x.imprints[di].screens = undefined; })} />Fashion hit</label>
        <label className="check" title="Soft hand additive mixed into the inks"><input type="checkbox" checked={!!d.softHand} onChange={(e) => update((x) => { x.imprints[di].softHand = e.target.checked || undefined; })} />Soft hand</label>
        {d.printStyle === "fashion" ? null : allLight ? <span className="faint">no underbase</span> : <span className={"sbx-ub" + (d.underbase == null ? " auto" : "")}>
          <label className="check" title={d.underbase == null ? (sc.under ? "Automatic: a light ink needs one. Click to override." : "Automatic: dark inks print without one. Click to override.") : "Set by hand"}><input type="checkbox" checked={sc.under} onChange={(e) => update((x) => { x.imprints[di].underbase = e.target.checked; x.imprints[di].screens = undefined; })} />Underbase</label>
          {d.underbase != null && <span className="sbx-ovr">override <button type="button" aria-label="Back to automatic" title="Back to automatic" onClick={() => update((x) => { x.imprints[di].underbase = undefined; })}>×</button></span>}
        </span>}
        {wpl.remakeFee != null && <label className="check" title="The screens are on file from an earlier order"><input type="checkbox" checked={rm} onChange={(e) => update((x) => { x.imprints[di].remake = e.target.checked; })} />Remake {money(wpl.remakeFee)}</label>}
      </ScreensLine>
    );
  };
  // a print's inks as chips, with its PMS matches and their charge on the same line (Oct 21, Nick: "the colors just seem
  // to run on and on… the inks can go up underneath the imprints, just like we charge for screens")
  const inkCtl = (d: Group["imprints"][number], chips = true) => {
    const di = g.imprints.indexOf(d), inks = pmsInks(d), isScr = scrImps.includes(d);
    const pms = isScr ? inks.filter((x) => x.auto) : [];
    const typed = isScr && !inks.length && !!wpl.pmsFee;
    if (!(chips && inks.length) && !pms.length && !typed) return null;
    const n = typed ? num0(d.pms) : pms.filter((x) => x.charge).length;
    const fee = n * (+(wpl.pmsFee || 0));
    return (
      <InkLine key={"ink" + d.id} thread={d.method === "embroidery"} inks={chips ? inks : []} charged={(k) => isScr && !!inks.find((x) => x.name === k)?.auto && !!inks.find((x) => x.name === k)?.charge}
        summary={pms.length || typed ? <span className="pr-pms">{n ? `${n} PMS match${n === 1 ? "" : "es"}` : "No PMS charge"}{!hidePrices && n ? <> · <b className="num">{money(fee)}</b></> : null}</span> : null}
        editable={pms.length > 0 || typed}>
        {typed ? <label className="check">PMS matches <input className="sbx-num" type="number" min={0} max={12} aria-label="Inks matched to a PMS" value={d.pms ?? ""} placeholder="0" onChange={(e) => update((x) => { x.imprints[di].pms = e.target.value ? Math.max(0, Math.round(+e.target.value)) : undefined; })} /></label>
          : pms.map((x) => <label key={x.name} className="check" title="The customer's regular ink: no matching charge"><input type="checkbox" checked={!x.charge} onChange={(e) => setPms(di, x.name, e.target.checked ? false : undefined)} />{x.name}: standard, no charge</label>)}
      </InkLine>
    );
  };
  // the poly / dyed ink charge is a screen printing thing: an embroidered-only group doesn't show it (Oct 23)
  const inksSec = (!!g.specialtyInk || !!g.specialtyInkSet) && scrImps.length > 0;
  const hasFoot = inksSec || embImps.length > 0 || (finishingAt === "group" && finList.length > 0);
  // the group's money in one line under its prints (Oct 15, Nick: "move the total up")
  const priceLine = hidePrices ? null : (() => {
    // a price typed or set by the program: finishing at its own price per piece (Oct 21, Nick: tag removal $1 × 200 shows
    // $200, not a share of the $5.50), the rest split between the garment and the prints
    const finOf = (lc: GroupCalc["lines"][number]) => (lc.hasOv ? Math.min(gc.finishEach, lc.each) : gc.finishEach);
    const tagEach = gc.finishing.filter((f) => isRelabel(f)).reduce((t, f) => t + (+f.price || 0), 0); // g.tagPrice applied in calcGroup
    const impOf = (lc: GroupCalc["lines"][number]) => { if (!lc.hasOv) return lc.printEach; const base = lc.calcEach - gc.finishEach; return base > 0 ? ((lc.each - finOf(lc)) * lc.printEach) / base : 0; };
    const imp = gc.lines.reduce((a, lc) => a + lc.qty * impOf(lc), 0);
    const finAll = gc.lines.reduce((a, lc) => a + lc.qty * finOf(lc), 0);
    const tags = gc.lines.reduce((a, lc) => a + lc.qty * Math.min(tagEach, finOf(lc)), 0);
    const fin = Math.round((finAll - tags) * 100) / 100;
    const gar = Math.round((gc.sub - imp - finAll) * 100) / 100;
    const bits: [string, number, string?][] = [
      ...(gc.wholesale && Math.abs(gar) < 0.01 ? [] : [["Garments", gar] as [string, number]]),
      ["Imprints", imp],
      // finishing by name when there's one ("Tag removal & custom imprint"), its own line on top of the prints
      ...(tags ? [["Tag prints", tags, `${money(tagEach)} a piece`] as [string, number, string]] : []),
      ...(fin > 0.004 ? [["Finishing", fin, gc.finishing.filter((f) => !isRelabel(f)).map((f) => `${f.name} ${money(+f.price)}/pc`).join(", ")] as [string, number, string]] : []),
      ...(gc.setup ? [["Setup", gc.setup, gc.minCharge ? `incl. ${money(gc.minCharge)}: under ${settings.wholesale.minQty || 12} pcs is charged as ${settings.wholesale.minQty || 12}` : gc.inkFees ? "incl. ink and PMS fees" : ""] as [string, number, string]] : []),
      ...(gc.materials ? [["2XL+ materials", gc.materials] as [string, number]] : []),
    ];
    return (
      <div className="grp-sum">
        {gc.custom && !gc.lines.every((lc) => lc.hasOv) ? <span className="ink-warn">9+ colors: custom quote (priced at 8 here)</span> : null}
        {bits.map(([k, v, t]) => <span key={k} title={t || undefined}>{k} <b className="num">{money(v)}</b></span>)}
        <span className="grp-sum-t">Group total <b className="num">{money(gc.sub + gc.setup + gc.materials)}</b></span>
      </div>
    );
  })();
  return (
    <section className={"line" + (hidePrices ? " np" : "") + (fixed ? " fixed" : "")}>
      <div className="line-h">
        <input type="text" className="grp-name" readOnly={fixed} aria-label="Group name" placeholder={`Group ${gi + 1}`} value={g.name || ""} onChange={(e) => update((x) => { x.name = e.target.value; })} />
        {/* the group description, right on the group's line (Oct 22, Nick: "move it where you have the add group
            description… if you put in a little text, it just goes right there"); it prints on the quote, invoice and work order */}
        {!fixed && <textarea className="grp-desc-in" rows={1} aria-label="Group description" title="Group description: prints on the quote, invoice and work order" placeholder="+ Add group description"
          value={g.description || ""} onChange={(e) => update((x) => { x.description = e.target.value; })}
          onBlur={(e) => { if (!e.target.value.trim() && g.description != null) update((x) => { delete x.description; }); }} />}
        <span className="spacer" />
        {!fixed && <button className="btn sm ghost" type="button" onClick={onDuplicate}>Duplicate group</button>}
        {canRemove && <button className={"btn sm ghost danger" + (armed === "grp" + g.id ? " armed" : "")} type="button" onClick={() => (armed === "grp" + g.id ? onRemove() : arm("grp" + g.id))}>{armed === "grp" + g.id ? "Remove group?" : "Remove"}</button>}
      </div>
      {gc.wholesale && <div className="cs-banner">Customer supplied goods</div>}
      {/* the size run (YXS → 4XL) across the top once, every color reading straight across (Oct 21, Nick: "version
          one"); how many sizes it has decides when the prices drop under the sizes (globals.css "Garments: the size run") */}
      <div ref={glRef} className={"line-b fit-" + glFit + (hasCost ? "" : " nocs")}>
        <div className="lbl gsec" style={{ marginBottom: -4 }}>Garments</div>
        <div className={"gl-list" + (gc.wholesale ? " ws" : "")}>
          <div className="gl-row gl-head gl-r2">
            <span className="a-sth">Style</span>
            <span className="a-co">Color</span>
            <span className="a-deh">Description</span>
            <span className="a-sz">{groupCols.length ? <span className="szrow szh">{groupCols.map((z, zi) => <span key={z} className={"szc" + (z === "YXL" && zi < groupCols.length - 1 ? " ysep" : "")}><span>{z}</span></span>)}</span> : "Sizes"}</span>
            {!gc.wholesale && !hidePrices && <span className="a-cs">Cost</span>}
            <span className="a-qt c">Qty</span><span className="a-ea r">Each</span><span className="a-to r">Total</span>
          </div>
          {g.lines.map((l, li) => {
            const lc = gc.lines[li];
            const hit = findStyle(l.style, l.brand);
            const sized = !l.oneSize && lineTotal(l) > 0; // sizes entered below, so Qty is their total
            const setQty = (s: keyof GLine["sizes"], raw: string) => update((x) => { const v = Math.max(0, Math.floor(+raw || 0)); if (v) x.lines[li].sizes[s] = v; else delete x.lines[li].sizes[s]; });
            // the style once, then a row per color with its sizes on the same line (Oct 21, Nick: order page cleanup)
            const prev = li > 0 ? g.lines[li - 1] : null;
            const same = !!prev && !!(l.style || "").trim() && (prev.style || "").trim().toLowerCase() === (l.style || "").trim().toLowerCase() && (prev.brand || "") === (l.brand || "") && (prev.garment || "") === (l.garment || "");
            return (
              <div key={l.id} className={"gl" + (same ? " same" : "")}>
                {!same && <div className="gl-sty" inert={fixed || undefined}>
                  <div className="a-st">
                    <StylePicker value={l.style} catalog={catalog} busy={!!lookingUp}
                      onType={(v) => onStyle(li, v)}
                      onPick={(gm) => onStyle(li, gm.style, gm)}
                      onPickSS={(h) => onLookup ? onLookup(h.style, h.styleID || undefined, h.supplier).then((gm) => { if (gm) onStyle(li, gm.style, gm); }) : Promise.resolve()} />
                    {lookingUp && lookingUp === l.style.trim().toUpperCase() && <div className="ink-hint">Pulling from S&amp;S…</div>}
                  </div>
                  <div className="a-bd"><div className="a-br"><input type="text" tabIndex={-1} className="pre" title="Filled from the catalog. Click to change." aria-label="Brand" placeholder="Brand" value={l.brand || ""} onChange={(e) => update((x) => { x.lines[li].brand = e.target.value; })} /></div>
                  <div className="a-de"><input type="text" tabIndex={-1} className="pre" title={(l.garment ? l.garment + "\n" : "") + "Filled from the catalog. Click to change."} aria-label="Description" placeholder="Description" value={l.garment} onChange={(e) => update((x) => { x.lines[li].garment = e.target.value; })} /></div></div>
                </div>}
                {/* the next color of the same style: its style number grayed, like a ditto mark (Oct 21, Nick: like Printavo) */}
                {same && <div className="gl-ditto" aria-hidden>{l.style}</div>}
                <div className="gl-row gl-r2">
                  <div className="a-co" inert={fixed || undefined}>
                    <ColorPicker value={l.color} colors={hit?.colors || []} onChange={(v) => update((x) => {
                      const ln = x.lines[li], was = ln.color; ln.color = v;
                      // a color with its own supplier prices: its 2XL+ charges, and its blank cost unless someone typed their own
                      if (hit?.color_size_costs && !gc.wholesale && !ln.prog) {
                        Object.assign(ln, supplierSizeUp(hit, settings, v));
                        const auto = [+colorCosts(hit, was).base, +hit.cost].filter((n) => n > 0);
                        if (ln.cost === "" || ln.cost == null || auto.includes(+ln.cost)) ln.cost = +colorCosts(hit, v).base || +hit.cost || "";
                      }
                    })} />
                  </div>
                  <div className="a-sz">
                    {l.oneSize ? (
                      <div className="os-note">{l.sizeRun?.length === 1 ? "One size. Enter the quantity in Qty." : "One-size item. Clear the Qty to switch back to sizes."}</div>
                    ) : (
                      <SizeRow cols={groupCols as (keyof GLine["sizes"])[]} off={(s) => !colsFor(l).includes(s)} sizes={l.sizes || {}} onSet={setQty}
                        up={(s) => (l.sizeUpSet?.[s as Size] != null ? +l.sizeUpSet[s as Size]! : !gc.wholesale && l.sizeUp && l.sizeUp[s] !== undefined ? sizeUpEach(l, s as Size) : prices.upcharges[s as keyof typeof prices.upcharges])}
                        upSet={(s) => l.sizeUpSet?.[s as Size] != null}
                        onUp={(s, v) => update((x) => { const ln = x.lines[li]; const m = { ...(ln.sizeUpSet || {}) }; if (v == null) delete m[s as Size]; else m[s as Size] = v; ln.sizeUpSet = Object.keys(m).length ? m : undefined; })} />
                    )}
                  </div>
                  {!gc.wholesale && !hidePrices && <div className="a-cs"><input type="number" step="0.01" min="0" tabIndex={-1} className="pre" title="Click to change" aria-label="Blank cost" placeholder="0.00" value={l.cost} onChange={(e) => update((x) => { x.lines[li].cost = numOr(e.target.value); })} /></div>}
                  <div className="a-qt c">
                    {/* Qty is the sum of the sizes. With no sizes entered, typing here makes it a one-size item (hats, koozies). */}
                    <input type="number" min="0" step="1" inputMode="numeric" tabIndex={l.oneSize ? 0 : -1} className={"pre qty" + (sized ? " locked" : "")} readOnly={sized}
                      title={sized ? "Total of the sizes below. Clear the sizes to type a single qty." : "Click to enter a qty for a one-size item (hats, koozies, bags)"}
                      value={sized ? lc?.qty ?? 0 : l.sizes?.OS || ""} placeholder="0"
                      onChange={(e) => { if (sized) return; update((x) => { const r = x.lines[li]; const v = Math.max(0, Math.floor(+e.target.value || 0)); const osOnly = r.sizeRun?.length === 1 && r.sizeRun[0] === ONE_SIZE; r.oneSize = osOnly || v > 0; r.sizes = v ? { [ONE_SIZE]: v } : {}; }); }} />
                  </div>
                  <div className="a-ea r"><input type="number" step="0.01" min="0" tabIndex={-1} title={l.prog ? `${l.prog.note}. Type a price to override it.` : "Click to override"} aria-label="Price each" className={"pre" + (lc?.hasOv ? " ov" : "") + (l.prog ? " prg" : "")} placeholder={lc ? lc.calcEach.toFixed(2) : ""} value={l.priceOverride ?? ""} onChange={(e) => update((x) => { x.lines[li].priceOverride = e.target.value === "" ? null : +e.target.value; })}
                    onBlur={(e) => { const v = e.target.value === "" ? null : +e.target.value; if (v != null && !isNaN(v) && g.lines.length > 1 && g.lines.some((y, yi) => yi !== li && y.priceOverride !== v)) setAskAll({ li, v }); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></div>
                  <div className="a-to r num"><b>{money(lc?.sub)}</b></div>
                  <div className="a-x">
                    {/* their extras: a stamp at the end of the row, printed or not (Oct 23, Nick: asked when the order is made,
                        "a little stamp next to that row at the end… printed extras or not printed extras"); click to switch */}
                    {l.extras && <span className="gl-stamp" data-notranslate>
                      <button type="button" tabIndex={-1} title={l.extrasPrint === false ? "Their extras, sent back blank. Click: print them" : "Their extras, printed free. Click: don't print them"} onClick={() => update((x) => { const ln = x.lines[li]; ln.extrasPrint = ln.extrasPrint === false ? true : false; })}>{l.extrasPrint === false ? "Not printed extras" : "Printed extras"}</button>
                      <button type="button" tabIndex={-1} className="fee" title={l.extrasFree === false ? "Charged. Click: no charge" : "No charge. Click: charge for them"} onClick={() => update((x) => { const ln = x.lines[li]; if (ln.extrasFree === false) { ln.extrasFree = true; ln.priceOverride = 0; } else { ln.extrasFree = false; if (ln.priceOverride === 0) ln.priceOverride = null; } })}>{l.extrasFree === false ? "charged" : "no charge"}</button>
                      <button type="button" tabIndex={-1} className="x" aria-label="Not extras: charge for this line" title="Not extras: charge for this line" onClick={() => update((x) => { const ln = x.lines[li]; delete ln.extras; delete ln.extrasPrint; delete ln.extrasFree; if (ln.priceOverride === 0) ln.priceOverride = null; })}>×</button>
                    </span>}
                    {l.note == null && noteOpen !== l.id && <button className="btn icon ghost ln-add" type="button" tabIndex={-1} title="Add a note for this line" aria-label="Add a line note" onClick={() => setNoteOpen(l.id)}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 6h14M5 11h14M5 16h8" /></svg></button>}
                    {g.lines.length > 1 && !fixed && <button className="btn icon ghost" type="button" tabIndex={-1} aria-label="Remove garment" onClick={() => update((x) => { x.lines.splice(li, 1); })}>✕</button>}
                  </div>
                </div>
                {(l.note != null || noteOpen === l.id) && (
                  <div className="gl-note">
                    <textarea rows={1} autoFocus={noteOpen === l.id && l.note == null} aria-label="Line note" placeholder="Line description: ship-to, packing, a name…" value={l.note || ""}
                      onChange={(e) => update((x) => { x.lines[li].note = e.target.value; })}
                      onBlur={(e) => { if (!e.target.value.trim()) { setNoteOpen(null); update((x) => { delete x.lines[li].note; }); } }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className={"gl-row grp-total gl-r2" + (gc.wholesale ? " ws" : "")}>
          {/* the add buttons on the totals line: one row, not two (Oct 15, Nick: "a lot of wasted space… vertically") */}
          <span className="a-de gl-foot"><span className="gl-adds">
          {/* one button (Oct 21, Nick: "combine these three buttons into one… a drop down") */}
          {!fixed && <details className="ot-more gl-addm" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) e.currentTarget.open = false; }}>
            <summary className="btn sm">+ Add garment ▾</summary>
            <div className="ot-menu">
              <button type="button" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; update((x) => { x.lines.push(newGLine()); }); }}>New garment</button>
              <button type="button" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; update((x) => { const last = x.lines[x.lines.length - 1]; x.lines.push({ ...last, extras: undefined, id: uid(), color: "", sizes: {}, priceOverride: null }); }); }}>Same style, new color</button>
              <button type="button" disabled={!!yth?.busy || !!cmp?.busy} title="The youth, women's, long sleeve… styles that go with this garment, in the same color" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; void openCompanions(); }}>{cmp?.busy ? "Finding companion styles…" : "Companion style (youth, women's…)"}</button>
            </div>
          </details>}
          </span><span className="lbl2">Total pieces</span></span>
          <b className="a-qt c num">{gc.qty}</b>
          <b className="a-to r num">{money(gc.sub)}</b>
        </div>
        {ythNote && !yth && (
          <div className="yth-note">{ythNote.text}
            {ythNote.youthLi >= 0 && <button type="button" className="linkbtn" onClick={() => void addYouth(ythNote.youthLi, ythNote.li)}>Not right?</button>}
            <button type="button" className="btn icon ghost sm" aria-label="Close" onClick={() => setYthNote(null)}>✕</button>
          </div>
        )}
        {cmp && (() => {
          const l = g.lines[cmp.li];
          return (
            <div className="cmp-bg" role="dialog" aria-modal="true" aria-label="Companion styles" onClick={() => setCmp(null)}>
              <div className="cmp" onClick={(e) => e.stopPropagation()}>
                <div className="cmp-h">
                  <div><b>Companion styles for {l?.brand ? `${l.brand} ` : ""}{l?.style}</b>{cmp.title && <div className="faint">{cmp.title}</div>}</div>
                  <button type="button" className="btn icon ghost sm" aria-label="Close" onClick={() => setCmp(null)}>✕</button>
                </div>
                <div className="cmp-b">
                  {cmp.busy ? <div className="faint">Asking SanMar…</div> : null}
                  {!cmp.busy && cmp.err ? <div className="ink-warn">{cmp.err}</div> : null}
                  {!cmp.busy && !cmp.err && !cmp.kinds.length ? <div className="faint">SanMar doesn&apos;t list companion styles for {l?.style}. Type one below{l?.style ? ", or find the youth style" : ""}.</div> : null}
                  {cmp.kinds.map((k) => (
                    <div key={k.kind} className="cmp-k">
                      <div className="cmp-kh">{k.kind}</div>
                      <div className="cmp-items">
                        {k.items.map((x) => (
                          <button key={x.style} type="button" className="cmp-it" onClick={() => void putCompanion(cmp.li, x.style, x.brand, k.kind, k.kind === "Youth" && !x.remembered)} title={`Add ${x.style} in ${l?.color || "the same color"}`}>
                            <span className="cmp-pic">{x.image ? <img src={x.image} alt="" loading="lazy" /> : null}</span>
                            <span className="cmp-t"><b>{x.style}</b><small>{x.title}</small>
                              {l?.color && x.inColor != null ? <em className={x.inColor ? "ok" : "no"}>{x.inColor ? `Comes in ${l.color}` : `No ${l.color}`}</em> : null}
                              {x.remembered ? <em className="ok">Picked before</em> : null}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="cmp-f">
                  <input type="text" value={cmp.typed} placeholder="Another style #" aria-label="Another style number" onChange={(e) => setCmp({ ...cmp, typed: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter" && cmp.typed.trim()) void putCompanion(cmp.li, cmp.typed, l?.brand || "", "Companion", false); }} />
                  <button type="button" className="btn sm" disabled={!cmp.typed.trim()} onClick={() => void putCompanion(cmp.li, cmp.typed, l?.brand || "", "Companion", false)}>Add it</button>
                  {!cmp.busy && !cmp.kinds.some((k) => k.kind === "Youth") && <button type="button" className="btn sm ghost" onClick={() => { const li = cmp.li; setCmp(null); void addYouth(null, li); }}>Find the youth style</button>}
                </div>
              </div>
            </div>
          );
        })()}
        {yth && !yth.busy && (
          <div className="yth-ask">
            <b>Youth style for {yth.brand ? `${yth.brand} ` : ""}{yth.adult}?</b> <span className="faint">It&apos;s remembered for next time.</span>
            {yth.guesses.length > 0 && <div className="yth-g">{yth.guesses.map((x) => (
              <button key={x.style} type="button" className="chip" title={x.title} onClick={() => void putYouth(yth.li, yth.fix, x.style, x.brand, x.supplier, "staff")}><b>{x.style}</b> <small>{x.title.replace(/\.\s*\S+$/, "")}</small></button>))}</div>}
            <div className="yth-k">
              <input type="text" value={yth.typed} placeholder="Youth style #" aria-label="Youth style number" autoFocus
                onChange={(e) => setYth({ ...yth, typed: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" && yth.typed.trim()) void putYouth(yth.li, yth.fix, yth.typed, yth.brand, undefined, "staff"); }} />
              <button type="button" className="btn sm primary" disabled={!yth.typed.trim()} onClick={() => void putYouth(yth.li, yth.fix, yth.typed, yth.brand, undefined, "staff")}>{yth.fix != null ? "Change it" : "Add youth"}</button>
              <button type="button" className="btn sm ghost" onClick={() => setYth(null)}>Cancel</button>
            </div>
          </div>
        )}

        {/* the mockup big on the left, the imprints beside it (Oct 15, Nick: "make it large and move to the left of the
            imprint… about 3 times larger… all the imprint methods and info to the right") */}
        <div className="imp-sec">
        <div className="lbl gsec">Imprints
          {tagFin && !fixed && <label className="check tagp-cb" title="Remove the maker's tags and print the customer's label inside the neck"><input type="checkbox" checked={tagOn} onChange={(e) => tick(tagFin.id, e.target.checked)} />Tag Print<span className="faint"> · remove the maker&apos;s tags and print their label</span></label>}
        </div>
        <div className="imp-wrap">
        <div className="imp-mock">
          {(g.mockupThumbs || []).filter((p) => thumbUrls?.[p]).length
            // the first mockup big, the rest small under it (Oct 20, Nick: six onesie colors stacked full size made the
            // group five screens long)
            // every mockup opens big in a pop-up, with the other colors to flip through (Oct 21, Nick)
            ? <MockGallery urls={[...new Set((g.mockupThumbs || []).filter((p) => thumbUrls?.[p]))].map((p) => thumbUrls![p])} />
            : <div className="mk-none">{g.mockupSkipped ? "No mockup" : "No mockup yet"}</div>}
          {/* the customer's own mockup isn't shown here: it's a reference in Production notes & files, stamped */}
          {onMockup && <button className={"btn sm" + (locked || !g.mockupAt ? " primary" : "")} type="button" onClick={startMockup} title={mockupBlock || undefined}>{g.mockupAt ? "Edit mockup" : "Create mockup"}</button>}
          {onRemoveMockup && g.mockupAt && <button className={"btn sm ghost danger" + (armed === "mk" + g.id ? " armed" : "")} type="button" title="Take this mockup off the order (it's archived, not deleted) so you can make a new one"
            onClick={() => (armed === "mk" + g.id ? onRemoveMockup() : arm("mk" + g.id))}>{armed === "mk" + g.id ? "Remove the mockup?" : "Remove mockup"}</button>}
          {mockupExtra}
          {g.mockupAt && !mockupExtra && <span className="faint mk-when">Saved {new Date(g.mockupAt).toLocaleDateString()}</span>}
          {blockMsg && mockupBlock && <span className="ink-warn" style={{ margin: 0 }}>{blockMsg}</span>}
        </div>
        <div className="imprints">
          {askAll && (
            <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Same price for the group" onClick={() => setAskAll(null)}>
              <div className="dla" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
                <h3>Change every item in this group to ${askAll.v.toFixed(2)}?</h3>
                <p className="dla-sub">{g.lines.length} items in this group. Just this one keeps the others as they are.</p>
                <div className="dla-acts"><button type="button" className="btn ghost" onClick={() => setAskAll(null)}>Just this one</button><button type="button" className="btn primary" autoFocus onClick={() => { const v = askAll.v; setAskAll(null); update((x) => { x.lines.forEach((y) => { if (!y.extras) y.priceOverride = v; }); }); }}>Yes, all {g.lines.filter((y) => !y.extras).length}</button></div>
              </div>
            </div>
          )}
          {locked && askSkip && (
            <div className="confirm-bar">
              <span>You haven&apos;t created a mockup for this group yet. Are you sure you want to fill in the imprints without one?</span>
              <button className="btn sm primary" type="button" onClick={startMockup}>Create mockup</button>
              <button className="btn sm" type="button" onClick={() => { setAskSkip(false); update((x) => { x.mockupSkipped = true; }); }}>Continue without a mockup</button>
              <button className="btn sm ghost" type="button" onClick={() => setAskSkip(false)}>Cancel</button>
            </div>
          )}
          <div className={"mk-lock" + (locked ? " on" : "") + (locked && needMockup ? " need" : "")}>
          {locked && (needMockup
            // the customer's builder: a small grayed-out outline of the prints, not the whole form under a cover (Oct 24,
            // Nick: "this grayed out area, it shouldn't even be that big… just a grayed out version of that")
            ? <div className="mk-need-sum" role="note">
                {g.imprints.map((d, di) => <div key={d.id} className="mk-need-row"><b>{g.imprints.length > 1 ? `Print ${di + 1}` : "Print"}</b><span>{[d.location, METHODS[d.method], d.method === "screen" ? `${d.colors >= 11 ? "Full color" : `${d.colors || 1} color${(d.colors || 1) > 1 ? "s" : ""}`}` : ""].filter(Boolean).join(" · ")}</span><span>Logo</span><span>Size</span></div>)}
                <small>{needMockup}</small>
              </div>
            : <button type="button" className="mk-cover" aria-label="Imprints are locked until a mockup is created" onClick={() => setAskSkip(true)}><span>Create a mockup first — or click here to fill this in without one</span></button>)}
          <div inert={locked || fixed || undefined} className="mk-body">
          {/* each print as a card beside the mockup (Oct 15, Nick: "rework how this is organized now that you have more
              space"): what and where on top, ink and size under it, notes, then the art */}
          <div className={"imp-cards" + (frozen ? " ro" : "")}>
            {g.imprints.map((d, di) => frozen ? (
              <PrintRow key={d.id} d={d} inksLine={inkCtl(d)} extra={screenCtl(d)} listed={gc.lines.length > 0 && gc.lines.every((lc) => lc.hasOv)} hex={shirtHex} n={g.imprints.length > 1 ? di + 1 : 0} designs={designs || []} urls={designUrls || {}} each={hidePrices ? null : money(gc.imprints[di]?.each)} detailsHref={detailsHref} onMockup={startMockup} />
            ) : (
              <div key={d.id} className="imp-card">
                <div className="imp-card-h">
                  <b>{g.imprints.length > 1 ? `Print ${di + 1}` : "Print"}</b><span>{[d.location, METHODS[d.method]].filter(Boolean).join(" · ")}</span>
                  <span className="spacer" />
                  {!hidePrices && <span className="imp-each"><b className="num">{money(gc.imprints[di]?.each)}</b> each</span>}
                  {!frozen && <button className="btn icon ghost" type="button" aria-label="Remove imprint" onClick={() => update((x) => { x.imprints.splice(di, 1); })}>✕</button>}
                </div>
                <div className={"imp-body" + (!!onMockup && !g.mockupSkipped ? " has-logo" : "")}>
                {!!onMockup && !g.mockupSkipped && <LogoTile imprint={d} designs={designs || []} urls={designUrls || {}} onMockup={startMockup} />}
                {(
                <div className="imp-grid">
                  <div className="f-method"><span className="imp-l">Method</span><select aria-label="Method" value={d.method} onChange={(e) => update((x) => { x.imprints[di].method = e.target.value as Method; })}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                  <div className="f-loc"><span className="imp-l">Location</span>{LOCATIONS.includes(d.location)
                      ? <select aria-label="Location" value={d.location} onChange={(e) => update((x) => { x.imprints[di].location = e.target.value === "__custom" ? "" : e.target.value; })}>{LOCATIONS.map((z) => <option key={z} value={z}>{z}</option>)}<option value="__custom">Custom…</option></select>
                      : <div className="loc-custom"><input type="text" autoFocus={!d.location} aria-label="Custom location" placeholder="Custom location" value={d.location} onChange={(e) => update((x) => { x.imprints[di].location = e.target.value; })} /><button type="button" className="btn icon ghost" tabIndex={-1} title="Back to the location list" aria-label="Back to the location list" onClick={() => update((x) => { x.imprints[di].location = "Full Front"; })}>▾</button></div>}</div>
                  <div className="f-col"><span className="imp-l">Colors</span>{d.method === "screen" || d.method === "embroidery"
                      ? <select aria-label="Number of colors" value={d.method === "embroidery" ? Math.min(d.colors, 15) : d.colors} onChange={(e) => update((x) => { x.imprints[di].colors = +e.target.value; })}>{(d.method === "embroidery" ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).map((n) => <option key={n} value={n}>{n}</option>)}{d.method === "screen" && <option value={FULL_COLOR}>Full color</option>}</select>
                      : <span className="faint" style={{ fontSize: 12 }}>Full color</span>}</div>
                  <div className="f-ink"><span className="imp-l">Ink or thread / PMS</span>
                    <div className={"ink-combo" + (d.confirm?.ink ? " unconf" : "")} title={d.confirm?.ink ? "Reorder Details Needed: our best guess at the ink, production confirms it" : undefined}>
                        <InkField list={d.method === "embroidery" ? THREAD_COLORS : INK_COLORS} placeholder={d.method === "embroidery" ? "Type a thread color" : "Type a color or PMS"} value={d.inks} bad={!!inkMismatch(d)} title={inkMismatch(d) || ""} onChange={(v) => update((x) => { x.imprints[di].inks = v; })} />
                        <select aria-label={d.method === "embroidery" ? "Add a thread color" : "Add a Wilflex RFU ink"} tabIndex={-1} value="" onChange={(e) => { const v = e.target.value; if (v) update((x) => { const cur = x.imprints[di].inks.trim().replace(/,\s*$/, ""); x.imprints[di].inks = cur ? `${cur}, ${v}` : v; }); }}>
                          <option value="" hidden>▾</option>
                          {(d.method === "embroidery" ? THREAD_COLORS : INK_COLORS).map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      {inkMismatch(d) && <div className="ink-warn">{inkMismatch(d)}</div>}
                  </div>
                  <div className="f-size"><span className="imp-l">Print size</span><div className={d.confirm?.size ? "unconf" : undefined} title={d.confirm?.size ? "Reorder Details Needed: our best guess at the size, production confirms it" : undefined}><SizeField value={d.size} onChange={(v) => update((x) => { x.imprints[di].size = v; })} /></div>
                      {d.size.trim() && <button type="button" className={"cs-tag" + (d.sizeFrom === "customer" ? " on" : "")} title={d.sizeFrom === "customer" ? "The customer asked for this size: the Mockup Creator asks before changing it. Click to unmark." : "Did the customer ask for this exact size? Mark it so it isn't changed by accident."} onClick={() => update((x) => { x.imprints[di].sizeFrom = x.imprints[di].sizeFrom === "customer" ? undefined : "customer"; })}>{d.sizeFrom === "customer" ? "🔒 Customer's size" : "Customer's size?"}</button>}</div>
                  <div className="f-drop"><span className="imp-l">Drop</span><label className="sz-dim">
                        <InchInput label="Drop in inches (blank = standard)" placeholder="Standard" num={d.drop || ""} onNum={(v) => update((x) => { x.imprints[di].drop = v; })} />
                      </label></div>
                  <div className="f-notes"><span className="imp-l">Notes</span><input type="text" aria-label="Imprint notes" placeholder='3" below collar' value={d.notes} onChange={(e) => update((x) => { x.imprints[di].notes = e.target.value; })} /></div>
                </div>
                )}
                </div>
                {screenCtl(d) && <div className="imp-scr">{screenCtl(d)}</div>}
                {inkCtl(d, false) && <div className="imp-scr">{inkCtl(d, false)}</div>}
                {/* retail prints have no screens line: the fashion hit / soft hand choice on its own (Oct 16, Nick) */}
                {d.method === "screen" && d.colors < FULL_COLOR && !scrImps.includes(d) && (
                  <div className="imp-hit">
                    <label className="check" title="No underbase: each color printed, flashed and printed again through the same screen. Priced the same."><input type="checkbox" checked={d.printStyle === "fashion"} onChange={(e) => update((x) => { x.imprints[di].printStyle = e.target.checked ? "fashion" : undefined; if (e.target.checked) x.imprints[di].underbase = undefined; })} />Fashion hit (no underbase)</label>
                    <label className="check" title="Soft hand additive mixed into the inks"><input type="checkbox" checked={!!d.softHand} onChange={(e) => update((x) => { x.imprints[di].softHand = e.target.checked || undefined; })} />Soft hand</label>
                  </div>
                )}
                {d.confirm && (d.confirm.size || d.confirm.ink) && <div className="imp-unconf">
                    <span><b>Reorder Details Needed</b> <span className="faint">Our best guess: {d.confirm.why}.</span></span>
                    {detailsHref ? <a className="btn sm" href={detailsHref} title="Production confirms the size and inks we printed before">Reorder Details</a> : null}
                </div>}
                <div className="imp-art">
                      {!(onMockup && !g.mockupSkipped) && <DesignPick imprint={d} designs={designs || []} urls={designUrls || {}} canUpload={!!onUploadDesign} onStar={onStarDesign}
                        onPick={(des) => update((x) => {
                          const im = x.imprints[di];
                          im.design_id = des?.id || undefined;
                          // bring the design's ink info along when the imprint doesn't have any yet
                          if (des && !im.inks.trim() && des.inks) im.inks = des.inks;
                          if (des && (im.method === "screen" || im.method === "embroidery") && des.colors && !im.inks.trim()) im.colors = des.colors;
                        })}
                        onUpload={async (f, name) => { if (!onUploadDesign) return; const des = await onUploadDesign(f, name); if (des) update((x) => { x.imprints[di].design_id = des.id; }); }} />}
                      {gc.wholesale && d.method === "embroidery" && settings.wholesale.embPer1k ? (
                        <div className="row ct-extra">
                          {d.method === "embroidery" && <label>Stitches <input type="number" min={0} step={500} aria-label="Stitch count" placeholder={String(settings.wholesale.embStitches || 6000)} value={d.stitches ?? ""} onChange={(e) => update((x) => { x.imprints[di].stitches = e.target.value ? Math.max(0, Math.round(+e.target.value)) : undefined; })} /><span className="faint">{(settings.wholesale.embStitches || 6000).toLocaleString()} included, {money(settings.wholesale.embPer1k)} each 1,000 over</span></label>}
                        </div>
                      ) : null}
                      {(() => {
                        // a small print on a big location (3.5" on the Full Front) is usually a left chest
                        const m = (d.size || "").match(/^([\d.]+)/); if (!m) return null;
                        const des = (designs || []).find((z) => z.id === d.design_id);
                        const r = des?.width_px && des?.height_px ? des.height_px / des.width_px : 0;
                        const tall = /tall/i.test(d.size), v = +m[1];
                        const w = tall ? (r ? v / r : 0) : v, h = tall ? v : r ? v * r : 0;
                        const sug = d.keepLocation ? [] : smallerSpot(d.location, w || h, h);
                        if (!sug.length) return null;
                        return (
                          <div className="ink-warn row" style={{ gap: 6, marginTop: 4 }}>
                            <span>{v}&quot; is small for the {d.location}. Should this be {sug.join(" or ")}?</span>
                            {sug.map((z) => <button key={z} type="button" className="btn sm" onClick={() => update((x) => { x.imprints[di].location = z; })}>{z}</button>)}
                            <button type="button" className="btn sm ghost" onClick={() => update((x) => { x.imprints[di].keepLocation = true; })}>Keep {d.location}</button>
                          </div>
                        );
                      })()}
                </div>
              </div>
            ))}
          </div>
          {tagOn && tagFin && (() => {
            // the tag print as a print row like the ones above (Oct 21, Nick: "make it look exactly like the thing
            // above… the little mock-up on the left")
            const live = (neckSets || []).filter((x) => !x.archived), cur = setFor(neckSets, g.neckLabel);
            const ink = cur?.ink || "Light gray";
            return (
              <div className="pr pr-tag">
                <div className="pr-logo pr-tag-pic" style={{ background: shirtHex }} title={cur ? `${cur.name || "Their tag"}: inside the neck` : "No tag art on file yet"}>
                  {cur ? <TagTile set={cur} size={mainSize([g])} shirtHex={shirtHex} /> : <span>No tag yet</span>}
                </div>
                <div className="pr-main">
                  <div className="pr-top">
                    <b>Tag Print</b>
                    <span className="pr-how">Inside the neck</span>
                    {!hidePrices && <span className="pr-each">each <span className="qp-amt-in tagp-amt"><span>$</span><input type="number" step="0.05" min="0" inputMode="decimal" aria-label="Tag print price a piece" value={g.tagPrice ?? ""} placeholder={(+tagFin.price).toFixed(2)}
                      onChange={(e) => update((x) => { x.tagPrice = e.target.value === "" ? undefined : Math.max(0, +e.target.value); })} /></span></span>}
                  </div>
                  <div className="pr-specs">
                    <span>1 color</span>
                    <span className="pr-ink">{ink}</span>
                    <span>{cur?.widthIn || 2.5}&quot; wide</span>
                    <span>The maker&apos;s tag removed</span>
                  </div>
                  <div className="pr-art tagp-which">
                    {live.length > 1 ? (
                      <select value={cur?.id || ""} onChange={(e) => update((x) => { x.neckLabel = e.target.value || undefined; })} aria-label="Which tag">
                        {!cur && <option value="">Pick their tag…</option>}
                        {live.map((x) => <option key={x.id} value={x.id}>{x.name || "Tag"}</option>)}
                      </select>
                    ) : cur ? <span>{cur.name || "Their tag"}</span> : <span className="faint">No tag art on file.</span>}
                    {customerId && <a className="linkbtn" href={`/shop/customers/${customerId}`} target="_blank" rel="noreferrer">{cur ? "Change their tag art ↗" : "Add their tag art ↗"}</a>}
                    <button type="button" className="linkbtn danger" onClick={() => tick(tagFin.id, false)}>Remove</button>
                  </div>
                  {cur?.note && <div className="pr-notes">{cur.note}</div>}
                </div>
              </div>
            );
          })()}
          {priceLine}
          <div className="row" style={{ gap: 8 }}>
          {!frozen && <button className="btn sm" type="button" onClick={() => update((x) => { const used = x.imprints.map((d) => d.location); x.imprints.push(newImprint(["Full Back", ...LOCATIONS].find((z) => !used.includes(z)) || "Full Front")); })}>+ Add imprint</button>}
          </div>
          </div>
          </div>
        </div>
        </div>
        </div>

        {hasFoot && <div className="grp-foot">
          <div className={"grp-foot-l mk-lock" + (locked ? " on" : "")}>
            {locked && <button type="button" className="mk-cover" tabIndex={-1} aria-label="Finishing is locked until a mockup is created" onClick={() => { if (!needMockup) setAskSkip(true); }} />}
            <div inert={locked || fixed || undefined} className="mk-body">
            {(inksSec || embImps.length > 0) && (
              <div className="sbx">
                {inksSec ? <div className="sbx-sec">
                  <div className="sbx-h gsec"><span>Inks</span></div>
                  {(g.specialtyInk || g.specialtyInkSet) && inkRate ? (
                    <div className="sbx-r">
                      <span className="sbx-loc">Poly / dyed</span>
                      <span className="faint" title={g.fabricNote || ""}>{g.specialtyInkSet ? "set by hand" : g.fabricNote || "specialty ink"}</span>
                      {!hidePrices && <b className={"num" + (g.specialtyInk ? "" : " sbx-off")}>{money(g.specialtyInk ? inkRate : 0)}/pc</b>}
                      <label className="check sbx-end"><input type="checkbox" checked={!g.specialtyInk} onChange={(e) => update((x) => { x.specialtyInk = !e.target.checked || undefined; x.specialtyInkSet = e.target.checked || undefined; })} />No charge</label>
                    </div>
                  ) : null}
                </div> : null}
                {embImps.length > 0 && <div className="sbx-sec">
                  <div className="sbx-h gsec"><span>Digitizing</span></div>
                  {embImps.map((d) => (
                    <div key={d.id} className="sbx-r"><span className="sbx-loc">{d.location || "Embroidery"}</span>{d.stitches ? <span className="faint">{d.stitches.toLocaleString()} stitches</span> : null}{!hidePrices && <b className="num">{money(wpl.digitizing)}</b>}</div>
                  ))}
                  {embList.length > 0 && <div className="sbx-r">{embList.map((f) => <label key={f.id} className="check"><input type="checkbox" checked={(g.finishing || []).includes(f.id)} onChange={(e) => tick(f.id, e.target.checked)} />{f.name}{!hidePrices && <span className="faint"> {money(f.price)}/pc</span>}</label>)}</div>}
                </div>}
              </div>
            )}
            {finishingAt === "group" && finList.length > 0 && (
        <div className="imprints">
                <div className="lbl gsec" style={{ marginBottom: 6 }}>Finishing</div>
                <FinishingPicker list={finList.filter((f) => !isRelabel(f))} custom={g.customFin || []} isOn={(id) => (g.finishing || []).includes(id)} onToggle={tick} hidePrices={hidePrices}
                  onAddCustom={(f) => update((x) => { x.customFin = [...(x.customFin || []), f]; x.finishing = [...new Set([...(x.finishing || []), f.id])]; })}
                  onRemoveCustom={(id) => update((x) => { x.customFin = (x.customFin || []).filter((f) => f.id !== id); x.finishing = (x.finishing || []).filter((y) => y !== id); })}
                  onSave={saveFinishing(!!gc.wholesale)} />
              </div>
            )}
            </div>
          </div>
        </div>}
      </div>
    </section>
  );
}


/** Ink colors box: grows downward as it fills, and completes Wilflex RFU names.
 *  Type part of a color ("nav") then Space or Enter to fill it in ("Navy, "). */
export function InkField({ value, bad, title, onChange, list = INK_COLORS, placeholder = "Type a color or PMS" }: { value: string; bad: boolean; title: string; onChange: (v: string) => void; list?: readonly string[]; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + 2 + "px";
  }, [value]);
  const cut = value.lastIndexOf(",");
  const head = cut >= 0 ? value.slice(0, cut + 1) : "";
  const part = (cut >= 0 ? value.slice(cut + 1) : value).trim();
  const matches = part ? list.filter((c) => c.toLowerCase().startsWith(part.toLowerCase())).sort((x, y) => x.length - y.length) : [];
  const exact = matches.find((c) => c.toLowerCase() === part.toLowerCase());
  const best = exact || matches[0];
  const fill = (c: string) => onChange(`${head}${head ? " " : ""}${c}, `.replace(/^\s+/, ""));
  return (
    <div className="ink-field">
      <textarea ref={ref} rows={1} aria-label="Ink colors" className={bad ? "bad" : ""} title={title} placeholder={placeholder} value={value}
        onChange={(e) => onChange(e.target.value.replace(/\n/g, " "))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (best) fill(best);
          } else if (e.key === " " && matches.length === 1 && !exact) {
            e.preventDefault();
            fill(matches[0]);
          }
        }} />
      {best && best.toLowerCase() !== part.toLowerCase() && <div className="ink-hint">{matches.length === 1 ? "Space or Enter" : "Enter"} → {best}</div>}
    </div>
  );
}

/** Print size: fill width OR height (inches). Once one has a number the other box hides.
 *  Stored on the imprint as text, e.g. 11" wide or 4" tall. */
export function SizeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const v = (value || "").trim();
  const m = v.match(/^(.*?)\s*\b(w|wide|width|h|high|tall|height)$/i);
  const num = (m ? m[1] : v).replace(/["]/g, "").replace(/\s*(in\.?|inch(es)?)$/i, "").trim();
  const dim: "W" | "H" | "" = !v ? "" : m && /^(h|tall)/i.test(m[2]) ? "H" : "W";
  const set = (d: "W" | "H", raw: string) => {
    const t = raw.replace(/["]/g, "").trim();
    const isMax = /^m(a(x)?)?$/i.test(t);
    onChange(t ? `${isMax ? t.toUpperCase() : `${t}"`} ${d === "W" ? "wide" : "tall"}` : "");
  };
  const box = (d: "W" | "H") => (
    <label className={"sz-dim" + (dim === d ? " on" : "")} key={d}>
      <InchInput label={d === "W" ? "Print width in inches" : "Print height in inches"} placeholder={d === "W" ? "Width" : "Height"} num={dim === d ? num : ""} onNum={(v) => set(d, v)} />
      <span>{dim === d ? (d === "W" ? "wide" : "tall") : d}</span>
    </label>
  );
  return <div className="sz-field">{[dim !== "H" ? box("W") : null, dim !== "W" ? box("H") : null]}</div>;
}

/** Number box that shows inches as 11" (the quote follows the number). */
function InchInput({ num, onNum, label, placeholder }: { num: string; onNum: (v: string) => void; label: string; placeholder: string }) {
  const numeric = /^[\d.\/ -]+$/.test(num);
  const shown = num ? (numeric ? `${num}"` : num.toUpperCase()) : "";
  return (
    <input type="text" inputMode="decimal" aria-label={label} placeholder={placeholder} value={shown}
      onChange={(e) => {
        let raw = e.target.value;
        // backspacing over the " removes the last digit instead
        if (numeric && shown && !raw.includes('"') && raw === num) raw = raw.slice(0, -1);
        onNum(raw.replace(/["]/g, "").replace(/\s*(in\.?|inch(es)?)$/i, "").trim());
      }} />
  );
}

export type SSHit = { styleID: number; brand: string; style: string; title: string; image: string; supplier?: "ss" | "sanmar" };
const inCatalog = (catalog: Garment[], h: SSHit) => h.supplier === "sanmar" ? catalog.some((c) => c.supplier === "sanmar" && (c.supplier_style || c.style).toLowerCase() === h.style.toLowerCase()) : catalog.some((c) => c.ss_style_id === h.styleID);
/** Style # box: type a number and pick from your catalog or from every matching S&S and SanMar style. */
export function StylePicker({ value, catalog, busy, onType, onPick, onPickSS }: {
  value: string; catalog: Garment[]; busy: boolean;
  onType: (v: string) => void; onPick: (g: Garment) => void; onPickSS: (h: SSHit) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<SSHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const q = value.trim().toLowerCase();
  useEffect(() => {
    if (!open || q.length < 2) { setHits([]); return; }
    let live = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/ss/search?q=${encodeURIComponent(q)}`);
        const j = await r.json().catch(() => ({}));
        if (live) setHits(Array.isArray(j.results) ? j.results : []);
      } finally { if (live) setLoading(false); }
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [q, open]);
  const stripped = q.replace(/^[a-z]{1,2}(?=\d)/, "");
  const rank = (b: string) => { const i = ["gildan", "next level", "bella", "hanes"].findIndex((x) => (b || "").toLowerCase().startsWith(x)); return i < 0 ? 4 : i; };
  const local = q ? catalog.filter((c) => [c.style, `${c.brand} ${c.style}`].some((x) => { const v = x.toLowerCase(); return v.startsWith(q) || v.startsWith(stripped) || v.includes(" " + stripped); })).sort((a, b) => rank(a.brand) - rank(b.brand) || a.style.localeCompare(b.style)).slice(0, 8) : [];
  const items: ({ kind: "cat"; g: Garment } | { kind: "ss"; h: SSHit })[] = [
    ...local.map((g) => ({ kind: "cat" as const, g })),
    ...hits.filter((h) => !inCatalog(catalog, h)).map((h) => ({ kind: "ss" as const, h })),
  ];
  const choose = (i: number) => {
    const it = items[i];
    if (!it) return;
    setOpen(false);
    if (it.kind === "cat") onPick(it.g); else onPickSS(it.h);
  };
  return (
    <div className="style-pick">
      <input type="text" aria-label="Style number" placeholder="Style #" value={value} autoComplete="off"
        onChange={(e) => { onType(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !items.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); choose(active); }
          else if (e.key === "Escape") setOpen(false);
        }} />
      {open && q.length >= 2 && (items.length || loading) ? (
        <div className="style-menu" role="listbox">
          {items.map((it, i) => (
            <div key={it.kind === "cat" ? "c" + it.g.id : (it.h.supplier === "sanmar" ? "m" + it.h.style : "s" + it.h.styleID)} role="option" aria-selected={i === active}
              className={"sm-item" + (i === active ? " on" : "")} onMouseDown={(e) => { e.preventDefault(); choose(i); }} onMouseEnter={() => setActive(i)}>
              <b>{it.kind === "cat" ? `${it.g.brand} ${it.g.style}` : `${it.h.brand} ${it.h.style}`}</b>
              <span>{it.kind === "cat" ? it.g.description : it.h.title}</span>
              {it.kind === "ss" && <em>{it.h.supplier === "sanmar" ? "SANMAR" : "S&S"}</em>}
            </div>
          ))}
          {loading && <div className="sm-note">Searching S&amp;S and SanMar…</div>}
          {busy && <div className="sm-note">Pulling it in…</div>}
        </div>
      ) : null}
    </div>
  );
}

/** Color box: click shows the style's full color list (even when a color is already chosen); typing filters it. */
export function ColorPicker({ value, colors, onChange }: { value: string; colors: string[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(0);
  const q = value.trim();
  // forgiving: "white royal", "white - royal", "white-royal" all find "White/ Royal" (rankColors, Oct 20)
  const list = typed && q ? rankColors(q, colors) : colors;
  const pick = (c: string) => { onChange(c); setOpen(false); setTyped(false); };
  return (
    <div className="style-pick">
      <input type="text" aria-label="Color" placeholder="Color" value={value} autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setTyped(true); setOpen(true); setActive(0); }}
        onFocus={() => { setTyped(false); setOpen(true); setActive(Math.max(0, colors.indexOf(value))); }}
        onClick={() => { if (!open) { setTyped(false); setOpen(true); } }}
        // typed and walked away: snap to the color it plainly means (the best match), so the line gets the real color name
        onBlur={() => setTimeout(() => { const m = typed && q && !colors.includes(value) ? plainlyMeans(q, colors) : null; if (m) onChange(m); setOpen(false); setTyped(false); }, 150)}
        onKeyDown={(e) => {
          if (!open || !list.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(list.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(list[active]); }
          else if (e.key === "Escape") setOpen(false);
        }} />
      {open && list.length > 0 && (
        <div className="style-menu color-menu" role="listbox">
          {list.map((c, i) => (
            <div key={c} role="option" aria-selected={c === value} ref={i === active ? (el) => { el?.scrollIntoView({ block: "nearest" }); } : undefined} className={"sm-item" + (i === active ? " on" : "") + (c === value ? " cur" : "")}
              onMouseDown={(e) => { e.preventDefault(); pick(c); }} onMouseEnter={() => setActive(i)}>
              <b>{c}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Under each imprint: which customer design prints here, with its size worked out from the print size. */
/** a print's logo on the order page: read only, set in the Mockup Creator (Oct 15, Nick: "grey out that section…
 *  see the logo a little larger"), beside the print's fields so it adds no row */
/** a print's screens: what they come to, with a pencil to change underbase / remake (Oct 15, Nick) */
/**
 * A print's notes to read: the shop's own words, without where things came from ("From Printavo #32668. Art from …
 * You said: printed 6 colors…": Oct 21, Nick: "that doesn't need to be there").
 */
const printNotes = (s: string | null | undefined) => cleanPrintNotes(shopNotes(s));

/** A print's inks: a swatch chip each (PMS matches marked), then the PMS charge; the pencil opens "standard, no charge". */
function InkLine({ inks, charged, summary, editable, children, thread }: { inks: { name: string }[]; charged: (name: string) => boolean; summary: React.ReactNode; editable: boolean; children: React.ReactNode; /** an embroidered print: its threads (Madeira, Isacord) */ thread?: boolean }) {
  const [edit, setEdit] = useState(false);
  return (
    <div className="pr-scr pr-inkl">
      <span className="pr-scr-l">{thread ? "Threads" : "Inks"}</span>
      <span className="pr-scr-v">
        {inks.length > 0 && <span className="ink-chips">{inks.map((k) => { const t = thread ? threadByName(k.name) : null; return <span key={k.name} className={"ink-chip" + (charged(k.name) ? " pms" : "")} title={charged(k.name) ? "PMS match: charged" : t?.pms.length ? `PMS ${t.pms[0]}` : undefined}><i style={{ background: t?.hex || colorHex(k.name) || "#d6d6d6" }} />{k.name}</span>; })}</span>}
        {summary}
      </span>
      {editable && <button type="button" className={"pr-scr-ed" + (edit ? " on" : "")} aria-label={edit ? "Done with the PMS charges" : "Change the PMS charges"} title={edit ? "Done" : "PMS charges"} onClick={() => setEdit(!edit)}>
        {edit ? "Done" : <svg viewBox="0 0 24 24" aria-hidden><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></svg>}
      </button>}
      {edit && <span className="pr-scr-opts">{children}</span>}
    </div>
  );
}

/**
 * The group's mockups: the first big, the rest small under it (Oct 20); any of them opens big in a pop-up where the
 * arrows, the arrow keys or the strip of colors flip between them (Oct 21, Nick: "when you click on them, they should
 * blow up… it should toggle to them").
 */
function MockGallery({ urls }: { urls: string[] }) {
  const [at, setAt] = useState<number | null>(null);
  const n = urls.length;
  const go = (d: number) => setAt((i) => (i == null ? i : (i + d + n) % n));
  useEffect(() => {
    if (at == null) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setAt(null); else if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  return <>
    <button type="button" className="mk-big" title="See it bigger" onClick={() => setAt(0)}><img src={urls[0]} alt="Mockup" /></button>
    {n > 1 && <div className="mk-more">{urls.slice(1).map((u, i) => <button type="button" key={u} title="See it bigger" onClick={() => setAt(i + 1)}><img src={u} alt="Mockup" /></button>)}</div>}
    {at != null && (
      <div className="mkz" role="dialog" aria-modal="true" aria-label="Mockup" onClick={() => setAt(null)}>
        <div className="mkz-in" onClick={(e) => e.stopPropagation()}>
          <div className="mkz-pic">
            {n > 1 && <button type="button" className="mkz-arr l" aria-label="Previous" onClick={() => go(-1)}>‹</button>}
            <img src={urls[at]} alt="Mockup" />
            {n > 1 && <button type="button" className="mkz-arr r" aria-label="Next" onClick={() => go(1)}>›</button>}
          </div>
          <div className="mkz-bar">
            {n > 1 && <div className="mkz-strip">{urls.map((u, i) => <button type="button" key={u} className={i === at ? "on" : ""} onClick={() => setAt(i)} aria-label={`Mockup ${i + 1}`}><img src={u} alt="" /></button>)}</div>}
            <span className="spacer" />
            <a className="btn sm ghost" href={urls[at]} target="_blank" rel="noreferrer">Open full size</a>
            <button type="button" className="btn sm" onClick={() => setAt(null)}>Close</button>
          </div>
        </div>
      </div>
    )}
  </>;
}

function ScreensLine({ summary, children }: { summary: React.ReactNode; children: React.ReactNode }) {
  const [edit, setEdit] = useState(false);
  return (
    <div className="pr-scr">
      <span className="pr-scr-l">Screens</span>
      <span className="pr-scr-v">{summary}</span>
      <button type="button" className={"pr-scr-ed" + (edit ? " on" : "")} aria-label={edit ? "Done changing the screens" : "Change the screens (underbase, remake)"} title={edit ? "Done" : "Underbase or remake"} onClick={() => setEdit(!edit)}>
        {edit ? "Done" : <svg viewBox="0 0 24 24" aria-hidden><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></svg>}
      </button>
      {edit && <span className="pr-scr-opts">{children}</span>}
    </div>
  );
}

/**
 * A print as the Mockup Creator set it, to read (Oct 15, Nick: "read only… filled in from the mockup creator… looks
 * messy, don't like all the grey, rethink the style"): the logo, then where and how it prints and its price, one line
 * of specs, the notes. White, no boxes; a hairline between prints.
 */
/** The logo picture in the inks picked for it in the Mockup Creator (imprint.inkMap), else as uploaded. */
const paintedCache = new Map<string, string>();
function usePainted(url: string, imp: { design_id?: string; inkMap?: Imprint["inkMap"] }): string {
  const im = imp.inkMap && imp.inkMap.design === imp.design_id ? imp.inkMap.map : null;
  const want: Record<string, string> = {};
  if (im) for (const [src, v] of Object.entries(im)) if (v.name === "none" || (v.hex && v.hex.toLowerCase() !== src.toLowerCase())) want[src] = v.name === "none" ? "none" : v.hex;
  // keyed by the picture itself too: a fixed logo (the order check's art fixes) is a new file and must repaint (Oct 23:
  // the blown-up logo still showed the gray outline after the blacks were made one)
  const key = url && Object.keys(want).length ? `${url.split("?")[0]}|${JSON.stringify(want)}` : "";
  const [out, setOut] = useState(key ? paintedCache.get(key) || "" : "");
  useEffect(() => {
    if (!key) { setOut(""); return; }
    const hit = paintedCache.get(key);
    if (hit) { setOut(hit); return; }
    let live = true;
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { try { const u = repaintLogo(img, want); paintedCache.set(key, u); if (live) setOut(u); } catch { /* picture can't be read: as uploaded */ } };
    img.src = url;
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, url]);
  return out || url;
}

function PrintRow({ d, n, hex, designs, urls, each, detailsHref, onMockup, extra, inksLine, listed }: { d: Group["imprints"][number]; n: number; hex: string; /** the print's screens line */ extra?: React.ReactNode;
  /** its inks as chips (with PMS matches) */ inksLine?: React.ReactNode; /** the garment prices were typed: "each" is the list price, not what's charged */ listed?: boolean; designs: Design[]; urls: Record<string, string>; each: string | null; detailsHref?: string; onMockup: () => void }) {
  const cur = designs.find((x) => x.id === d.design_id);
  const m = (d.size || "").match(/^([\d.]+)\D*(wide|tall)?/i);
  const val = m ? +m[1] : 0, given: "W" | "H" = m && /tall/i.test(m[2] || "") ? "H" : "W";
  const other = cur && val ? designOther(cur, val, given) : 0;
  const size = val ? (given === "W" ? `${val}" × ${other || "?"}"` : `${other || "?"}" × ${val}"`) : "";
  const colors = d.method === "dtf" || d.colors === FULL_COLOR ? "Full color" : d.colors ? `${d.colors} color${d.colors === 1 ? "" : "s"}` : "";
  // click the logo to see it big (Oct 15, Nick: "you should be able to click it and zoom in")
  const [zoom, setZoom] = useState(false);
  // in the inks picked in the Mockup Creator (Oct 20: the logo here still showed its uploaded green after it was set to yellow)
  const pic = usePainted(cur ? urls[cur.id] || "" : "", d);
  // a visual-only reorder print (Oct 20, Nick): the whole row greyed under a stamp; clicking it asks before anyone goes
  // in to set the details (that's what production confirms and locks in)
  const vis = !!d.visualOnly && !d.confirmed;
  const [ask, setAsk] = useState(false), [opened, setOpened] = useState(false);
  return (
    <div className={"pr" + (vis && !opened ? " pr-vis" : "")}>
      {vis && !opened && <button type="button" className="pr-vis-stamp" onClick={() => setAsk(true)} title="Set the print details (production)"><span><b>Visual mockup</b><small>Production confirming details on print run</small></span></button>}
      {ask && (
        <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Edit the print details" onClick={() => setAsk(false)}>
          <div className="dla" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h3>Edit the print details?</h3>
            <p className="dla-sub">This is a visual mockup: production sets the colors, inks and size on the print run. Editing them now locks in the production notes for this design.</p>
            <div className="dla-acts"><button type="button" className="btn ghost" autoFocus onClick={() => setAsk(false)}>No</button><button type="button" className="btn primary" onClick={() => { setAsk(false); if (detailsHref) window.location.href = detailsHref; else setOpened(true); }}>Yes, edit the details</button></div>
          </div>
        </div>
      )}
      <button type="button" className="pr-logo" style={{ background: hex }} onClick={() => (pic ? setZoom(true) : onMockup())} title={pic ? "See it bigger" : "Pick the logo in the Mockup Creator"}>
        {pic ? <img src={pic} alt="" /> : <span>No logo</span>}
      </button>
      {zoom && pic && <div className="pr-zoom" role="dialog" aria-modal="true" aria-label={cur ? designLabel(cur) : "Logo"} onClick={() => setZoom(false)} onKeyDown={(e) => { if (e.key === "Escape") setZoom(false); }} tabIndex={-1} ref={(el) => el?.focus()}>
        <figure onClick={(e) => e.stopPropagation()}>
          <img src={pic} alt={cur ? designLabel(cur) : ""} style={{ background: hex }} />
          <figcaption><span><b>{cur ? designLabel(cur) : ""}</b>{size ? ` · ${size} on the ${d.location}` : ""}</span><button type="button" className="btn sm" onClick={() => setZoom(false)}>Close</button></figcaption>
          {/* the print's ink (or thread) colors (Oct 15, Nick) */}
          {inkNames(d.inks).length > 0 && <div className="pr-zoom-inks">{inkNames(d.inks).map((k) => <span key={k}><i style={{ background: colorHex(k) || "#ccc" }} />{k}</span>)}</div>}
        </figure>
      </div>}
      <div className="pr-main">
        <div className="pr-top">
          {n > 0 && <span className="pr-n">{n}</span>}
          <b>{d.location || "Print"}</b>
          <span className="pr-how">{METHODS[d.method]}</span>
          {each && <span className="pr-each" title={listed ? "The price list's price for this print. The garment prices were typed, so it's not charged separately." : undefined}>{listed ? "list" : "each"} <b>{each}</b></span>}
        </div>
        {/* visual only: no guessed inks or size anywhere, so nobody takes a guess for how it printed (Oct 20, Nick) */}
        <div className={"pr-specs" + (d.visualOnly && !d.confirmed ? " pr-grey" : "")}>
          {colors && <span>{d.visualOnly && !d.confirmed ? `${colors} (the old job)` : colors}</span>}
          {size && !(d.visualOnly && !d.confirmed && d.sizeFrom !== "customer") && <span>{size}{d.sizeFrom === "customer" ? " 🔒" : ""}</span>}
          {!(d.visualOnly && !d.confirmed) && <span>{d.drop ? `${d.drop}" drop` : "Standard drop"}</span>}
          {d.method === "embroidery" && d.stitches ? <span>{d.stitches.toLocaleString()} stitches</span> : null}
        </div>
        {cur && <div className="pr-art">{designLabel(cur)}</div>}
        {!(d.visualOnly && !d.confirmed) && inksLine}
        {extra}
        {printNotes(d.notes) && <div className="pr-notes">{printNotes(d.notes)}</div>}
        {d.confirm && (d.confirm.size || d.confirm.ink) && <div className="pr-unconf"><b>Reorder details needed</b> <span>Our best guess: {d.confirm.why}.</span>{detailsHref ? <a href={detailsHref}>Reorder Details</a> : null}</div>}
      </div>
    </div>
  );
}

function LogoTile({ imprint, designs, urls, onMockup }: { imprint: { design_id?: string; size: string; inkMap?: Imprint["inkMap"] }; designs: Design[]; urls: Record<string, string>; onMockup?: () => void }) {
  const cur = designs.find((x) => x.id === imprint.design_id);
  const pic = usePainted(cur ? urls[cur.id] || "" : "", imprint);
  const m = (imprint.size || "").match(/^([\d.]+)\D*(wide|tall)?/i);
  const val = m ? +m[1] : 0, given: "W" | "H" = m && /tall/i.test(m[2] || "") ? "H" : "W";
  const other = cur && val ? designOther(cur, val, given) : 0;
  return (
    <button type="button" className="imp-logo" onClick={onMockup} title={cur ? `${designLabel(cur)}: change it in the Mockup Creator` : "Pick the logo in the Mockup Creator"}>
      {cur && pic ? <img src={pic} alt="" /> : <span className="imp-logo-none">No logo</span>}
      <small>{cur ? designLabel(cur) : "Mockup Creator"}</small>
      {cur && val > 0 && other > 0 && <small className="imp-logo-sz">{val}&quot; {given === "W" ? "wide" : "tall"} → {other}&quot; {given === "W" ? "tall" : "wide"}</small>}
    </button>
  );
}

function DesignPick({ imprint, designs, urls, canUpload, onPick, onUpload, onStar, readOnly, onMockup }: {
  imprint: { design_id?: string; size: string }; designs: Design[]; urls: Record<string, string>; canUpload: boolean;
  /** the art is set in the Mockup Creator, not here (Oct 15, Nick: "you shouldn't be able to change the logo or upload
   *  new art from the main order page") */ readOnly?: boolean; onMockup?: () => void;
  onStar?: (d: Design, starred: boolean) => void;
  onPick: (d: Design | null) => void; onUpload: (f: File, name: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const cur = designs.find((x) => x.id === imprint.design_id);
  const m = (imprint.size || "").match(/^([\d.]+)\D*(wide|tall)?/i);
  const val = m ? +m[1] : 0;
  const given: "W" | "H" = m && /tall/i.test(m[2] || "") ? "H" : "W";
  const other = cur && val ? designOther(cur, val, given) : 0;
  return (
    <div className="dp">
      <span className="dp-l">Logo</span>
      {readOnly
        ? <span className="dp-ro">{cur ? <>{urls[cur.id] && <img src={urls[cur.id]} alt="" />}<b>{designLabel(cur)}</b></> : <span className="faint">No logo yet</span>}
            {onMockup && <button type="button" className="linkbtn" onClick={onMockup}>{cur ? "Change in the Mockup Creator" : "Pick it in the Mockup Creator"}</button>}</span>
        : <DesignSearch designs={designs} urls={urls} value={imprint.design_id} onPick={onPick} onStar={onStar} placeholder="Choose the customer's logo…" />}
      {canUpload && !readOnly && (
        <label className="btn sm ghost" style={{ cursor: "pointer" }}>{busy ? "Uploading…" : "Upload new art"}
          <input type="file" hidden accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.ai,.eps,.psd" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; setBusy(true); try { await onUpload(f, f.name.replace(/\.[^.]+$/, "")); } finally { setBusy(false); } }} />
        </label>
      )}
      {cur && val > 0 && other > 0 && <span className="dp-size">{val}&quot; {given === "W" ? "wide" : "tall"} → <b>{other}&quot; {given === "W" ? "tall" : "wide"}</b></span>}
      {cur && !cur.width_px && <span className="faint" style={{ fontSize: 12 }}>Add a preview image to this logo to get its size</span>}
    </div>
  );
}


/** pause after typing a size before the phone moves on to the next size */
const SIZE_ADVANCE_MS = 900;
/**
 * The size boxes for one garment. On a computer: a box per size (Tab moves on). On a phone or tablet the number pad
 * has no Next key, so one entry box stays open and walks the sizes: type 50, pause a moment (a bar shows it's about
 * to move), and it slides to the next size with the keypad still up. Tap any size to jump to it; Enter / Next on
 * keypads that have one moves right away.
 */
function SizeRow<K extends string>({ cols, sizes, onSet, up, off, upSet, onUp }: { cols: K[]; sizes: Partial<Record<K, number>>; onSet: (s: K, raw: string) => void; up: (s: K) => number | undefined;
  /** a size this garment doesn't come in: an empty slot that keeps the columns lined up with the other garments */ off?: (s: K) => boolean;
  /** the 2XL+ charge was typed by hand; onUp sets it (null = back to automatic) */ upSet?: (s: K) => boolean; onUp?: (s: K, v: number | null) => void }) {
  const [editUp, setEditUp] = useState<K | null>(null);
  const [touch, setTouch] = useState(false);
  useEffect(() => { setTouch(typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches); }, []);
  const [at, setAt] = useState<number | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [tick, setTick] = useState(0);
  const row = useRef<HTMLDivElement>(null), box = useRef<HTMLInputElement>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => stop, []);
  // keep the entry box over the size it's filling
  useLayoutEffect(() => {
    if (!touch || at == null || !row.current) return;
    const cell = row.current.querySelectorAll<HTMLElement>(".sz")[at]; if (!cell) return;
    const r = row.current.getBoundingClientRect(), c = cell.getBoundingClientRect();
    setPos({ left: c.left - r.left, top: c.top - r.top, width: c.width, height: c.height });
  }, [touch, at, cols.length]);
  const go = (i: number) => {
    stop(); setAt(i);
    // the same box stays focused (the keypad stays up); select what's there so typing replaces it
    requestAnimationFrame(() => box.current?.select());
  };
  // the next size this garment comes in (an empty slot for another garment's size is skipped)
  const next = (from: number) => { stop(); let i = from + 1; while (i < cols.length && off?.(cols[i]) && !sizes[cols[i]]) i++; if (i < cols.length) go(i); else { setAt(null); box.current?.blur(); } };
  const cells = cols.map((s, si) => {
    const u = up(s), q = sizes[s];
    if (off?.(s) && !q) return <span key={s} className={"szc szc-off" + (s === "YXL" && si < cols.length - 1 ? " ysep" : "")} aria-hidden><span>{s}</span><i className="sz sz-off" /><small className="upc">{"\u00a0"}</small></span>;
    const big = /^[2-6]XL$/.test(s);
    // the 2XL+ charge each: click it to type your own (blank goes back to automatic)
    const upEl = onUp && big
      ? (editUp === s
        ? <input className="upc-in" type="number" step="0.01" min="0" autoFocus defaultValue={u != null ? String(u) : ""} aria-label={`${s} extra charge each`}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditUp(null); }}
            onBlur={(e) => { const t = e.target.value.trim(); onUp(s, t === "" ? null : Math.max(0, +t)); setEditUp(null); }} />
        : <button type="button" tabIndex={-1} className={"upc upc-btn" + (upSet?.(s) ? " set" : "")} onClick={(e) => { e.preventDefault(); setEditUp(s); }} title={upSet?.(s) ? "Typed by hand. Click to change; clear it to go back to automatic." : "Extra charge each for this size. Click to type your own."}>{u ? `+${u}` : "+ $"}</button>)
      : <small className="upc">{u ? `+${u}` : "\u00a0"}</small>;
    return (
      <label key={s} className={"szc" + (s === "YXL" && si < cols.length - 1 ? " ysep" : "")}>
        <span>{s}</span>
        {touch
          ? <button type="button" className={"sz sz-tap" + (q ? " has" : "") + (at === si ? " on" : "")} aria-label={`${s} quantity`} onClick={() => { box.current?.focus(); go(si); }}>{q || ""}</button>
          : <SizeBox q={q} label={`${s} quantity`} onSet={(v) => onSet(s, v)} />}
        {upEl}
      </label>
    );
  });
  if (!touch) return <div className="szrow">{cells}</div>;
  const cur = at == null ? null : cols[at];
  return (
    <div className="szrow sz-walk" ref={row}>
      {cells}
      <input ref={box} className={"sz-entry" + (cur ? " on" : "")} type="text" inputMode="numeric" pattern="[0-9]*" enterKeyHint={at != null && at < cols.length - 1 ? "next" : "done"} autoComplete="off"
        aria-label={cur ? `${cur} quantity` : "Size quantity"} style={pos && cur ? { left: pos.left, top: pos.top, width: pos.width, height: pos.height } : undefined}
        value={cur ? sizes[cur] || "" : ""}
        onChange={(e) => {
          if (at == null || !cur) return;
          const v = e.target.value.replace(/\D/g, "").slice(0, 5);
          onSet(cur, v); stop();
          // a number typed: move on after a short pause (another digit restarts the wait)
          if (v) { setTick((t) => t + 1); const i = at; timer.current = setTimeout(() => next(i), SIZE_ADVANCE_MS); }
        }}
        onKeyDown={(e) => { if (e.key === "Enter" && at != null) { e.preventDefault(); next(at); } }}
        onBlur={() => { stop(); setAt(null); }} />
      {cur && pos && timer.current && <i key={tick} className="sz-wait" style={{ left: pos.left, top: pos.top + pos.height + 1, width: pos.width, animationDuration: `${SIZE_ADVANCE_MS}ms` }} />}
    </div>
  );
}

/**
 * One size's quantity on a computer (Oct 21, Nick: "you should be able to enter zero… I need 0 2XL"): a 0 typed shows
 * as 0 while the box is being typed in (a size with none is blank once you move on). Tab goes size to size; the 2XL+
 * charges under the sizes are clicked, never tabbed to.
 */
function SizeBox({ q, label, onSet }: { q: number | undefined; label: string; onSet: (v: string) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  return <input type="number" min="0" step="1" inputMode="numeric" aria-label={label} className={"sz" + (q || typed === "0" ? " has" : "")}
    value={typed ?? (q ? String(q) : "")} onFocus={(e) => { setTyped(q ? String(q) : ""); e.target.select(); }} onBlur={() => setTyped(null)}
    onChange={(e) => { setTyped(e.target.value); onSet(e.target.value); }} />;
}

/** the tag art itself in its ink, filling the print row's picture box (Oct 21, Nick: "make it fill the box so that it's viewable") */
function TagTile({ set, size, shirtHex }: { set: NeckLabelSet; size: string; shirtHex: string }) {
  const [u, setU] = useState(""), [none, setNone] = useState(false);
  useEffect(() => {
    let off = false;
    labelFor(set, size, shirtHex).then((c) => { if (off) return; if (c) { setU(c.toDataURL("image/png")); setNone(false); } else { setU(""); setNone(true); } }).catch(() => { if (!off) setNone(true); });
    return () => { off = true; };
  }, [set, size, shirtHex]);
  // click to see it big (Oct 21, Nick: "you should be able to zoom in on the tag print")
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (!big) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setBig(false); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [big]);
  if (!u) return <span>{none ? "No picture of the tag" : ""}</span>;
  return <>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={u} alt={`${set.name || "Tag"}, as it prints`} className="tag-zoomable" title="See it bigger" onClick={() => setBig(true)} />
    {big && (
      <div className="mkz" role="dialog" aria-modal="true" aria-label="Tag print" onClick={() => setBig(false)}>
        <div className="mkz-in" onClick={(e) => e.stopPropagation()}>
          <div className="mkz-pic" style={{ background: shirtHex }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt={`${set.name || "Tag"}, as it prints`} className="tag-big" />
          </div>
          <div className="mkz-bar">
            <b>{set.name || "Tag print"}</b><span className="faint">&nbsp;· size {size} · inside the neck</span>
            <span className="spacer" />
            <button type="button" className="btn sm" onClick={() => setBig(false)}>Close</button>
          </div>
        </div>
      </div>
    )}
  </>;
}
