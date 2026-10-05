"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import { orderGroups, type Design, type Group, type Order } from "@/lib/pricing";
import { DEFAULT_SEP, baseByDefault, neverBase, composite, filmBits, findColors, filmDot, findSimInks, gradientShare, isDark, baseShirt, minDot, resamplePlate, separate, snapInk, spotMixer, type Plate, type Px, type SepCover, type SepInk, type SepResult, type SepSettings } from "@/lib/separate";
import { closestPms, colorHex, matchWord, suggestInk } from "@/lib/inkColors";
import InkMatch from "@/components/InkMatch";
import { guessHex, shirtHex, SHIRT_COLORS } from "@/lib/mockup";
import { filmPdf, filmRollPdf, deflate } from "@/lib/filmPdf";
import { ripPdf, rollLayout } from "@/lib/ripPdf";
import { folderPrintable, forgetFolder, pickFolder, savedFolder, sendToFolder } from "@/lib/filmFolder";
import { illustratorPdf } from "@/lib/illustratorPdf";
import { parseSvg, type VArt } from "@/lib/svgVector";
import { parseEps, vartSvg, vpathD } from "@/lib/epsVector";
import { findBackdrop, withoutBackdrop } from "@/lib/vectorBg";
import CustomerPick from "@/components/CustomerPick";
import { adjustInks, colorWord, dropInk, fadesOf, inkName, planFor, planPrint, shown, withMiddle, type PrintPlan } from "@/lib/printPlan";
import { browserInflate, parsePdf } from "@/lib/pdfVector";
import { deltaE } from "@/lib/inkColors";
import { layoutCounts, mergeProduction, withIssue, type EquipRow, type Machine, type Station } from "@/lib/production";
import PressLayout from "@/components/PressLayout";
import PressDefaults, { pressLayOf } from "@/components/PressDefaults";
import { autoSetup, checkSetup, drawLayout, fitSetup, plateOf, printOrder, type Slot } from "@/lib/pressSetup";
import { overlaps, recommendSetup } from "@/lib/pressPlan";
import SepCoach from "@/components/SepCoach";
import { holdsUm, meshFor, smallestDetail } from "@/lib/meshPlan";
import { inkNamesFromFiles } from "@/lib/sepInkNames";
import { useRole } from "@/components/RoleContext";
import { lessonFits, type CoachChange, type LessonDefault } from "@/lib/sepCoach";

/**
 * Separation Studio: our own separations, in the browser. Pick the method (spot color or simulated process), the
 * shirt color and how many inks; the art is split into plates (underbase, colors, highlight white) and shown on the
 * shirt. Fix any ink name, reorder, check it on a press, then save: an Illustrator file (spot colors, vector for spot
 * jobs), films (PDF with registration marks) and plate images go on the separation, and Approve writes the screen
 * count and inks back to the order. Art separated somewhere else (Separo…) can be uploaded here too.
 */
export type SepRow = {
  id: string; number: number; order_id: string | null; group_id: string | null; imprint_id: string | null; location: string; design_id: string | null; customer_id: string | null;
  garment_color: string; status: "requested" | "in_progress" | "review" | "approved" | "films" | "cancelled"; method: string; source: string;
  settings: Record<string, unknown>; channels: Channel[]; files: SepFile[]; preview_path: string | null; notes: string; due_date: string | null;
  requested_by: string; assigned_to: string | null; approved_by: string | null; approved_at: string | null; created_at: string; updated_at: string;
};
export type Channel = { key: string; name: string; hex: string; kind: Plate["kind"]; order: number; mesh: number; coverage: number; file?: string };
export type SepFile = { path: string; name: string; kind: "plate" | "preview" | "illustrator" | "films" | "upload"; size?: number };
export { ARCHIVE_DAYS, SEP_STATUS, sepStage, type SepStage } from "@/lib/sepStatus";
import { ARCHIVE_DAYS, SEP_STATUS } from "@/lib/sepStatus";

type Studio = SepSettings & { widthIn: number; lpi: number; angle: number; dpi: number; removeBg: boolean;
  /** vector art: take out the background layer (a page-size box of cream / white behind the art); unset = not asked yet */
  dropBackdrop?: boolean; lib: "auto" | "wilflex" | "pms"; solidOut?: "pixels" | "vector";
  /** underbase choke and color trap, in points at the print size (so they mean the same at any resolution) */
  chokePt?: number; trapPt?: number; blackOver?: boolean;
  /** fine detail (small type, thin lines): narrower than finePt (0 = off), the base is choked only fineChokePt and the
   *  color on top is fattened bumpPt onto the shirt instead */
  finePt?: number; fineChokePt?: number; bumpPt?: number;
  /** films: halftone dot shape */
  dot?: "ellipse" | "round" | "square";
  /** halftone frequency per screen (lpi), when it differs from the job's LPI */
  lpiFor?: Record<string, number>;
  /** films: crop marks at the corners / registration targets on the four sides (default on) */
  cropMarks?: boolean; regMarks?: boolean;
  /** dot gain on press, taken off the halftone plates ahead of time (Illustrator file and films); 0 if the RIP does it.
   *  (`gain` from SepSettings is filled from this; an old saved films-only `gain` is ignored.) */
  pressGain?: number };
const DOT_NAME = { ellipse: "elliptical", round: "round", square: "square" } as const;
const PRESS_GAIN = 0.15;
const CHOKE_PT = 0.5, TRAP_PT = 0.25, FINE_PT = 2, FINE_CHOKE_PT = 0.15, BUMP_PT = 0.25;
/** points at the print size → pixels of a copy `w` px wide (fractions kept: edges move by exact sub-pixel amounts) */
const ptPx = (pt: number, w: number, widthIn: number) => (pt * w) / (widthIn * 72);
/** the separation settings in pixels of a copy `w` px wide */
/** no shirt picked yet (garment ""): every color prints (nothing is left to the shirt); worked out as on a dark (black)
 * shirt with an underbase, the shop's usual job (head 1 is the underbase on almost every job), never as white */
const shirtOf = (st: Studio) => st.garment || "#000000";
/** a screen's halftone frequency: its own, else the job's */
const lpiOf = (st: Studio, key: string) => st.lpiFor?.[key] ?? st.lpi;
const sepOpts = (st: Studio, w: number): SepSettings => ({ ...st, garment: shirtOf(st), dropGarment: !!st.garment && st.dropGarment, gain: st.pressGain ?? PRESS_GAIN, choke: ptPx(st.chokePt ?? CHOKE_PT, w, st.widthIn), trap: ptPx(st.trapPt ?? TRAP_PT, w, st.widthIn),
  fine: ptPx(st.finePt ?? FINE_PT, w, st.widthIn), fineChoke: ptPx(st.fineChokePt ?? FINE_CHOKE_PT, w, st.widthIn), bump: ptPx(st.bumpPt ?? BUMP_PT, w, st.widthIn) });
/** the working size on screen (fast); the files are separated again at full size (OUT_PPI at the print width) */
const MAX_SIDE = 2400;
const OUT_PPI = 400, OUT_MAX_SIDE = 7200, OUT_MAX_PX = 36e6;
/** print order of locations for the tabs: front ones, then back, then sleeves and the rest */
const locRank = (loc: string) => { const l = (loc || "").toLowerCase(); return /sleeve/.test(l) ? 3 : /back|yoke|shoulder/.test(l) ? 2 : /front|chest|pocket|vertical/.test(l) ? 1 : 4; };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "plate";
/** what an ink name is and how close it is to the art's color: "Standard · very close", "PMS · close", "Custom" */
function inkKind(name: string, art: string): { kind: string; word: string; dE: number } | null {
  const hex = colorHex(name); if (!hex) return null;
  const kind = WILFLEX_NAMES[name] ? "Standard" : /^#/.test(name) ? "Custom" : "PMS", dE = Math.round(deltaE(art, hex) * 10) / 10;
  return { kind, word: matchWord(dE), dE };
}

/**
 * The art as pixels, at most `side` on the long side (vector art is drawn at exactly that size; pictures are never
 * blown up). With removeBg, a white background around the art becomes transparent, and the soft pixels along the
 * art's edge have the white taken back out of them (color-to-alpha), so no pale fringe prints around the outline.
 */
/**
 * Vector art: what each ink covers, drawn straight from the shapes at the size of `px` (spot color). Each shape's fill
 * becomes its inks' shares (an ink's own color = 100% of it; another color = halftone tints of the inks that make it),
 * and every shape is painted in the art's order, so a shape on top knocks out what's under it on every other ink.
 * Edges are the shapes' own curves (anti-aliased), never a soft pixel read as a third color: no slivers, no steps.
 * `blackOver`: black prints on top of the colors (overprint): a black shape doesn't cut the colors printed before it,
 * so thin black lines leave no cracks and a dot under a black outline stays whole. The knocked-out version of each ink
 * comes back too, for the underbase (black never goes on the base). The highlight white prints after black, so black
 * still knocks it out.
 * Where the art's background was taken out (`px` transparent), nothing prints.
 */
function vectorCover(v: VArt, px: Px, inks: SepInk[], s: SepSettings, blackOver: boolean): SepCover {
  const { w, h } = px, n = w * h, m = inks.length;
  const mix = spotMixer(inks, s);
  const rgb = (f: string) => (f.match(/[0-9a-f]{2}/gi) || ["00", "00", "00"]).slice(0, 3).map((x) => parseInt(x, 16)) as [number, number, number];
  const shares = v.shapes.map((sh) => mix(...rgb(sh.fill), true));
  // a gradient shape: each ink's share all along the fade (its halftone ramps up and down with it)
  const gshares = v.shapes.map((sh) => sh.grad ? sh.grad.stops.map((st) => ({ t: st.t, s: mix(...rgb(st.hex), true) })) : null);
  gshares.forEach((g, j) => { if (g) { const top = new Float32Array(m + 1); for (const st of g) for (let c = 0; c <= m; c++) top[c] = Math.max(top[c], st.s[c]); shares[j] = top; } });
  const paths = v.shapes.map((sh) => new Path2D(vpathD(sh.ops)));
  // black inks, and the shapes that print (mostly) black
  const blackInk = inks.map((k) => neverBase(k.hex));
  const isBlack = shares.map((sh, j) => { if (gshares[j]) return false; let b = 0; for (let c = 0; c < m; c++) if (blackInk[c]) b += sh[c]; return b > 0.9; });
  const whiteInk = inks.map((k) => { const [r, g, b] = rgb(k.hex); return r > 235 && g > 235 && b > 235; });
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  const k = w / v.w;
  const draw = (ch: number, skipBlack: boolean) => {
    const out = new Uint8Array(n);
    const first = shares.findIndex((sh) => sh[ch] > 0.02);
    if (first < 0) return out;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h);
    x.setTransform(k, 0, 0, k, -v.x * k, -v.y * k);
    for (let j = first; j < paths.length; j++) {
      const t = shares[j][ch] > 0.02 ? Math.round(Math.min(1, shares[j][ch]) * 255) : 0;
      if (!t && skipBlack && isBlack[j]) continue;
      const g = v.shapes[j].grad, gs = gshares[j];
      if (g && gs && t) {
        const cg = g.kind === "linear" ? x.createLinearGradient(g.x0, g.y0, g.x1, g.y1) : x.createRadialGradient(g.x0, g.y0, g.r0 || 0, g.x1, g.y1, g.r1 || 0);
        for (const st of gs) { const u = st.s[ch] > 0.02 ? Math.round(Math.min(1, st.s[ch]) * 255) : 0; cg.addColorStop(st.t, `rgb(${u},${u},${u})`); }
        x.fillStyle = cg;
      } else x.fillStyle = `rgb(${t},${t},${t})`;
      x.fill(paths[j], v.shapes[j].evenodd ? "evenodd" : "nonzero");
    }
    const d = x.getImageData(0, 0, w, h).data;
    for (let i = 0; i < n; i++) { const a = d[i * 4 + 3]; if (a && px.data[i * 4 + 3]) out[i] = Math.round((d[i * 4] * a) / 255); }
    return out;
  };
  const knock = inks.map((_, ch) => draw(ch, false));
  const over = blackOver && isBlack.some(Boolean);
  const cover = inks.map((_, ch) => (over && !blackInk[ch] && !whiteInk[ch] ? draw(ch, true) : knock[ch]));
  return { cover, knock, white: draw(m, false) };
}

function pixelsOf(img: HTMLImageElement, removeBg: boolean, vector = false, side = MAX_SIDE): Px {
  const nat = Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
  const k = vector ? side / nat : Math.min(1, side / nat);
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!; x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, w, h);
  const data = x.getImageData(0, 0, w, h).data;
  if (removeBg) {
    const n = w * h;
    // flood from the edges through near-white, opaque pixels (each pixel is marked when it's queued, so it's queued once)
    const near = (i: number) => data[i * 4 + 3] > 200 && data[i * 4] > 242 && data[i * 4 + 1] > 242 && data[i * 4 + 2] > 242;
    const gone = new Uint8Array(n), stack = new Int32Array(n); let sp = 0, removed = 0;
    const seed = (i: number) => { if (!gone[i] && near(i)) { gone[i] = 1; stack[sp++] = i; } };
    for (let i = 0; i < w; i++) { seed(i); seed((h - 1) * w + i); }
    for (let j = 0; j < h; j++) { seed(j * w); seed(j * w + w - 1); }
    while (sp) {
      const i = stack[--sp]; data[i * 4 + 3] = 0; removed++;
      const xx = i % w, yy = (i - xx) / w;
      if (xx > 0) seed(i - 1); if (xx < w - 1) seed(i + 1); if (yy > 0) seed(i - w); if (yy < h - 1) seed(i + w);
    }
    // the edge ring (within 2 px of the removed background): take the white back out. Found by growing the removed
    // area 2 px (across, then down), and only if anything was removed
    const ring = new Uint8Array(n);
    if (removed) {
      const tmp = new Uint8Array(n);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (gone[i]) for (let k = Math.max(0, x - 2); k <= Math.min(w - 1, x + 2); k++) tmp[y * w + k] = 1; }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (!tmp[y * w + x]) continue; for (let k = Math.max(0, y - 2); k <= Math.min(h - 1, y + 2); k++) ring[k * w + x] = 1; }
    }
    for (let i = 0; i < n; i++) {
      if (!ring[i] || gone[i]) continue;
      const xx = i % w, yy = (i - xx) / w;
      const o = i * 4, r = data[o], g = data[o + 1], b = data[o + 2];
      // the art's own color here: the strongest (farthest from white) pixel close by that isn't background
      let F = [r, g, b], fd = (255 - r) ** 2 + (255 - g) ** 2 + (255 - b) ** 2;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const X = xx + dx, Y = yy + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (gone[j]) continue;
        const q = j * 4, d = (255 - data[q]) ** 2 + (255 - data[q + 1]) ** 2 + (255 - data[q + 2]) ** 2; if (d > fd) { fd = d; F = [data[q], data[q + 1], data[q + 2]]; }
      }
      if (fd < 30 * 30) continue; // a pale color: nothing to take out
      // how much of the pixel is that color (the rest is the white it was blended with)
      const a = Math.max(0, Math.min(1, ((255 - r) * (255 - F[0]) + (255 - g) * (255 - F[1]) + (255 - b) * (255 - F[2])) / fd));
      if (a >= 0.98) continue;
      if (a < 0.02) { data[o + 3] = 0; continue; }
      data[o] = Math.round((r - (1 - a) * 255) / a); data[o + 1] = Math.round((g - (1 - a) * 255) / a); data[o + 2] = Math.round((b - (1 - a) * 255) / a);
      data[o + 3] = Math.round(data[o + 3] * a);
    }
  }
  return { w, h, data };
}
/** art uploaded straight to a separation (no order): kept in its folder, remembered in settings.art */
export type SepArt = { path: string; name: string; type: string; preview?: string };
export const ART_ACCEPT = ".png,.jpg,.jpeg,.webp,.svg,.eps,.ai,.pdf,image/png,image/jpeg,image/webp,image/svg+xml,application/postscript,application/pdf,application/illustrator";
export const ART_KINDS = "PNG, JPG, WebP, SVG, Illustrator (.ai), PDF or EPS";
const isEps = (name: string, type = "") => /\.eps$/i.test(name) || (/postscript/i.test(type) && !/\.ai$/i.test(name));
const isPdf = (name: string, type = "") => /\.(pdf|ai)$/i.test(name) || /pdf|illustrator/i.test(type);
/** vector files we read ourselves (EPS, .ai, PDF): their shapes, or null for pictures and SVG */
export async function readVector(blob: Blob, name: string, type = ""): Promise<VArt | null> {
  if (isEps(name, type)) return parseEps(await blob.text());
  if (isPdf(name, type)) {
    try { return await parsePdf(new Uint8Array(await blob.arrayBuffer()), browserInflate); }
    catch (e) { return { ok: false, why: e instanceof Error ? e.message : "couldn't be read", x: 0, y: 0, w: 1, h: 1, shapes: [] }; }
  }
  return null;
}
export const artOk = (f: File) => /^image\/(png|jpe?g|webp|svg\+xml)$/i.test(f.type) || /\.(png|jpe?g|webp|svg|eps|ai|pdf)$/i.test(f.name);
/** null when the file can be separated, else why not (an EPS has to be flat filled shapes) */
export async function artProblem(f: File): Promise<string | null> {
  if (!artOk(f)) return `Use a ${ART_KINDS}.`;
  const v = await readVector(f, f.name, f.type);
  if (!v || v.ok) return null;
  const kind = isEps(f.name, f.type) ? "EPS" : /\.ai$/i.test(f.name) ? "Illustrator file" : "PDF";
  return `This ${kind} ${v.why}. Fix that in Illustrator, or save it as PNG (at the print size) to separate it as a picture.`;
}
export async function uploadSepArt(sb: ReturnType<typeof createClient>, id: string, f: File): Promise<SepArt> {
  const stamp = Date.now(), path = `separations/${id}/art-${stamp}-${f.name.replace(/[^\w.-]+/g, "_")}`;
  const type = f.type || (/\.svg$/i.test(f.name) ? "image/svg+xml" : isEps(f.name) ? "application/postscript" : isPdf(f.name) ? "application/pdf" : "application/octet-stream");
  const r = await sb.storage.from("proofs").upload(path, f, { upsert: true, contentType: type });
  if (r.error) throw new Error(r.error.message);
  const art: SepArt = { path, name: f.name, type };
  {
    // vector files (EPS, .ai, PDF): a picture of it for the list (the Studio reads the file itself)
    const v = await readVector(f, f.name, f.type);
    if (v?.ok) { const pv = `separations/${id}/art-${stamp}-preview.svg`; const u = await sb.storage.from("proofs").upload(pv, new Blob([vartSvg(v)], { type: "image/svg+xml" }), { upsert: true, contentType: "image/svg+xml" }); if (!u.error) art.preview = pv; }
  }
  return art;
}

const loadImg = (url: string) => new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = () => bad(new Error("Couldn't load the art")); i.src = url; });
const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), "image/png"));
const download = (data: Uint8Array | Blob, name: string, type = "application/pdf") => { const a = document.createElement("a"); a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data as BlobPart], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

export default function SeparationStudio({ id }: { id: string }) {
  const sb = useMemo(() => createClient(), []);
  const [row, setRow] = useState<SepRow | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [artUrl, setArtUrl] = useState(""), [origUrl, setOrigUrl] = useState("");
  // null while loading; false = nothing to separate yet (show the upload box)
  const [hasArt, setHasArt] = useState<boolean | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  // SVG art: its shapes, kept as vector for the Illustrator file
  const [vraw, setVart] = useState<VArt | null>(null);
  const [me, setMe] = useState({ email: "", boss: false });
  const [err, setErr] = useState(""), [msg, setMsg] = useState(""), [busy, setBusy] = useState("");
  const [st, setSt] = useState<Studio>({ ...DEFAULT_SEP, widthIn: 11, lpi: 55, angle: 22.5, dpi: 720, removeBg: true, lib: "auto" });
  // vector art's background layer (stock art's cream / white page box): asked once, then kept in the settings
  const backdrop = useMemo(() => findBackdrop(vraw), [vraw]);
  const vart = useMemo(() => (vraw && backdrop && st.dropBackdrop ? withoutBackdrop(vraw, backdrop) : vraw), [vraw, backdrop, st.dropBackdrop]);
  // after the background comes out (or goes back), the inks are found again once the new art is drawn
  const refind = useRef<HTMLImageElement | null | false>(false);
  // EPS / PDF art: the Studio's picture of it is drawn from its shapes
  const fromShapes = useRef(false);
  const [inks, setInks] = useState<SepInk[]>([]);
  const [res, setRes] = useState<SepResult | null>(null);
  const [orderKeys, setOrderKeys] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [solo, setSolo] = useState<string | null>(null);
  /** film close-up: where on the plate (px of the screen copy) */
  const [loupe, setLoupe] = useState<{ x: number; y: number } | null>(null);
  const loupeCv = useRef<HTMLCanvasElement>(null);
  const [mesh, setMesh] = useState<Record<string, number>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [presses, setPresses] = useState<Machine[]>([]);
  const [pressId, setPressId] = useSticky("sep.press", "");
  // press setup for this job: what goes on each head (null = automatic, from the press defaults)
  const [setup, setSetup] = useState<Slot[] | null>(null);
  const [selPlate, setSelPlate] = useState<string | null>(null), [selHead, setSelHead] = useState<number | null>(null);
  const [defOpen, setDefOpen] = useState(false);
  // the two side panes are tabbed so the whole studio fits the window: left = how it separates, right = what comes out
  const [ltab0, setLtab] = useSticky<"inks" | "base" | "output">("sep.ltab", "inks");
  // two tabs: the inks, and the underbase with the output settings
  const ltab = ltab0 === "base" ? "output" : ltab0;
  const [rtab0, setRtab] = useSticky<"screens" | "press" | "films" | "coach">("sep.rtab", "screens");
  // two tabs: screens with their films, the press with the coach
  const rtab = rtab0 === "films" ? "screens" : rtab0 === "coach" ? "press" : rtab0;
  const [pick, setPick] = useState(false);
  const [cancelAsk, setCancelAsk] = useState(false);
  // how many inks the art itself needs (from the last automatic find): fewer is a choice, not "shading"
  const [natural, setNatural] = useState(0);
  // the ink whose Suggested colors box is open (index in the ink bar)
  const [matchAt, setMatchAt] = useState<number | null>(null);
  const [tab, setTab] = useSticky<"studio" | "outside">("sep.tab", "studio");
  const cv = useRef<HTMLCanvasElement>(null);
  const cvOrig = useRef<HTMLCanvasElement>(null);
  // like Separo's soft proof: the print, the original art, or the two side by side with a slider
  const [view, setView] = useSticky<"proof" | "original" | "compare">("sep.view", "proof");
  const [split, setSplit] = useState(50);
  // where the art sits in the stage (it's shrunk to fit), so the compare slider runs exactly across it
  const [artBox, setArtBox] = useState<{ l: number; w: number } | null>(null);
  useEffect(() => {
    const c = cv.current, box = c?.parentElement; if (!c || !box || typeof ResizeObserver === "undefined") return;
    const run = () => { const a = c.getBoundingClientRect(), b = box.getBoundingClientRect(); setArtBox((o) => (o && Math.abs(o.l - (a.left - b.left)) < 1 && Math.abs(o.w - a.width) < 1 ? o : { l: a.left - b.left, w: a.width })); };
    const ro = new ResizeObserver(run); ro.observe(c); ro.observe(box); run();
    return () => ro.disconnect();
  }, [res, tab, hasArt]);
  const [bg, setBg] = useSticky<"shirt" | "checker">("sep.bg", "shirt");
  const pxRef = useRef<Px | null>(null);
  const [pxTick, setPxTick] = useState(0);
  const set = (p: Partial<Studio>) => setSt((s) => ({ ...s, ...p }));
  // "Make Separations Better": the production manager (and the owner) talk to the coach
  const { perms } = useRole();
  const coachOn = perms.coach;
  const lessonNote = useRef("");

  /* ---------- load ---------- */
  const load = useCallback(async () => {
    const { data: r } = await sb.from("separations").select("*").eq("id", id).maybeSingle();
    if (!r) { setErr("Separation not found."); return; }
    const row0 = r as SepRow; setRow(row0);
    const { data: { user } } = await sb.auth.getUser();
    const email = (user?.email || "").toLowerCase();
    const { data: sf } = await sb.from("staff").select("role").eq("email", email).maybeSingle();
    setMe({ email, boss: !!sf });
    const [{ data: o }, { data: d }, { data: s0 }, { data: eq0 }] = await Promise.all([
      row0.order_id ? sb.from("orders").select("*").eq("id", row0.order_id).maybeSingle() : Promise.resolve({ data: null }),
      row0.design_id ? sb.from("designs").select("*").eq("id", row0.design_id).maybeSingle() : Promise.resolve({ data: null }),
      sb.from("settings").select("data").eq("id", 1).maybeSingle(),
      sb.from("production_equipment").select("*"),
    ]);
    setOrder((o as Order) || null);
    // the other print locations of this order group (front, back, sleeve…): a tab each at the top
    if (row0.order_id) {
      const { data: sib } = await sb.from("separations").select("id, location, status, imprint_id, group_id").eq("order_id", row0.order_id).neq("status", "cancelled");
      const groupSibs = ((sib || []) as Pick<SepRow, "id" | "location" | "status" | "imprint_id" | "group_id">[]).filter((x) => !row0.group_id || x.group_id === row0.group_id);
      setSiblings(groupSibs.sort((a, b) => locRank(a.location) - locRank(b.location)));
    }
    const today = new Date().toISOString().slice(0, 10);
    const ps = mergeProduction((s0?.data as { production?: unknown } | null)?.production);
    setPresses(ps.machines.filter((m) => m.type === "screen" && m.active).map((m) => withIssue(m, ((eq0 || []) as EquipRow[]).find((e) => e.machine === m.id), today)));
    // saved settings win; otherwise the garment from the order
    const saved = row0.settings as Partial<Studio> & { inks?: SepInk[]; order?: string[]; mesh?: Record<string, number>; names?: Record<string, string> };
    // the shirt: saved, else the order's garment color; none picked = every color prints
    const garment = (saved.garment as string) ?? (row0.garment_color ? shirtHex(row0.garment_color) || colorHex(row0.garment_color) || guessHex(row0.garment_color) || "" : "");
    const im = orderGroups((o as Order) || { groups: [], lines: [] } as never).flatMap((g) => g.imprints).find((x) => x.id === row0.imprint_id);
    const widthIn = saved.widthIn || parseFloat(String(im?.size || "").replace(/[^\d.]/g, " ").trim().split(/\s+/)[0]) || 11;
    setSt((s) => ({ ...s, ...saved, garment, widthIn, method: (saved.method as SepSettings["method"]) || s.method }));
    // a new separation starts from what the coach has learned (Make Separations Better, last 30 days)
    if (!saved.inks?.length) {
      const { data: ls } = await sb.from("sep_lessons").select("lesson, default_setting").eq("active", true).gt("expires_at", new Date().toISOString()).not("default_setting", "is", null).order("created_at");
      const meth = (saved.method as string) || "spot", dk = isDark(garment), p: Partial<Studio> = {}, used: string[] = [];
      for (const l of (ls || []) as { lesson: string; default_setting: LessonDefault }[]) {
        const d = l.default_setting; if (!d || !lessonFits(d, meth, dk) || d.setting === "method" || d.setting === "addMiddle" || d.setting === "colors") continue;
        (p as Record<string, unknown>)[d.setting] = d.value; used.push(l.lesson);
      }
      if (used.length) { setSt((s) => ({ ...s, ...p })); lessonNote.current = `Started from what the coach learned: ${used.join(" · ")}`; setMsg(lessonNote.current); }
    }
    if (saved.inks?.length) setInks(saved.inks);
    if (saved.order) setOrderKeys(saved.order);
    if (saved.mesh) setMesh(saved.mesh);
    if (saved.names) setNames(saved.names);
    const ps0 = (saved as { pressSetup?: { press: string; heads: Slot[]; manual?: boolean } }).pressSetup;
    if (ps0?.press) setPressId(ps0.press);
    setSetup(ps0?.manual && Array.isArray(ps0.heads) ? ps0.heads : null);
    if (row0.status === "requested") { await sb.from("separations").update({ status: "in_progress", assigned_to: email, updated_at: new Date().toISOString() }).eq("id", id); setRow({ ...row0, status: "in_progress", assigned_to: email }); }
    // the art: the imprint's design, else art uploaded straight to this separation
    const d0 = d as Design | null, up = (row0.settings as { art?: SepArt }).art;
    designRef.current = (d0 as (Design & { print_plan?: PrintPlan | null }) | null) || null;
    const des = d0?.file_path ? { file_path: d0.file_path, file_type: d0.file_type, file_name: d0.file_name, preview_path: d0.preview_path } : up?.path ? { file_path: up.path, file_type: up.type, file_name: up.name, preview_path: null as string | null } : null;
    setHasArt(!!des);
    // Illustrator EPS: read its shapes (vector all the way to the Illustrator file)
    if (des && (isEps(des.file_name || des.file_path, des.file_type || "") || isPdf(des.file_name || des.file_path, des.file_type || ""))) {
      const [{ data: ev }, { data: su }] = await Promise.all([sb.storage.from("proofs").download(des.file_path), sb.storage.from("proofs").createSignedUrl(des.file_path, 3600)]);
      setOrigUrl(su?.signedUrl || "");
      const v = ev ? await readVector(ev, des.file_name || des.file_path, des.file_type || "") : null;
      if (v?.ok) { fromShapes.current = true; setVart(v); return; } // (the picture of it is drawn from the shapes, below)
      if (!des.preview_path) { setErr(`This art file ${v?.why || "couldn't be read"}. Fix that in Illustrator, or upload a PNG at the print size.`); setHasArt(false); return; }
      if (v) setVart(v); // shows why, and the preview picture is separated instead
      const { data: pb } = await sb.storage.from("proofs").download(des.preview_path);
      if (pb) setArtUrl(URL.createObjectURL(pb));
      return;
    }
    if (des) {
      const raster = /^image\/(png|jpe?g|webp)/i.test(des.file_type || "") || /\.(png|jpe?g|webp)$/i.test(des.file_name || "");
      const svg = /svg/i.test(des.file_type || "") || /\.svg$/i.test(des.file_name || des.file_path || "");
      const paths = [raster || svg ? des.file_path : des.preview_path || des.file_path, des.file_path].filter(Boolean) as string[];
      if (svg) { const { data: sv } = await sb.storage.from("proofs").download(des.file_path); if (sv) setVart(parseSvg(await sv.text())); }
      const { data: urls } = await sb.storage.from("proofs").createSignedUrls(paths, 3600);
      setOrigUrl(urls?.[1]?.signedUrl || urls?.[0]?.signedUrl || "");
      // the art as a local blob, so the canvas can read its pixels (no cross-site image)
      const { data: blob } = await sb.storage.from("proofs").download(paths[0]);
      setArtUrl(blob ? URL.createObjectURL(blob) : urls?.[0]?.signedUrl || "");
    }
  }, [sb, id]);
  useEffect(() => { load(); }, [load]);
  // vector art: the picture the Studio works from is drawn from its shapes (without the background, when removed)
  useEffect(() => { if (vart?.ok && (fromShapes.current || vart !== vraw)) setArtUrl(URL.createObjectURL(new Blob([vartSvg(vart)], { type: "image/svg+xml" }))); }, [vart]);
  useEffect(() => { if (!artUrl) return; loadImg(artUrl).then(setImg).catch((e) => setErr(e.message)); }, [artUrl]);
  useEffect(() => { if (!img) return; pxRef.current = pixelsOf(img, st.removeBg, !!vart); setPxTick((t) => t + 1); }, [img, st.removeBg, vart]);

  /* ---------- fades (gradients) between inks ---------- */
  // each fade in the art, with its middle color (from the art itself) and whether two inks' halftones can make it:
  // yellow and blue dots side by side mix in light toward a dull gray-green, not the art's bright green, so the shop
  // adds a third screen for the middle (as with Separo)
  const fadeRows = useMemo(() => fadesOf(inks, pxRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inks, pxTick]);
  function addMiddle(ah: string, bh: string, mid: string) {
    setInks((l) => withMiddle(l, ah, bh, mid, st.lib));
    setSt((x) => ({ ...x, maxColors: Math.min(12, inks.length + 1) }));
  }
  /* ---------- combining inks (drag one swatch onto another) ---------- */
  const [dragInk, setDragInk] = useState<number | null>(null), [dropOn, setDropOn] = useState<number | null>(null);
  /** ink `from` prints as ink `to` from now on: its art colors join `to`'s, one screen */
  function combineInks(from: number, to: number) {
    setInks((l) => {
      const src = l[from], dst = l[to]; if (!src || !dst) return l;
      const moved = [src.hex, ...(src.also || [])];
      const merged: SepInk = { ...dst, also: [...(dst.also || []), ...moved].filter((h, q, a) => h !== dst.hex && a.indexOf(h) === q) };
      // fades that ran to the combined ink now run to the ink it joined
      const fix = (x: SepInk): SepInk => (x.fadeTo?.some((h) => moved.includes(h)) ? { ...x, fadeTo: [...new Set(x.fadeTo.map((h) => (moved.includes(h) ? dst.hex : h)))].filter((h) => h !== x.hex) } : x);
      const fadeTo = [...new Set([...(dst.fadeTo || []), ...(src.fadeTo || [])])].filter((h) => h !== dst.hex && !moved.includes(h));
      return l.map((x, j) => (j === to ? { ...merged, ...(fadeTo.length ? { fadeTo } : { fadeTo: undefined }) } : fix(x))).filter((_, j) => j !== from);
    });
    setMatchAt(null);
    setSt((x) => ({ ...x, maxColors: Math.max(1, inks.length - 1) }));
    setMsg(`Combined: ${inks[from]?.name} now prints as ${inks[to]?.name} (one screen). Split it again from that ink.`);
  }
  function splitInk(i: number) {
    setInks((l) => { const k = l[i]; if (!k?.also?.length) return l; const back = k.also.map((h) => ({ hex: h, name: inkName(h, st.lib) })); return [...l.slice(0, i), { ...k, also: undefined }, ...back, ...l.slice(i + 1)]; });
    setSt((x) => ({ ...x, maxColors: Math.min(12, inks.length + (inks[i]?.also?.length || 0)) }));
  }
  /* ---------- Make Separations Better (the coach) ---------- */
  const pendingFind = useRef(false);
  function applyCoach(changes: CoachChange[]) {
    const p: Partial<Studio> = {}, notes: string[] = [];
    for (const c of changes) {
      if (c.setting === "method") { const m = c.value === "sim" ? "sim" : "spot"; set({ method: m }); findInks(m, true); continue; }
      if (c.setting === "colors") { p.maxColors = +c.value; pendingFind.current = true; continue; }
      if (c.setting === "addMiddle") {
        const [a, b] = String(c.value).split("|").map((x) => x.trim().toLowerCase());
        const f = fadeRows.find((r) => [r.a.name.toLowerCase(), r.b.name.toLowerCase()].sort().join("|") === [a, b].sort().join("|"));
        if (f) addMiddle(f.a.hex, f.b.hex, f.mid); else notes.push(`no fade between ${c.value.toString().replace("|", " and ")}`);
        continue;
      }
      (p as Record<string, unknown>)[c.setting] = c.value;
    }
    if (Object.keys(p).length) set(p);
    setMsg(notes.length ? `Applied, except: ${notes.join("; ")}.` : "Applied. Save Draft to keep it.");
  }
  useEffect(() => { if (pendingFind.current) { pendingFind.current = false; findInks(); } }); // eslint-disable-line react-hooks/exhaustive-deps
  const coachContext = () => ({
    order_id: row?.order_id || undefined, separation: row ? `S-${row.number}` : undefined, location: row?.location, status: row?.status,
    shirt: st.garment ? { color: st.garment, name: row?.garment_color, dark: isDark(st.garment) } : "none picked: every color prints",
    method: st.method, art: vart?.ok ? "vector" : img ? `picture ${img.naturalWidth}×${img.naturalHeight} px (${Math.round((img.naturalWidth || 0) / st.widthIn)} ppi at the print size)` : "none",
    print_width_in: st.widthIn,
    settings: { colors: st.maxColors, underbase: st.underbase, highlight: st.highlight, chokePt: st.chokePt ?? CHOKE_PT, trapPt: st.trapPt ?? TRAP_PT, finePt: st.finePt ?? FINE_PT, fineChokePt: st.fineChokePt ?? FINE_CHOKE_PT, bumpPt: st.bumpPt ?? BUMP_PT, blackOver: st.blackOver ?? true, lpi: st.lpi, angle: st.angle, dot: st.dot || "ellipse", pressGain: st.pressGain ?? PRESS_GAIN, dpi: st.dpi },
    inks: inks.map((k) => ({ name: k.name, art_color: k.hex, ...(k.also?.length ? { combined_with: k.also } : {}), ...(k.fadeTo?.length ? { fades_to: k.fadeTo.map((h) => inks.find((q) => q.hex === h)?.name || h) } : {}) })),
    plates: plates.map((p, i) => ({ order: i + 1, name: p.name, kind: p.kind, coverage: `${(p.coverage * 100).toFixed(1)}%`, mesh: p.mesh, halftone: st.method === "sim" || !!p.tonal })),
    fades: fadeRows.map((f) => ({ from: f.a.name, to: f.b.name, middle: f.midWord, muddy_middle_risk: !!f.risky })),
    shading_between_colors: hint ? `${Math.round(hint * 100)}%` : undefined,
  });
  const coachImages = () => {
    const out: { label: string; data: string }[] = [];
    const grab = (c: HTMLCanvasElement | null, label: string) => {
      if (!c || !c.width) return;
      try {
        const k = Math.min(1, 1100 / Math.max(c.width, c.height)), t = document.createElement("canvas");
        t.width = Math.round(c.width * k); t.height = Math.round(c.height * k);
        const g = t.getContext("2d")!; g.fillStyle = shirtOf(st); g.fillRect(0, 0, t.width, t.height); g.drawImage(c, 0, 0, t.width, t.height);
        out.push({ label, data: t.toDataURL("image/jpeg", 0.85).split(",")[1] });
      } catch { /* a canvas that can't be read is just left out */ }
    };
    if (cv.current) grab(cv.current, solo ? "The film for one screen (black = ink):" : "Soft proof: how the separation prints on the shirt:");
    else if (res) {
      // the Coach tab: the proof canvas isn't on screen, so draw the proof here
      const c = document.createElement("canvas"); c.width = res.w; c.height = res.h;
      const x = c.getContext("2d")!, id = x.createImageData(res.w, res.h);
      id.data.set(composite({ plates, w: res.w, h: res.h }, shirtOf(st), undefined, st.pressGain ?? PRESS_GAIN)); x.putImageData(id, 0, 0); grab(c, "Soft proof: how the separation prints on the shirt:");
    }
    if (cvOrig.current) grab(cvOrig.current, "The original art:");
    else if (img) { const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext("2d")!.drawImage(img, 0, 0); grab(c, "The original art:"); }
    return out;
  };

  /* ---------- find inks (first time, or on request) ---------- */
  // auto: find as many inks as the art needs and set the Colors count to that; otherwise use the Colors count (fewer
  // than the art has: the inks easiest to mix from the others are left out and printed as halftones of them)
  const findInks = useCallback((method = st.method, auto = false, fromPlan = false) => {
    const px = pxRef.current; if (!px) return;
    // sim tries every candidate ink against the whole art (a few seconds): let the page say so first
    setBusy("Finding inks…");
    setTimeout(() => {
      // the print plan: the same one the Mockup Creator shows for this logo (saved on the design), else worked out
      // here the same way (and saved on the design, so the mockup and the price match the screens)
      if (auto) {
        const d0 = designRef.current;
        let plan = fromPlan ? planFor(d0?.print_plan, px, shirtOf(st), st.lib) : null;
        const fresh = !plan;
        if (!plan) plan = planPrint(px, { garment: shirtOf(st), lib: st.lib, method: fromPlan ? undefined : method });
        const spots = (vart?.shapes || []).filter((sh) => sh.ink && !/%$/.test(sh.ink));
        const swatch = (hex: string) => { let best = "", bd = 4; for (const sh of spots) { const dd = deltaE(hex, sh.fill); if (dd < bd) { bd = dd; best = sh.ink!; } } return best; };
        const list = plan.inks.map((k) => ({ ...k, name: swatch(k.hex) || k.name }));
        setSt((x) => ({ ...x, method: plan!.method, maxColors: Math.max(1, list.length) }));
        setNatural(list.length);
        setInks(list);
        setMsg((fromPlan && !fresh ? `From the logo's print plan (same as the mockup): ${plan.why}` : plan.why) + (lessonNote.current ? ` ${lessonNote.current}` : ""));
        lessonNote.current = "";
        if (fresh && fromPlan && d0?.id) { sb.from("designs").update({ print_plan: plan }).eq("id", d0.id).then(() => {}); d0.print_plan = plan; }
        setOrderKeys([]); setNames({}); setHidden(new Set()); setMatchAt(null); setBusy("");
        return;
      }
      // Colors + Apply (spot): change how many inks the logo prints in, starting from the inks it has now. Fewer: the
      // ink easiest to do without goes (a fade's middle screen first; its area prints as the others' halftones).
      // More: a fade gets another step, else the next color in the art gets its own ink.
      if (method === "spot" && inks.length) {
        const r = adjustInks(px, inks, st.maxColors, st.lib);
        setInks(r.inks); setMsg(r.note); setSt((x) => ({ ...x, maxColors: r.inks.length }));
        setOrderKeys([]); setMatchAt(null); setBusy("");
        return;
      }
      const want = auto ? (method === "sim" ? 8 : 12) : st.maxColors;
      const f = method === "sim" ? findSimInks(px, shirtOf(st), want) : findColors(px, want, 9, 0.004, shirtOf(st));
      if (auto || f.length < want) setSt((x) => ({ ...x, maxColors: Math.max(1, f.length) }));
      if (auto) setNatural(f.length);
      if (!auto && f.length < want) setMsg(`This art has ${f.length} color${f.length === 1 ? "" : "s"}. More inks would print almost nothing, so it stays at ${f.length}.`);
      // vector art with spot swatches (.ai / PDF): an ink that is one of the art's swatches takes the swatch's name
      const spots = (vart?.shapes || []).filter((sh) => sh.ink && !/%$/.test(sh.ink));
      const swatch = (hex: string) => { let best = "", bd = 4; for (const sh of spots) { const d = deltaE(hex, sh.fill); if (d < bd) { bd = d; best = sh.ink!; } } return best; };
      const list: SepInk[] = f.map((x) => ({ hex: x.hex, name: swatch(x.hex) || inkName(x.hex, st.lib), ...("fadeTo" in x && x.fadeTo?.length ? { fadeTo: x.fadeTo } : {}) }));
      setInks(list);
      setOrderKeys([]); setNames({}); setHidden(new Set()); setMatchAt(null); setBusy("");
    }, 30);
  }, [st.method, st.garment, st.maxColors, st.lib, vart, sb, inks]);
  const hint = useMemo(() => { const px = pxRef.current; if (!px || !inks.length || st.method === "sim") return 0; return gradientShare(px, inks.map((k) => k.hex)); }, [pxTick, inks, st.method]);
  useEffect(() => {
    if (!pxTick) return;
    if (refind.current !== false && img !== refind.current) { refind.current = false; findInks(st.method, true, false); return; }
    if (!inks.length) findInks(st.method, true, true);
  }, [pxTick]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- separate (a moment after anything changes) ---------- */
  useEffect(() => {
    const px = pxRef.current; if (!px || !inks.length) return;
    setBusy("Separating…");
    const t = setTimeout(() => {
      const ks = inks.map((k) => ({ hex: k.hex, name: k.name, fadeTo: k.fadeTo, also: k.also, shirt: k.shirt })), so = sepOpts(st, px.w);
      const r = separate(px, ks, so, vart?.ok && st.method === "spot" ? vectorCover(vart, px, ks, so, st.blackOver ?? true) : undefined);
      // show the ink's real color, not the art's
      r.plates.forEach((p) => { const k = inks.find((x) => "c" + x.hex.slice(1) === p.key); if (k) p.hex = shown(k); });
      hiRef.current = null;
      setRes(r); setBusy("");
    }, 60);
    return () => clearTimeout(t);
  }, [pxTick, inks, st.method, st.garment, st.underbase, st.chokePt, st.highlight, st.dropGarment, st.trapPt, st.blackOver, st.widthIn, st.baseFor, st.finePt, st.fineChokePt, st.bumpPt, st.pressGain]); // eslint-disable-line react-hooks/exhaustive-deps

  // plates in the chosen print order (new plates keep their default spot)
  // suggested mesh per screen from its smallest detail (156 unless the detail is very small; the base matches the
  // finest color on it)
  const [meshSug, setMeshSug] = useState<Record<string, { mesh: number; why: string }>>({});
  useEffect(() => {
    if (!res) return;
    const t = setTimeout(() => {
      const out: Record<string, { mesh: number; why: string }> = {};
      for (const p of res.plates) {
        if (p.tonal || st.method === "sim" || p.kind === "highlight") continue;
        if (p.kind === "underbase") { out[p.key] = { mesh: 156, why: "Underbase: 156, or as fine as the finest color printed on it." }; continue; }
        const d = smallestDetail(p.alpha, res.w, res.h, st.widthIn);
        const m = d ? meshFor(d.smallestUm, d.kind) : 156;
        out[p.key] = { mesh: m, why: d ? `Smallest detail: ${d.what} ${(d.smallestUm / 1000).toFixed(2)} mm at ${st.widthIn}" wide. ${m} mesh holds ${d.kind === "dot" ? "dots" : "lines"} about ${(holdsUm(m, d.kind) / 1000).toFixed(2)} mm and up.` : "No fine detail: 156." };
      }
      const base = res.plates.find((p) => p.kind === "underbase");
      if (base && out[base.key]) {
        // the base prints under the colors' dots too: as fine as the finest based color
        const based = res.plates.filter((p) => p.kind === "color" && !neverBase("#" + p.key.slice(1)) && (st.baseFor?.[p.key] ?? baseByDefault("#" + p.key.slice(1))) && out[p.key]);
        const finest = based.reduce((a, p) => (out[p.key].mesh > a.mesh ? { mesh: out[p.key].mesh, name: p.name } : a), { mesh: out[base.key].mesh, name: "" });
        if (finest.name && finest.mesh > out[base.key].mesh) out[base.key] = { mesh: finest.mesh, why: `${finest.name} needs ${finest.mesh} for its small detail, and the base prints under it, so the base is ${finest.mesh} too.` };
      }
      setMeshSug(out);
    }, 120);
    return () => clearTimeout(t);
  }, [res, st.widthIn, st.method, st.baseFor]);
  const arrange = useCallback((ps: Plate[]) => {
    const list = ps.map((p) => ({ ...p, name: names[p.key] || p.name, mesh: mesh[p.key] ?? meshSug[p.key]?.mesh ?? p.mesh }));
    if (!orderKeys.length) return list;
    return [...list].sort((a, b) => { const x = orderKeys.indexOf(a.key), y = orderKeys.indexOf(b.key); return (x < 0 ? 999 : x) - (y < 0 ? 999 : y); });
  }, [orderKeys, names, mesh, meshSug]);
  const plates = useMemo(() => (res ? arrange(res.plates) : []), [res, arrange]);

  /* ---------- draw ---------- */
  useEffect(() => {
    const c = cv.current; if (!c || !res) return;
    c.width = res.w; c.height = res.h;
    const x = c.getContext("2d")!;
    const imgData = x.createImageData(res.w, res.h);
    if (solo) {
      // one plate as film: black where the ink goes
      const p = plates.find((q) => q.key === solo);
      if (p) for (let i = 0; i < p.alpha.length; i++) { const v = 255 - p.alpha[i]; imgData.data[i * 4] = imgData.data[i * 4 + 1] = imgData.data[i * 4 + 2] = v; imgData.data[i * 4 + 3] = 255; }
    } else {
      imgData.data.set(composite({ plates, w: res.w, h: res.h }, shirtOf(st), new Set(plates.filter((p) => !hidden.has(p.key)).map((p) => p.key)), st.pressGain ?? PRESS_GAIN, bg === "checker" || !st.garment));
    }
    x.putImageData(imgData, 0, 0);
  }, [res, plates, hidden, solo, st.garment, bg]); // eslint-disable-line react-hooks/exhaustive-deps

  // film close-up: about 0.6" of the real film around the clicked spot, at the film settings (dots, dpi, mesh)
  const LOUPE_IN = 0.6;
  useEffect(() => {
    const c = loupeCv.current, p = plates.find((q) => q.key === solo); if (!c || !p || !res || !loupe) return;
    const ppi = res.w / st.widthIn, n = Math.max(8, Math.round(LOUPE_IN * ppi)), x0 = Math.max(0, Math.min(res.w - n, loupe.x - (n >> 1))), y0 = Math.max(0, Math.min(res.h - n, loupe.y - (n >> 1)));
    const cw = Math.min(n, res.w), ch = Math.min(n, res.h), a = new Uint8Array(cw * ch), within = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const j = (y0 + y) * res.w + x0 + x; a[y * cw + x] = p.alpha[j];
      let m = 0; for (const q of plates) if (q.alpha[j] > m) m = q.alpha[j]; within[y * cw + x] = m;
    }
    const ht = st.method === "sim" || !!p.tonal;
    const f = filmBits({ ...p, alpha: a }, cw, ch, cw / ppi, st.dpi, { halftone: ht, lpi: lpiOf(st, p.key), angle: st.angle, dot: st.dot || "ellipse", mesh: p.mesh, within });
    c.width = f.W; c.height = f.H;
    const x = c.getContext("2d")!, d = x.createImageData(f.W, f.H), rb = Math.ceil(f.W / 8);
    for (let yy = 0; yy < f.H; yy++) for (let xx = 0; xx < f.W; xx++) { const on = f.bits[yy * rb + (xx >> 3)] & (0x80 >> (xx & 7)), o = (yy * f.W + xx) * 4; d.data[o] = d.data[o + 1] = d.data[o + 2] = on ? 0 : 255; d.data[o + 3] = 255; }
    x.putImageData(d, 0, 0);
  }, [loupe, solo, plates, res, st.widthIn, st.dpi, st.lpi, st.lpiFor, st.angle, st.dot, st.method]);

  useEffect(() => {
    const c = cvOrig.current, px = pxRef.current; if (!c || !px) return;
    c.width = px.w; c.height = px.h;
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.w, px.h), 0, 0);
  }, [pxTick, view]);

  // eyedropper: click the preview to add that color from the art as an ink
  const onPick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (solo && !pick && res) {
      // film close-up of this spot
      const r = e.currentTarget.getBoundingClientRect();
      setLoupe({ x: Math.floor(((e.clientX - r.left) / r.width) * res.w), y: Math.floor(((e.clientY - r.top) / r.height) * res.h) });
      return;
    }
    if (!pick) return;
    const px = pxRef.current, c = cv.current; if (!px || !c) return;
    const r = c.getBoundingClientRect(), x = Math.floor(((e.clientX - r.left) / r.width) * px.w), y = Math.floor(((e.clientY - r.top) / r.height) * px.h);
    const o = (y * px.w + x) * 4; if (px.data[o + 3] < 128) { setMsg("That spot is the shirt (no art there)."); return; }
    const hex = "#" + [px.data[o], px.data[o + 1], px.data[o + 2]].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
    setInks((l) => [...l, { hex, name: inkName(hex, st.lib) }]); setPick(false);
  };

  /* ---------- full size (for the files) ---------- */
  // the screen works on a copy of at most 2,400 px; the Illustrator file and films are separated again from the art
  // at full size: the art's own pixels (up to OUT_PPI at the print width), vector art drawn at OUT_PPI
  const [siblings, setSiblings] = useState<Pick<SepRow, "id" | "location" | "status" | "imprint_id" | "group_id">[]>([]);
  const designRef = useRef<(Design & { print_plan?: PrintPlan | null }) | null>(null);
  const hiRef = useRef<{ key: string; plates: Plate[]; w: number; h: number; ppi: number } | null>(null);
  const outSize = useCallback(() => {
    if (!img) return { side: MAX_SIDE, ppi: 0 };
    const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1, long = Math.max(nw, nh);
    let side = (st.widthIn * OUT_PPI * long) / nw;
    if (!vart) side = Math.min(side, long);
    side = Math.min(side, OUT_MAX_SIDE, Math.sqrt(OUT_MAX_PX * (long / Math.min(nw, nh))));
    return { side: Math.round(side), ppi: Math.round((side * (nw / long)) / st.widthIn) };
  }, [img, vart, st.widthIn]);
  async function fullSep() {
    const key = JSON.stringify([inks, st, names, mesh, orderKeys, !!vart?.ok]);
    if (hiRef.current?.key === key) return hiRef.current;
    if (!img || !pxRef.current) throw new Error("The art isn't loaded yet.");
    setBusy("Separating at full size…"); await new Promise((r) => setTimeout(r, 40));
    const { side, ppi } = outSize();
    const px = pixelsOf(img, st.removeBg, !!vart, side);
    const ks = inks.map((x) => ({ hex: x.hex, name: x.name, fadeTo: x.fadeTo, also: x.also, shirt: x.shirt })), so = sepOpts(st, px.w);
    const r = separate(px, ks, so, vart?.ok && st.method === "spot" ? vectorCover(vart, px, ks, so, st.blackOver ?? true) : undefined);
    r.plates.forEach((p) => { const q = inks.find((x) => "c" + x.hex.slice(1) === p.key); if (q) p.hex = shown(q); });
    // a picture under 400 ppi: the plates (not the art) are drawn again at 400 ppi, following the art's own soft
    // edges, so the Illustrator file doesn't step in the art's pixels
    let w = px.w, h = px.h, outPpi = ppi;
    if (!vart && ppi && ppi < OUT_PPI) {
      const k = Math.min(OUT_PPI / ppi, OUT_MAX_SIDE / Math.max(px.w, px.h), Math.sqrt(OUT_MAX_PX / (px.w * px.h)));
      if (k > 1.15) {
        setBusy("Smoothing the plates to 400 ppi…"); await new Promise((res) => setTimeout(res, 20));
        const W = Math.round(px.w * k), H = Math.round(px.h * k);
        r.plates.forEach((p) => { p.alpha = resamplePlate(p, px.w, px.h, W, H); delete p.bump; });
        w = W; h = H; outPpi = Math.round(W / st.widthIn);
      }
    }
    hiRef.current = { key, plates: arrange(r.plates), w, h, ppi: outPpi };
    return hiRef.current;
  }

  /* ---------- outputs ---------- */
  const title = `${order ? `#${order.number}` : `S-${row?.number ?? ""}`} ${row?.location || ""}`.trim();
  const tonal = st.method === "sim";
  // spot color on vector art: each original shape goes on the plates of the inks that print its color (solid, or as
  // tints when its color is mixed from other inks)
  const vectorOut = (ps: Plate[]) => (vart?.ok && !tonal ? {
    art: vart,
    mixOf: (fill: string) => {
      const ws = spotMixer(inks.map((k) => ({ hex: k.hex, name: k.name, fadeTo: k.fadeTo, also: k.also, shirt: k.shirt })), sepOpts(st, 1000))(...(fill.match(/[0-9a-f]{2}/gi) || ["00", "00", "00"]).map((h) => parseInt(h, 16)) as [number, number, number]);
      const out: { plate: number; tint: number }[] = [];
      inks.forEach((k, j) => {
        if (ws[j] <= 0.02) return;
        const white = /^#F[A-F0-9]F[A-F0-9]F[A-F0-9]$/i.test(k.hex) || k.name === "White";
        // (simulated process: the art's white is the highlight white; spot: its own White plate)
        let at = white && res?.underbase && st.highlight ? ps.findIndex((p) => p.key === "hw") : -1;
        if (at < 0) at = ps.findIndex((p) => p.key === "c" + k.hex.slice(1));
        if (at >= 0) out.push({ plate: at, tint: ws[j] });
      });
      if (ws[inks.length] > 0.02) { const at = ps.findIndex((p) => p.key === "hw"); if (at >= 0) out.push({ plate: at, tint: ws[inks.length] }); }
      // the shares are what should show; each ink covers its share of what's under it (printed later = on top), and
      // a tint is a halftone, so dot gain comes off it (the same as the picture plates)
      const G = st.pressGain ?? PRESS_GAIN; let open = 1;
      for (const e of [...out].sort((a, b) => b.plate - a.plate)) {
        const t = open > 0.004 ? Math.min(1, e.tint / open) : 1; open *= 1 - t;
        e.tint = t >= 0.98 ? 1 : filmDot(t, G);
      }
      return out;
    },
  } : undefined);
  async function aiFile() {
    const hr = await fullSep();
    setBusy("Making the Illustrator file…"); await new Promise((r) => setTimeout(r, 30));
    return illustratorPdf(hr.plates, hr.w, hr.h, { marks: { crop: st.cropMarks !== false, targets: st.regMarks !== false }, widthIn: st.widthIn, tonal, title, vector: vectorOut(hr.plates), solid: st.solidOut || "pixels", minDot: hr.plates.map((p) => minDot(p.mesh, lpiOf(st, p.key))) }, deflate);
  }
  /** for FilmMaker (or any RIP): one page per screen, each its own named spot color; the RIP makes the dots */
  async function ripFile() {
    const hr = await fullSep();
    setBusy("Making the RIP file…"); await new Promise((r) => setTimeout(r, 30));
    return ripPdf(hr.plates, hr.w, hr.h, { marks: { crop: st.cropMarks !== false, targets: st.regMarks !== false }, widthIn: st.widthIn, title, tonal, minDot: hr.plates.map((p) => minDot(p.mesh, lpiOf(st, p.key))),
      screens: hr.plates.map((p) => (tonal || p.tonal ? { lpi: lpiOf(st, p.key), angle: st.angle, dot: st.dot || "ellipse" } : null)),
      sub: (p) => `${p.kind === "underbase" ? "underbase, flash after" : p.kind === "highlight" ? "highlight white" : "color"} - mesh ${p.mesh} - ${tonal || p.tonal ? `halftone: ${lpiOf(st, p.key)} lpi ${st.angle} deg` : "solid"} - print ${st.widthIn}" wide at 100%` }, deflate);
  }
  /** the films, black and finished (our dots): a page each, or all on one sheet for a roll printer */
  async function filmsFile(rollIn = 0) {
    const hr = await fullSep();
    setBusy("Making films…"); await new Promise((r) => setTimeout(r, 30));
    // where the art prints at all: halftone dots are cut only at the art's edge
    const within = new Uint8Array(hr.w * hr.h);
    for (const p of hr.plates) for (let j = 0; j < within.length; j++) if (p.alpha[j] > within[j]) within[j] = p.alpha[j];
    const pages = hr.plates.map((p, i) => {
      const ht = tonal || !!p.tonal;
      const f = filmBits(p, hr.w, hr.h, st.widthIn, st.dpi, { halftone: ht, lpi: lpiOf(st, p.key), angle: st.angle, dot: st.dot || "ellipse", mesh: p.mesh, within });
      return { ...f, widthIn: st.widthIn, heightIn: st.widthIn * (hr.h / hr.w), ink: `${p.name}  (${i + 1}/${hr.plates.length})`, label: `${title} - ${i + 1}/${hr.plates.length} ${p.name}`, sub: `${p.kind === "underbase" ? "Underbase (flash after)" : p.kind === "highlight" ? "Highlight white" : "Color"} - mesh ${p.mesh}${ht ? ` - ${st.lpi} lpi ${st.angle} deg ${DOT_NAME[st.dot || "ellipse"]} dot${(st.pressGain ?? PRESS_GAIN) ? ` - ${Math.round((st.pressGain ?? PRESS_GAIN) * 100)}% dot gain allowed for` : ""}` : " - solid"} - print ${st.widthIn}" wide at 100%` };
    });
    return rollIn ? filmRollPdf(pages, rollIn, title, deflate, { crop: st.cropMarks !== false, targets: st.regMarks !== false }) : filmPdf(pages);
  }
  async function save(status: SepRow["status"], done = "Saved."): Promise<SepRow | null> {
    if (!row || !res) return null;
    let saved: SepRow | null = null;
    setBusy("Saving…"); setErr("");
    try {
      const base = `separations/${row.id}`, files: SepFile[] = [];
      const up = async (path: string, body: Blob, kind: SepFile["kind"], name: string) => { const r = await sb.storage.from("proofs").upload(path, body, { upsert: true, contentType: body.type || "application/octet-stream" }); if (r.error) throw new Error(r.error.message); files.push({ path, name, kind, size: body.size }); };
      // the shirt preview
      await up(`${base}/preview.png`, await toBlob(cv.current!), "preview", "Preview.png");
      // plates as black-on-white images
      const channels: Channel[] = [];
      for (let i = 0; i < plates.length; i++) {
        const p = plates[i], c = document.createElement("canvas"); c.width = res.w; c.height = res.h;
        const x = c.getContext("2d")!, d = x.createImageData(res.w, res.h);
        for (let j = 0; j < p.alpha.length; j++) { const v = 255 - p.alpha[j]; d.data[j * 4] = d.data[j * 4 + 1] = d.data[j * 4 + 2] = v; d.data[j * 4 + 3] = 255; }
        x.putImageData(d, 0, 0);
        const path = `${base}/plate-${i + 1}-${slug(p.name)}.png`;
        await up(path, await toBlob(c), "plate", `${i + 1} ${p.name}.png`);
        channels.push({ key: p.key, name: p.name, hex: p.hex, kind: p.kind, order: i + 1, mesh: p.mesh, coverage: Math.round(p.coverage * 1000) / 10, file: path });
      }
      setBusy("Saving the Illustrator file…");
      const fname = `${slug(title)}-seps.pdf`;
      await up(`${base}/${fname}`, new Blob([await aiFile() as BlobPart], { type: "application/pdf" }), "illustrator", `${title} seps (Illustrator).pdf`);
      const keep = (row.files || []).filter((f) => f.kind === "upload");
      const patch = { status, method: st.method, source: "studio", channels, files: [...keep, ...files], preview_path: `${base}/preview.png`, settings: { ...row.settings, ...st, inks, order: plates.map((p) => p.key), mesh, names, ...(onPress && press ? { pressSetup: { press: press.id, heads: onPress.heads, manual: !!setup, at: new Date().toISOString() } } : {}) }, updated_at: new Date().toISOString() };
      const r = await sb.from("separations").update(patch).eq("id", row.id).select("*").single();
      if (r.error) throw new Error(r.error.message);
      setRow(r.data as SepRow); saved = r.data as SepRow;
      // the logo's print plan follows what the separation settled on (inks, method, colors), so the next mockup and
      // price for this logo match the screens
      const d0 = designRef.current;
      if (d0?.id) {
        const plan: PrintPlan = { v: 1, method: st.method === "sim" ? "sim" : "spot", inks, colors: inks.length, at: new Date().toISOString(), dark: isDark(shirtOf(st)),
          why: `${st.method === "sim" ? "Simulated process" : "Screen print"}, ${inks.length} ${st.method === "sim" ? "screens" : `color${inks.length === 1 ? "" : "s"}`}${inks.some((k) => k.fadeTo?.length) ? " (with fades)" : ""}, as separated (S-${row.number}).` };
        sb.from("designs").update({ print_plan: plan, colors: plan.colors, inks: plan.method === "spot" ? [...new Set(inks.map((k) => k.name))].join(", ") : `Simulated process (${plan.colors})` }).eq("id", d0.id).then(() => {});
        d0.print_plan = plan;
      }
      setMsg(done);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy("");
    return saved;
  }
  /** films printed: save it as Printed, and put its screens and inks back on the order's imprint */
  async function markPrinted() {
    const r = await save("films", "Films printed: saved as Printed.");
    if (!r) return;
    // screens and inks back on the order's imprint (the underbase is added by the schedule on dark shirts)
    if (r.order_id && r.imprint_id) {
      const { data: o } = await sb.from("orders").select("groups").eq("id", r.order_id).maybeSingle();
      const groups = ((o?.groups || []) as Group[]).map((g) => ({ ...g, imprints: g.imprints.map((im) => im.id !== r.imprint_id ? im : { ...im, colors: r.channels.filter((c) => c.kind !== "underbase").length || im.colors, inks: r.channels.filter((c) => c.kind !== "underbase").map((c) => c.name).join(", ") || im.inks }) }));
      if (groups.length) await sb.from("orders").update({ groups }).eq("id", r.order_id);
    }
  }
  async function setStatus(status: SepRow["status"]) { if (!row) return; const r = await sb.from("separations").update({ status, updated_at: new Date().toISOString() }).eq("id", row.id).select("*").single(); if (!r.error) setRow(r.data as SepRow); }
  /** uploaded art: swap in a new file (the inks are found again) */
  async function replaceArt(f?: File) {
    if (!row || !f) return;
    const bad = await artProblem(f); if (bad) { setErr(bad); return; }
    setBusy("Uploading…"); setErr("");
    try {
      const art = await uploadSepArt(sb, row.id, f);
      const { inks: _i, order: _o, names: _n, mesh: _m, ...keep } = row.settings as Record<string, unknown>; void _i; void _o; void _n; void _m;
      const r = await sb.from("separations").update({ settings: { ...keep, art }, updated_at: new Date().toISOString() }).eq("id", row.id).select("*").single();
      if (r.error) throw new Error(r.error.message);
      setRow(r.data as SepRow); setInks([]); setOrderKeys([]); setNames({}); setMesh({}); setHidden(new Set()); setSolo(null); setVart(null); setImg(null); setRes(null);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy("");
  }
  // "Shirt color" on an ink: that color is the shirt (knocked out), and the viewer's shirt turns that color; unchecking
  // goes back to the shirt it was
  const shirtBefore = useRef<string | null>(null);
  function shirtInk(i: number, on: boolean) {
    const k = inks[i]; if (!k) return;
    setInks((l) => l.map((x, j) => (j === i ? { ...x, shirt: on } : on && x.shirt === true ? { ...x, shirt: undefined } : x)));
    if (on) { if (shirtBefore.current === null) shirtBefore.current = st.garment; set({ garment: k.hex }); }
    else if (st.garment === k.hex) { set({ garment: shirtBefore.current ?? "" }); shirtBefore.current = null; }
  }
  /** save this separation to a customer (it shows in their Artwork, under Separations) */
  async function setCustomer(cid: string | null) {
    if (!row) return;
    const r = await sb.from("separations").update({ customer_id: cid, updated_at: new Date().toISOString() }).eq("id", row.id).select("*").single();
    if (r.error) { setErr(r.error.message); return; }
    setRow(r.data as SepRow); setMsg(cid ? "Saved to the customer: it's in their Artwork, under Separations." : "Taken off the customer.");
  }
  function setBackdrop(drop: boolean) {
    if (!!st.dropBackdrop !== drop) refind.current = img;
    set({ dropBackdrop: drop });
  }
  async function openFile(path: string) { const { data } = await sb.storage.from("proofs").createSignedUrl(path, 600); if (data?.signedUrl) window.open(data.signedUrl, "_blank"); }

  /* ---------- press setup: the plates on a press, in print order, the underbase just before a flash ---------- */
  const press = presses.find((m) => m.id === pressId) || presses[0];
  // which screens print on top of which (for wet-on-wet: a light color over a dark one still wet wants a flash)
  const ovm = useMemo(() => (res ? overlaps(res.plates.map((p) => p.alpha)) : null), [res]);
  const onPress = useMemo(() => {
    if (!press) return null;
    const lay = pressLayOf(press);
    const sp = plates.map((p) => ({ key: p.key, name: p.name, hex: p.hex, kind: p.kind, mesh: p.mesh }));
    // automatic: the suggested layout (print order, flashes, cool-down, inks by the load / unload stations)
    const all = res ? res.plates.map((p) => { const q = plates.find((x) => x.key === p.key); return { key: p.key, name: q?.name || p.name, hex: p.hex, kind: p.kind, coverage: p.coverage, tonal: !!p.tonal }; }) : [];
    const rec = !setup && all.length ? recommendSetup(lay, all, { dark: baseShirt(shirtOf(st)), noShirt: !st.garment, ov: ovm || undefined, allPlates: all }) : null;
    const { heads, off } = rec?.ok ? { heads: rec.heads, off: [] as typeof sp } : fitSetup(setup, lay, sp);
    const out = heads.map((x) => { const k = plateOf(x); const p = k ? plates.find((q) => q.key === k) : null; return p ? { hex: p.kind === "underbase" || p.kind === "highlight" ? "#FFFFFF" : p.hex, name: `${plates.indexOf(p) + 1} · ${p.name}` } : null; });
    const chk = checkSetup(heads, lay, sp, baseShirt(shirtOf(st)));
    const note = off.length ? `${off.length} screen${off.length === 1 ? "" : "s"} won't fit on ${press.name.split(" · ")[0]} (${off.map((p) => p.name).join(", ")}): free a head, print in two rounds, or pick another press.` : "";
    return { lay, heads, out, off, note, ...chk, why: rec?.why || [], recOrder: rec?.ok ? rec.order : null, recNote: rec && !rec.ok ? rec.why[0] : "" };
  }, [press, plates, setup, st.garment, res, ovm]);
  // automatic: the Screens tab's print order is the suggested one
  useEffect(() => {
    const o = onPress?.recOrder; if (!o || setup) return;
    if (o.join("|") !== plates.map((p) => p.key).join("|")) setOrderKeys(o);
  }, [onPress?.recOrder?.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  // the screens' print order follows the heads they're on (a pallet reaches head 1 first)
  function commitSetup(n: Slot[]) {
    setSetup(n);
    setOrderKeys([...printOrder(n), ...plates.map((p) => p.key).filter((k) => !n.includes("p:" + k))]);
  }
  // …and moving a screen up in Print Order moves it to the earlier head
  useEffect(() => {
    if (!setup) return;
    const placed = printOrder(setup), want = plates.map((p) => p.key).filter((k) => placed.includes(k));
    if (want.join("|") === placed.join("|")) return;
    const at = setup.map((x, i) => (plateOf(x) ? i : -1)).filter((i) => i >= 0), n = [...setup];
    at.forEach((i, j) => { n[i] = "p:" + want[j]; });
    setSetup(n);
  }, [plates]); // eslint-disable-line react-hooks/exhaustive-deps
  function putPlate(key: string, head: number) {
    if (!onPress) return;
    const n = [...onPress.heads], from = n.indexOf("p:" + key), prev = n[head];
    if (prev === "down") return;
    n[head] = "p:" + key;
    // whatever was on that head (a screen, a flash, the roller, a cool-down) trades places with it
    if (from >= 0 && from !== head) n[from] = prev;
    commitSetup(n); setSelPlate(null); setSelHead(null);
  }
  function setHeadTo(head: number, v: Slot) {
    if (!onPress) return;
    if (plateOf(v)) { putPlate(plateOf(v)!, head); return; }
    const n = [...onPress.heads];
    // a flash, the roller or a cool-down head put where a screen is: that screen and the ones after it move down a head
    // (flashes, rollers and cool-down heads after it stay put)
    const moving = plateOf(n[head]) ? n.slice(head).filter((x) => plateOf(x)) : [];
    if (moving.length) for (let i = head; i < n.length; i++) if (plateOf(n[i])) n[i] = "";
    n[head] = v;
    for (let i = head + 1; i < n.length && moving.length; i++) if (n[i] === "") n[i] = moving.shift()!;
    commitSetup(n);
  }
  // tap a head on the drawing: its row in the list below lights up and its dropdown opens for a choice
  function pickHead(i: number) {
    if (!onPress) return;
    if (onPress.heads[i] === "down") { setMsg(`Head ${i + 1} is down (Production → Equipment Status).`); return; }
    setSelHead(i);
    setTimeout(() => { const el = document.getElementById(`ps-head-${i}`) as HTMLSelectElement | null; el?.scrollIntoView({ block: "nearest" }); el?.focus(); }, 0);
  }
  /** drag a screen (from a head or the not-on-the-press list) onto a head: it goes there, and they trade places */
  const [dragPlate, setDragPlate] = useState<string | null>(null), [dropHead, setDropHead] = useState<number | null>(null);
  function dropOnHead(i: number) { if (dragPlate) chooseHead(dragPlate, i); setDragPlate(null); setDropHead(null); }
  /**
   * A color picks its head. A free head: it moves there. A head with another color on it: ask where that color goes
   * (back to this color's head, or any open head). A flash / roller / cool-down head: ask before covering it.
   */
  const [ask, setAsk] = useState<{ key: string; to: number; other?: string; station?: string } | null>(null);
  function chooseHead(key: string, to: number) {
    if (!onPress) return;
    const n = onPress.heads, there = n[to];
    if (there === "down" || n.indexOf("p:" + key) === to) return;
    if (plateOf(there)) { setAsk({ key, to, other: plateOf(there)! }); return; }
    if (there === "flash" || there === "roller" || there === "cool") { setAsk({ key, to, station: there }); return; }
    moveColor(key, to);
  }
  /** two colors trade heads (↑ / ↓ in the press list: print one earlier or later) */
  function swapWith(a: string, b?: string) {
    if (!onPress || !b) return;
    const n = [...onPress.heads], ha = n.indexOf("p:" + a), hb = n.indexOf("p:" + b);
    if (ha < 0 || hb < 0) return;
    n[ha] = "p:" + b; n[hb] = "p:" + a; commitSetup(n); setAsk(null);
  }
  /** move it, and the color that was there to `otherTo` (a head), or back where the moving one came from */
  function moveColor(key: string, to: number, otherTo?: number) {
    if (!onPress) return;
    const n = [...onPress.heads], from = n.indexOf("p:" + key), there = n[to], other = plateOf(there);
    n[to] = "p:" + key;
    if (from >= 0) n[from] = "";
    if (other) { const dest = otherTo ?? from; if (dest >= 0 && (n[dest] === "" || dest === from)) n[dest] = "p:" + other; }
    commitSetup(n); setAsk(null); setSelHead(null);
  }
  /** a sheet for the press operator: the press drawn with every head, and the list */
  function printSetup() {
    if (!onPress || !press || !row) return;
    const svg = document.querySelector(".sep-pressup .sep-press svg")?.outerHTML || "";
    const css = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((x) => x.outerHTML).join("");
    const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
    const rows = onPress.heads.map((x, i) => { const k = plateOf(x), p = k ? plates.find((q) => q.key === k) : null;
      const what = p ? `<b>${esc(p.name)}</b>${p.kind === "underbase" ? " (underbase)" : p.kind === "highlight" ? " (highlight white)" : ""} · mesh ${p.mesh}` : x === "flash" ? "<b>FLASH</b>" : x === "roller" ? "<b>ROLLER</b> (dead screen)" : x === "cool" ? "<i>empty: cool down</i>" : x === "down" ? "<i>head down</i>" : "<span style=\"color:#999\">empty</span>";
      return `<tr><td style="padding:5px 10px;font-weight:800">Head ${i + 1}</td><td style="padding:5px 10px">${p ? `<span style="display:inline-block;width:14px;height:14px;border:1px solid #999;vertical-align:-2px;margin-right:6px;background:${p.hex}"></span>` : ""}${what}</td></tr>`; }).join("");
    const w = window.open("", "_blank"); if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Press setup S-${row.number}</title>${css}<style>body{background:#fff;color:#111;font:14px system-ui;padding:24px}table{border-collapse:collapse}tr:nth-child(odd){background:#f4f5f7}.pl{width:360px;height:auto}</style></head><body>
      <h2 style="margin:0">Press setup · ${esc(row.location || "")}${order ? ` · #${order.number} ${esc(order.nickname || "")}` : ""}</h2>
      <div style="color:#555;margin:4px 0 14px">${esc(press.name)} · S-${row.number} · ${plates.length} screens · shirt ${esc(row.garment_color || st.garment || "not picked")}</div>
      <div style="display:flex;gap:28px;align-items:flex-start;flex-wrap:wrap">${svg}<table>${rows}</table></div>
      ${onPress.moves.length ? `<h3>Before you start</h3><ul>${onPress.moves.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
      <script>setTimeout(()=>print(),400)</script></body></html>`);
    w.document.close();
  }

  if (err && !row) return <div className="empty">{err}</div>;
  if (!row) return <div className="empty">Loading…</div>;
  const s0 = SEP_STATUS[row.status];
  const dark = baseShirt(shirtOf(st)), noShirt = !st.garment;
  const garments = [...new Set(order ? orderGroups(order).find((g) => g.id === row.group_id)?.lines.map((l) => l.color).filter(Boolean) || [] : [])];
  // the shirt's name: from the order, the garment list, the shirt colors, or the ink picked as the shirt color
  const shirtLabel = noShirt ? "" : [row.garment_color, ...garments, ...SHIRT_COLORS.flatMap((g) => g.colors.map(([c]) => c))].find((c) => c && (shirtHex(c) || colorHex(c) || guessHex(c)) === st.garment) || inks.find((k) => k.hex === st.garment)?.name || st.garment;

  return (
    <div className="sep">
      <div className="page-head">
        <div>
          <div className="eyebrow sep-eyebrow"><Link href="/shop/separations">Separations</Link> · S-{row.number}
            {/* whose art this is: an order's separation belongs to the order's customer; any other can be saved to one */}
            {(!row.order_id || row.customer_id) && <span className="sep-cust">· <CustomerPick compact disabled={!!row.order_id} value={row.customer_id} placeholder="Save to a customer…" onPick={(cid) => setCustomer(cid)} /></span>}
            {row.customer_id && <Link className="sep-cust-l" href={`/shop/customers/${row.customer_id}?area=artwork`} title="This customer's production files (staff only)">Production files ↗</Link>}</div>
          <h1>{row.location || "Separation"}{order ? <span className="faint"> · #{order.number} {order.nickname || ""}</span> : null}</h1>
        </div>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <span className="pill" style={{ ["--sc" as string]: s0.c }}>{s0.label}</span>
          {tab === "studio" && <>
            {row.status !== "cancelled" && <button type="button" className="btn primary" disabled={!res || !!busy} onClick={() => save(row.status === "films" ? "films" : "in_progress")}>Save</button>}
            {row.status === "films" && <button type="button" className="btn" disabled={!!busy} title="Films need redoing: back to Working" onClick={() => setStatus("in_progress")}>Back to Working</button>}
          </>}
          {order && <Link className="btn" href={`/shop/orders/${order.id}`}>Open Order</Link>}
          {!!(row.settings as { art?: SepArt }).art && row.status !== "films" && row.status !== "cancelled" && <label className="btn" title="Upload a different file (the inks are found again)"><input type="file" accept={ART_ACCEPT} hidden onChange={(e) => { replaceArt(e.target.files?.[0]); e.target.value = ""; }} />Replace Art</label>}
          {row.status === "cancelled"
            ? <button type="button" className="btn primary" onClick={() => setStatus("in_progress")} title="Back to Working">Restore</button>
            : cancelAsk
              ? <span className="sep-ask">Archive this separation? It stays in Archived for {ARCHIVE_DAYS} days. <button type="button" className="btn sm" onClick={() => { setCancelAsk(false); setStatus("cancelled").then(() => location.assign("/shop/separations")); }}>Yes, Archive</button> <button type="button" className="btn sm" onClick={() => setCancelAsk(false)}>No</button></span>
              : <button type="button" className="btn" onClick={() => setCancelAsk(true)} title="Not using it: move it to Archived">Archive</button>}
        </div>
      </div>
      {msg && <div className="ms-toast" role="status"><span>{msg}</span><button type="button" aria-label="Dismiss" onClick={() => setMsg("")}>×</button></div>}
      {err && <div className="pv-err">{err}</div>}
      <div className="sep-topbar">
      {siblings.length > 1 && (
        <nav className="sep-locs" aria-label="Print locations on this order">
          {siblings.map((x) => {
            const st0 = SEP_STATUS[x.status];
            return x.id === row.id
              ? <span key={x.id} className="sep-loc on" aria-current="page"><b>{x.location}</b><small>{st0?.label}</small></span>
              : <Link key={x.id} className="sep-loc" href={`/shop/separations/${x.id}`}><b>{x.location}</b><small>{st0?.label}</small></Link>;
          })}
        </nav>
      )}
      <div className="rv-seg sep-tabs">{([["studio", "Separations"], ["outside", "✦ Coach & Learning"]] as const).map(([k, l]) => <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      </div>

      {backdrop && st.dropBackdrop === undefined && vraw?.ok && (
        <div className="mk-modal-back" role="dialog" aria-modal="true" aria-labelledby="bg-t">
          <div className="mk-modal">
            <h2 id="bg-t">Remove the {backdrop.name} background?</h2>
            <div className="sep-bgask">
              <span className="sep-bgask-sw" style={{ background: backdrop.hex }} />
              <p>I noticed this vector art has a <b>{backdrop.name}</b> background ({backdrop.hex}): {backdrop.what}, the size of the whole page. As it is, it would print as a {backdrop.name} box on the shirt.</p>
            </div>
            <p className="muted">Removing it takes out just that background layer. The art itself stays vector, exactly as it was, and any {backdrop.name} inside the design (highlights, details) still prints. You can change this later under the art.</p>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn ghost" onClick={() => setBackdrop(false)}>Keep it (it prints)</button>
              <button type="button" className="btn primary" autoFocus onClick={() => setBackdrop(true)}>Remove background</button>
            </div>
          </div>
        </div>
      )}
      {tab === "outside" ? <div className="sep-learn">
        {coachOn && <div className="sep-learn-coach">{res ? <SepCoach sepId={row.id} designId={row.design_id} context={coachContext} images={coachImages} onApply={applyCoach} /> : <div className="sep-card faint">Loading the separation…</div>}</div>}
        <div className="sep-learn-out"><Outside row={row} origUrl={origUrl} onSaved={(r) => { setRow(r); setMsg("Uploaded and sent for review."); }} openFile={openFile}
        ours={() => ({ ours: { method: st.method, natural, inks: inks.map((k) => ({ name: k.name, hex: k.hex, ...(k.fadeTo?.length ? { fadeTo: k.fadeTo.map((h) => inks.find((q) => q.hex === h)?.name || h) } : {}), ...(k.also?.length ? { also: k.also } : {}) })), settings: coachContext().settings }, art: { vector: !!vart?.ok, shirt: row.garment_color || st.garment, dark: isDark(shirtOf(st)), width_in: st.widthIn, location: row.location } })}
        artImage={() => { try { if (!img) return null; const k = Math.min(1, 1100 / Math.max(img.naturalWidth, img.naturalHeight)), t = document.createElement("canvas"); t.width = Math.round(img.naturalWidth * k); t.height = Math.round(img.naturalHeight * k); const g = t.getContext("2d")!; g.fillStyle = "#fff"; g.fillRect(0, 0, t.width, t.height); g.drawImage(img, 0, 0, t.width, t.height); return t.toDataURL("image/jpeg", 0.85).split(",")[1]; } catch { return null; } }} /></div>
      </div> : hasArt === false ? <AddArt row={row} onDone={(r) => { setRow(r); load(); }} /> : (
      <div className="sep-grid">
        {/* settings */}
        <aside className="sep-side">
          <div className="rv-seg sep-ptabs" role="tablist">{([["inks", "Inks"], ["output", "Underbase & Size"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={ltab === k} className={ltab === k ? "on" : ""} onClick={() => setLtab(k)}>{l}</button>)}</div>
          <div className="sep-pane">
          {ltab === "inks" && <>
          <section className="sep-card">
            <h3>Method</h3>
            <div className="rv-seg sep-full">{([["spot", "Spot color"], ["sim", "Simulated process"]] as const).map(([k, l]) => <button key={k} type="button" className={st.method === k ? "on" : ""} onClick={() => { set({ method: k }); findInks(k, true); }}>{l}</button>)}</div>
            <p className="sep-help">{st.method === "spot" ? "Flat colors, solid screens. Logos, text, cartoon art." : "Photos and painted art: a few bright inks in halftones, mixed on the shirt."}</p>
            {vart && <div className={vart.ok ? "sep-ok" : "sep-tip"}>{vart.ok ? `Vector art (${vart.shapes.length} shapes): the Illustrator file keeps the original shapes for each ink.` : `Vector art, but it ${vart.why}: the plates are traced from a picture of it instead.`}</div>}
            {backdrop && vraw?.ok && <label className="sep-chk" title={`The art sits on ${backdrop.what} in ${backdrop.name} (${backdrop.hex}), the size of the page. Checked: that background layer is taken out and doesn't print; the rest of the art is untouched.`}><input type="checkbox" checked={!!st.dropBackdrop} onChange={(e) => setBackdrop(e.target.checked)} /> <span className="sep-bgask-sw sm" style={{ background: backdrop.hex }} /> Remove the {backdrop.name} background layer</label>}
            {st.method === "spot" && hint > 0.18 && inks.length >= natural && !inks.some((k) => k.fadeTo?.length) && <div className="sep-tip">This art has a lot of shading ({Math.round(hint * 100)}% between colors). <button type="button" className="linkbtn" onClick={() => { set({ method: "sim" }); findInks("sim", true); }}>Try simulated process</button></div>}
          </section>
          <section className="sep-card">
            <h3>Shirt</h3>
            <div className="sep-row">
              {/* no shirt picked: an empty swatch (every color prints); tap it for any color */}
              <label className={"sep-shirt-sw" + (noShirt ? " none" : "")} style={noShirt ? undefined : { background: st.garment }} title={noShirt ? "No shirt picked: every color prints. Tap for any color." : `Shirt ${st.garment}. Tap for any color.`}>
                <input type="color" value={st.garment || "#ffffff"} onChange={(e) => set({ garment: e.target.value.toUpperCase() })} aria-label="Shirt color" />
              </label>
              <select value={noShirt ? "" : "_"} onChange={(e) => { const v = e.target.value; if (v === "_") return; set({ garment: v ? shirtHex(v) || colorHex(v) || guessHex(v) : "" }); }} aria-label="Shirt color">
                <option value="">All colors printed</option>
                {!noShirt && <option value="_">{shirtLabel}</option>}
                {garments.length > 0 && <optgroup label="From the order">{garments.map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>}
                {SHIRT_COLORS.map((g) => <optgroup key={g.group} label={g.group}>{g.colors.map(([c]) => <option key={c} value={c}>{c}</option>)}</optgroup>)}
              </select>
            </div>
            {noShirt ? <p className="sep-help">No shirt picked yet: worked out as a dark shirt with an underbase (head 1), and every color prints. Pick the shirt to leave the colors that match it to the shirt.</p>
              : <label className="sep-chk"><input type="checkbox" checked={st.dropGarment} onChange={(e) => set({ dropGarment: e.target.checked })} /> Let the shirt be colors that match it</label>}
          </section>
          <section className="sep-card">
            <h3>Finding inks</h3>
            <label className="sep-f">Ink names<select value={st.lib} onChange={(e) => { const lib = e.target.value as Studio["lib"]; set({ lib }); setInks((l) => l.map((x) => ({ ...x, name: inkName(x.hex, lib) }))); }} title="Names every ink again"><option value="auto">Suggested</option><option value="wilflex">All standard</option><option value="pms">All PMS</option></select></label>
            <p className="sep-help">{st.lib === "auto" ? "Suggested: a standard (stock) ink when one is very close, a PMS when only the PMS is. Tap an ink's match line to see both." : st.lib === "wilflex" ? "Every ink named as the closest Wilflex RFU stock ink." : "Every ink named as the closest PMS coated color."}</p>
            <button type="button" className="btn sm" onClick={() => findInks(st.method, true)} title="Start over: find the inks the art needs">Find Inks Again</button>
          </section>
          </>}
          {ltab === "output" && <section className="sep-card">
            <h3>Underbase{dark ? "" : " (white shirt)"}</h3>
            <div className="rv-seg sep-full">{([["auto", "Auto"], ["on", "On"], ["off", "Off"]] as const).map(([k, l]) => <button key={k} type="button" className={st.underbase === k ? "on" : ""} onClick={() => set({ underbase: k })}>{l}</button>)}</div>
            <label className="sep-f" title="How far the underbase is pulled in from the edges of the colors, so it never peeks out">Choke <input type="range" min={0} max={3} step={0.25} value={st.chokePt ?? CHOKE_PT} onChange={(e) => set({ chokePt: +e.target.value })} /> <b>{st.chokePt ?? CHOKE_PT} pt</b></label>
            {(() => { const on = (st.finePt ?? FINE_PT) > 0; return (<div className="sep-fine">
              <label className="sep-chk" title="Small type and thin lines (sponsor backs): the full choke would thin their base to nothing. There the base is choked only a little and the color on top gets a small stroke instead, so it still covers the white."><input type="checkbox" checked={on} onChange={(e) => set({ finePt: e.target.checked ? FINE_PT : 0 })} /> Small type &amp; thin lines</label>
              {on && <>
                <label className="sep-f" title="Parts of the art thinner than this count as fine detail">Thinner than <input type="range" min={0.5} max={4} step={0.25} value={st.finePt ?? FINE_PT} onChange={(e) => set({ finePt: +e.target.value })} /> <b>{st.finePt ?? FINE_PT} pt</b></label>
                <label className="sep-f" title="How far the base is pulled in on fine detail (instead of the full choke)">Base choke there <input type="range" min={0} max={Math.max(0.25, st.chokePt ?? CHOKE_PT)} step={0.05} value={Math.min(st.fineChokePt ?? FINE_CHOKE_PT, st.chokePt ?? CHOKE_PT)} onChange={(e) => set({ fineChokePt: +e.target.value })} /> <b>{Math.min(st.fineChokePt ?? FINE_CHOKE_PT, st.chokePt ?? CHOKE_PT)} pt</b></label>
                <label className="sep-f" title="A stroke on the top color on fine detail, so it covers the white's edge">Color stroke <input type="range" min={0} max={1} step={0.05} value={st.bumpPt ?? BUMP_PT} onChange={(e) => set({ bumpPt: +e.target.value })} /> <b>{st.bumpPt ?? BUMP_PT} pt</b></label>
              </>}
            </div>); })()}
            {st.method === "sim" && <label className="sep-chk"><input type="checkbox" checked={st.highlight} onChange={(e) => set({ highlight: e.target.checked })} /> Highlight white on top</label>}
            <label className="sep-chk"><input type="checkbox" checked={st.removeBg} onChange={(e) => set({ removeBg: e.target.checked })} /> White background isn&apos;t printed</label>
          </section>}
          {ltab === "output" && <section className="sep-card">
            <h3>Size &amp; Film</h3>
            <label className="sep-f">Print width (in)<input type="number" min={1} max={20} step={0.25} value={st.widthIn} onChange={(e) => set({ widthIn: +e.target.value || 1 })} /></label>
            {img && (() => {
              // pictures can't be blown up (Separo can't either): say how sharp the art is at this print size
              if (vart?.ok) return <div className="sep-res ok">Vector art: sharp at any size.</div>;
              const ppi = Math.round((img.naturalWidth || 0) / st.widthIn), best = Math.floor((img.naturalWidth || 0) / 300 * 4) / 4;
              const lvl = ppi >= 250 ? "ok" : ppi >= 150 ? "warn" : "bad";
              return <div className={"sep-res " + lvl}>Art is {img.naturalWidth} px wide: <b>{ppi} ppi</b> at {st.widthIn}&quot;. {lvl === "ok" ? "Sharp." : lvl === "warn" ? `Usable; edges soften a little past ${best}" (300 ppi).` : `Too small for ${st.widthIn}": it will print pixelated. Up to ${best}" is sharp; get bigger art or vector (SVG / EPS)${st.method === "spot" ? ", or try Smooth vector for solid inks" : ""}.`}</div>;
            })()}
            {(tonal || plates.some((p) => p.tonal)) && <><label className="sep-f" title="Halftone frequency (lines per inch) for every halftone screen; lower = bigger dots that hold better on coarser mesh. One screen can differ: pick its LPI in Screens.">Halftone LPI<select value={st.lpi} onChange={(e) => set({ lpi: +e.target.value })}>{[...new Set([...LPIS, st.lpi])].sort((x, y) => x - y).map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
              <p className="sep-help">Films from here have the dots made at this frequency. The FilmMaker / RIP file carries each screen&apos;s frequency, angle and dot too: FilmMaker uses them when its queue has Print Mode Overrides → Halftones → &quot;Override print mode halftoning&quot; and &quot;Enable application halftoning&quot; checked; otherwise it uses its own ink settings.</p><label className="sep-f">Angle<input type="number" min={0} max={90} step={0.5} value={st.angle} onChange={(e) => set({ angle: +e.target.value })} /></label>
              <label className="sep-f" title="Elliptical: neighbors join near 40% one way and 60% the other, so midtones don't jump (the usual pick for screen printing). Round: joins at 78%. Square: all four corners join at 50%.">Dot<select value={st.dot || "ellipse"} onChange={(e) => set({ dot: e.target.value as Studio["dot"] })}><option value="ellipse">Elliptical</option><option value="round">Round</option><option value="square">Square</option></select></label>
              {(() => {
                // a halftone needs about 4 threads per dot (mesh ≥ 4 × LPI), and dots smaller than a thread and an opening wash out
                const ht = plates.filter((p) => tonal || p.tonal), low = ht.filter((p) => p.mesh < lpiOf(st, p.key) * 4);
                const mds = ht.map((p) => Math.round(minDot(p.mesh, lpiOf(st, p.key)) * 100)), lo = Math.min(...mds), hi = Math.max(...mds);
                return <div className={"sep-res " + (low.length ? "warn" : "ok")}>{low.length ? <>Mesh too open for {st.lpi} lpi on {low.map((p) => p.name).join(", ")}: use {Math.ceil((st.lpi * 4) / 10) * 10}+ mesh or a lower LPI.</> : <>Mesh fits {st.lpi} lpi.</>} Smallest dot the mesh holds: {lo === hi ? `${lo}%` : `${lo}–${hi}%`} (lighter tones drop out; the films print whole dots, none too small to hold).</div>;
              })()}</>}
            {st.method === "spot" && <label className="sep-f" title="Each color spreads this far under the darker color printed after it, so colors that touch overlap a hair (no gaps if a screen is a little off). Keep it small on based colors; 0 = colors just touch. Black never spreads onto the white base.">Trap <input type="range" min={0} max={2} step={0.25} value={st.trapPt ?? TRAP_PT} onChange={(e) => set({ trapPt: +e.target.value })} /> <b>{st.trapPt ?? TRAP_PT} pt</b></label>}
            {st.method === "spot" && vart?.ok && <label className="sep-chk" title="Vector art: black prints on top of the colors (overprint), so the colors under it aren't cut out. Thin black lines leave no cracks in a color's screen, a dot or a stripe under a black outline stays whole, and no slivers of color are left between black lines. The underbase still stops where black is. Off: black knocks out the colors under it (trap only).">
              <input type="checkbox" checked={st.blackOver ?? true} onChange={(e) => set({ blackOver: e.target.checked })} /> Black prints on top (no knockout under black)</label>}
            {st.method === "spot" && !vart?.ok && <label className="sep-f" title="Pixels: the art's own pixels at full size, like Separo. Smooth vector: traced curves, for low-resolution art.">Solid inks<select value={st.solidOut || "pixels"} onChange={(e) => set({ solidOut: e.target.value as Studio["solidOut"] })}><option value="pixels">Pixels (exact)</option><option value="vector">Smooth vector</option></select></label>}
            {(tonal || plates.some((p) => p.tonal)) && <label className="sep-f" title="Halftone dots print bigger than on the film (at 15% a 50% dot prints about 65%). The halftone plates are made that much lighter so they print as the art, and the proof shows how it prints. Pick None if your RIP adds its own dot gain curve (FilmMaker: a Press Calibration curve that isn't straight). Use one or the other, not both.">Dot gain on press<select value={st.pressGain ?? PRESS_GAIN} onChange={(e) => set({ pressGain: +e.target.value })}>{[0, 0.1, 0.15, 0.2, 0.25, 0.3].map((g) => <option key={g} value={g}>{g ? `${Math.round(g * 100)}%` : "None (RIP does it)"}</option>)}</select></label>}
            <label className="sep-f">Film DPI<select value={st.dpi} onChange={(e) => set({ dpi: +e.target.value })}>{[360, 600, 720, 1200, 1440].map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
            <div className="sep-marks"><span>Film marks</span>
              <label className="sep-chk"><input type="checkbox" checked={st.cropMarks !== false} onChange={(e) => set({ cropMarks: e.target.checked })} /> Crop marks</label>
              <label className="sep-chk"><input type="checkbox" checked={st.regMarks !== false} onChange={(e) => set({ regMarks: e.target.checked })} /> Registration targets</label>
            </div>
          </section>}
          </div>
        </aside>

        {/* preview */}
        <section className="sep-main">
          {/* the inks, big, like Separo: art color → ink, click the name to change it */}
          <div className="sep-inkbar">
            {/* the underbase is a screen like the colors: always shown, first (head 1) */}
            {(() => {
              const ub = plates.find((p) => p.kind === "underbase");
              return (
                <div className={"sep-chip sep-chip-ub" + (ub ? "" : " off")} title={ub ? "The underbase: a white screen that prints first (head 1) and gets flashed, under the colors." : "No underbase on this job (light shirt). Check Print it to add one."}>
                  <span className="sep-chip-sw" style={{ background: "#FFFFFF" }}><i style={{ background: "#FFFFFF" }} /></span>
                  <input value={ub ? ub.name : "Underbase White"} onChange={(e) => { if (ub) setNames((m) => ({ ...m, [ub.key]: e.target.value })); }} readOnly={!ub} aria-label="Underbase" data-notranslate />
                  <span className="sep-chip-m q-exact">{ub ? "Underbase · head 1" : "Underbase · off"}</span>
                  <label className={"sep-chip-shirt" + (ub ? " on" : "")} title="Print a white underbase under the colors"><input type="checkbox" checked={!!ub} onChange={(e) => set({ underbase: e.target.checked ? "on" : "off" })} /> Print it</label>
                </div>
              );
            })()}
            {inks.map((k, i) => (
              <div key={k.hex + i} className={"sep-chip" + (res?.dropped.includes(k.hex) ? " shirt" : "") + (dragInk === i ? " dragging" : "") + (dropOn === i && dragInk !== null && dragInk !== i ? " drop" : "")}
                title={res?.dropped.includes(k.hex) ? "Matches the shirt: not printed (the shirt shows through)" : "Drag onto another ink to combine them into one screen"}
                draggable onDragStart={(e) => { setDragInk(i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); }}
                onDragEnd={() => { setDragInk(null); setDropOn(null); }}
                onDragOver={(e) => { if (dragInk !== null && dragInk !== i) { e.preventDefault(); setDropOn(i); } }}
                onDragLeave={() => setDropOn((d) => (d === i ? null : d))}
                onDrop={(e) => { e.preventDefault(); if (dragInk !== null && dragInk !== i) combineInks(dragInk, i); setDragInk(null); setDropOn(null); }}>
                <span className="sep-chip-sw" style={{ background: shown(k) }} title={`In the art: ${[k.hex, ...(k.also || [])].join(", ")}`}><i style={{ background: k.hex }} />{(k.also || []).map((h, q) => <i key={h} className="also" style={{ background: h, right: 6 + 14 * (q + 1) }} />)}</span>
                {(k.also?.length || 0) > 0 && <button type="button" className="sep-chip-split" onClick={() => splitInk(i)} title="Separate the combined colors into their own inks again">Split {(k.also?.length || 0) + 1}</button>}
                <input list="sep-inklist" value={k.name} onChange={(e) => setInks((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Ink" data-notranslate />
                {(() => { const m = vart?.shapes.some((sh) => sh.ink === k.name) ? { kind: "Swatch", word: "from the art", dE: 0 } : inkKind(k.name, k.hex); return (
                  <button type="button" className={"sep-chip-m" + (matchAt === i ? " on" : "") + (m ? " q-" + (m.kind === "Swatch" ? "exact" : m.word.replace(/ /g, "-")) : "")} onClick={() => setMatchAt(matchAt === i ? null : i)} title="Standard ink or PMS: see both and pick">
                    {m ? <>{m.kind} · {m.word}</> : "Pick an ink"}
                  </button>
                ); })()}
                {(() => {
                  // this color IS the shirt: knocked out (the shirt shows there); unchecking one that matches the shirt prints it anyway
                  const on = !!res?.dropped.includes(k.hex);
                  return <label className={"sep-chip-shirt" + (on ? " on" : "")} title={on ? "Knocked out: the shirt shows here. Uncheck to print this color." : "Check if this color is the shirt color: it's knocked out and the shirt shows there."}>
                    <input type="checkbox" checked={on} onChange={(e) => shirtInk(i, e.target.checked)} /> Shirt color
                  </label>;
                })()}
                <button type="button" className="sep-chip-x" onClick={() => { setMatchAt(null); setInks((l) => dropInk(l, i)); }} aria-label={`Remove ${k.name}`} title="Remove (its part of the art goes to the nearest other ink)">×</button>
              </div>
            ))}
            <button type="button" className={"sep-add" + (pick ? " on" : "")} onClick={() => setPick(!pick)} title="Add an ink: click a color in the art">{pick ? "Click the art" : "+"}</button>
            <span className="spacer" />
            <label className="sep-count">Colors <select value={st.maxColors} onChange={(e) => { set({ maxColors: +e.target.value }); }}>{Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <button type="button" className="btn sm" onClick={() => findInks()} title="Separate with this many inks. Fewer than the art has: the colors left out are mixed from the other inks as halftones.">Apply</button>
          </div>
          {st.method === "spot" && fadeRows.length > 0 && (
            <div className="sep-fades">
              {fadeRows.map((f) => (
                <div key={f.a.hex + f.b.hex} className={"sep-fade" + (f.risky ? " warn" : "")}>
                  <span className="sep-fade-bar" style={{ background: `linear-gradient(90deg, ${shown(f.a)}, ${f.mid}, ${shown(f.b)})` }} />
                  <span><b data-notranslate>{f.a.name}</b> fades to <b data-notranslate>{f.b.name}</b>{f.risky ? <>: the {f.midWord} in the middle can print muddy as {f.a.name} and {f.b.name} halftones crossing.</> : <>, printed as the two inks&apos; halftones crossing over.</>}</span>
                  <button type="button" className={"btn sm" + (f.risky ? " primary" : "")} onClick={() => addMiddle(f.a.hex, f.b.hex, f.mid)} title="A third screen for the middle of the fade (like adding the green between yellow and blue): the fade goes A → middle → B">Add {/^[aeiou]/.test(f.midWord) ? "an" : "a"} {f.midWord} screen in the middle</button>
                </div>
              ))}
            </div>
          )}
          {matchAt != null && inks[matchAt] && (
            <div className="sep-matchbox">
              <InkMatch hex={inks[matchAt].hex} title={`INK ${matchAt + 1} OF ${inks.length}: SUGGESTED COLORS`} cur={{ name: inks[matchAt].name, hex: colorHex(inks[matchAt].name) || inks[matchAt].hex }}
                onPick={(v) => { const at = matchAt; setInks((l) => l.map((x, j) => (j === at ? { ...x, name: v.name } : x))); setMatchAt(at + 1 < inks.length ? at + 1 : null); }} />
              <button type="button" className="sep-matchbox-x" onClick={() => setMatchAt(null)} aria-label="Close">×</button>
            </div>
          )}
          <datalist id="sep-inklist">{[...Object.keys(WILFLEX_NAMES), ...PMS_NAMES].map((n) => <option key={n} value={n} />)}</datalist>
          <div className="sep-vbar">
            <div className="rv-seg">{([["proof", "Proof"], ["compare", "Compare"], ["original", "Original"]] as const).map(([k, l]) => <button key={k} type="button" className={view === k ? "on" : ""} onClick={() => { setView(k); setSolo(null); }}>{l}</button>)}</div>
            <div className="rv-seg">{([["shirt", "On the shirt"], ["checker", "Transparent"]] as const).map(([k, l]) => <button key={k} type="button" className={bg === k ? "on" : ""} onClick={() => setBg(k)}>{l}</button>)}</div>
          </div>
          <div className={"sep-stage" + ((bg === "checker" || noShirt) && !solo ? " checker" : "")} style={{ background: solo ? "#fff" : bg === "shirt" && !noShirt ? st.garment : undefined }}>
            <div className="sep-canvases">
              <canvas ref={cv} className={(pick ? "pick " : solo ? "zoom " : "") + (view === "original" && !solo ? "gone" : "")} onClick={onPick} />
              <canvas ref={cvOrig} className={"sep-orig" + (view === "proof" || solo ? " gone" : "")} style={view === "compare" && !solo ? { clipPath: `inset(0 ${100 - split}% 0 0)` } : undefined} onClick={onPick} />
              {view === "compare" && !solo && <input className="sep-split" type="range" min={0} max={100} value={split} onChange={(e) => setSplit(+e.target.value)} aria-label="Original | proof" style={artBox ? { left: artBox.l, width: artBox.w, right: "auto" } : undefined} />}
            </div>
            {busy && <div className="sep-busy">{busy}</div>}
            {!img && !err && <div className="sep-busy">Loading the art…</div>}
          </div>
          {solo && (
            <div className="sep-loupe">
              {loupe ? <canvas ref={loupeCv} aria-label="Film close-up" /> : <div className="sep-loupe-hint">Click the film to see the real dots up close</div>}
              <small>{loupe ? <>{LOUPE_IN}&quot; of film at {st.dpi} dpi{(st.method === "sim" || plates.find((p) => p.key === solo)?.tonal) ? `, ${st.lpi} lpi ${DOT_NAME[st.dot || "ellipse"]} dots` : ", solid"}. Click elsewhere to move.</> : "Film close-up"}</small>
            </div>
          )}
          <div className="sep-legend faint">{solo ? <>Film for <b>{plates.find((p) => p.key === solo)?.name}</b> (black = ink). Click it for a close-up of the real film. <button type="button" className="linkbtn" onClick={() => { setSolo(null); setLoupe(null); }}>Back to the proof</button></> : view === "compare" ? <>Left of the line: the original art. Right: how it prints.</> : <>{view === "original" ? "The original art" : "Soft proof: how it prints"}{noShirt ? " (no shirt picked: every color prints)" : bg === "shirt" ? ` on a ${shirtLabel} shirt` : ""} · {plates.length} screen{plates.length === 1 ? "" : "s"}{res?.dropped.length ? ` · ${res.dropped.length} color${res.dropped.length === 1 ? "" : "s"} left to the shirt` : ""}</>}</div>
        </section>

        {/* screens, press, films, coach */}
        <aside className="sep-side">
          <div className="rv-seg sep-ptabs" role="tablist">{([["screens", `Screens ${plates.length || ""} & Films`], ["press", "Press"]] as [typeof rtab, string][]).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={rtab === k} className={rtab === k ? "on" : ""} onClick={() => setRtab(k)}>{l}</button>)}</div>
          <div className="sep-pane">
          {rtab === "screens" && <section className="sep-card">
            <h3>Print order</h3>
            <ol className="sep-plates">{plates.map((p, i) => (
              <li key={p.key} className={(hidden.has(p.key) ? "off" : "") + (solo === p.key ? " solo" : "")}>
                <span className="sep-n">{i + 1}</span>
                <span className="sep-sw" style={{ background: p.hex }} />
                <input className="sep-pname" value={p.name} onChange={(e) => setNames((m) => ({ ...m, [p.key]: e.target.value }))} aria-label="Plate name" />
                <small className="sep-meta">{p.kind === "underbase" ? "Base · flash after" : p.kind === "highlight" ? "Top white" : "Color"} · {(p.coverage * 100).toFixed(1)}%
                  {p.kind === "color" && res?.underbase && (() => {
                    // underbase under this ink or not (black and dark colors like navy: not, by default)
                    const art = "#" + p.key.slice(1);
                    if (neverBase(art)) return <span className="sep-base fixed" title="Black never gets underbase: black ink on white bubbles">No base</span>;
                    const on = st.baseFor?.[p.key] ?? baseByDefault(art);
                    return <button type="button" className={"sep-base" + (on ? " on" : "")} title={on ? "White underbase prints under this ink. Click to leave it off (the ink prints straight on the shirt)" : "No underbase under this ink (prints straight on the shirt). Click to put base under it"} onClick={() => set({ baseFor: { ...(st.baseFor || {}), [p.key]: !on } })}>{on ? "Base" : "No base"}</button>;
                  })()}
                  {" "}<span className="sep-nw">· mesh <select className="sep-mesh" value={p.mesh} onChange={(e) => setMesh((m) => ({ ...m, [p.key]: +e.target.value }))} aria-label="Mesh">{[...new Set([...SHOP_MESH, p.mesh])].sort((x, y) => x - y).map((v) => <option key={v} value={v}>{v}</option>)}</select></span>
                  {(tonal || p.tonal) && <>{" "}<span className="sep-nw">· <select className="sep-mesh sep-lpi" value={lpiOf(st, p.key)} title="Halftone frequency for this screen (lines per inch): lower = bigger dots" aria-label="Halftone LPI"
                    onChange={(e) => { const v = +e.target.value, n = { ...(st.lpiFor || {}) }; if (v === st.lpi) delete n[p.key]; else n[p.key] = v; set({ lpiFor: n }); }}>
                    {[...new Set([...LPIS, lpiOf(st, p.key)])].sort((x, y) => x - y).map((v) => <option key={v} value={v}>{v} lpi</option>)}</select></span></>}
                  {meshSug[p.key] && (mesh[p.key] == null || mesh[p.key] === meshSug[p.key].mesh
                    ? <span className="sep-meshsug" title={meshSug[p.key].why}>suggested</span>
                    : <button type="button" className="linkbtn sep-meshsug" title={meshSug[p.key].why} onClick={() => setMesh((m) => { const n = { ...m }; delete n[p.key]; return n; })}>suggests {meshSug[p.key].mesh}</button>)}</small>
                <span className="sep-pa">
                  <button type="button" className="btn icon ghost sm" title="Show / hide on the shirt" onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(p.key)) n.delete(p.key); else n.add(p.key); return n; })}>{hidden.has(p.key) ? "◌" : "●"}</button>
                  <button type="button" className="btn icon ghost sm" title="See this film" onClick={() => setSolo(solo === p.key ? null : p.key)}>▣</button>
                  
                </span>
              </li>
            ))}</ol>
          </section>}
          {rtab === "press" && !onPress && <div className="sep-card faint">No screen presses set up (Settings → Production).</div>}
          {rtab === "press" && onPress && press && (
            <section className="sep-card sep-pressup">
              <h3>Press Setup <small className="faint">{setup ? "set by hand" : "suggested"}</small></h3>
              <div className="sep-row">
                <select value={press.id} onChange={(e) => { setPressId(e.target.value); setSetup(null); }} aria-label="Press">{presses.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                {perms.pressDefaults && <button type="button" className="btn sm" onClick={() => setDefOpen(true)} title="What always sits on each head of this press: flashes, the roller">Press Defaults</button>}
              </div>
              <div className="sep-press"><PressLayout layout={drawLayout(onPress.heads)} size={250} mirror={!!press.mirror} inks={onPress.out} selected={selHead} onPick={pickHead}
                onDropHead={dragPlate ? dropOnHead : undefined} dropAt={dropHead} onDragHead={(i) => setDropHead(i)} /></div>
              {selHead != null && (() => {
                // tapped a head on the drawing: what's on it (a color's head is picked in the list below)
                const x = onPress.heads[selHead], k = plateOf(x), p = k ? plates.find((q) => q.key === k) : null;
                return (
                  <div className="ps-headmenu">
                    <b>Head {selHead + 1}</b>
                    {p ? <span>{p.name}: pick a different head for it in the list below.</span> : <>
                      {([["", "Empty"], ["cool", "Cool down"], ["flash", "Flash"], ["roller", "Roller"]] as const).map(([v, l]) => <button key={v || "e"} type="button" className={"pl-opt " + (v || "print") + (x === v ? " on" : "")} onClick={() => { setHeadTo(selHead, v); setSelHead(null); }}><i aria-hidden />{l}</button>)}
                    </>}
                    <button type="button" className="btn icon ghost sm" aria-label="Close" onClick={() => setSelHead(null)}>✕</button>
                  </div>
                );
              })()}
              <p className="sep-help">Each color: pick the head it goes on. Tap a head on the press for a flash, the roller or a cool-down.</p>
              <ol className="ps-colors">{plates.map((p, i) => {
                const at = onPress.heads.indexOf("p:" + p.key);
                const what = (x: Slot) => { const k = plateOf(x); return k ? (plates.find((q) => q.key === k)?.name || "a screen") : x === "flash" ? "Flash" : x === "roller" ? "Roller" : x === "cool" ? "Cool down" : x === "down" ? "down" : "open"; };
                const a = ask && ask.key === p.key ? ask : null;
                const otherName = a?.other ? plates.find((q) => q.key === a.other)?.name : "";
                const open = onPress.heads.map((x, h) => (x === "" && h !== a?.to ? h : -1)).filter((h) => h >= 0);
                return (
                  <li key={p.key} className={"ps-color" + (dragPlate === p.key ? " dragging" : "") + (a ? " asking" : "")}
                    draggable onDragStart={(e) => { setDragPlate(p.key); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p.key); }} onDragEnd={() => { setDragPlate(null); setDropHead(null); }}>
                    <div className="ps-color-r">
                      <i className="ps-sw" style={{ background: p.hex }} />
                      <span className="ps-cname"><b>{i + 1} · {p.name}</b><small>mesh {p.mesh}</small></span>
                      <span className="ps-ud">
                        <button type="button" className="btn icon ghost sm" title="Print earlier (trades heads with the color before it)" disabled={!i || at < 0} onClick={() => swapWith(p.key, plates[i - 1]?.key)}>↑</button>
                        <button type="button" className="btn icon ghost sm" title="Print later (trades heads with the color after it)" disabled={i === plates.length - 1 || at < 0} onClick={() => swapWith(p.key, plates[i + 1]?.key)}>↓</button>
                      </span>
                      <select value={at} aria-label={`Head for ${p.name}`} onChange={(e) => chooseHead(p.key, +e.target.value)}>
                        {at < 0 && <option value={-1}>Not on the press</option>}
                        {onPress.heads.map((x, h) => <option key={h} value={h} disabled={x === "down"}>Head {h + 1}{h === at ? "" : ` · ${what(x)}`}</option>)}
                      </select>
                    </div>
                    {a && (
                      <div className="ps-ask">
                        {a.other ? <>
                          <span>Head {a.to + 1} has <b>{otherName}</b>. Where should {otherName} go?</span>
                          <div className="ps-ask-b">
                            {at >= 0 && <button type="button" className="btn sm primary" onClick={() => moveColor(p.key, a.to, at)}>Head {at + 1} (trade places)</button>}
                            <select value="" aria-label={`Another head for ${otherName}`} onChange={(e) => e.target.value !== "" && moveColor(p.key, a.to, +e.target.value)}>
                              <option value="">Another open head…</option>
                              {open.map((h) => <option key={h} value={h}>Head {h + 1}</option>)}
                            </select>
                            <button type="button" className="btn sm" onClick={() => setAsk(null)}>Cancel</button>
                          </div>
                        </> : <>
                          <span>Head {a.to + 1} is {a.station === "flash" ? "a flash" : a.station === "roller" ? "the roller" : "a cool-down head"}. Put {p.name} there instead?</span>
                          <div className="ps-ask-b">
                            <button type="button" className="btn sm primary" onClick={() => moveColor(p.key, a.to)}>Yes, use head {a.to + 1}</button>
                            <button type="button" className="btn sm" onClick={() => setAsk(null)}>Cancel</button>
                          </div>
                        </>}
                      </div>
                    )}
                  </li>
                );
              })}</ol>
              {onPress.note && <div className="sep-tip">{onPress.note}</div>}
              {onPress.recNote && <div className="sep-tip">{onPress.recNote}</div>}
              {!setup && onPress.why.length > 0 && <details className="ps-why" open><summary>Why this layout</summary><ul>{onPress.why.map((w) => <li key={w}>{w}</li>)}</ul></details>}
              {onPress.warn.map((w) => <div key={w} className="sep-tip">{w}</div>)}
              {onPress.moves.length > 0 && <div className="ps-moves"><b>Set up the press:</b><ul>{onPress.moves.map((m) => <li key={m}>{m}</li>)}</ul></div>}
              <div className="ps-acts">
                <button type="button" className="linkbtn" onClick={() => { const n = autoSetup(onPress.lay, plates.map((p) => ({ key: p.key, name: p.name, hex: p.hex, kind: p.kind })), true); commitSetup(n); }} title="Leave an empty head between colors where there's room, so each hit cools before the next">Space colors out</button>
                {setup && <button type="button" className="linkbtn" onClick={() => { setSetup(null); setSelHead(null); setSelPlate(null); }}>Use the suggested layout</button>}
                <button type="button" className="linkbtn" onClick={printSetup}>Print setup sheet</button>
              </div>
            </section>
          )}
          {defOpen && <PressDefaults presses={presses} start={press?.id} me={me.email} onClose={() => setDefOpen(false)} onSaved={(m, lay) => { const lc = layoutCounts(lay); setPresses((ps) => ps.map((p) => (p.id === m.id ? { ...p, layout: lay, flashes: lc.units, rollers: lc.rollers || undefined } : p))); setDefOpen(false); setMsg(`${m.name.split(" · ")[0]} defaults saved. Every job's setup on it starts from these.`); }} />}
          {rtab === "screens" && res && <PrintFilms n={plates.length} aspect={res.h / res.w} widthIn={st.widthIn} dpi={st.dpi} title={title} busy={!!busy}
            make={async (rollIn) => { try { return await filmsFile(rollIn); } finally { setBusy(""); } }}
            onSent={() => { if (row.status !== "cancelled") markPrinted(); }} />}
          {rtab === "screens" && <section className="sep-card">
            <h3>Files</h3>
            <div className="sep-dl">
              <button type="button" className="linkbtn" disabled={!res || !!busy} onClick={async () => { try { setErr(""); download(await aiFile(), `${slug(title)}-seps.pdf`); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } setBusy(""); }}>Illustrator file (spot colors)</button>
              <button type="button" className="linkbtn" disabled={!res || !!busy} onClick={async () => { try { setErr(""); download(await filmsFile(ROLL_IN), `${slug(title)}-films-${ROLL_IN}in.pdf`); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } setBusy(""); }}>Films PDF ({ROLL_IN}&quot; roll, {st.dpi} dpi{tonal || plates.some((p) => p.tonal) ? `, ${st.lpi} lpi` : ""})</button>
              <button type="button" className="linkbtn" disabled={!res || !!busy} title="For FilmMaker (or any RIP): one page per screen, each its own spot color, with marks and the ink name. FilmMaker makes the halftone dots with its own settings per ink." onClick={async () => { try { setErr(""); download(await ripFile(), `${slug(title)}-filmmaker.pdf`); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } setBusy(""); }}>FilmMaker / RIP file (one page per screen)</button>
            </div>
            {(row.files || []).length > 0 && <ul className="sep-files">{row.files.filter((f) => f.kind !== "plate").map((f) => <li key={f.path}><button type="button" className="linkbtn" onClick={() => openFile(f.path)}>{f.name}</button></li>)}</ul>}
            <p className="sep-help">The Illustrator file opens straight in Illustrator: each ink is a spot color swatch, so File → Print → Separations prints one film per ink.{img && !vart ? ` Files are made from the art at full size: ${outSize().ppi} pixels per inch at ${st.widthIn}" wide${outSize().ppi < 200 ? " (low: consider Smooth vector for solid inks, or better art)" : ""}.` : vart?.ok ? " Vector art: the original shapes, sharp at any size." : ""}</p>
          </section>}
          </div>
        </aside>
      </div>
      )}
    </div>
  );
}

import { WILFLEX_HEX as WILFLEX_NAMES } from "@/lib/inkColors";
import { PMS_COATED } from "@/lib/pms";
const PMS_NAMES = Object.keys(PMS_COATED);

/** a picture file as a JPEG (base64, at most 1100 px) for Claude to look at */
async function jpegOf(f: File): Promise<string | null> {
  try {
    const u = URL.createObjectURL(f), im = await loadImg(u);
    const k = Math.min(1, 1100 / Math.max(im.naturalWidth, im.naturalHeight)), t = document.createElement("canvas");
    t.width = Math.round(im.naturalWidth * k); t.height = Math.round(im.naturalHeight * k);
    const g = t.getContext("2d")!; g.fillStyle = "#fff"; g.fillRect(0, 0, t.width, t.height); g.drawImage(im, 0, 0, t.width, t.height);
    URL.revokeObjectURL(u); return t.toDataURL("image/jpeg", 0.85).split(",")[1];
  } catch { return null; }
}

/** No art yet: upload a picture or SVG straight to this separation. */
function AddArt({ row, onDone }: { row: SepRow; onDone: (r: SepRow) => void }) {
  const sb = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [over, setOver] = useState(false);
  async function go(f?: File) {
    if (!f) return;
    const bad = await artProblem(f); if (bad) { setErr(bad); return; }
    setBusy(true); setErr("");
    try {
      const art = await uploadSepArt(sb, row.id, f);
      const r = await sb.from("separations").update({ settings: { ...row.settings, art }, updated_at: new Date().toISOString() }).eq("id", row.id).select("*").single();
      if (r.error) throw new Error(r.error.message);
      onDone(r.data as SepRow);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  return (
    <div className="sep-outside">
      <section className="sep-card">
        <h3>Art to separate</h3>
        <p className="sep-help">{row.order_id ? "This imprint has no design attached. Upload the art here, or add it to the order's imprint." : "Upload the art to separate."}</p>
        <label className={"tmx-drop" + (over ? " over" : "")} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); go(e.dataTransfer.files[0]); }}>
          <input type="file" accept={ART_ACCEPT} onChange={(e) => go(e.target.files?.[0])} />
          <b>{busy ? "Uploading…" : "Drop the art here or choose a file"}</b>
          <span className="faint">{ART_KINDS} (SVG and EPS keep the real vector shapes)</span>
        </label>
        {err && <div className="pv-err">{err}</div>}
      </section>
    </div>
  );
}

/** Separated somewhere else: download the art, upload what came back, list the inks. */
function Outside({ row, origUrl, onSaved, openFile, ours, artImage }: { row: SepRow; origUrl: string; onSaved: (r: SepRow) => void; openFile: (p: string) => void;
  /** what our Studio picked for this art, to learn from the difference */
  ours: () => Record<string, unknown>; artImage: () => string | null }) {
  const sb = useMemo(() => createClient(), []);
  const [files, setFiles] = useState<File[]>([]);
  // why it went to Separo (what was wrong with ours), and what was learned from it
  const [why, setWhy] = useState("");
  const [learned, setLearned] = useState<{ summary: string; lessons: { id: string; lesson: string }[] } | null>(null), [learning, setLearning] = useState(false);
  const [readInks, setReadInks] = useState(0);
  async function pickFiles(fs: File[]) {
    setFiles(fs);
    const names = await inkNamesFromFiles(fs);
    if (names.length && !inkText.trim()) { setInkText(names.join("\n")); setReadInks(names.length); }
  }
  /** Separo's result next to ours → lessons for our separations (and notes for the engine) */
  async function learn(chs: Channel[]) {
    setLearning(true);
    try {
      const imgs: { label: string; data: string }[] = [];
      const art = artImage(); if (art) imgs.push({ label: "The original art:", data: art });
      const comp = files.find((f) => /^image\/(png|jpe?g)$/i.test(f.type) && f.size < 15e6);
      if (comp) { const d = await jpegOf(comp); if (d) imgs.push({ label: `What came back from ${src} (${comp.name}):`, data: d }); }
      const r = await fetch("/api/separations/learn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ separation_id: row.id, design_id: row.design_id, source: src, why, theirs: { inks: chs.map((c) => ({ name: c.name, hex: c.hex })), files: files.map((f) => f.name) }, ...ours(), images: imgs }) });
      const j = await r.json().catch(() => ({}));
      if (j.summary) setLearned({ summary: j.summary, lessons: j.lessons || [] });
    } catch { /* learning is extra: the upload already saved */ }
    setLearning(false);
  }
  const [inkText, setInkText] = useState(row.channels.map((c) => c.name).join("\n"));
  const [src, setSrc] = useState(row.source && row.source !== "studio" ? row.source : "Separo");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  async function save() {
    setBusy(true); setErr("");
    try {
      const added: SepFile[] = [];
      for (const f of files) {
        const path = `separations/${row.id}/upload-${Date.now()}-${f.name.replace(/[^\w.-]+/g, "_")}`;
        const r = await sb.storage.from("proofs").upload(path, f, { upsert: true, contentType: f.type || "application/octet-stream" });
        if (r.error) throw new Error(r.error.message);
        added.push({ path, name: f.name, kind: "upload", size: f.size });
      }
      const names = inkText.split(/\n|,/).map((x) => x.trim()).filter(Boolean);
      // Separo names inks "7405 C", "Base", "White": a PMS number gets its color, a white after the base is the highlight
      const hasBase = names.some((n) => /base/i.test(n));
      const channels: Channel[] = names.map((n, i) => ({ key: "u" + i, name: n, hex: colorHex(n) || colorHex("PMS " + n) || (/^white$/i.test(n) || /base/i.test(n) ? "#FFFFFF" : "#999999"), kind: /base|underbase/i.test(n) ? "underbase" : /highlight/i.test(n) || (hasBase && /^white$/i.test(n.trim())) ? "highlight" : "color", order: i + 1, mesh: /base/i.test(n) ? 156 : 230, coverage: 0 }));
      const r = await sb.from("separations").update({ status: "review", method: "outside", source: src, channels, files: [...(row.files || []), ...added], updated_at: new Date().toISOString() }).eq("id", row.id).select("*").single();
      if (r.error) throw new Error(r.error.message);
      onSaved(r.data as SepRow);
      await learn(channels);
      setFiles([]);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  return (
    <div className="sep-outside">
      <section className="sep-card">
        <h3>Learn from Separo · 1. Get the art</h3>
        <p className="sep-help">When a job has to be separated in Separo, upload what comes back here: it&apos;s compared with ours and the differences teach our separations.</p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {origUrl ? <a className="btn" href={origUrl} target="_blank" rel="noreferrer">Download the Art</a> : <span className="faint">No art on this imprint.</span>}
          <a className="btn" href="https://separo.io" target="_blank" rel="noreferrer">Open Separo ↗</a>
        </div>
      </section>
      <section className="sep-card">
        <h3>2. Upload what came back</h3>
        <label className="sep-f">From<input value={src} onChange={(e) => setSrc(e.target.value)} /></label>
        <label className="tmx-drop"><input type="file" multiple accept=".eps,.pdf,.ai,.psd,.tif,.tiff,.png,.jpg,.zip" onChange={(e) => pickFiles([...(e.target.files || [])])} /><b>{files.length ? files.map((f) => f.name).join(", ") : "Choose files (EPS, PDF, AI, PSD, TIFF, PNG, ZIP)"}</b></label>
        {readInks > 0 && <div className="sep-ok">Read {readInks} ink{readInks === 1 ? "" : "s"} from the file. Check the print order.</div>}
        <label className="sep-f">Inks, in print order (one per line)<textarea rows={6} value={inkText} onChange={(e) => setInkText(e.target.value)} placeholder={"Underbase\n7405 C\n2347 C\n288 C\nHighlight White\nBlack"} /></label>
        <label className="sep-f">Why Separo this time? What was wrong with ours? (it learns from this)<textarea rows={3} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. ours used 5 colors for the gradient, Separo did it in 3; our underbase was too heavy" /></label>
        {err && <div className="pv-err">{err}</div>}
        <button type="button" className="btn primary" disabled={busy || learning || (!files.length && !inkText.trim())} onClick={save}>{busy ? "Uploading…" : learning ? "Learning from it…" : "Save & Send for Review"}</button>
      </section>
      {learned && (
        <section className="sep-card sep-coach">
          <h3>What we learned from {src}</h3>
          <p style={{ fontSize: 13, margin: "4px 0 8px" }}>{learned.summary}</p>
          {learned.lessons.length > 0 && <ul className="sc-lessons">{learned.lessons.map((l) => <li key={l.id}><span>{l.lesson}</span></li>)}</ul>}
          <p className="sep-help">Our separations use these for the next 30 days (Make Separations Better shows them). The differences are also kept to improve the separation engine itself.</p>
        </section>
      )}
      {(row.files || []).some((f) => f.kind === "upload") && <section className="sep-card"><h3>Uploaded</h3><ul className="sep-files">{row.files.filter((f) => f.kind === "upload").map((f) => <li key={f.path}><button type="button" className="linkbtn" onClick={() => openFile(f.path)}>{f.name}</button></li>)}</ul></section>}
    </div>
  );
}

/**
 * Print films: the finished black films (our dots: nothing for FilmMaker to separate, convert or screen), laid out on
 * the film roll (turned when that uses less film), sent straight to FilmMaker's hot folder, which prints it as one
 * black composite job. Nobody opens Illustrator.
 */
/** the shop's screen meshes (the mesh picker on each screen) */
const SHOP_MESH = [80, 110, 156, 195, 230, 305];
/** halftone frequencies to pick from (lines per inch) */
const LPIS = [35, 40, 45, 50, 55, 60, 65, 75, 85];
/** the film printer's roll (Epson, 17"): every film goes on it */
const ROLL_IN = 17;
function PrintFilms({ n, aspect, widthIn, dpi, title, busy, make, onSent }: {
  n: number; aspect: number; widthIn: number; dpi: number; title: string; busy: boolean;
  make: (rollIn: number) => Promise<Uint8Array>; onSent: () => void;
}) {
  const rollIn = ROLL_IN;
  const [folder, setFolder] = useState<string | null>(null), [canFolder, setCanFolder] = useState(false);
  const [msg, setMsg] = useState(""), [err, setErr] = useState(""), [working, setWorking] = useState(false);
  useEffect(() => { setCanFolder(folderPrintable()); savedFolder().then((h) => setFolder(h?.name || null)); }, []);
  const W = widthIn * 72, H = W * aspect;
  const L = rollIn ? rollLayout(n, W, H, rollIn) : null;
  const name = `${slug(title)}-films${rollIn ? `-${rollIn}in` : ""}.pdf`;
  async function choose() {
    setErr("");
    try { const h = await pickFolder(); setFolder(h.name); return true; }
    catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) setErr(e instanceof Error ? e.message : String(e)); return false; }
  }
  async function print() {
    setErr(""); setMsg(""); setWorking(true);
    try {
      if (canFolder && !folder && !(await choose())) return;
      const pdf = await make(rollIn);
      const at = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      if (canFolder) {
        const r = await sendToFolder(pdf, name);
        if (r === "sent") { setMsg(`Sent to FilmMaker at ${at}: ${name}`); onSent(); return; }
        if (r === "gone") { await forgetFolder(); setFolder(null); setErr("The hot folder isn't there any more. Pick it again (Change folder) and print again."); return; }
        if (r === "denied") { setErr("The browser wasn't allowed to save into the hot folder. Click Print films again and choose Allow (or Allow on every visit)."); return; }
      }
      download(pdf, name);
      setMsg(`Downloaded ${name} at ${at}.${canFolder ? "" : " On the film PC (Chrome or Edge) this goes straight to FilmMaker."}`);
      onSent();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(false); }
  }
  // the roll, drawn: each screen a box, the ones turned shown turned
  const pic = (() => {
    if (!L || !rollIn) return null;
    const m = 36, iw = W + 2 * m, ih = H + 2 * m;
    const RW = rollIn * 72, RL = Math.max(L.lengthIn * 72, 72), k = Math.min(150 / RW, 210 / RL);
    return (
      <svg className="pf-roll" width={RW * k + 2} height={RL * k + 2} viewBox={`-1 -1 ${RW + 2 / k} ${RL + 2 / k}`} aria-hidden>
        <rect x={0} y={0} width={RW} height={RL} className="pf-film" />
        {L.place.map((p, i) => {
          const bw = p.rot ? ih : iw, bh = p.rot ? iw : ih, x = 0.2 * 72 + p.x, y = 22 + p.y;
          return <g key={i}><rect x={x} y={y} width={bw} height={bh} className={"pf-box" + (L.fits ? "" : " bad")} /><text x={x + bw / 2} y={y + bh / 2} className="pf-n" fontSize={Math.min(bw, bh) * 0.32}>{i + 1}</text></g>;
        })}
      </svg>
    );
  })();
  return (
    <section className="sep-card">
      <div className="pf-head"><h3>Print films</h3><button type="button" className="btn primary" disabled={busy || working || (!!L && !L.fits)} onClick={print}>{working ? "Making films…" : "Print Films"}</button></div>
      {L ? (
        <div className="pf-lay">
          {pic}
          <div className="pf-txt">
            {L.fits ? <>
              <b>{n} screen{n === 1 ? "" : "s"} · {L.lengthIn.toFixed(1)}&quot; of film</b>
              <span>{L.mixed ? "Some turned sideways to fit more across" : L.rotate ? "Turned sideways" : "Upright"}, {L.cols === 1 ? "one across" : `up to ${L.cols} across`}{L.rows > 1 ? `, ${L.rows} rows` : ""}</span>
              <span className="faint">{L.widthIn.toFixed(1)}&quot; of the {rollIn}&quot; roll used{L.savedIn >= 0.5 ? ` · saves ${L.savedIn.toFixed(1)}" over one under another` : ""}</span>
            </> : <span className="pv-err">The art with its marks is {((W + 72) / 72).toFixed(1)}&quot; × {((H + 72) / 72).toFixed(1)}&quot;: too big for the {rollIn}&quot; roll either way. Make the print smaller, or download the Films PDF (a page per screen).</span>}
          </div>
        </div>
      ) : <p className="sep-help">One page per screen, each the art at {widthIn}&quot; wide with its marks: for a sheet printer.</p>}
      <p className="sep-help">Black films, finished: solid and halftone dots made here at {dpi} dpi (Film DPI under Output; set it to the printer&apos;s resolution). FilmMaker just prints black: no separating, no converting colors to black.</p>
      {canFolder && !folder && <div className="pf-folder faint">The first time on the film PC, it asks for FilmMaker&apos;s hot folder.</div>}
      {!canFolder && <div className="pf-folder faint">This browser downloads the file (Chrome or Edge on the film PC sends it straight to FilmMaker).</div>}
      {canFolder && folder && <div className="pf-folder faint">Sends to the folder <b data-notranslate>{folder}</b> on this computer · <button type="button" className="linkbtn" onClick={choose}>Change folder</button></div>}
      {msg && <div className="ok-note">{msg}</div>}
      {err && <div className="pv-err">{err}</div>}
      <details className="pf-setup">
        <summary className="faint">Set up the film PC (once)</summary>
        <ol>
          <li><b>FilmMaker: a template for films.</b> Make (or pick) a queue template: the Epson, media = {rollIn || 17}&quot; roll film, black only (composite, no separations), scale 100% (never fit to page), and &quot;Enable application halftoning&quot; on so it keeps our dots. Turn off Auto Nest and rotation in it: the portal already lays the films out.</li>
          <li><b>FilmMaker: hot folders.</b> Queue → Properties → Hot Folders tab: turn on template hot folders, pick a plain folder such as <code>C:\Films</code> (Chrome won&apos;t write into Program Files, ProgramData or Windows), and check &quot;Delete file after processed by queue&quot;. FilmMaker makes a numbered subfolder for each template; the film template&apos;s subfolder is the one the portal sends to. If the queue holds jobs instead of printing them, click Print in FilmMaker.</li>
          <li><b>Dot gain:</b> the dots already allow for it (&quot;Dot gain on press&quot;, 15%), so the film template&apos;s Press Calibration curve stays straight. Keep its film Calibration / ink density so blacks come out dense.</li>
          <li><b>Film DPI:</b> set Film DPI (Output, above) to what FilmMaker prints at on the Epson (usually 720 or 1440) so the dots aren&apos;t resized.</li>
          <li><b>Chrome or Edge on the film PC:</b> sign in to the portal, open a separation, click Print films, pick the film template&apos;s hot folder, and choose <i>Allow on every visit</i>. From then on Print films sends straight to FilmMaker: no save box, no Illustrator.</li>
          <li><b>Test it:</b> print one job; measure the art on the film against its width here (it should be exact), and check each film has its ink name at the top.</li>
        </ol>
        <p className="sep-help">Another computer (or Safari) downloads the file instead: drop it into the hot folder, or open it in FilmMaker. Want FilmMaker to make the dots with its own per-ink settings instead? Use &quot;FilmMaker / RIP file&quot; under Save (spot colors, one page per screen).</p>
      </details>
    </section>
  );
}
