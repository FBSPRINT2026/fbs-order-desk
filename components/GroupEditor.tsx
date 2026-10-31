"use client";
import { bySupplierStyle, garmentSupName, inCatalogHit, type GarmentSup } from "@/lib/garmentSup";
import { PrintThumb } from "@/components/LogoThumb";
import { threadByName } from "@/lib/embroidery";
import { changeWord, cleanPrintNotes, frontFirst, inkNames, shopNotes, isLightColor, lineQty, pmsInks, pmsKey, screensFor, ADULT_SIZES, BABY_SIZES, TODDLER_SIZES, WAIST_SIZES, FULL_COLOR, designLabel, designOther, INK_COLORS, THREAD_COLORS, LOCATIONS, fitLocation, locationsFor, METHODS, ONE_SIZE, SIZES, YOUTH_SIZES, newGLine, newImprint, uid, persEach, persOf, PERS_SHOW, type PersEntry, type Design, type GLine, type Garment, type Group, type GroupCalc, type Method, type PriceList, type Settings, type Size, colorCosts, sizeUpEach, supplierSizeUp, isSpecialtyItem, SPECIALTY_ITEM, digitizingFee, puffEach } from "@/lib/pricing";
import { money } from "@/lib/format";
import { guessHex, garmentHex, lineHex, registerAreas, smallerSpot } from "@/lib/mockup";
import { colorChangeWant, colorHex, paintPrint } from "@/lib/inkColors";
import { loadInkFormulas } from "@/lib/inkFormulas";
import { createClient } from "@/lib/supabase/client";
import type { Imprint } from "@/lib/pricing";
import { confirmTitle, isNewOrderConfirm } from "@/components/OrderTypeRow";
import { plainlyMeans, rankColors } from "@/lib/colorMatch";
import DesignSearch from "@/components/DesignSearch";
import ColorChange, { versionOfColor, versionsOf } from "@/components/ColorChange";
import LocationChange from "@/components/LocationChange";
import { hasSpotChange, spotKey, spotLines, spotOf, spotsOf } from "@/lib/spotChange";
import { colorChanges } from "@/lib/pricing";
import FinishingPicker from "@/components/FinishingPicker";
import { isRelabel } from "@/components/NeckLabelPick";
import { labelFor } from "@/components/NeckLabelView";
import { mainSize, setFor, type NeckLabelSet } from "@/lib/neckLabels";

/** save a custom finishing to the sometimes-used list (retail, or the wholesale contract list for a wholesale job) */
export const saveFinishing = (wholesale: boolean) => async (f: { name: string; price: number }) =>
  fetch("/api/settings/finishing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, wholesale }) }).then((r) => r.ok).catch(() => false);
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { digitizeStamp, digitizeState, digitizingHref, embSpecsOf, type DgzSewout } from "@/lib/digitizeStatus";
import DigitizedFinder from "@/components/DigitizedFinder";
import PersonalizationPicker from "@/components/PersonalizationPicker";
import SizeFitAsk, { applySizeFit, checkSizeFit, type FitRow } from "@/components/SizeFit";
import { offRun, pcsOf, sizesText } from "@/lib/sizeFit";

type Props = {
  /** the order (staff): its prints' digitizing stamps open them on the Digitizing page */ orderId?: string;
  /** the order's sew-outs, photos signed (the stamps: Waiting on customer, Sew-out approved) */ sewouts?: (DgzSewout & { url?: string })[];
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
  /** Add logo: the Mockup Creator with only the close-ups (Oct 27) */ onLogo?: () => void;
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
  /** the personalization price each when the customer's program sets its own (Nine18 $5); else the price list's */
  persPrice?: number;
  /** don't gray out imprints waiting on a mockup (customer requests come with their own details) */
  noLock?: boolean;
  /** the portal: the prints stay grayed out until the group has a mockup (made, uploaded or picked), with this note
   *  (Oct 24, Nick: "gray out the print area… I don't want them to fill it in. I want them to make the mock-up") */ needMockup?: string;
  /** a reorder: the prints shown as they were printed (like a mockup's), not the full print form */ printsFixed?: boolean;
  /** garments: the shirt on its own line and the sizes under it, never squeezed onto one line (the customer's builder) */ sizesBelow?: boolean;
  /** the customer's builder: Tag Print with no tag on file uploads their tag art (shown from thumbUrls) */ onUploadTag?: (f: File) => Promise<{ path: string; name: string } | null>;
  /** buttons under the mockup spot beside the prints (the portal: Create mockup / Upload your own mockup, Oct 24) */ mockupExtra?: React.ReactNode;
  /** "Customer artwork": bring a mockup from another of their orders (or a logo) onto this group (Oct 24) */ onCustomerArt?: () => void;
  /** the customer's order made from their mockup (Oct 24, Nick: "it should look exactly like it does on our order screen with
   *  the imprints blown up… you shouldn't be able to change anything at that point"): the prints read only like a group with
   *  a mockup, the garments and colors fixed; only the sizes are theirs to fill in */ fixed?: boolean;
  /** a reorder print waiting on production details: where production confirms it */
  detailsHref?: string;
  /** move a garment line to another group (Oct 30, Nick: "in Printavo, I can just drag the line… to the first, and it
   *  says like add to first group"): dragged by its handle onto another group, or picked from the handle's menu.
   *  `moveTo` lists the order's other groups; "new" makes a group of its own */
  moveTo?: { id: string; label: string }[];
  onMoveLine?: (lineId: string, from: string, to: string) => void;
};

/** the garment line being dragged, so a group knows while it's dragged over it (a drag's data can only be read on drop) */
let dragging: { from: string; lineId: string; label: string } | null = null;
const MoveIcon = () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" /></svg>;

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
export default function GroupEditor({ persPrice, onLogo, printsFixed = false, onUploadTag, sizesBelow = false, finishingAt = "group", neckSets, customerId, gi, g, gc, settings, prices, catalog, canRemove, armed, arm, update, onDuplicate, onRemove, onRemoveMockup, onSaveToCatalog, fixed = false, mockupExtra, onCustomerArt, needMockup, onLookup, lookingUp, designs, designUrls, onUploadDesign, onMockup, mockupBlock, thumbUrls, onStarDesign, hidePrices, noLock, detailsHref, orderId, sewouts, moveTo, onMoveLine }: Props) {
  // a group of hats prints on the hat spots (Full Front, sides, Back); visors on the front; beanies on the cuff (Oct 26, Nick)
  const locs = locationsFor(g.lines);
  // a hat group with shirt spots on it (a reorder pulled from Printavo: "Full Back"): moved to the hat spot it means, once
  const badLoc = locs !== LOCATIONS && !fixed && !printsFixed && g.imprints.some((d) => d.location && !locs.includes(d.location) && LOCATIONS.includes(d.location));
  useEffect(() => { if (badLoc) update((x) => { for (const d of x.imprints) if (d.location && LOCATIONS.includes(d.location)) d.location = fitLocation(d.location, x.lines); }); }, [badLoc]); // eslint-disable-line react-hooks/exhaustive-deps
  // the Ink Room's PMS formulas for the ink swatches (2178 C and the rest the old chart doesn't have)
  const [, setFormulas] = useState(0);
  useEffect(() => { loadInkFormulas(createClient()).then(setFormulas).catch(() => {}); }, []);
  // embroidery on a backpack, hat, fleece… is a specialty item (Oct 27, Nick on #40189: "a backpack at 20 pieces… $5…
  // you have to add the specialty item… hats, backpacks, fleece, anything that's not just a flat garment"): a line known
  // only by its style number (CT89241804) is marked from the catalog's name for it ("Carhartt Canvas Backpack")
  const specFromCatalog = g.imprints.some((d) => d.method === "embroidery") ? g.lines.map((l, i) => ({ l, i })).filter(({ l }) => {
    if (l.specialty != null || isSpecialtyItem(l) || !(l.style || "").trim()) return false;
    const gar = catalog.find((x) => x.style.toLowerCase() === l.style.trim().toLowerCase());
    return !!gar && SPECIALTY_ITEM.test(gar.description || "");
  }).map((x) => x.i) : [];
  useEffect(() => { if (specFromCatalog.length) update((x) => { for (const i of specFromCatalog) if (x.lines[i]) x.lines[i].specialty = true; }); }, [specFromCatalog.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const [askSkip, setAskSkip] = useState(false);
  // "Already digitized?" open for one print (components/DigitizedFinder.tsx)
  const [finder, setFinder] = useState<string | null>(null);
  /** the print has a stitch file: its own, or its logo's from before */
  const hasSewFile = (d: Imprint) => !!d.emb?.file || !!(embSpecsOf((designs || []).find((x) => x.id === d.design_id)).files || []).length;
  const finderFor = finder ? g.imprints.find((x) => x.id === finder) : null;
  const finderDesign = finderFor?.design_id ? (designs || []).find((x) => x.id === finderFor.design_id) || null : null;
  // a price typed on one line: the rest of the group too? (Oct 20, Nick: "change the price to 2.25… a quick pop-up: do
  // you want to change all the items on this group to 2.25?")
  const [askAll, setAskAll] = useState<null | { li: number; v: number }>(null);
  const [blockMsg, setBlockMsg] = useState("");
  const [moveMenu, setMoveMenu] = useState("");
  const [dropOn, setDropOn] = useState("");
  const gLabel = g.name?.trim() || `Group ${gi + 1}`;
  useEffect(() => {
    if (!moveMenu) return;
    const off = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest?.(".gl-move-wrap")) setMoveMenu(""); };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [moveMenu]);
  // the color change pop-up for a print (its index), Oct 27
  const [ccAt, setCcAt] = useState<number | null>(null);
  const [lcAt, setLcAt] = useState<number | null>(null);
  /**
   * "+ Add youth" (Oct 21, Nick: "1717… the corresponding youth is the 9018… Gildan 5000 → 5000B… if you don't know,
   * ask me and I can key it in and you can remember it"): the adult garment's youth style goes on a new line in the
   * same color. Known pairs (/api/garments/youth) and one clear catalog match go straight on; otherwise it asks, with
   * the catalog's best guesses, and remembers the answer.
   */
  type YGuess = { style: string; brand: string; title: string; supplier: string; sure?: boolean };
  const [yth, setYth] = useState<null | { li: number; fix: number | null; adult: string; brand: string; guesses: YGuess[]; typed: string; busy: boolean }>(null);
  const [ythNote, setYthNote] = useState<null | { text: string; li: number; youthLi: number; adult: string; brand: string }>(null);
  /** "Move them to the right style": the sizes this line's style doesn't come in go on its sister style, found the way
   *  Create order finds it (a remembered pair or one clear match goes straight on; otherwise it asks, and remembers) */
  const [fitBusy, setFitBusy] = useState<string | null>(null);
  const [fitAsk, setFitAsk] = useState<FitRow[] | null>(null);
  const putFit = (rows: FitRow[]) => { const r = applySizeFit([g], rows); update((x) => { x.lines = r.groups[0].lines; }); if (r.did.length) setYthNote({ text: r.did.join(" · "), li: -1, youthLi: -1, adult: "", brand: "" }); };
  async function moveOff(li: number) {
    const l = g.lines[li]; if (!l) return;
    setFitBusy(l.id);
    const only: Group = { ...g, lines: g.lines.map((x, i) => (i === li ? x : { ...x, sizes: {} })) };
    const sf = await checkSizeFit([only]).catch(() => ({ rows: [] as FitRow[], ask: [] as FitRow[] }));
    setFitBusy(null);
    if (!sf.rows.length) { setYthNote({ text: `Couldn't check ${l.style}'s sizes in the catalog.`, li: -1, youthLi: -1, adult: "", brand: "" }); return; }
    if (sf.ask.length) setFitAsk(sf.rows); else putFit(sf.rows);
  }
  const adultLi = () => { for (let i = g.lines.length - 1; i >= 0; i--) { const l = g.lines[i]; if (l.style.trim() && !(l.sizeRun || []).some((z) => (YOUTH_SIZES as readonly string[]).includes(z))) return i; } return -1; };
  async function putYouth(li: number, fix: number | null, style: string, brand: string, supplier: string | undefined, learn: "staff" | "catalog" | false) {
    const adult = g.lines[li];
    const st = style.trim().toUpperCase();
    const at = fix ?? g.lines.length;
    if (fix == null) update((x) => { x.lines.push({ ...newGLine(), color: adult.color }); });
    const hit = findStyle(st, brand) || findStyle(st) || (onLookup ? await onLookup(st, undefined, bySupplierStyle(supplier) ? supplier : undefined) : null);
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
  // "Manually enter info" (Continue without a mockup) only counts until a mockup is saved (Oct 27, #40189: skipped first, then a mockup made, and
  // the prints stayed open to edit instead of showing as the mockup made them)
  const skipped = !!g.mockupSkipped && !g.mockupAt;
  // prints added from the customer's brand show like a mockup order's (Oct 27, Nick: "the same imprint thing that we have
  // on all other orders"), until someone opens them to edit
  const [editBrand, setEditBrand] = useState(false);
  const brandOnly = !!onMockup && !g.mockupAt && g.imprints.length > 0 && g.imprints.every((x) => x.fromBrand || x.sizeFrom === "brand");
  const frozen = fixed || printsFixed || (!!onMockup && !!g.mockupAt) || (brandOnly && !editBrand);
  // the group's shirt color (first garment): behind each print's logo, like the Mockup Creator's close-ups (Oct 15, Nick)
  const shirtHex = (() => {
    const l = g.lines.find((x) => (x.style || "").trim()) || g.lines[0];
    if (!l) return "#9aa1ab";
    if (lineHex(l)) return lineHex(l); // as the Mockup Creator showed it (picked, or drawn): lib/mockup.ts lineHex
    const key = (c: string) => (c || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const gar = catalog.find((x) => x.style.toLowerCase() === (l.style || "").trim().toLowerCase());
    const ci = gar?.color_images?.[l.color] || Object.entries(gar?.color_images || {}).find(([k]) => key(k) === key(l.color))?.[1];
    return garmentHex(ci?.hex, l.color) || "#9aa1ab";
  })();
  // each garment color's own shirt color, for a print's color change close-up (Oct 26)
  const hexOfColor = (color: string) => {
    const key = (c: string) => (c || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const l = g.lines.find((x) => key(x.color) === key(color));
    if (lineHex(l)) return lineHex(l);
    const gar = l ? catalog.find((x) => x.style.toLowerCase() === (l.style || "").trim().toLowerCase()) : undefined;
    const ci = gar?.color_images?.[color] || Object.entries(gar?.color_images || {}).find(([k]) => key(k) === key(color))?.[1];
    return garmentHex(ci?.hex, color) || guessHex(color) || "#9aa1ab";
  };
  const firstColor = (g.lines.find((x) => (x.style || "").trim()) || g.lines[0])?.color || "";
  const changesOf = (d: Group["imprints"][number]) => {
    const key = (c: string) => (c || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const colors = [...new Set(g.lines.map((l) => l.color).filter(Boolean))].filter((c) => key(c) !== key(firstColor));
    return colors.map((color) => {
      const m = Object.entries(d.inkBy || {}).find(([k]) => key(k) === key(color))?.[1] || {};
      const swap: Record<string, string> = {};
      for (const [a, b] of Object.entries(m)) if (b && b.trim().toLowerCase() !== a.trim().toLowerCase()) swap[a.trim().toLowerCase()] = b.trim();
      return { color, hex: hexOfColor(color), swap };
    }).filter((x) => Object.keys(x.swap).length);
  };
  // color changes across the group's prints: each garment color's version (A as printed, B… a change), for grouping lines
  const ccImps = g.imprints.filter((x) => versionsOf(x).length > 0);
  const verKey = (color: string) => ccImps.map((x) => versionOfColor(x, color)).join(".");
  const inkOfVer = (x: Imprint, color: string) => { const v = versionOfColor(x, color); return v ? versionsOf(x)[v - 1].to : (x.inks || "").split(/\s*,\s*/)[0] || "as printed"; };
  const verLabel = (color: string) => ccImps.map((x) => `${ccImps.length > 1 ? `${x.location}: ` : ""}${inkOfVer(x, color)}`).join("  /  ");
  // the sections only show when a version has more than one line (Oct 27: a Dear Heart order with one line per color
  // looked broken with them)
  const ccShow = ccImps.length > 0 && (() => { const n: Record<string, number> = {}; for (const l of g.lines) { const k = verKey(l.color); n[k] = (n[k] || 0) + 1; } return Object.values(n).some((v) => v > 1); })();
  // location change (Oct 30): one embroidery print sewn at another spot on some garments, shown like a color change
  const scImps = g.imprints.filter((x) => x.method === "embroidery" && hasSpotChange(x, g.lines));
  const spShow = !ccShow && scImps.length > 0;
  const spKey = (l: GLine) => scImps.map((x) => spotsOf(x, g.lines).indexOf(spotOf(x, l))).join(".");
  const spLetter = (l: GLine) => scImps.map((x) => String.fromCharCode(65 + Math.max(0, spotsOf(x, g.lines).indexOf(spotOf(x, l))))).join("");
  const spLabel = (l: GLine) => scImps.map((x) => spotOf(x, l)).join("  /  ");
  const verLetter = (color: string) => ccImps.map((x) => String.fromCharCode(65 + versionOfColor(x, color))).join("");
  const lightHex = (h: string) => { const v = parseInt((h || "").replace("#", "").padEnd(6, "0").slice(0, 6), 16); return 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255) > 160; };
  const verHex = (color: string) => { const x = ccImps[0]; if (!x) return "transparent"; const n = inkOfVer(x, color); return threadByName(n)?.hex || colorHex(n) || (/white/i.test(n) ? "#F4F4F1" : "#9aa1ab"); };
  /** a print's close-ups by section when the lines are grouped: Group B, C… each on its first garment color */
  const groupTiles = (d: Group["imprints"][number]) => versionsOf(d).map((v, i) => {
    const l = g.lines.find((x) => versionOfColor(d, x.color) === i + 1);
    // a brand logo has its own picture in that thread (its colorway): shown as it is
    const own = d.design_id ? designUrls?.[`${d.design_id}:ink:${v.to.trim().toLowerCase()}`] : "";
    return { color: `Group ${String.fromCharCode(66 + i)}`, hex: l ? hexOfColor(l.color) : "#9aa1ab", swap: { [v.from.trim().toLowerCase()]: v.to.trim() }, ...(own ? { url: own, to: v.to.trim() } : {}) };
  });
  /** the print's color change count and its Change button (in the read-out and the form) */
  const ccRow = (d: Group["imprints"][number], di: number) => {
    if (fixed || printsFixed || d.supplied || !(d.inks || "").trim() || new Set(g.lines.map((x) => (x.color || "").trim().toLowerCase()).filter(Boolean)).size < 2) return null;
    const n = versionsOf(d).length;
    // a screen print's color change already has its own line with the screens (count and fee), and is set in the Mockup
    // Creator: only a brand print without one gets the button here
    if (d.method === "screen" && (n > 0 || !d.fromBrand)) return null;
    return <div className="pr-scr pr-ccrow"><span className="pr-scr-l">Color change</span><span className="pr-scr-v">{n ? `${n}` : "None"} <button type="button" className="linkbtn" onClick={() => setCcAt(di)}>{n ? "Change" : "Add color change"}</button></span></div>;
  };
  /** an embroidery print's location change and its Change button (read-out and form), like the color change */
  const lcRow = (d: Group["imprints"][number], di: number) => {
    if (fixed || printsFixed || d.supplied || d.method !== "embroidery" || new Set(g.lines.filter((x) => lineQty(x) > 0).map((x) => spotKey(x))).size < 2) return null;
    const sp = spotsOf(d, g.lines);
    return <div className="pr-scr pr-ccrow"><span className="pr-scr-l">Location change</span><span className="pr-scr-v">{sp.length > 1 ? spotLines(d, g.lines).map((x) => `${x.letter} ${x.spot}${x.letter === "A" ? "" : ` · ${x.what}`}`).join("  ⟳  ") : "None"} <button type="button" className="linkbtn" onClick={() => setLcAt(di)}>{sp.length > 1 ? "Change" : "Add location change"}</button></span></div>;
  };
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
          // a one-size item takes the whole qty; otherwise every quantity stays, even in a size this style doesn't come in
          // (Oct 30: picking PC099Y deleted the adult sizes): it shows in its own column, flagged, with "Move them" below
          if (os) { const q = lineTotal(l); l.sizes = q ? { [ONE_SIZE]: q } : {}; }
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
    if (run.length) return [...run, ...[...BABY_SIZES, ...TODDLER_SIZES, ...YOUTH_SIZES, ...ADULT_SIZES, ...WAIST_SIZES].filter((z) => !run.includes(z) && l.sizes?.[z as keyof GLine["sizes"]])];
    const baby = has(BABY_SIZES), tod = has(TODDLER_SIZES), youth = !!g.youth || has(YOUTH_SIZES);
    // waist sizes (shorts, pants: Oct 30, Nick): the waists it has, from the smallest to the largest, no letter sizes
    if (has(WAIST_SIZES) && !has(ADULT_SIZES)) return WAIST_SIZES.filter((z) => (+z % 2 === 0 && +z <= 44) || l.sizes?.[z as keyof GLine["sizes"]]);
    // little ones only: no adult columns to scroll past
    if ((baby || tod) && !has(ADULT_SIZES)) return [...(baby ? BABY_SIZES : []), ...(tod ? TODDLER_SIZES : []), ...(youth ? YOUTH_SIZES : [])];
    return [...(baby ? BABY_SIZES : []), ...(tod ? TODDLER_SIZES : []), ...(youth ? YOUTH_SIZES : []), ...ADULT_SIZES, ...WAIST_SIZES.filter((z) => l.sizes?.[z as keyof GLine["sizes"]])];
  };
  // one set of size columns for the whole group, so S sits under S on every garment even when one style has no XS
  // (Oct 20, Nick: "the sizes line up across multiple garments"); a size a garment doesn't come in is an empty slot
  const groupCols: string[] = (() => {
    const all = new Set(g.lines.filter((l) => !l.oneSize).flatMap((l) => colsFor(l)));
    const order = [...BABY_SIZES, ...TODDLER_SIZES, ...YOUTH_SIZES, ...ADULT_SIZES, ...WAIST_SIZES] as readonly string[];
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
      // no prices shown (retail builder): no room kept for them, so the qty sits at the right end (Oct 24, Nick)
      const ea = hidePrices ? 150 : widest(".gl .a-ea input", 28, 54, 120);
      const to = hidePrices ? 0 : Math.max(widest(".gl .a-to b", 4, 52, 150), widest(".grp-total > .a-to", 4, 52, 150));
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
        // the customer's builder always puts the sizes under the garment (Oct 24, Nick: "the garment is the top line, the
        // sizes below"), so it never gets scrunched beside the side panel
        if (!sizesBelow && deB > 0 && one(true, true)) mode = "w0";
        else if (!sizesBelow && one(true)) mode = "w1";
        else if (!sizesBelow && cs && one(false)) mode = "w1c";
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
  registerAreas(g.imprints);
  // a logo added from the customer's brand (Customer artwork → Brands) is set up by the brand's rules: no mockup needed
  // (Oct 27, Nick: "it added this grayed out box when it should say like imprint, left chest embroidery, this thread")
  const locked = (!!onMockup || !!needMockup) && !noLock && !g.mockupAt && !g.mockupSkipped && !(g.customerMockups || []).length && !g.imprints.some((x) => x.supplied || x.fromBrand || x.sizeFrom === "brand");
  // wholesale (contract) jobs use the contract's own finishing list and prices
  const finList = gc.wholesale && settings.wholesale.finishing?.length ? settings.wholesale.finishing : settings.finishing;
  // embroidery extras (specialty thread, 3D puff…): only on a group with embroidery
  // (personalization isn't one of them any more: it's per piece, on the line it's for, PersonalizationPicker below)
  const embList = gc.wholesale && g.imprints.some((d) => d.method === "embroidery") ? (settings.wholesale.embExtras || []).filter((f) => !/personali[sz]/i.test(`${f.id} ${f.name}`) || (g.finishing || []).includes(f.id)) : [];
  // "Add personalization" on any group with embroidery (Oct 30, Nick): a name on one piece of a line, split onto its own line
  const hasEmb = g.imprints.some((d) => d.method === "embroidery") || g.lines.some((l) => persOf(l).length > 0);
  const addPers = (lineId: string, size: Size | "", qty: number, text: string, loc: string) => update((x) => {
    const l = x.lines.find((y) => y.id === lineId);
    if (!l) return;
    l.persList = [...persOf(l), { id: uid(), text, size, qty, loc }];
    if (l.pers) { if (l.note === `Personalization: ${l.pers}`) delete l.note; delete l.pers; }
  });
  const addPersMany = (adds: { lineId: string; entry: Omit<PersEntry, "id"> }[]) => update((x) => {
    for (const a of adds) {
      const l = x.lines.find((y) => y.id === a.lineId);
      if (!l) continue;
      l.persList = [...persOf(l), { id: uid(), ...a.entry }];
      if (l.pers) { if (l.note === `Personalization: ${l.pers}`) delete l.note; delete l.pers; }
    }
  });
  const clearPers = (lineId: string) => update((x) => { const l = x.lines.find((y) => y.id === lineId); if (l) { delete l.persList; delete l.pers; } });
  const [persOpen, setPersOpen] = useState<string | null>(null);
  const removePers = (lineId: string, entryId: string) => update((x) => {
    const l = x.lines.find((y) => y.id === lineId);
    if (!l) return;
    const left = persOf(l).filter((e) => e.id !== entryId);
    if (l.pers) { if (l.note === `Personalization: ${l.pers}`) delete l.note; delete l.pers; }
    if (left.length) l.persList = left; else delete l.persList;
  });
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
  const [tagBusy, setTagBusy] = useState(false);
  const tick = (id: string, on: boolean) => update((x) => { const set = new Set(x.finishing || []); if (on) set.add(id); else set.delete(id); x.finishing = [...set]; });
  // puff ink (Oct 30, Nick: "like you have PMS match fee, you would have puff ink $1… it has to be indicated somewhere
  // that it's a puff print"): its charge per piece on its own line, and a print whose notes say puff offered as one
  const puffCtl = (d: Group["imprints"][number]) => {
    if (d.method !== "screen" || d.colors >= FULL_COLOR) return null;
    const di = g.imprints.indexOf(d);
    const rate = puffEach(gc.wholesale ? settings.wholesale : prices);
    if (d.puff) return (
      <div className="pr-scr pr-cc-line pr-puff-line"><span className="pr-scr-l">Puff ink</span>
        <span className="pr-scr-v">No underbase{!hidePrices && <> · <b className="num">{money(rate)}</b> each</>}</span>
        {!fixed && <button type="button" className="linkbtn" onClick={() => update((x) => { delete x.imprints[di].puff; })}>Not puff</button>}
      </div>
    );
    if (fixed || !/\bpuff/i.test(`${d.notes || ""} ${d.inks || ""}`)) return null;
    return (
      <div className="pr-scr pr-puff-line"><span className="pr-scr-l">Puff?</span>
        <span className="pr-scr-v">The notes say puff</span>
        <button type="button" className="btn sm" onClick={() => update((x) => { x.imprints[di].puff = true; x.imprints[di].underbase = undefined; x.imprints[di].screens = undefined; })}>Make it a puff print{!hidePrices && ` (+${money(rate)} each)`}</button>
      </div>
    );
  };
  // a print's screens, on its own line (Oct 15, Nick: "make the screens incorporate into the imprint lines")
  const screenCtl = (d: Group["imprints"][number]) => {
    // embroidery: its thread change on the same kind of line (Oct 26, Nick: "thread change… exactly the same as color change")
    if (embImps.includes(d)) { const tc = +(d.inkChanges || 0); return tc > 0 ? <div className="pr-scr pr-cc-line"><span className="pr-scr-l">Thread change</span><span className="pr-scr-v">{tc}{!hidePrices && <> · <b className="num">{money(tc * (+(wpl.inkChangeFee || 0)))}</b></>}</span></div> : null; }
    if (!scrImps.includes(d)) return null;
    const di = g.imprints.indexOf(d), sc = screensFor(d, wpl, allLight), rm = !!(d.remake ?? g.remake);
    const fee = rm && wpl.remakeFee != null ? wpl.remakeFee : wpl.screenFee;
    const cc = +(d.inkChanges || 0);
    return (<>
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
      {/* the color change's charge on its own line under the screens, so underbase, remake and the edit stay with the
          screens (Oct 26, Nick: "making the color change a new line right below screens") */}
      {cc > 0 && <div className="pr-scr pr-cc-line"><span className="pr-scr-l">Color change</span><span className="pr-scr-v">{cc}{!hidePrices && <> · <b className="num">{money(cc * (+(wpl.inkChangeFee || 0)))}</b></>}</span></div>}
    </>);
  };
  // a print's inks as chips, with its PMS matches and their charge on the same line (Oct 21, Nick: "the colors just seem
  // to run on and on… the inks can go up underneath the imprints, just like we charge for screens")
  const inkCtl = (d: Group["imprints"][number], chips = true) => {
    // heat press: no inks, just "DTF transfer" (Oct 26, Nick: "it shouldn't say inks anymore. It should just say transfer")
    if (d.method === "dtf") return <div key={"ink" + d.id} className="pr-scr pr-inkl"><span className="pr-scr-l">DTF transfer</span></div>;
    const di = g.imprints.indexOf(d), inks = pmsInks(d), isScr = scrImps.includes(d);
    const pms = isScr ? inks.filter((x) => x.auto) : [];
    const typed = isScr && !inks.length && !!wpl.pmsFee;
    // a color change to a PMS is charged as a PMS match too (lib/pricing.ts calcGroup: pmsChange)
    const ci = gc.imprints[di] as { pmsShared?: string[]; pmsChange?: string[]; pmsN?: number } | undefined;
    const toPms = isScr ? ci?.pmsChange || [] : [];
    if (!(chips && inks.length) && !pms.length && !typed && !toPms.length) return null;
    // the same PMS on another print of this order is matched once (Oct 24 rule): it shows here as "charged once"
    const shared = ci?.pmsShared || [];
    const n = typed ? num0(d.pms) : ci?.pmsN ?? pms.filter((x) => x.charge).length - shared.length;
    const fee = n * (+(wpl.pmsFee || 0));
    // shown like the screens line's "remake" tag: the second location isn't charged for the same PMS
    const firstOn = (name: string) => g.imprints.slice(0, di).find((o) => pmsInks(o).some((x) => x.charge && pmsKey(x.name) === pmsKey(name)))?.location;
    // color changes (Imprint.inkBy, set in the Mockup Creator): "Color change on F260 Mauve: Burgundy"
    const ck = (c: string) => (c || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    // shown on the ink itself (Oct 26, Nick): "White · change to Maroon · on Mauve", only on the inks that change
    const changes: Record<string, { to: string; on: string }[]> = {};
    for (const [k, m] of Object.entries(d.inkBy || {})) {
      const l = g.lines.find((x) => ck(x.color) === ck(k));
      for (const [a, b] of Object.entries(m || {})) if (b && b.trim().toLowerCase() !== a.trim().toLowerCase()) (changes[a.trim().toLowerCase()] ||= []).push({ to: b.trim(), on: l?.color || k });
    }
    const sharedNote = shared.length ? <>{shared.map((k) => <span key={k} className="pr-scr-tag" title="The same PMS on another print of this order: one matching fee">{k}: same as {firstOn(k) || "another garment"}, no charge</span>)}</> : null;
    return (
      <InkLine key={"ink" + d.id} thread={d.method === "embroidery"} inks={chips ? inks : []} changes={changes} groups={ccShow && versionsOf(d).length ? versionsOf(d).map((v) => v.to) : undefined} charged={(k) => isScr && !!inks.find((x) => x.name === k)?.auto && !!inks.find((x) => x.name === k)?.charge}
        summary={pms.length || typed || toPms.length || shared.length ? <span className="pr-pms">{n ? `${n} PMS match${n === 1 ? "" : "es"}` : shared.length ? "PMS match" : "No PMS charge"}{!hidePrices && n ? <> · <b className="num">{money(fee)}</b></> : null}{sharedNote}</span> : null}
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
    <section className={"line" + (hidePrices ? " np" : "") + (fixed ? " fixed" : "") + (dropOn ? " ge-drop" : "")}
      onDragOver={onMoveLine ? (e) => { if (!dragging || dragging.from === g.id || !e.dataTransfer.types.includes("application/x-fbs-line")) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dropOn !== dragging.label) setDropOn(dragging.label); } : undefined}
      onDragLeave={onMoveLine ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOn(""); } : undefined}
      onDrop={onMoveLine ? (e) => { const d = dragging; setDropOn(""); if (!d || d.from === g.id) return; e.preventDefault(); dragging = null; onMoveLine(d.lineId, d.from, g.id); } : undefined}>
      {dropOn && <div className="ge-dropmsg" role="status">Drop to add {dropOn} to {gLabel}</div>}
      {finderFor && <DigitizedFinder designId={finderDesign?.id || null}
        where={[finderFor.location, finderDesign ? designLabel(finderDesign) : "", g.name || ""].filter(Boolean).join(" · ")}
        hint={(finderDesign?.name || g.name || "").replace(/\b(mockup|front|back|left|right|chest|logo|final|copy)\b/gi, " ").replace(/\s+/g, " ").trim()}
        onClose={() => setFinder(null)}
        onDone={(set, _info, sewout) => {
          const di = g.imprints.findIndex((x) => x.id === finderFor.id);
          // the print sews this file: its size and stitches are the file's, and with no sew-out it's ready to sew
          update((x) => {
            const im = x.imprints[di]; if (!im) return;
            im.emb = { ...(im.emb || {}), stitchesFrom: "file", file: set };
            im.stitches = set.stitches;
            const w = /(\d+(?:\.\d+)?)/.exec(im.size || "");
            if (set.wIn && (!w || Math.abs(+w[1] - set.wIn) > 0.05)) im.size = `${Math.round(set.wIn * 100) / 100}" wide`;
            if (sewout) delete im.digitized; else im.digitized = true;
          });
          setFinder(null);
        }} />}
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
          {/* with a color change, the lines show grouped by version (A's together, then B's), each keeping its own index */}
          {(ccShow ? g.lines.map((l, li) => ({ l, li })).sort((a, b) => verKey(a.l.color).localeCompare(verKey(b.l.color)) || a.li - b.li) : spShow ? g.lines.map((l, li) => ({ l, li })).sort((a, b) => spKey(a.l).localeCompare(spKey(b.l)) || a.li - b.li) : g.lines.map((l, li) => ({ l, li }))).map(({ l, li }, pos, order) => {
            const lc = gc.lines[li];
            // grouped by color change (Oct 27): a heading where the version changes (A · 1743 Oxford Blue, B · 1801 White)
            const vk = verKey(l.color), vHead = ccShow && (pos === 0 || verKey(order[pos - 1].l.color) !== vk);
            const sHead = spShow && (pos === 0 || spKey(order[pos - 1].l) !== spKey(l));
            const hit = findStyle(l.style, l.brand);
            const sized = !l.oneSize && lineTotal(l) > 0; // sizes entered below, so Qty is their total
            const setQty = (s: keyof GLine["sizes"], raw: string) => update((x) => { const v = Math.max(0, Math.floor(+raw || 0)); if (v) x.lines[li].sizes[s] = v; else delete x.lines[li].sizes[s]; });
            // the style once, then a row per color with its sizes on the same line (Oct 21, Nick: order page cleanup)
            const prev = pos > 0 ? order[pos - 1].l : null;
            const same = !!prev && !!(l.style || "").trim() && (prev.style || "").trim().toLowerCase() === (l.style || "").trim().toLowerCase() && (prev.brand || "") === (l.brand || "") && (prev.garment || "") === (l.garment || "");
            return (
              <Fragment key={l.id}>
              {vHead && (() => { const n = g.lines.filter((x) => verKey(x.color) === vk); const pcs = n.reduce((a, x) => a + lineQty(x), 0); return (<>
                {/* a color change between the sections: its own divider line, so B lines up with A (Oct 27, Nick) */}
                {pos > 0 && <div className="gl-ccdiv"><span><CcIcon />Color change</span></div>}
                <div className="gl-ver"><span className={"gl-vt" + (lightHex(verHex(l.color)) ? " lt" : "")} style={{ background: verHex(l.color) }}>{verLetter(l.color)}</span><b>{verLabel(l.color)}</b><span className="faint">{n.length} line{n.length === 1 ? "" : "s"} · {pcs} pcs</span></div>
              </>); })()}
              {sHead && (() => { const n = g.lines.filter((x) => spKey(x) === spKey(l)); const pcs = n.reduce((a, x) => a + lineQty(x), 0); return (<>
                {pos > 0 && <div className="gl-ccdiv"><span><CcIcon />Location change</span></div>}
                <div className="gl-ver"><span className={"gl-vt" + (spLetter(l).startsWith("A") ? "" : " lt")} style={{ background: spLetter(l).startsWith("A") ? "var(--ink)" : "var(--surface-3)" }}>{spLetter(l)}</span><b>{spLabel(l)}</b><span className="faint">{n.length} line{n.length === 1 ? "" : "s"} · {pcs} pcs</span></div>
              </>); })()}
              <div className={"gl" + (same && !vHead && !sHead ? " same" : "") + (ccShow || spShow ? " ver" : "")} style={ccShow ? { ["--ver" as string]: verHex(l.color) } : spShow ? { ["--ver" as string]: spLetter(l).startsWith("A") ? "var(--ink)" : "var(--surface-3)" } : undefined}>
                {(!same || vHead || sHead) && <div className="gl-sty" inert={fixed || undefined}>
                  <div className="a-st">
                    <StylePicker value={l.style} catalog={catalog} busy={!!lookingUp}
                      onType={(v) => onStyle(li, v)}
                      onPick={(gm) => onStyle(li, gm.style, gm)}
                      onPickSS={(h) => onLookup ? onLookup(h.supplierStyle || h.style, h.styleID || undefined, h.supplier).then((gm) => { if (gm) onStyle(li, gm.style, gm); }) : Promise.resolve()} />
                    {lookingUp && lookingUp === l.style.trim().toUpperCase() && <div className="ink-hint">Pulling from S&amp;S…</div>}
                  </div>
                  <div className="a-bd"><div className="a-br"><input type="text" tabIndex={-1} className="pre" title="Filled from the catalog. Click to change." aria-label="Brand" placeholder="Brand" value={l.brand || ""} onChange={(e) => update((x) => { x.lines[li].brand = e.target.value; })} /></div>
                  <div className="a-de"><input type="text" tabIndex={-1} className="pre" title={(l.garment ? l.garment + "\n" : "") + "Filled from the catalog. Click to change."} aria-label="Description" placeholder="Description" value={l.garment} onChange={(e) => update((x) => { x.lines[li].garment = e.target.value; })} /></div></div>
                </div>}
                {/* the next color of the same style: its style number grayed, like a ditto mark (Oct 21, Nick: like Printavo) */}
                {same && !vHead && <div className="gl-ditto" aria-hidden>{l.style}</div>}
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
                      <div className="os-note" title={l.sizeRun?.length === 1 ? undefined : "Clear the Qty to switch back to sizes"}>One-size item</div>
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
                  {/* no price when prices are hidden (the retail builder): a "Price" placeholder and who sets it (Oct 24, Nick:
                      "have a thing that says price… FBS will send quote") */}
                  {hidePrices && <div className="a-ea r a-quote" title="We price your order and send you a quote to approve"><span className="aq-in"><span className="aq-ph">Price</span><small>FBS will send a quote</small></span></div>}
                  {!hidePrices && <>
                  <div className="a-ea r"><input type="number" step="0.01" min="0" tabIndex={-1} title={l.prog ? `${l.prog.note}. Type a price to override it.` : "Click to override"} aria-label="Price each" className={"pre" + (lc?.hasOv ? " ov" : "") + (l.prog ? " prg" : "")} placeholder={lc ? lc.calcEach.toFixed(2) : ""} value={l.priceOverride ?? ""} onChange={(e) => update((x) => { x.lines[li].priceOverride = e.target.value === "" ? null : +e.target.value; })}
                    onBlur={(e) => { const v = e.target.value === "" ? null : +e.target.value; if (v != null && !isNaN(v) && g.lines.length > 1 && g.lines.some((y, yi) => yi !== li && y.priceOverride !== v)) setAskAll({ li, v }); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></div>
                  <div className="a-to r num"><b>{money(lc?.sub)}</b></div>
                  </>}
                  <div className="a-x">
                    {/* their extras: a stamp at the end of the row, printed or not (Oct 23, Nick: asked when the order is made,
                        "a little stamp next to that row at the end… printed extras or not printed extras"); click to switch */}
                    {l.extras && <span className="gl-stamp" data-notranslate>
                      <button type="button" tabIndex={-1} title={l.extrasPrint === false ? "Their extras, sent back blank. Click: print them" : "Their extras, printed free. Click: don't print them"} onClick={() => update((x) => { const ln = x.lines[li]; ln.extrasPrint = ln.extrasPrint === false ? true : false; })}>{l.shopUse ? (l.extrasPrint === false ? "Not printed" : "Printed") : l.extrasPrint === false ? "Not printed extras" : "Printed extras"}</button>
                      <button type="button" tabIndex={-1} className={"fee" + (l.shopUse ? " ours" : "")} title={l.shopUse ? "Ours (a shop sample, spares): never on the customer's invoice, portal or Printavo. Click: their extras, no charge" : l.extrasFree === false ? "Charged. Click: ours, hidden from the customer" : "No charge. Click: charge for them"} onClick={() => update((x) => { const ln = x.lines[li]; if (ln.shopUse) { delete ln.shopUse; ln.extrasFree = true; ln.priceOverride = 0; } else if (ln.extrasFree === false) { ln.shopUse = true; ln.extrasFree = true; ln.priceOverride = 0; } else { ln.extrasFree = false; if (ln.priceOverride === 0) ln.priceOverride = null; } })}>{l.shopUse ? "ours · hidden from customer" : l.extrasFree === false ? "charged" : "no charge"}</button>
                      <button type="button" tabIndex={-1} className="x" aria-label="Not extras: charge for this line" title="Not extras: charge for this line" onClick={() => update((x) => { const ln = x.lines[li]; delete ln.extras; delete ln.extrasPrint; delete ln.extrasFree; delete ln.shopUse; if (ln.priceOverride === 0) ln.priceOverride = null; })}>×</button>
                    </span>}
                    {l.note == null && noteOpen !== l.id && <button className="btn icon ghost ln-add" type="button" tabIndex={-1} title="Add a note for this line" aria-label="Add a line note" onClick={() => setNoteOpen(l.id)}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 6h14M5 11h14M5 16h8" /></svg></button>}
                    {onMoveLine && !fixed && (!!moveTo?.length || g.lines.length > 1) && (() => {
                      const label = [l.style, l.color].filter((x) => (x || "").trim()).join(" ") || "this garment";
                      return (
                        <span className="gl-move-wrap">
                          <button className="btn icon ghost gl-move" type="button" tabIndex={-1} draggable aria-label="Move this garment to another group" aria-expanded={moveMenu === l.id}
                            title="Drag onto another group, or click to pick where it goes"
                            onDragStart={(e) => { dragging = { from: g.id, lineId: l.id, label }; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("application/x-fbs-line", l.id); const row = (e.currentTarget as HTMLElement).closest(".gl"); if (row) e.dataTransfer.setDragImage(row, 24, 18); setMoveMenu(""); }}
                            onDragEnd={() => { dragging = null; }}
                            onClick={() => setMoveMenu(moveMenu === l.id ? "" : l.id)}><MoveIcon /></button>
                          {moveMenu === l.id && (
                            <span className="gl-move-menu" role="menu">
                              <span className="gl-move-k">Move {label} to</span>
                              {(moveTo || []).map((t) => <button key={t.id} type="button" role="menuitem" onClick={() => { setMoveMenu(""); onMoveLine(l.id, g.id, t.id); }}>{t.label}</button>)}
                              {g.lines.length > 1 && <button type="button" role="menuitem" onClick={() => { setMoveMenu(""); onMoveLine(l.id, g.id, "new"); }}>A new group of its own</button>}
                            </span>
                          )}
                        </span>
                      );
                    })()}
                    {g.lines.length > 1 && !fixed && <button className="btn icon ghost" type="button" tabIndex={-1} aria-label="Remove garment" onClick={() => update((x) => { x.lines.splice(li, 1); })}>✕</button>}
                  </div>
                </div>
                {/* sizes this style doesn't come in (Oct 30, PC099Y with adult sizes): moved to its sister style here, the
                    same check Create order runs (components/SizeFit.tsx) */}
                {!fixed && (() => {
                  const off = offRun(l.sizes as Record<string, number>, l.sizeRun);
                  const all = Object.values(off).reduce<Record<string, number>>((a, m) => ({ ...a, ...m }), {});
                  if (!Object.keys(all).length) return null;
                  return (
                    <div className="sf-note" role="status">
                      <span>{l.style} doesn&apos;t come in {sizesText(all)} ({pcsOf(all)} pcs).</span>
                      <button type="button" className="btn sm" disabled={fitBusy === l.id} onClick={() => void moveOff(li)}>{fitBusy === l.id ? "Finding the style…" : "Move them to the right style"}</button>
                    </div>
                  );
                })()}
                {/* the name on this piece, right under its line (Oct 30, Nick: "once we input the personalization… put it below
                    the line item… JST73… Cody White Ops Manager") */}
                {persOf(l).length > PERS_SHOW && persOpen !== l.id && (() => {
                  // a long list (Oct 30, Nick: "after 10… multiple names, 21 selected, view list here"): one summary row
                  const es = persOf(l), n = es.reduce((a, e) => a + (e.qty || 1), 0), file = es.find((e) => e.list)?.list;
                  const bySize = SIZES.map((z) => [z, es.filter((e) => e.size === z).reduce((a, e) => a + (e.qty || 1), 0)] as const).filter(([, q]) => q).map(([z, q]) => `${z} ${q}`).join(", ");
                  return (
                    <div className="gl-pers"><span className="gl-pers-k">Personalization</span><span className="gl-pers-t">Multiple names: {n}</span>
                      {bySize && <span className="faint">{bySize}</span>}
                      <button type="button" className="linkbtn" onClick={() => setPersOpen(l.id)}>View list</button>
                      {file && <span className="faint">· list in Production files</span>}
                      {!fixed && <button className="btn icon ghost gl-pers-x" type="button" aria-label="Remove all the names on this line" title="Remove all" onClick={() => clearPers(l.id)}>✕</button>}</div>
                  );
                })()}
                {persOf(l).length > PERS_SHOW && persOpen === l.id && <div className="gl-pers"><span className="gl-pers-k">Personalization</span><span className="gl-pers-t">{persOf(l).length} names</span><button type="button" className="linkbtn" onClick={() => setPersOpen(null)}>Hide list</button></div>}
                {(persOf(l).length <= PERS_SHOW || persOpen === l.id) && persOf(l).map((e) => (
                  <div key={e.id} className="gl-pers"><span className="gl-pers-k">Personalization</span><span className="gl-pers-t">{e.text}</span>
                    {e.size && <span className="faint">Size {e.size}</span>}<span className="faint">Qty {e.qty}</span><span className="faint">{e.loc || "Right Chest"}</span>
                    {!hidePrices && <span className="faint">{money(e.price != null ? e.price : persPrice ?? persEach(settings, gc.wholesale ? "wholesale" : "retail"))} each</span>}
                    {!fixed && <button className="btn icon ghost gl-pers-x" type="button" aria-label={`Remove the personalization ${e.text}`} title="Remove" onClick={() => removePers(l.id, e.id)}>✕</button>}</div>
                ))}
                {((l.note != null && !(l.pers && l.note === `Personalization: ${l.pers}`)) || noteOpen === l.id) && (
                  <div className="gl-note">
                    <textarea rows={1} autoFocus={noteOpen === l.id && l.note == null} aria-label="Line note" placeholder="Line description: ship-to, packing, a name…" value={l.note || ""}
                      onChange={(e) => update((x) => { x.lines[li].note = e.target.value; })}
                      onBlur={(e) => { if (!e.target.value.trim()) { setNoteOpen(null); update((x) => { delete x.lines[li].note; }); } }} />
                  </div>
                )}
              </div>
              </Fragment>
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
              <button type="button" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; update((x) => { const last = x.lines[x.lines.length - 1]; x.lines.push({ ...last, extras: undefined, shopUse: undefined, id: uid(), color: "", sizes: {}, priceOverride: null }); }); }}>Same style, new color</button>
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
        {fitAsk && <SizeFitAsk rows={fitAsk} onDone={(r) => { setFitAsk(null); putFit(r); }} onCancel={() => setFitAsk(null)} />}
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
        <div className="lbl gsec">Imprints</div>
        <div className="imp-wrap">
        <div className="imp-mock">
          {(g.mockupThumbs || []).filter((p) => thumbUrls?.[p]).length
            // the first mockup big, the rest small under it (Oct 20, Nick: six onesie colors stacked full size made the
            // group five screens long)
            // every mockup opens big in a pop-up, with the other colors to flip through (Oct 21, Nick)
            ? <MockGallery urls={[...new Set((g.mockupThumbs || []).filter((p) => thumbUrls?.[p]))].map((p) => thumbUrls![p])} />
            : (() => { const bp = g.imprints.find((x) => (x.fromBrand || x.sizeFrom === "brand") && x.design_id && designUrls?.[x.design_id]);
                // a logo added from their brand: the logo itself, large, where the mockup goes (Oct 27, Nick)
                if (bp) return <div className="mk-pref mk-brandlogo"><MockGallery urls={[designUrls![bp.design_id!]]} /><small>{bp.fromBrand ? `From ${bp.fromBrand}` : "From their brand"} · no mockup needed</small></div>;
                const pr = g.imprints.find((x) => x.supplied?.picture?.path)?.supplied?.picture || g.imprints.find((x) => x.placeRef?.path)?.placeRef; const u = pr ? thumbUrls?.[pr.path] : "";
                return u ? <div className="mk-pref"><MockGallery urls={[u]} /><small>{g.imprints.some((x) => x.supplied) ? "Placement reference · customer supplied transfers" : "Placement reference"}</small></div> : <div className="mk-none">{g.mockupSkipped ? "Entered by hand · no mockup" : "No mockup yet"}</div>; })()}
          {/* the customer's own mockup isn't shown here: it's a reference in Production notes & files, stamped */}
          {onMockup && <button className={"btn sm mk-edit" + (locked || !g.mockupAt ? " primary" : "")} type="button" onClick={startMockup} title={mockupBlock || undefined}>
            {/* the shirt icon shows on a phone, where the three buttons are matching tiles (Oct 29, Nick) */}
            <svg className="mk-ic" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3.5L4 5.8 2.5 10.2l3.2 1.3.9-2.2V20.5h10.8V9.3l.9 2.2 3.2-1.3L20 5.8 15 3.5c-.4 1.6-1.6 2.6-3 2.6s-2.6-1-3-2.6z" /></svg>
            <span>{g.mockupAt ? "Edit mockup" : "Create mockup"}</span></button>}
          {/* the logo on its spot without the garment (Oct 27, Nick: "just below… create mockup… say add logo") */}
          {/* Add logo and Customer artwork side by side under Create mockup (Oct 27, Nick: "three buttons… create mockup,
              add logo, and then customer artwork" → option B). Customer artwork opens on the customer's brands when they
              have them (Cedar Promos: MEI, ShipStation…), else their mockups and logos */}
          {(onLogo || onCustomerArt) && (
            <div className="mk-tiles">
              {onLogo && <button className="mk-tile" type="button" title="The logo, its size, spot and thread on close-ups only: no garment pictures (backpacks, odd garments, many styles)" onClick={() => { if (mockupBlock) { setBlockMsg(mockupBlock); return; } setBlockMsg(""); onLogo(); }}>
                <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5h11M4 5v14h16v-7M8.5 15.5l3-3 2.5 2.5 2-2 3 3M18 3v6M15 6h6" /></svg>
                <span>Add logo</span></button>}
              {onCustomerArt && <button className="mk-tile" type="button" onClick={onCustomerArt} title="Their brands and logos (each department's files), or a mockup from another of their orders">
                <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7.5V18a1 1 0 0 0 1 1h13M6 5h4l2 2h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z" /></svg>
                <span>Customer artwork</span></button>}
            </div>
          )}
          {onRemoveMockup && g.mockupAt && <button className={"btn sm ghost danger" + (armed === "mk" + g.id ? " armed" : "")} type="button" title="Take this mockup and its prints off the order (the mockup is archived, not deleted) and start this group fresh"
            onClick={() => (armed === "mk" + g.id ? onRemoveMockup() : arm("mk" + g.id))}>{armed === "mk" + g.id ? "Remove the mockup and its prints?" : "Remove mockup"}</button>}
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
              <span>No mockup for this group yet. Make one, or enter the prints by hand (method, location, colors, size) with a placement picture for reference.</span>
              <button className="btn sm primary" type="button" onClick={startMockup}>Create mockup</button>
              <button className="btn sm" type="button" onClick={() => { setAskSkip(false); update((x) => { x.mockupSkipped = true; }); }}>Manually enter info</button>
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
            : <button type="button" className="mk-cover" aria-label="Imprints are locked until a mockup is created" onClick={() => setAskSkip(true)}><span>Create a mockup — or click here to manually enter info</span></button>)}
          <div inert={locked || fixed || printsFixed || undefined} className="mk-body">
          {brandOnly && <div className="imp-brand-ed">{editBrand ? <button type="button" className="linkbtn" onClick={() => setEditBrand(false)}>Done editing</button> : <button type="button" className="linkbtn" onClick={() => setEditBrand(true)}>Edit the print details</button>}</div>}
          {/* each print as a card beside the mockup (Oct 15, Nick: "rework how this is organized now that you have more
              space"): what and where on top, ink and size under it, notes, then the art */}
          <div className={"imp-cards" + (frozen ? " ro" : "")}>
                {lcAt != null && g.imprints[lcAt] && <LocationChange im={g.imprints[lcAt]} lines={g.lines} onClose={() => setLcAt(null)} onSave={(spotBy) => { const at = lcAt; setLcAt(null); update((x) => { const im = x.imprints[at!]; if (!im) return; if (spotBy) im.spotBy = spotBy; else delete im.spotBy; }); }} />}
                {ccAt != null && g.imprints[ccAt] && <ColorChange im={g.imprints[ccAt]} lines={g.lines} onClose={() => setCcAt(null)} onSave={(inkBy) => { setCcAt(null); update((x) => {
                  const im = x.imprints[ccAt!];
                  if (!im) return;
                  im.inkBy = inkBy;
                  if (im.method === "screen") im.inkChanges = colorChanges(im);
                  // the group's lines grouped by version: A's together, then B's (the order otherwise kept)
                  const cc = x.imprints.filter((y) => versionsOf(y).length > 0);
                  const key = (c: string) => cc.map((y) => versionOfColor(y, c)).join(".");
                  x.lines = x.lines.map((ln, i) => ({ ln, i })).sort((a, b) => key(a.ln.color).localeCompare(key(b.ln.color)) || a.i - b.i).map((v) => v.ln);
                }); }} />}

            {g.imprints.map((d, di) => frozen ? (
              <PrintRow key={d.id} shown={d.shownArt ? thumbUrls?.[d.shownArt] : undefined} d={d} color={ccShow && versionsOf(d).length ? "Group A" : firstColor} changes={ccShow && versionsOf(d).length ? groupTiles(d) : changesOf(d)} sym={ccShow} inksLine={inkCtl(d)} extra={<>{screenCtl(d)}{puffCtl(d)}{ccRow(d, di)}{lcRow(d, di)}</>} listed={gc.lines.length > 0 && gc.lines.every((lc) => lc.hasOv)} hex={shirtHex} n={g.imprints.length > 1 ? di + 1 : 0} designs={designs || []} urls={designUrls || {}} each={hidePrices ? null : money(gc.imprints[di]?.each)} detailsHref={detailsHref} onMockup={startMockup} orderId={orderId} sewout={orderId ? (sewouts || []).find((x) => x.imprint_id === d.id && !x.archived_at) : undefined} onFind={orderId && !fixed ? () => setFinder(d.id) : undefined} />
            ) : (
              <div key={d.id} className="imp-card">
                <div className="imp-card-h">
                  <b>{g.imprints.length > 1 ? `Print ${di + 1}` : "Print"}</b><span>{[d.location, METHODS[d.method]].filter(Boolean).join(" · ")}</span>{d.supplied && <span className="imp-sup-tag">Customer supplied transfers</span>}
                  <span className="spacer" />
                  {!hidePrices && <span className="imp-each"><b className="num">{money(gc.imprints[di]?.each)}</b> each</span>}
                  {!frozen && <button className="btn icon ghost" type="button" aria-label="Remove imprint" onClick={() => update((x) => { x.imprints.splice(di, 1); })}>✕</button>}
                </div>
                <div className={"imp-body" + (!!onMockup && !skipped && !d.supplied ? " has-logo" : "")}>
                {!!onMockup && !skipped && !d.supplied && <LogoTile imprint={d} designs={designs || []} urls={designUrls || {}} onMockup={startMockup} />}
                {(
                <div className={"imp-grid" + (d.supplied ? " sup" : "")}>
                  <div className="f-method"><span className="imp-l">Method</span><select aria-label="Method" value={d.method} onChange={(e) => update((x) => { x.imprints[di].method = e.target.value as Method; })}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                  <div className="f-loc"><span className="imp-l">Location</span>{(locs.includes(d.location) || (!d.location && locs !== LOCATIONS))
                      ? <select aria-label="Location" value={d.location} onChange={(e) => update((x) => { x.imprints[di].location = e.target.value === "__custom" ? "" : e.target.value; frontFirst(x.imprints); })}>{!d.location && <option value="">Pick a spot…</option>}{locs.map((z) => <option key={z} value={z}>{z}</option>)}<option value="__custom">Custom…</option></select>
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
                {/* customer supplied transfers (Oct 27, Nick): heat press only; ticked, the rest is grayed out and only who made
                    them, their order number and the placement reference are filled in */}
                {d.method === "dtf" && <label className="check imp-sup-chk"><input type="checkbox" checked={!!d.supplied} onChange={(e) => update((x) => { x.imprints[di].supplied = e.target.checked ? { ...(x.imprints[di].supplied || {}) } : undefined; })} />Customer supplied transfers <span className="faint">they send the transfers, we press them</span></label>}
                {d.supplied && <SuppliedBox d={d} onChange={(fn) => update((x) => { fn(x.imprints[di]); })} url={(p) => thumbUrls?.[p] || ""} />}
                {!d.supplied && screenCtl(d) && <div className="imp-scr">{screenCtl(d)}</div>}
                {!d.supplied && puffCtl(d) && <div className="imp-scr">{puffCtl(d)}</div>}
                {!d.supplied && inkCtl(d, false) && <div className="imp-scr">{inkCtl(d, false)}</div>}
                {/* retail prints have no screens line: the fashion hit / soft hand choice on its own (Oct 16, Nick) */}
                {d.method === "screen" && d.colors < FULL_COLOR && !scrImps.includes(d) && (
                  <div className="imp-hit">
                    <label className="check" title="No underbase: each color printed, flashed and printed again through the same screen. Priced the same."><input type="checkbox" checked={d.printStyle === "fashion"} onChange={(e) => update((x) => { x.imprints[di].printStyle = e.target.checked ? "fashion" : undefined; if (e.target.checked) x.imprints[di].underbase = undefined; })} />Fashion hit (no underbase)</label>
                    <label className="check" title="Soft hand additive mixed into the inks"><input type="checkbox" checked={!!d.softHand} onChange={(e) => update((x) => { x.imprints[di].softHand = e.target.checked || undefined; })} />Soft hand</label>
                  </div>
                )}
                {d.confirm && (d.confirm.size || d.confirm.ink) && <div className="imp-unconf">
                    <span><b>{confirmTitle(d.confirm.why)}</b> <span className="faint">Our best guess: {d.confirm.why}.</span></span>
                    {detailsHref ? <a className="btn sm" href={detailsHref} title="Production confirms the size and inks">{isNewOrderConfirm(d.confirm.why) ? "Production details" : "Reorder Details"}</a> : null}
                </div>}
                {/* color change (Oct 27, Nick: "a color change button… change the navy to white… check which ones") */}
                {!d.supplied && new Set(g.lines.map((x) => (x.color || "").trim().toLowerCase()).filter(Boolean)).size > 1 && (d.inks || "").trim() && (
                  <div className="imp-cc">
                    <span className="imp-l">Color change</span>
                    {versionsOf(d).length ? <span className="imp-cc-v">{versionsOf(d).map((v, i) => { const on = [...new Set(g.lines.filter((x) => versionOfColor(d, x.color) === i + 1).map((x) => x.color))]; return <span key={i}><b>{String.fromCharCode(66 + i)}</b> {v.from} → {v.to} on {on.join(", ")}</span>; })}</span> : <span className="faint">Same {d.method === "embroidery" ? "thread" : "inks"} on every color</span>}
                    <button type="button" className="btn sm ghost" onClick={() => setCcAt(di)}>{versionsOf(d).length ? "Change" : "Add color change"}</button>
                  </div>
                )}
                {d.method === "embroidery" && !d.supplied && new Set(g.lines.filter((x) => lineQty(x) > 0).map((x) => spotKey(x))).size > 1 && (
                  <div className="imp-cc">
                    <span className="imp-l">Location change</span>
                    {hasSpotChange(d, g.lines) ? <span className="imp-cc-v">{spotLines(d, g.lines).slice(1).map((x) => <span key={x.letter}><b>{x.letter}</b> {x.spot} on {x.what}</span>)}</span> : <span className="faint">Every garment at {d.location || "this spot"}</span>}
                    <button type="button" className="btn sm ghost" onClick={() => setLcAt(di)}>{hasSpotChange(d, g.lines) ? "Change" : "Add location change"}</button>
                  </div>
                )}
                {!d.supplied && <PlaceRefRow d={d} onChange={(fn) => update((x) => { fn(x.imprints[di]); })} url={(p) => thumbUrls?.[p] || ""} />}
                <div className="imp-art" hidden={!!d.supplied}>
                      {!(onMockup && !skipped) && <DesignPick imprint={d} lines={g.lines} designs={designs || []} urls={designUrls || {}} canUpload={!!onUploadDesign} onStar={onStarDesign}
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
                            {sug.map((z) => <button key={z} type="button" className="btn sm" onClick={() => update((x) => { x.imprints[di].location = z; frontFirst(x.imprints); })}>{z}</button>)}
                            <button type="button" className="btn sm ghost" onClick={() => update((x) => { x.imprints[di].keepLocation = true; })}>Keep {d.location}</button>
                          </div>
                        );
                      })()}
                </div>
              </div>
            ))}
          </div>
          {priceLine}
          <div className="row" style={{ gap: 8 }}>
          {!frozen && <button className="btn sm" type="button" onClick={() => update((x) => { const used = x.imprints.map((d) => d.location); x.imprints.push(newImprint((locs === LOCATIONS ? ["Full Back", ...LOCATIONS] : locs).find((z) => !used.includes(z)) || locs[0] || "Full Front")); frontFirst(x.imprints); })}>+ Add imprint</button>}
          </div>
          </div>
          </div>
        </div>
        </div>
        </div>

        {/* Tag Print under the prints, on the right (Oct 24, Nick: "it should not be right next to imprints. It should be
            underneath on the right… let them upload there somehow or use their tag on file") */}
        {tagFin && (!fixed || !!onUploadTag) && (
          <div className={"tagp-sec" + (tagOn ? " on" : "")}>
            {!tagOn && <label className="check tagp-cb" title="Remove the maker's tags and print the customer's label inside the neck"><input type="checkbox" checked={tagOn} onChange={(e) => tick(tagFin.id, e.target.checked)} />Tag Print<span className="faint"> · remove the maker&apos;s tags and print {onUploadTag ? "your" : "their"} label</span></label>}
          {tagOn && tagFin && (() => {
              // the tag print as a print row like the ones above (Oct 21, Nick: "make it look exactly like the thing
              // above… the little mock-up on the left")
              const live = (neckSets || []).filter((x) => !x.archived), cur = setFor(neckSets, g.neckLabel);
              const ink = cur?.ink || "Light gray";
              return (
                <div className="pr pr-tag">
                  <div className="pr-logo pr-tag-pic" style={{ background: shirtHex }} title={cur ? `${cur.name || "Their tag"}: inside the neck` : "No tag art on file yet"}>
                    {cur ? <TagTile set={cur} size={mainSize([g])} shirtHex={shirtHex} /> : g.tagArt && thumbUrls?.[g.tagArt.path] ? <img src={thumbUrls[g.tagArt.path]} alt="Your tag art" style={{ maxWidth: "80%", maxHeight: "80%", objectFit: "contain" }} /> : <span>No tag yet</span>}
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
                      ) : cur ? <span>{cur.name || "Their tag"}</span> : g.tagArt ? <span>{g.tagArt.name}</span> : <span className="faint">{onUploadTag ? "No tag on file yet." : "No tag art on file."}</span>}
                      {onUploadTag && !cur && (
                        <label className="linkbtn" style={{ cursor: "pointer" }}>{tagBusy ? "Uploading…" : g.tagArt ? "Replace your tag art" : "Upload your tag art"}
                          <input type="file" hidden accept="image/*,application/pdf,.ai,.eps,.svg" disabled={tagBusy} onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; setTagBusy(true); const r = await onUploadTag(f).catch(() => null); setTagBusy(false); if (r) update((x) => { x.tagArt = r; }); }} />
                        </label>
                      )}
                      {customerId && <a className="linkbtn" href={`/shop/customers/${customerId}`} target="_blank" rel="noreferrer">{cur ? "Change their tag art ↗" : "Add their tag art ↗"}</a>}
                      <button type="button" className="linkbtn danger" onClick={() => tick(tagFin.id, false)}>Remove</button>
                    </div>
                    {cur?.note && <div className="pr-notes">{cur.note}</div>}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {hasFoot && <div className="grp-foot">
          <div className={"grp-foot-l mk-lock" + (locked ? " on" : "")}>
            {locked && <button type="button" className="mk-cover" tabIndex={-1} aria-label="Finishing is locked until a mockup is created" onClick={() => { if (!needMockup) setAskSkip(true); }} />}
            <div inert={locked || fixed || undefined} className="mk-body">
            {(inksSec || embImps.length > 0 || hasEmb) && (
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
                    <div key={d.id} className="sbx-r"><span className="sbx-loc">{d.location || "Embroidery"}</span>{d.stitches ? <span className="faint">{d.stitches.toLocaleString()} stitches{d.emb?.file ? "" : " (estimate)"}</span> : null}{!hidePrices && !d.digitized && (d.digitizeFee != null
                        ? <span className="sbx-ov"><input type="number" min={0} step={1} value={d.digitizeFee} aria-label={`Digitizing price for the ${d.location || "logo"}`} onChange={(e) => { const di = g.imprints.indexOf(d), v = e.target.value; update((x) => { x.imprints[di].digitizeFee = v === "" ? 0 : Math.max(0, +v || 0); }); }} />
                            <button type="button" className="linkbtn" onClick={() => { const di = g.imprints.indexOf(d); update((x) => { delete x.imprints[di].digitizeFee; }); }}>Use the stitch price</button></span>
                        : <button type="button" className="linkbtn" title="A complex logo: set its digitizing price by hand" onClick={() => { const di = g.imprints.indexOf(d); update((x) => { x.imprints[di].digitizeFee = digitizingFee({ ...d, digitizeFee: undefined }, wpl); }); }}>Complex: set the price</button>)}
                      {/* the one digitizing fee (lib/pricing.ts digitizingFee): $40, plus $1 a started 1,000 past 6,000 (Oct 28, Nick) */}
                      {!hidePrices && <b className={"num" + (d.digitized ? " sbx-off" : "")} title={d.digitized ? "Digitized before: no charge" : d.digitizeFee != null ? "Set by hand" : `${money(wpl.digitizing)} base${(d.stitches || 0) > (wpl.digStitches ?? 6000) ? ` + ${Math.ceil(((d.stitches || 0) - (wpl.digStitches ?? 6000)) / 1000)} × ${money(wpl.digPer1k ?? 1)} for the stitches past ${(wpl.digStitches ?? 6000).toLocaleString()}` : ""}`}>{money(digitizingFee(d, wpl))}</b>}
                      {/* the logo's DST is on file from before (Oct 27, Nick: "like repeat screens… already digitized… that overrides it") */}
                      <label className="check sbx-end" title="The logo was digitized before (its DST is on file): no digitizing charge and no Needs digitizing stamp"><input type="checkbox" checked={!!d.digitized} onChange={(e) => { const di = g.imprints.indexOf(d); if (e.target.checked && !hasSewFile(d)) { setFinder(d.id); return; } update((x) => { x.imprints[di].digitized = e.target.checked || undefined; }); }} />Already digitized</label></div>
                  ))}
                  {(wpl.embSpecialty?.length || 0) > 0 && g.lines.some((l) => (l.style || "").trim()) && (() => {
                    const on = g.lines.some((l) => isSpecialtyItem(l)), rate = wpl.embSpecialty![Math.min(gc.eti, wpl.embSpecialty!.length - 1)] || 0;
                    return (
                      <div className="sbx-r"><span className="sbx-loc">Specialty item</span><span className="faint">hats, bags, fleece, jackets</span>{!hidePrices && <b className={"num" + (on ? "" : " sbx-off")}>{money(on ? rate * embImps.length : 0)}/pc</b>}
                        <label className="check sbx-end"><input type="checkbox" checked={on} onChange={(e) => update((x) => { for (const l of x.lines) l.specialty = e.target.checked; })} />Specialty</label></div>
                    );
                  })()}
                  {embList.length > 0 && <div className="sbx-r">{embList.map((f) => <label key={f.id} className="check"><input type="checkbox" checked={(g.finishing || []).includes(f.id)} onChange={(e) => tick(f.id, e.target.checked)} />{f.name}{!hidePrices && <span className="faint"> {money(f.price)}/pc</span>}</label>)}</div>}
                </div>}
                {hasEmb && <PersonalizationPicker lines={g.lines} price={persPrice ?? persEach(settings, gc.wholesale ? "wholesale" : "retail")} hidePrices={hidePrices} disabled={fixed} onAdd={addPers} orderId={orderId} onAddMany={addPersMany} />}
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

export type SSHit = { styleID: number; brand: string; style: string; title: string; image: string; supplier?: GarmentSup; /** One Stop's own code for the style */ supplierStyle?: string };
const inCatalog = (catalog: Garment[], h: SSHit) => inCatalogHit(catalog, h);
/** Style # box: type a number and pick from your catalog or from every matching S&S and SanMar style. */
/** the "Need help picking garments?" list (Settings → Garments → Popular garments), loaded once: those styles come up
 *  first when someone types a brand (Oct 24, Nick: "if you just say Gildan… the 5000 comes up first because it's on our list") */
let popularOnce: Promise<string[]> | null = null;
const popKey = (brand: string, style: string) => `${brand}|${style}`.toLowerCase().replace(/[^a-z0-9|]/g, "");
function usePopularStyles() {
  const [keys, setKeys] = useState<string[]>([]);
  useEffect(() => {
    popularOnce ||= import("@/app/popular-garments-actions").then((m) => m.popularGarments()).then((r) => (r.ok ? r.list.map((g) => popKey(g.brand, g.style)) : [])).catch(() => []);
    let live = true;
    popularOnce.then((k) => { if (live) setKeys(k); });
    return () => { live = false; };
  }, []);
  return keys;
}

export function StylePicker({ value, catalog, busy, onType, onPick, onPickSS }: {
  value: string; catalog: Garment[]; busy: boolean;
  onType: (v: string) => void; onPick: (g: Garment) => void; onPickSS: (h: SSHit) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<SSHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const popular = usePopularStyles();
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
  // the brand typed loosely ("comfort colors", "bella canvas"): letters and digits only
  const qn = q.replace(/[^a-z0-9]/g, "");
  const popAt = (g: Garment) => { const i = popular.indexOf(popKey(g.brand, g.style)); return i < 0 ? (popular.some((k) => k.endsWith("|" + g.style.toLowerCase().replace(/[^a-z0-9]/g, ""))) ? 500 : 999) : i; };
  const local = q ? catalog.filter((c) => [c.style, `${c.brand} ${c.style}`].some((x) => { const v = x.toLowerCase(); return v.startsWith(q) || v.startsWith(stripped) || v.includes(" " + stripped); }) || (qn.length >= 3 && `${c.brand}${c.style}`.toLowerCase().replace(/[^a-z0-9]/g, "").startsWith(qn)))
    .sort((a, b) => popAt(a) - popAt(b) || rank(a.brand) - rank(b.brand) || a.style.localeCompare(b.style)).slice(0, 8) : [];
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
            <div key={it.kind === "cat" ? "c" + it.g.id : (bySupplierStyle(it.h.supplier) ? `${it.h.supplier}:${it.h.supplierStyle || it.h.style}` : "s" + it.h.styleID)} role="option" aria-selected={i === active}
              className={"sm-item" + (i === active ? " on" : "")} onMouseDown={(e) => { e.preventDefault(); choose(i); }} onMouseEnter={() => setActive(i)}>
              <b>{it.kind === "cat" ? `${it.g.brand} ${it.g.style}` : `${it.h.brand} ${it.h.style}`}</b>
              {it.kind === "cat" && popAt(it.g) < 500 && <em className="sm-pop">Popular</em>}
              <span>{it.kind === "cat" ? it.g.description : it.h.title}</span>
              {it.kind === "ss" && <em>{garmentSupName(it.h.supplier).toUpperCase()}</em>}
            </div>
          ))}
          {loading && <div className="sm-note">Searching S&amp;S, SanMar and One Stop…</div>}
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
function InkLine({ inks, charged, summary, editable, children, thread, changes, groups }: { /** the lines are grouped by color change: "A 1743 Oxford Blue changes to B 1801 Super White" (Oct 27) */ groups?: string[]; inks: { name: string }[]; charged: (name: string) => boolean; summary: React.ReactNode; editable: boolean; children: React.ReactNode; /** an embroidered print: its threads (Madeira, Isacord) */ thread?: boolean;
  /** color changes by ink (lower case): what it changes to and on which garment color */ changes?: Record<string, { to: string; on: string }[]> }) {
  const [edit, setEdit] = useState(false);
  const chip = (name: string, cls = "") => { const t = thread ? threadByName(name) : null; return <span key={name + cls} className={"ink-chip" + cls + (charged(name) ? " pms" : "")} title={charged(name) ? "PMS match: charged" : t?.pms.length ? `PMS ${t.pms[0]}` : undefined}><i style={{ background: t?.hex || colorHex(name) || "#d6d6d6" }} />{name}</span>; };
  const anyChange = !!changes && Object.keys(changes).length > 0;
  return (
    <div className="pr-scr pr-inkl">
      <span className="pr-scr-l">{thread ? "Threads" : "Inks"}</span>
      <span className="pr-scr-v">
        {inks.length > 0 && groups?.length ? <span className="ink-chips ink-grp"><span className="ink-gl">A</span>{inks.map((k) => chip(k.name))}{groups.map((to, i) => <span key={i} className="ink-gw"><span className="ink-to">changes to</span><span className="ink-gl">{String.fromCharCode(66 + i)}</span>{chip(to, " chg")}</span>)}</span> : null}
        {inks.length > 0 && !groups?.length && !anyChange && <span className="ink-chips">{inks.map((k) => chip(k.name))}</span>}
        {/* a color change: each ink on its own line, the ones that change followed by what they change to (Oct 26, Nick) */}
        {inks.length > 0 && !groups?.length && anyChange && <span className="ink-lines">{inks.map((k) => {
          const ch = changes![k.name.trim().toLowerCase()] || [];
          return <span key={k.name} className="ink-ln">{chip(k.name)}{ch.length > 0 && <><span className="ink-to">change to</span>{ch.map((c) => <span key={c.on} className="ink-tw">{chip(c.to, " chg")}<span className="ink-on">on {c.on}</span></span>)}</>}</span>;
        })}</span>}
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
 * The group's mockups: the first big, the rest small under it (Oct 20; two are both big, three split the next row in half,
 * more go three to a row, Oct 26); any of them opens big in a pop-up where the
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
    {/* Oct 26, Nick: two garments are the same size, full width; three split the second row in half; four or more go
        three little ones to a row, the first always big on top */}
    {(n === 2 ? urls : urls.slice(0, 1)).map((u, i) => <button type="button" key={u} className="mk-big" title="See it bigger" onClick={() => setAt(i)}><img src={u} alt="Mockup" /></button>)}
    {n > 2 && <div className={"mk-more" + (n === 3 ? " half" : "")}>{urls.slice(1).map((u, i) => <button type="button" key={u} title="See it bigger" onClick={() => setAt(i + 1)}><img src={u} alt="Mockup" /></button>)}</div>}
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
function usePainted(url: string, imp: { design_id?: string; inkMap?: Imprint["inkMap"]; inks?: string; colors?: number; method?: string }, /** a color change: ink (lower case) → the ink printed instead (Oct 26) */ swap?: Record<string, string> | null): string {
  const im = imp.inkMap && imp.inkMap.design === imp.design_id ? imp.inkMap.map : null;
  const sw = swap && Object.keys(swap).length ? swap : null;
  let want: Record<string, string> = {};
  // every art color with its ink as picked in the Mockup Creator (the same picks the mockup was painted with)
  if (im) for (const [src, v] of Object.entries(im)) want[src] = v.name === "none" || !v.hex ? "none" : v.hex;
  if (im && sw) want = colorChangeWant(null, im, [], sw);
  // keyed by the picture itself too: a fixed logo (the order check's art fixes) is a new file and must repaint (Oct 23:
  // the blown-up logo still showed the gray outline after the blacks were made one)
  // every logo picture goes through it (not only repainted ones): a white PDF page around the art is taken off
  // spot colors with no white ink: white in the art is the shirt (full color and DTF keep their white)
  const targets = Object.values(want).filter((v) => v !== "none").map((v) => v.toLowerCase());
  const dropWhite = imp.method !== "dtf" && (imp.colors || 0) > 0 && (imp.colors || 0) < 11 && !/white/i.test(imp.inks || "") && !targets.some((h) => /^#?f[a-f0-9]f[a-f0-9]f[a-f0-9]$/i.test(h));
  const key = url ? `${url.split("?")[0]}|${JSON.stringify(want)}|${dropWhite ? "w" : ""}|${sw && !im ? JSON.stringify(sw) : ""}` : "";
  const [out, setOut] = useState(key ? paintedCache.get(key) || "" : "");
  useEffect(() => {
    if (!key) { setOut(""); return; }
    const hit = paintedCache.get(key);
    if (hit) { setOut(hit); return; }
    let live = true;
    const img = new Image(); img.crossOrigin = "anonymous";
    // the one print painter (lib/inkColors paintPrint), the same as the production mockup and the Mockup Creator
    img.onload = () => { try { const w = sw && !im ? colorChangeWant(img, null, inkNames(imp.inks || ""), sw) : want; const u = paintPrint(img, w, { paper: dropWhite, maxSide: 1400 }).toDataURL("image/png"); paintedCache.set(key, u); if (live) setOut(u); } catch { /* picture can't be read: as uploaded */ } };
    img.src = url;
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, url]);
  return out || url;
}

/** a print's close-up on another garment color with a color change: the color's name over it, "Color change" under it (Oct 26) */
/** the color change symbol: two arrows going around a dot (Oct 27, Nick: "a couple arrows flopping around it") */
function CcIcon() {
  return <svg className="cc-ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 9a8 8 0 0 0-14.3-3.6L4 7" /><path d="M4 3v4h4" /><path d="M4 15a8 8 0 0 0 14.3 3.6L20 17" /><path d="M20 21v-4h-4" /><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" /></svg>;
}
function ChangeTile({ d, url, color, hex, swap, sym, own }: { d: Group["imprints"][number]; url: string; color: string; hex: string; swap: Record<string, string>; /** the color change symbol instead of the word */ sym?: boolean;
  /** the logo's own picture in the new thread (a brand colorway): drawn as it is, not repainted */ own?: { url: string; to: string } }) {
  const pic = usePainted(own ? own.url : url, own ? { ...d, inkMap: undefined, inks: own.to } : d, own ? undefined : swap);
  const [zoom, setZoom] = useState(false);
  return (
    <div className="pr-tw">
      <span className="pr-tc">{color}</span>
      <button type="button" className="pr-logo" style={{ background: hex }} onClick={() => pic && setZoom(true)} title="See it bigger">{pic ? <img src={pic} alt="" /> : <span>No logo</span>}</button>
      {sym ? <span className="pr-cc sym" title={changeWord(d.method)}><CcIcon /></span> : <span className="pr-cc">{changeWord(d.method)}</span>}
      {zoom && pic && <div className="pr-zoom" role="dialog" aria-modal="true" aria-label={`On ${color}`} onClick={() => setZoom(false)} tabIndex={-1} ref={(el) => el?.focus()} onKeyDown={(e) => { if (e.key === "Escape") setZoom(false); }}>
        <figure onClick={(e) => e.stopPropagation()}>
          <img src={pic} alt="" style={{ background: hex }} />
          <figcaption><span><b>{changeWord(d.method)} on {color}</b> · {Object.entries(swap).map(([a, b]) => `${b} instead of ${a}`).join(", ")}</span><button type="button" className="btn sm" onClick={() => setZoom(false)}>Close</button></figcaption>
        </figure>
      </div>}
    </div>
  );
}

function PrintRow({ shown, d, n, hex, designs, urls, each, detailsHref, onMockup, extra, inksLine, listed, color, changes, sym, orderId, sewout, onFind }: { /** "Already digitized?": find the print's existing stitch files (components/DigitizedFinder.tsx) */ onFind?: () => void; /** color change tiles show the symbol */ sym?: boolean; /** the order (staff): the digitizing stamp opens it on the Digitizing page */ orderId?: string; /** this print's live sew-out, its photo signed */ sewout?: DgzSewout & { url?: string }; /** the art as saved with the mockup (Imprint.shownArt), signed */ shown?: string; d: Group["imprints"][number]; n: number; hex: string; /** the print's screens line */ extra?: React.ReactNode;
  /** the first garment's color (over the close-up when there's a color change) */ color?: string; /** the other garment colors this print changes ink on */ changes?: { color: string; hex: string; swap: Record<string, string>; url?: string; to?: string }[];
  /** its inks as chips (with PMS matches) */ inksLine?: React.ReactNode; /** the garment prices were typed: "each" is the list price, not what's charged */ listed?: boolean; designs: Design[]; urls: Record<string, string>; each: string | null; detailsHref?: string; onMockup: () => void }) {
  const cur = designs.find((x) => x.id === d.design_id);
  const m = (d.size || "").match(/^([\d.]+)\D*(wide|tall)?/i);
  const val = m ? +m[1] : 0, given: "W" | "H" = m && /tall/i.test(m[2] || "") ? "H" : "W";
  const other = cur && val ? designOther(cur, val, given, d.artRatio) : 0;
  const size = val ? (given === "W" ? `${val}" × ${other || "?"}"` : `${other || "?"}" × ${val}"`) : "";
  const colors = d.method === "dtf" || d.colors === FULL_COLOR ? "Full color" : d.colors ? `${d.colors} color${d.colors === 1 ? "" : "s"}` : "";
  // click the logo to see it big (Oct 15, Nick: "you should be able to click it and zoom in")
  const [zoom, setZoom] = useState(false);
  // in the inks picked in the Mockup Creator (Oct 20: the logo here still showed its uploaded green after it was set to yellow)
  // a brand logo's own picture in this print's thread (its colorway, lib/designs previewUrls): shown as it is (Oct 27,
  // Nick: picked 1801 white and the tile still showed the navy logo on navy)
  const ownCw = cur ? urls[`${cur.id}:ink:${(d.inks || "").trim().toLowerCase()}`] || "" : "";
  const painted = usePainted(shown ? "" : ownCw || (cur ? urls[cur.id] || "" : ""), ownCw ? { ...d, inkMap: undefined } : d);
  // the art as the Mockup Creator showed it when the mockup was saved: the same picture as the blow-up (falls back to
  // the logo painted here for prints saved before, or with no mockup yet)
  const pic = shown || painted;
  // a visual-only reorder print (Oct 20, Nick): the whole row greyed under a stamp; clicking it asks before anyone goes
  // in to set the details (that's what production confirms and locks in)
  const vis = !!d.visualOnly && !d.confirmed;
  // embroidery not digitized yet: the same stamp as a visual mockup, in the same place (Oct 27, Nick: "exactly the same
  // font and color and size and everything")
  // where the print is in digitizing, the same answer as the Digitizing page (lib/digitizeStatus.ts; Oct 28, Nick): grayed
  // out until the digitizer's files come back, then a stamp over the details that are now real; clicking it opens the
  // print on the Digitizing page, and an approved one shows the sew-out photo
  const dgz = !vis && d.method === "embroidery" ? digitizeStamp(digitizeState(d, cur, sewout)) : null;
  const [ask, setAsk] = useState(false), [opened, setOpened] = useState(false), [sewPic, setSewPic] = useState(false);
  const dgzGo = () => { if (dgz?.tone === "ok" && sewout?.url) setSewPic(true); else if (orderId) window.location.href = digitizingHref(orderId, d.id); };
  return (
    <div className={"pr" + ((vis && !opened) || dgz?.gray ? " pr-vis" : "")}>
      {vis && !opened && <button type="button" className="pr-vis-stamp" onClick={() => setAsk(true)} title="Set the print details (production)"><span><b>Visual mockup</b><small>Production confirming details on print run</small></span></button>}
      {/* embroidery not digitized yet (Oct 27, Nick: "a stamp on embroidery orders that say needs digitizing… the price
          right now is not firm… until we email Volikes, get it back, sew it out, get it approved"): the stitches, size
          and price are estimates. Clicking it opens the Digitizer */}
      {dgz?.gray && (orderId
        ? <button type="button" className="pr-vis-stamp pr-dgz" title="Open it on the Digitizing page" onClick={dgzGo}><span><b>{dgz.title}</b><small>{dgz.sub}</small></span></button>
        : <div className="pr-vis-stamp pr-dgz"><span><b>{dgz.title}</b><small>{dgz.sub}</small></span></div>)}
      {/* every later stage stamps in the same spot, the same size, in its color, over a row that's no longer grayed
          (Oct 29, Nick: "this stamp needs to remain in the same spot as the needs digitizing stamp before") */}
      {dgz && !dgz.gray && (orderId || (dgz.tone === "ok" && sewout?.url)
        ? <div className={"pr-vis-stamp pr-dgz pr-dgz-on pr-dgz-" + dgz.tone}><button type="button" onClick={dgzGo} title={dgz.tone === "ok" && sewout?.url ? "See the sew-out" : "Open it on the Digitizing page"}><b>{dgz.title}</b><small>{dgz.tone === "ok" && !sewout?.url ? "On file" : dgz.sub}</small></button></div>
        : <div className={"pr-vis-stamp pr-dgz pr-dgz-on pr-dgz-" + dgz.tone}><span><b>{dgz.title}</b><small>{dgz.sub}</small></span></div>)}
      {sewPic && sewout?.url && <div className="pr-zoom" role="dialog" aria-modal="true" aria-label="The sew-out" onClick={() => setSewPic(false)} onKeyDown={(e) => { if (e.key === "Escape") setSewPic(false); }} tabIndex={-1} ref={(el) => el?.focus()}>
        <figure onClick={(e) => e.stopPropagation()}>
          <img src={sewout.url} alt="The sew-out" />
          <figcaption><span><b>Sew-out approved</b>{sewout.decided_at ? ` · ${new Date(sewout.decided_at).toLocaleDateString()}` : ""}{d.location ? ` · ${d.location}` : ""}</span>
            <span className="row" style={{ gap: 6 }}>{orderId && <a className="btn sm" href={digitizingHref(orderId, d.id)}>Open in Digitizing</a>}<button type="button" className="btn sm" onClick={() => setSewPic(false)}>Close</button></span></figcaption>
        </figure>
      </div>}
      {ask && (
        <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Edit the print details" onClick={() => setAsk(false)}>
          <div className="dla" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h3>Edit the print details?</h3>
            <p className="dla-sub">This is a visual mockup: production sets the colors, inks and size on the print run. Editing them now locks in the production notes for this design.</p>
            <div className="dla-acts"><button type="button" className="btn ghost" autoFocus onClick={() => setAsk(false)}>No</button><button type="button" className="btn primary" onClick={() => { setAsk(false); if (detailsHref) window.location.href = detailsHref; else setOpened(true); }}>Yes, edit the details</button></div>
          </div>
        </div>
      )}
      {(() => {
        const main = (
          <button type="button" className="pr-logo" style={{ background: hex }} onClick={() => (pic ? setZoom(true) : onMockup())} title={pic ? "See it bigger" : "Pick the logo in the Mockup Creator"}>
            {pic ? <img src={pic} alt="" /> : <span>No logo</span>}
          </button>
        );
        // a color change: both close-ups side by side, each under its garment color (Oct 26, Nick)
        if (!changes?.length || !cur) return main;
        return (
          <div className="pr-tiles">
            <div className="pr-tw"><span className="pr-tc">{color || "As printed"}</span>{main}</div>
            {changes.map((c) => <ChangeTile key={c.color} d={d} url={urls[cur.id] || ""} color={c.color} hex={c.hex} swap={c.swap} sym={sym} own={c.url && c.to ? { url: c.url, to: c.to } : undefined} />)}
          </div>
        );
      })()}
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
          {d.method === "screen" && d.puff && <span className="pr-puff">Puff print</span>}
          {d.method === "embroidery" && d.stitches ? <span>{d.stitches.toLocaleString()} stitches{d.emb?.file ? <i className="pr-fromfile">from the file</i> : null}</span> : null}
        </div>
        {cur && <div className="pr-art">{designLabel(cur)}</div>}
        {!(d.visualOnly && !d.confirmed) && inksLine}
        {extra}
        {/* the logo was digitized before: bring its files in instead (Oct 29, Nick: "already digitized question mark…
            all the way at the bottom of that") */}
        {dgz?.gray && onFind && <button type="button" className="btn sm pr-dgz-find" onClick={onFind} title="Find its DST, EMB and worksheet in the email, Dropbox or this computer">Already digitized?</button>}
        {printNotes(d.notes) && <div className="pr-notes">{printNotes(d.notes)}</div>}
        {d.confirm && (d.confirm.size || d.confirm.ink) && <div className="pr-unconf"><b>{confirmTitle(d.confirm.why)}</b> <span>Our best guess: {d.confirm.why}.</span>{detailsHref ? <a href={detailsHref}>{isNewOrderConfirm(d.confirm.why) ? "Production details" : "Reorder Details"}</a> : null}</div>}
      </div>
    </div>
  );
}

function LogoTile({ imprint, designs, urls, onMockup }: { imprint: { design_id?: string; size: string; inkMap?: Imprint["inkMap"]; artRatio?: number }; designs: Design[]; urls: Record<string, string>; onMockup?: () => void }) {
  const cur = designs.find((x) => x.id === imprint.design_id);
  const pic = usePainted(cur ? urls[cur.id] || "" : "", imprint);
  const m = (imprint.size || "").match(/^([\d.]+)\D*(wide|tall)?/i);
  const val = m ? +m[1] : 0, given: "W" | "H" = m && /tall/i.test(m[2] || "") ? "H" : "W";
  const other = cur && val ? designOther(cur, val, given, imprint.artRatio) : 0;
  return (
    <button type="button" className="imp-logo" onClick={onMockup} title={cur ? `${designLabel(cur)}: change it in the Mockup Creator` : "Pick the logo in the Mockup Creator"}>
      {cur && pic ? <img src={pic} alt="" /> : <span className="imp-logo-none">No logo</span>}
      <small>{cur ? designLabel(cur) : "Mockup Creator"}</small>
      {cur && val > 0 && other > 0 && <small className="imp-logo-sz">{val}&quot; {given === "W" ? "wide" : "tall"} → {other}&quot; {given === "W" ? "tall" : "wide"}</small>}
    </button>
  );
}

function DesignPick({ imprint, lines, designs, urls, canUpload, onPick, onUpload, onStar, readOnly, onMockup }: {
  imprint: { design_id?: string; size: string; artRatio?: number; inkMap?: Imprint["inkMap"] }; /** the group's garments, for its picture */ lines?: { color?: string; hex?: string }[]; designs: Design[]; urls: Record<string, string>; canUpload: boolean;
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
  const other = cur && val ? designOther(cur, val, given, imprint.artRatio) : 0;
  return (
    <div className="dp">
      <span className="dp-l">Logo</span>
      {readOnly
        ? <span className="dp-ro">{cur ? <>{urls[cur.id] && <span className="dp-th"><PrintThumb d={cur} url={urls[cur.id]} print={imprint} lines={lines} /></span>}<b>{designLabel(cur)}</b></> : <span className="faint">No logo yet</span>}
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

/**
 * Customer supplied transfers (Oct 27, Nick: "you should be able to just upload the placement reference… you can even put
 * in there where it came from, like DTF Dallas… the order number"): who made them, their order number, and the
 * placement reference (their mockup). A PDF's first page is made into the picture the order and the work order show.
 */
/** a placement reference picked from a file: stored as it is, a PDF also made into a picture of its first page */
async function putPlacement(file: Blob, name: string, keepFile?: string): Promise<{ path: string; name: string; file: string }> {
  const sb = createClient(), key = `designs/placement-${crypto.randomUUID().slice(0, 8)}`;
  const safe = name.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(-90) || "placement";
  const pdf = /\.pdf$/i.test(name) || file.type === "application/pdf";
  let file0 = keepFile || "";
  if (!keepFile) { const up = await sb.storage.from("proofs").upload(`${key}/${safe}`, file, { contentType: file.type || undefined }); if (up.error) throw new Error(up.error.message); file0 = `${key}/${safe}`; }
  let pic = pdf ? "" : file0;
  if (pdf) {
    const { pdfPicture } = await import("@/lib/printavoArt");
    const c = await pdfPicture(await file.arrayBuffer(), 1600);
    const png = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    if (png) { const to = `${key}/${safe.replace(/\.[^.]+$/, "")}.png`; const up = await sb.storage.from("proofs").upload(to, png, { contentType: "image/png" }); if (!up.error) pic = to; }
  }
  return { path: pic, name, file: file0 };
}

/** the customer's picture of where the logo goes, on any print (Oct 27, Nick) */
function PlaceRefRow({ d, onChange, url }: { d: Imprint; onChange: (fn: (im: Imprint) => void) => void; url: (path: string) => string }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const inRef = useRef<HTMLInputElement>(null);
  const pic = d.placeRef?.path ? url(d.placeRef.path) : "";
  const pick = async (f: File) => {
    setBusy(true); setErr("");
    try { const r = await putPlacement(f, f.name); onChange((im) => { im.placeRef = r; }); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't upload it."); }
    setBusy(false);
  };
  return (
    <div className="imp-pref">
      <span className="imp-l">Placement reference</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {pic && <img src={pic} alt="Placement reference" />}
      {d.placeRef && <span className="faint imp-pref-n">{d.placeRef.name}</span>}
      <button type="button" className="btn sm ghost" disabled={busy} onClick={() => inRef.current?.click()}>{busy ? "Uploading…" : d.placeRef ? "Replace" : "Add their placement picture"}</button>
      {d.placeRef && <button type="button" className="btn sm ghost" onClick={() => onChange((im) => { im.placeRef = undefined; })}>Remove</button>}
      <input ref={inRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f); }} />
      {err && <span className="err">{err}</span>}
    </div>
  );
}

function SuppliedBox({ d, onChange, url }: { d: Imprint; onChange: (fn: (im: Imprint) => void) => void; url: (path: string) => string }) {
  const sup = d.supplied || {};
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const inRef = useRef<HTMLInputElement>(null);
  const made = useRef(false);
  async function put(file: Blob, name: string, pdf: boolean, keepFile?: string) {
    const sb = createClient(), key = `designs/placement-${crypto.randomUUID().slice(0, 8)}`;
    const safe = name.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(-90) || "placement";
    let file0 = keepFile || "";
    if (!keepFile) { const up = await sb.storage.from("proofs").upload(`${key}/${safe}`, file, { contentType: file.type || undefined }); if (up.error) throw new Error(up.error.message); file0 = `${key}/${safe}`; }
    let pic = pdf ? "" : file0;
    if (pdf) {
      const { pdfPicture } = await import("@/lib/printavoArt");
      const c = await pdfPicture(await file.arrayBuffer(), 1600);
      const png = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
      if (png) { const up = await sb.storage.from("proofs").upload(`${key}/${safe.replace(/\.[^.]+$/, "")}.png`, png, { contentType: "image/png" }); if (!up.error) pic = `${key}/${safe.replace(/\.[^.]+$/, "")}.png`; }
    }
    onChange((im) => { im.supplied = { ...(im.supplied || {}), picture: { path: pic, name, file: file0 } }; });
  }
  async function upload(f: File) {
    setBusy("Uploading the placement reference…"); setErr("");
    try { await put(f, f.name, /\.pdf$/i.test(f.name) || f.type === "application/pdf"); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't upload it."); }
    finally { setBusy(""); }
  }
  // made by Create order from their PDF: its first page made into the picture, once
  useEffect(() => {
    const pr = sup.picture;
    if (made.current || !pr?.file || pr.path) return;
    made.current = true;
    void (async () => {
      setBusy("Making a picture of their placement reference…");
      try {
        const { data } = await createClient().storage.from("proofs").download(pr.file!);
        if (data) await put(data, pr.name, true, pr.file);
      } catch { /* the PDF stays; upload a picture by hand */ }
      setBusy("");
    })();
  }, [sup.picture?.file, sup.picture?.path]); // eslint-disable-line react-hooks/exhaustive-deps
  const pic = sup.picture?.path ? url(sup.picture.path) : "";
  return (
    <div className="imp-sup">
      <div className="imp-sup-f">
        <label><span className="imp-l">Supplied by</span><input type="text" placeholder="DTF Dallas" value={sup.by || ""} onChange={(e) => onChange((im) => { im.supplied = { ...(im.supplied || {}), by: e.target.value.slice(0, 60) }; })} /></label>
        <label><span className="imp-l">Their order #</span><input type="text" placeholder="182715" value={sup.ref || ""} onChange={(e) => onChange((im) => { im.supplied = { ...(im.supplied || {}), ref: e.target.value.slice(0, 60) }; })} /></label>
        <label><span className="imp-l">Where they go</span><input type="text" placeholder="Front & back" value={sup.where || ""} onChange={(e) => onChange((im) => { im.supplied = { ...(im.supplied || {}), where: e.target.value.slice(0, 60) }; })} /></label>
      </div>
      <span className="imp-l">Placement reference</span>
      <div className="imp-sup-ref">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {pic ? <img src={pic} alt="Placement reference" /> : <div className="imp-sup-none">{sup.picture?.file ? "Their PDF" : "None yet"}</div>}
        <div>
          {sup.picture?.name && <div className="imp-sup-n">{sup.picture.name}</div>}
          <div className="faint">Their mockup of where the transfers go. Shown on the order and the work order; not priced.</div>
          <button type="button" className="btn sm" disabled={!!busy} onClick={() => inRef.current?.click()}>{sup.picture ? "Replace" : "Upload the placement reference"}</button>
          <input ref={inRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
          {busy && <div className="faint">{busy}</div>}
          {err && <div className="err">{err}</div>}
        </div>
      </div>
    </div>
  );
}
