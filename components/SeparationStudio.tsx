"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import { orderGroups, type Design, type Group, type Order } from "@/lib/pricing";
import { DEFAULT_SEP, baseByDefault, neverBase, composite, filmBits, findColors, filmDot, findSimInks, gradientShare, isDark, minDot, resamplePlate, separate, snapInk, spotMixer, type Plate, type Px, type SepInk, type SepResult, type SepSettings } from "@/lib/separate";
import { closestPms, colorHex, matchWord, suggestInk } from "@/lib/inkColors";
import InkMatch from "@/components/InkMatch";
import { guessHex } from "@/lib/mockup";
import { filmPdf, deflate } from "@/lib/filmPdf";
import { ripPdf } from "@/lib/ripPdf";
import { illustratorPdf } from "@/lib/illustratorPdf";
import { parseSvg, type VArt } from "@/lib/svgVector";
import { parseEps, vartSvg } from "@/lib/epsVector";
import { browserInflate, parsePdf } from "@/lib/pdfVector";
import { deltaE } from "@/lib/inkColors";
import { mergeProduction, withIssue, type EquipRow, type Machine, type Station } from "@/lib/production";
import PressLayout from "@/components/PressLayout";

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
export const SEP_STATUS: Record<SepRow["status"], { label: string; c: string }> = {
  requested: { label: "Requested", c: "#6477D6" }, in_progress: { label: "In progress", c: "#A152C9" }, review: { label: "Ready for review", c: "#C98A0C" },
  approved: { label: "Approved", c: "#2E9D5B" }, films: { label: "Films printed", c: "#0A8FC0" }, cancelled: { label: "Cancelled", c: "#7C8799" },
};

type Studio = SepSettings & { widthIn: number; lpi: number; angle: number; dpi: number; removeBg: boolean; lib: "auto" | "wilflex" | "pms"; solidOut?: "pixels" | "vector";
  /** underbase choke and color trap, in points at the print size (so they mean the same at any resolution) */
  chokePt?: number; trapPt?: number;
  /** fine detail (small type, thin lines): narrower than finePt (0 = off), the base is choked only fineChokePt and the
   *  color on top is fattened bumpPt onto the shirt instead */
  finePt?: number; fineChokePt?: number; bumpPt?: number;
  /** films: halftone dot shape */
  dot?: "ellipse" | "round" | "square";
  /** dot gain on press, taken off the halftone plates ahead of time (Illustrator file and films); 0 if the RIP does it.
   *  (`gain` from SepSettings is filled from this; an old saved films-only `gain` is ignored.) */
  pressGain?: number };
const DOT_NAME = { ellipse: "elliptical", round: "round", square: "square" } as const;
const PRESS_GAIN = 0.15;
const CHOKE_PT = 0.5, TRAP_PT = 0.25, FINE_PT = 2, FINE_CHOKE_PT = 0.15, BUMP_PT = 0.25;
/** points at the print size → pixels of a copy `w` px wide (fractions kept: edges move by exact sub-pixel amounts) */
const ptPx = (pt: number, w: number, widthIn: number) => (pt * w) / (widthIn * 72);
/** the separation settings in pixels of a copy `w` px wide */
const sepOpts = (st: Studio, w: number): SepSettings => ({ ...st, gain: st.pressGain ?? PRESS_GAIN, choke: ptPx(st.chokePt ?? CHOKE_PT, w, st.widthIn), trap: ptPx(st.trapPt ?? TRAP_PT, w, st.widthIn),
  fine: ptPx(st.finePt ?? FINE_PT, w, st.widthIn), fineChoke: ptPx(st.fineChokePt ?? FINE_CHOKE_PT, w, st.widthIn), bump: ptPx(st.bumpPt ?? BUMP_PT, w, st.widthIn) });
/** the working size on screen (fast); the files are separated again at full size (OUT_PPI at the print width) */
const MAX_SIDE = 2400;
const OUT_PPI = 400, OUT_MAX_SIDE = 7200, OUT_MAX_PX = 36e6;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "plate";
const inkName = (hex: string, lib: Studio["lib"]) => {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (r > 238 && g > 238 && b > 238) return "White";
  if (r < 30 && g < 30 && b < 30) return "Black";
  return lib === "pms" ? closestPms(hex).name : lib === "wilflex" ? snapInk(hex).name : (({ standard, pms, rec }) => (rec === "pms" ? pms : standard).name)(suggestInk(hex));
};
/** what an ink name is and how close it is to the art's color: "Standard · very close", "PMS · close", "Custom" */
function inkKind(name: string, art: string): { kind: string; word: string; dE: number } | null {
  const hex = colorHex(name); if (!hex) return null;
  const kind = WILFLEX_NAMES[name] ? "Standard" : /^#/.test(name) ? "Custom" : "PMS", dE = Math.round(deltaE(art, hex) * 10) / 10;
  return { kind, word: matchWord(dE), dE };
}
const shown = (ink: SepInk) => colorHex(ink.name) || ink.hex;

/**
 * The art as pixels, at most `side` on the long side (vector art is drawn at exactly that size; pictures are never
 * blown up). With removeBg, a white background around the art becomes transparent, and the soft pixels along the
 * art's edge have the white taken back out of them (color-to-alpha), so no pale fringe prints around the outline.
 */
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
  const [vart, setVart] = useState<VArt | null>(null);
  const [me, setMe] = useState({ email: "", boss: false });
  const [err, setErr] = useState(""), [msg, setMsg] = useState(""), [busy, setBusy] = useState("");
  const [st, setSt] = useState<Studio>({ ...DEFAULT_SEP, widthIn: 11, lpi: 55, angle: 22.5, dpi: 600, removeBg: true, lib: "auto" });
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
  const [bg, setBg] = useSticky<"shirt" | "checker">("sep.bg", "shirt");
  const pxRef = useRef<Px | null>(null);
  const [pxTick, setPxTick] = useState(0);
  const set = (p: Partial<Studio>) => setSt((s) => ({ ...s, ...p }));

  /* ---------- load ---------- */
  const load = useCallback(async () => {
    const { data: r } = await sb.from("separations").select("*").eq("id", id).maybeSingle();
    if (!r) { setErr("Separation not found."); return; }
    const row0 = r as SepRow; setRow(row0);
    const { data: { user } } = await sb.auth.getUser();
    const email = (user?.email || "").toLowerCase();
    const { data: sf } = await sb.from("staff").select("role").eq("email", email).maybeSingle();
    setMe({ email, boss: ["owner", "admin", "production"].includes((sf?.role as string) || "") });
    const [{ data: o }, { data: d }, { data: s0 }, { data: eq0 }] = await Promise.all([
      row0.order_id ? sb.from("orders").select("*").eq("id", row0.order_id).maybeSingle() : Promise.resolve({ data: null }),
      row0.design_id ? sb.from("designs").select("*").eq("id", row0.design_id).maybeSingle() : Promise.resolve({ data: null }),
      sb.from("settings").select("data").eq("id", 1).maybeSingle(),
      sb.from("production_equipment").select("*"),
    ]);
    setOrder((o as Order) || null);
    const today = new Date().toISOString().slice(0, 10);
    const ps = mergeProduction((s0?.data as { production?: unknown } | null)?.production);
    setPresses(ps.machines.filter((m) => m.type === "screen" && m.active).map((m) => withIssue(m, ((eq0 || []) as EquipRow[]).find((e) => e.machine === m.id), today)));
    // saved settings win; otherwise the garment from the order
    const saved = row0.settings as Partial<Studio> & { inks?: SepInk[]; order?: string[]; mesh?: Record<string, number>; names?: Record<string, string> };
    const garment = (saved.garment as string) || colorHex(row0.garment_color) || guessHex(row0.garment_color) || "#FFFFFF";
    const im = orderGroups((o as Order) || { groups: [], lines: [] } as never).flatMap((g) => g.imprints).find((x) => x.id === row0.imprint_id);
    const widthIn = saved.widthIn || parseFloat(String(im?.size || "").replace(/[^\d.]/g, " ").trim().split(/\s+/)[0]) || 11;
    setSt((s) => ({ ...s, ...saved, garment, widthIn, method: (saved.method as SepSettings["method"]) || s.method }));
    if (saved.inks?.length) setInks(saved.inks);
    if (saved.order) setOrderKeys(saved.order);
    if (saved.mesh) setMesh(saved.mesh);
    if (saved.names) setNames(saved.names);
    if (row0.status === "requested") { await sb.from("separations").update({ status: "in_progress", assigned_to: email, updated_at: new Date().toISOString() }).eq("id", id); setRow({ ...row0, status: "in_progress", assigned_to: email }); }
    // the art: the imprint's design, else art uploaded straight to this separation
    const d0 = d as Design | null, up = (row0.settings as { art?: SepArt }).art;
    const des = d0?.file_path ? { file_path: d0.file_path, file_type: d0.file_type, file_name: d0.file_name, preview_path: d0.preview_path } : up?.path ? { file_path: up.path, file_type: up.type, file_name: up.name, preview_path: null as string | null } : null;
    setHasArt(!!des);
    // Illustrator EPS: read its shapes (vector all the way to the Illustrator file)
    if (des && (isEps(des.file_name || des.file_path, des.file_type || "") || isPdf(des.file_name || des.file_path, des.file_type || ""))) {
      const [{ data: ev }, { data: su }] = await Promise.all([sb.storage.from("proofs").download(des.file_path), sb.storage.from("proofs").createSignedUrl(des.file_path, 3600)]);
      setOrigUrl(su?.signedUrl || "");
      const v = ev ? await readVector(ev, des.file_name || des.file_path, des.file_type || "") : null;
      if (v?.ok) { setVart(v); setArtUrl(URL.createObjectURL(new Blob([vartSvg(v)], { type: "image/svg+xml" }))); return; }
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
  useEffect(() => { if (!artUrl) return; loadImg(artUrl).then(setImg).catch((e) => setErr(e.message)); }, [artUrl]);
  useEffect(() => { if (!img) return; pxRef.current = pixelsOf(img, st.removeBg, !!vart); setPxTick((t) => t + 1); }, [img, st.removeBg, vart]);

  /* ---------- find inks (first time, or on request) ---------- */
  // auto: find as many inks as the art needs and set the Colors count to that; otherwise use the Colors count (fewer
  // than the art has: the inks easiest to mix from the others are left out and printed as halftones of them)
  const findInks = useCallback((method = st.method, auto = false) => {
    const px = pxRef.current; if (!px) return;
    // sim tries every candidate ink against the whole art (a few seconds): let the page say so first
    setBusy("Finding inks…");
    setTimeout(() => {
      const want = auto ? (method === "sim" ? 8 : 12) : st.maxColors;
      const f = method === "sim" ? findSimInks(px, st.garment, want) : findColors(px, want, 9, 0.004, st.garment);
      if (auto || f.length < want) setSt((x) => ({ ...x, maxColors: Math.max(1, f.length) }));
      if (auto) setNatural(f.length);
      if (!auto && f.length < want) setMsg(`This art has ${f.length} color${f.length === 1 ? "" : "s"}. More inks would print almost nothing, so it stays at ${f.length}.`);
      // vector art with spot swatches (.ai / PDF): an ink that is one of the art's swatches takes the swatch's name
      const spots = (vart?.shapes || []).filter((sh) => sh.ink && !/%$/.test(sh.ink));
      const swatch = (hex: string) => { let best = "", bd = 4; for (const sh of spots) { const d = deltaE(hex, sh.fill); if (d < bd) { bd = d; best = sh.ink!; } } return best; };
      setInks(f.map((x) => ({ hex: x.hex, name: swatch(x.hex) || inkName(x.hex, st.lib) })));
      setOrderKeys([]); setNames({}); setHidden(new Set()); setMatchAt(null); setBusy("");
    }, 30);
  }, [st.method, st.garment, st.maxColors, st.lib, vart]);
  const hint = useMemo(() => { const px = pxRef.current; if (!px || !inks.length || st.method === "sim") return 0; return gradientShare(px, inks.map((k) => k.hex)); }, [pxTick, inks, st.method]);
  useEffect(() => { if (pxTick && !inks.length) findInks(st.method, true); }, [pxTick]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- separate (a moment after anything changes) ---------- */
  useEffect(() => {
    const px = pxRef.current; if (!px || !inks.length) return;
    setBusy("Separating…");
    const t = setTimeout(() => {
      const r = separate(px, inks.map((k) => ({ hex: k.hex, name: k.name })), sepOpts(st, px.w));
      // show the ink's real color, not the art's
      r.plates.forEach((p) => { const k = inks.find((x) => "c" + x.hex.slice(1) === p.key); if (k) p.hex = shown(k); });
      hiRef.current = null;
      setRes(r); setBusy("");
    }, 60);
    return () => clearTimeout(t);
  }, [pxTick, inks, st.method, st.garment, st.underbase, st.chokePt, st.highlight, st.dropGarment, st.trapPt, st.widthIn, st.baseFor, st.finePt, st.fineChokePt, st.bumpPt, st.pressGain]); // eslint-disable-line react-hooks/exhaustive-deps

  // plates in the chosen print order (new plates keep their default spot)
  const arrange = useCallback((ps: Plate[]) => {
    const list = ps.map((p) => ({ ...p, name: names[p.key] || p.name, mesh: mesh[p.key] ?? p.mesh }));
    if (!orderKeys.length) return list;
    return [...list].sort((a, b) => { const x = orderKeys.indexOf(a.key), y = orderKeys.indexOf(b.key); return (x < 0 ? 999 : x) - (y < 0 ? 999 : y); });
  }, [orderKeys, names, mesh]);
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
      imgData.data.set(composite({ plates, w: res.w, h: res.h }, st.garment, new Set(plates.filter((p) => !hidden.has(p.key)).map((p) => p.key)), st.pressGain ?? PRESS_GAIN));
    }
    x.putImageData(imgData, 0, 0);
  }, [res, plates, hidden, solo, st.garment]);

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
    const f = filmBits({ ...p, alpha: a }, cw, ch, cw / ppi, st.dpi, { halftone: ht, lpi: st.lpi, angle: st.angle, dot: st.dot || "ellipse", mesh: p.mesh, within });
    c.width = f.W; c.height = f.H;
    const x = c.getContext("2d")!, d = x.createImageData(f.W, f.H), rb = Math.ceil(f.W / 8);
    for (let yy = 0; yy < f.H; yy++) for (let xx = 0; xx < f.W; xx++) { const on = f.bits[yy * rb + (xx >> 3)] & (0x80 >> (xx & 7)), o = (yy * f.W + xx) * 4; d.data[o] = d.data[o + 1] = d.data[o + 2] = on ? 0 : 255; d.data[o + 3] = 255; }
    x.putImageData(d, 0, 0);
  }, [loupe, solo, plates, res, st.widthIn, st.dpi, st.lpi, st.angle, st.dot, st.method]);

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
    const r = separate(px, inks.map((x) => ({ hex: x.hex, name: x.name })), sepOpts(st, px.w));
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
      const ws = spotMixer(inks.map((k) => ({ hex: k.hex, name: k.name })), st)(...(fill.match(/[0-9a-f]{2}/gi) || ["00", "00", "00"]).map((h) => parseInt(h, 16)) as [number, number, number]);
      const out: { plate: number; tint: number }[] = [];
      inks.forEach((k, j) => {
        if (ws[j] <= 0.02) return;
        const white = /^#F[A-F0-9]F[A-F0-9]F[A-F0-9]$/i.test(k.hex) || k.name === "White";
        const at = ps.findIndex((p) => p.key === (white && res?.underbase && st.highlight ? "hw" : "c" + k.hex.slice(1)));
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
    return illustratorPdf(hr.plates, hr.w, hr.h, { widthIn: st.widthIn, tonal, title, vector: vectorOut(hr.plates), solid: st.solidOut || "pixels", minDot: hr.plates.map((p) => minDot(p.mesh, st.lpi)) }, deflate);
  }
  /** for FilmMaker (or any RIP): one page per screen, each its own named spot color; the RIP makes the dots */
  async function ripFile() {
    const hr = await fullSep();
    setBusy("Making the RIP file…"); await new Promise((r) => setTimeout(r, 30));
    return ripPdf(hr.plates, hr.w, hr.h, { widthIn: st.widthIn, title, tonal, minDot: hr.plates.map((p) => minDot(p.mesh, st.lpi)),
      sub: (p) => `${p.kind === "underbase" ? "underbase, flash after" : p.kind === "highlight" ? "highlight white" : "color"} - mesh ${p.mesh} - ${tonal || p.tonal ? `halftone: ${st.lpi} lpi ${st.angle} deg` : "solid"} - print ${st.widthIn}" wide at 100%` }, deflate);
  }
  async function filmsFile() {
    const hr = await fullSep();
    setBusy("Making films…"); await new Promise((r) => setTimeout(r, 30));
    // where the art prints at all: halftone dots are cut only at the art's edge
    const within = new Uint8Array(hr.w * hr.h);
    for (const p of hr.plates) for (let j = 0; j < within.length; j++) if (p.alpha[j] > within[j]) within[j] = p.alpha[j];
    const pages = hr.plates.map((p, i) => {
      const ht = tonal || !!p.tonal;
      const f = filmBits(p, hr.w, hr.h, st.widthIn, st.dpi, { halftone: ht, lpi: st.lpi, angle: st.angle, dot: st.dot || "ellipse", mesh: p.mesh, within });
      return { ...f, widthIn: st.widthIn, heightIn: st.widthIn * (hr.h / hr.w), ink: `${p.name}  (${i + 1}/${hr.plates.length})`, label: `${title} - ${i + 1}/${hr.plates.length} ${p.name}`, sub: `${p.kind === "underbase" ? "Underbase (flash after)" : p.kind === "highlight" ? "Highlight white" : "Color"} - mesh ${p.mesh}${ht ? ` - ${st.lpi} lpi ${st.angle} deg ${DOT_NAME[st.dot || "ellipse"]} dot${(st.pressGain ?? PRESS_GAIN) ? ` - ${Math.round((st.pressGain ?? PRESS_GAIN) * 100)}% dot gain allowed for` : ""}` : " - solid"} - print ${st.widthIn}" wide at 100%` };
    });
    return filmPdf(pages);
  }
  async function save(status: SepRow["status"]) {
    if (!row || !res) return;
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
      const patch = { status, method: st.method, source: "studio", channels, files: [...keep, ...files], preview_path: `${base}/preview.png`, settings: { ...row.settings, ...st, inks, order: plates.map((p) => p.key), mesh, names }, updated_at: new Date().toISOString() };
      const r = await sb.from("separations").update(patch).eq("id", row.id).select("*").single();
      if (r.error) throw new Error(r.error.message);
      setRow(r.data as SepRow);
      setMsg(status === "review" ? "Saved and sent for review." : "Saved.");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy("");
  }
  async function approve() {
    if (!row) return;
    setBusy("Approving…");
    const now = new Date().toISOString();
    const r = await sb.from("separations").update({ status: "approved", approved_by: me.email, approved_at: now, updated_at: now }).eq("id", row.id).select("*").single();
    // screens and inks back on the order's imprint (the underbase is added by the schedule on dark shirts)
    if (row.order_id && row.imprint_id) {
      const { data: o } = await sb.from("orders").select("groups").eq("id", row.order_id).maybeSingle();
      const groups = ((o?.groups || []) as Group[]).map((g) => ({ ...g, imprints: g.imprints.map((im) => im.id !== row.imprint_id ? im : { ...im, colors: row.channels.filter((c) => c.kind !== "underbase").length || im.colors, inks: row.channels.filter((c) => c.kind !== "underbase").map((c) => c.name).join(", ") || im.inks }) }));
      if (groups.length) await sb.from("orders").update({ groups }).eq("id", row.order_id);
    }
    if (!r.error) setRow(r.data as SepRow);
    setBusy(""); setMsg(r.error ? r.error.message : "Approved. The order's imprint now shows these inks.");
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
  async function openFile(path: string) { const { data } = await sb.storage.from("proofs").createSignedUrl(path, 600); if (data?.signedUrl) window.open(data.signedUrl, "_blank"); }

  /* ---------- press setup: the plates on a press, in print order, the underbase just before a flash ---------- */
  const press = presses.find((m) => m.id === pressId) || presses[0];
  const onPress = useMemo(() => {
    if (!press) return null;
    const heads = press.colors + (press.issue?.full && press.issue.full > press.colors ? press.issue.full - press.colors : 0);
    const lay: Station[] = press.layout || Array.from({ length: heads }, (_, i): Station => (i === 1 ? "flash" : "print"));
    const out: ({ hex: string; name: string } | null)[] = lay.map(() => null);
    const printable = (i: number) => lay[i] === "print";
    let at = 0, note = "";
    const seq = [...plates];
    if (seq[0]?.kind === "underbase") {
      const f = lay.findIndex((s, i) => s === "flash" && i > 0 && printable(i - 1));
      if (f < 0) note = "No flash on this press: the underbase needs one right after it.";
      else { out[f - 1] = { hex: "#E9ECEF", name: `1 · ${seq[0].name} → flash on head ${f + 1}` }; seq.shift(); at = f + 1; }
    }
    let placed = 0;
    for (let k = 0; k < lay.length && seq.length; k++) { const i = (at + k) % lay.length; if (printable(i) && !out[i]) { const p = seq.shift()!; out[i] = { hex: p.hex, name: `${plates.indexOf(p) + 1} · ${p.name}` }; placed++; } }
    if (seq.length) note = `${plates.length} screens won't fit: ${lay.filter((s) => s === "print").length} print heads on ${press.name.split(" · ")[0]} (two rounds, or another press).`;
    return { lay, out, note, placed };
  }, [press, plates]);

  if (err && !row) return <div className="empty">{err}</div>;
  if (!row) return <div className="empty">Loading…</div>;
  const s0 = SEP_STATUS[row.status];
  const dark = isDark(st.garment);
  const garments = [...new Set(order ? orderGroups(order).find((g) => g.id === row.group_id)?.lines.map((l) => l.color).filter(Boolean) || [] : [])];

  return (
    <div className="sep">
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href="/shop/separations">Separations</Link> · S-{row.number}</div>
          <h1>{row.location || "Separation"}{order ? <span className="faint"> · #{order.number} {order.nickname || ""}</span> : null}</h1>
        </div>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <span className="pill" style={{ ["--sc" as string]: s0.c }}>{s0.label}</span>
          {order && <Link className="btn" href={`/shop/orders/${order.id}`}>Open Order</Link>}
          {!!(row.settings as { art?: SepArt }).art && row.status !== "approved" && row.status !== "films" && <label className="btn" title="Upload a different file (the inks are found again)"><input type="file" accept={ART_ACCEPT} hidden onChange={(e) => { replaceArt(e.target.files?.[0]); e.target.value = ""; }} />Replace Art</label>}
          {!row.order_id && row.status !== "cancelled" && row.status !== "films" && (cancelAsk
            ? <span className="sep-ask">Cancel this separation? <button type="button" className="btn sm" onClick={() => { setCancelAsk(false); setStatus("cancelled").then(() => location.assign("/shop/separations")); }}>Yes, Cancel</button> <button type="button" className="btn sm" onClick={() => setCancelAsk(false)}>No</button></span>
            : <button type="button" className="btn" onClick={() => setCancelAsk(true)}>Cancel</button>)}
        </div>
      </div>
      {msg && <div className="ms-toast" role="status"><span>{msg}</span><button type="button" aria-label="Dismiss" onClick={() => setMsg("")}>×</button></div>}
      {err && <div className="pv-err">{err}</div>}
      <div className="rv-seg sep-tabs">{([["studio", "Separate Here"], ["outside", "Separated Elsewhere (Separo…)"]] as const).map(([k, l]) => <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>

      {tab === "outside" ? <Outside row={row} origUrl={origUrl} onSaved={(r) => { setRow(r); setMsg("Uploaded and sent for review."); }} openFile={openFile} /> : hasArt === false ? <AddArt row={row} onDone={(r) => { setRow(r); load(); }} /> : (
      <div className="sep-grid">
        {/* settings */}
        <aside className="sep-side">
          <section className="sep-card">
            <h3>Method</h3>
            <div className="rv-seg sep-full">{([["spot", "Spot color"], ["sim", "Simulated process"]] as const).map(([k, l]) => <button key={k} type="button" className={st.method === k ? "on" : ""} onClick={() => { set({ method: k }); findInks(k, true); }}>{l}</button>)}</div>
            <p className="sep-help">{st.method === "spot" ? "Flat colors, solid screens. Logos, text, cartoon art." : "Photos and painted art: a few bright inks in halftones, mixed on the shirt."}</p>
            {vart && <div className={vart.ok ? "sep-ok" : "sep-tip"}>{vart.ok ? `Vector art (${vart.shapes.length} shapes): the Illustrator file keeps the original shapes for each ink.` : `Vector art, but it ${vart.why}: the plates are traced from a picture of it instead.`}</div>}
            {st.method === "spot" && hint > 0.18 && inks.length >= natural && <div className="sep-tip">This art has a lot of shading ({Math.round(hint * 100)}% between colors). <button type="button" className="linkbtn" onClick={() => { set({ method: "sim" }); findInks("sim", true); }}>Try simulated process</button></div>}
          </section>
          <section className="sep-card">
            <h3>Shirt</h3>
            <div className="sep-row">
              <input type="color" value={st.garment} onChange={(e) => set({ garment: e.target.value.toUpperCase() })} aria-label="Shirt color" />
              <select value="" onChange={(e) => e.target.value && set({ garment: colorHex(e.target.value) || guessHex(e.target.value) })} aria-label="Shirt color from the order">
                <option value="">{garments.length ? "From the order…" : "Pick a color…"}</option>
                {[...garments, "Black", "White", "Navy", "Red", "Royal", "Charcoal", "Sport Grey", "Forest Green", "Maroon"].filter((x, i, a) => a.indexOf(x) === i).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <label className="sep-chk"><input type="checkbox" checked={st.dropGarment} onChange={(e) => set({ dropGarment: e.target.checked })} /> Let the shirt be colors that match it</label>
          </section>
          <section className="sep-card">
            <h3>Finding inks</h3>
            <label className="sep-f">Ink names<select value={st.lib} onChange={(e) => { const lib = e.target.value as Studio["lib"]; set({ lib }); setInks((l) => l.map((x) => ({ ...x, name: inkName(x.hex, lib) }))); }} title="Names every ink again"><option value="auto">Suggested</option><option value="wilflex">All standard</option><option value="pms">All PMS</option></select></label>
            <p className="sep-help">{st.lib === "auto" ? "Suggested: a standard (stock) ink when one is very close, a PMS when only the PMS is. Tap an ink's match line to see both." : st.lib === "wilflex" ? "Every ink named as the closest Wilflex RFU stock ink." : "Every ink named as the closest PMS coated color."}</p>
            <button type="button" className="btn sm" onClick={() => findInks(st.method, true)} title="Start over: find the inks the art needs">Find Inks Again</button>
          </section>
          <section className="sep-card">
            <h3>Underbase{dark ? "" : " (light shirt)"}</h3>
            <div className="rv-seg sep-full">{([["auto", "Auto"], ["on", "On"], ["off", "Off"]] as const).map(([k, l]) => <button key={k} type="button" className={st.underbase === k ? "on" : ""} onClick={() => set({ underbase: k })}>{l}</button>)}</div>
            <label className="sep-f" title="How far the underbase is pulled in from the edges of the colors, so it never peeks out">Choke <input type="range" min={0} max={3} step={0.25} value={st.chokePt ?? CHOKE_PT} onChange={(e) => set({ chokePt: +e.target.value })} /> <b>{st.chokePt ?? CHOKE_PT} pt</b></label>
            {(() => { const on = (st.finePt ?? FINE_PT) > 0; return (<div className="sep-fine">
              <label className="sep-chk" title="Small type and thin lines (sponsor backs): the full choke would thin their base to nothing. There the base is choked only a little and the color on top is made a little fatter instead, so it still covers the white."><input type="checkbox" checked={on} onChange={(e) => set({ finePt: e.target.checked ? FINE_PT : 0 })} /> Small type &amp; thin lines</label>
              {on && <>
                <label className="sep-f" title="Parts of the art thinner than this count as fine detail">Thinner than <input type="range" min={0.5} max={4} step={0.25} value={st.finePt ?? FINE_PT} onChange={(e) => set({ finePt: +e.target.value })} /> <b>{st.finePt ?? FINE_PT} pt</b></label>
                <label className="sep-f" title="How far the base is pulled in on fine detail (instead of the full choke)">Base choke there <input type="range" min={0} max={Math.max(0.25, st.chokePt ?? CHOKE_PT)} step={0.05} value={Math.min(st.fineChokePt ?? FINE_CHOKE_PT, st.chokePt ?? CHOKE_PT)} onChange={(e) => set({ fineChokePt: +e.target.value })} /> <b>{Math.min(st.fineChokePt ?? FINE_CHOKE_PT, st.chokePt ?? CHOKE_PT)} pt</b></label>
                <label className="sep-f" title="How much fatter the color on top is made on fine detail (a stroke on the top color), so it covers the white's edge">Color fatter <input type="range" min={0} max={1} step={0.05} value={st.bumpPt ?? BUMP_PT} onChange={(e) => set({ bumpPt: +e.target.value })} /> <b>{st.bumpPt ?? BUMP_PT} pt</b></label>
              </>}
            </div>); })()}
            <label className="sep-chk"><input type="checkbox" checked={st.highlight} onChange={(e) => set({ highlight: e.target.checked })} /> Highlight white on top</label>
            <label className="sep-chk"><input type="checkbox" checked={st.removeBg} onChange={(e) => set({ removeBg: e.target.checked })} /> White background isn&apos;t printed</label>
          </section>
          <section className="sep-card">
            <h3>Output</h3>
            <label className="sep-f">Print width (in)<input type="number" min={1} max={20} step={0.25} value={st.widthIn} onChange={(e) => set({ widthIn: +e.target.value || 1 })} /></label>
            {img && (() => {
              // pictures can't be blown up (Separo can't either): say how sharp the art is at this print size
              if (vart?.ok) return <div className="sep-res ok">Vector art: sharp at any size.</div>;
              const ppi = Math.round((img.naturalWidth || 0) / st.widthIn), best = Math.floor((img.naturalWidth || 0) / 300 * 4) / 4;
              const lvl = ppi >= 250 ? "ok" : ppi >= 150 ? "warn" : "bad";
              return <div className={"sep-res " + lvl}>Art is {img.naturalWidth} px wide: <b>{ppi} ppi</b> at {st.widthIn}&quot;. {lvl === "ok" ? "Sharp." : lvl === "warn" ? `Usable; edges soften a little past ${best}" (300 ppi).` : `Too small for ${st.widthIn}": it will print pixelated. Up to ${best}" is sharp; get bigger art or vector (SVG / EPS)${st.method === "spot" ? ", or try Smooth vector for solid inks" : ""}.`}</div>;
            })()}
            {(tonal || plates.some((p) => p.tonal)) && <><label className="sep-f">Halftone LPI<input type="number" min={25} max={85} value={st.lpi} onChange={(e) => set({ lpi: +e.target.value || 55 })} /></label><label className="sep-f">Angle<input type="number" min={0} max={90} step={0.5} value={st.angle} onChange={(e) => set({ angle: +e.target.value })} /></label>
              <label className="sep-f" title="Elliptical: neighbors join near 40% one way and 60% the other, so midtones don't jump (the usual pick for screen printing). Round: joins at 78%. Square: all four corners join at 50%.">Dot<select value={st.dot || "ellipse"} onChange={(e) => set({ dot: e.target.value as Studio["dot"] })}><option value="ellipse">Elliptical</option><option value="round">Round</option><option value="square">Square</option></select></label>
              {(() => {
                // a halftone needs about 4 threads per dot (mesh ≥ 4 × LPI), and dots smaller than a thread and an opening wash out
                const ht = plates.filter((p) => tonal || p.tonal), low = ht.filter((p) => p.mesh < st.lpi * 4);
                const mds = ht.map((p) => Math.round(minDot(p.mesh, st.lpi) * 100)), lo = Math.min(...mds), hi = Math.max(...mds);
                return <div className={"sep-res " + (low.length ? "warn" : "ok")}>{low.length ? <>Mesh too open for {st.lpi} lpi on {low.map((p) => p.name).join(", ")}: use {Math.ceil((st.lpi * 4) / 10) * 10}+ mesh or a lower LPI.</> : <>Mesh fits {st.lpi} lpi.</>} Smallest dot the mesh holds: {lo === hi ? `${lo}%` : `${lo}–${hi}%`} (lighter tones drop out; the films print whole dots, none too small to hold).</div>;
              })()}</>}
            {st.method === "spot" && <label className="sep-f" title="Each color spreads this far under the darker color printed after it, so colors that touch overlap a hair (no gaps if a screen is a little off). Keep it small on based colors; 0 = colors just touch. Black never spreads onto the white base.">Trap <input type="range" min={0} max={2} step={0.25} value={st.trapPt ?? TRAP_PT} onChange={(e) => set({ trapPt: +e.target.value })} /> <b>{st.trapPt ?? TRAP_PT} pt</b></label>}
            {st.method === "spot" && !vart?.ok && <label className="sep-f" title="Pixels: the art's own pixels at full size, like Separo. Smooth vector: traced curves, for low-resolution art.">Solid inks<select value={st.solidOut || "pixels"} onChange={(e) => set({ solidOut: e.target.value as Studio["solidOut"] })}><option value="pixels">Pixels (exact)</option><option value="vector">Smooth vector</option></select></label>}
            {(tonal || plates.some((p) => p.tonal)) && <label className="sep-f" title="Halftone dots print bigger than on the film (at 15% a 50% dot prints about 65%). The halftone plates are made that much lighter so they print as the art, and the proof shows how it prints. Pick None if your RIP adds its own dot gain curve (FilmMaker: a Press Calibration curve that isn't straight). Use one or the other, not both.">Dot gain on press<select value={st.pressGain ?? PRESS_GAIN} onChange={(e) => set({ pressGain: +e.target.value })}>{[0, 0.1, 0.15, 0.2, 0.25, 0.3].map((g) => <option key={g} value={g}>{g ? `${Math.round(g * 100)}%` : "None (RIP does it)"}</option>)}</select></label>}
            <label className="sep-f">Film DPI<select value={st.dpi} onChange={(e) => set({ dpi: +e.target.value })}>{[360, 600, 720, 1200, 1440].map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
          </section>
        </aside>

        {/* preview */}
        <section className="sep-main">
          {/* the inks, big, like Separo: art color → ink, click the name to change it */}
          <div className="sep-inkbar">
            {inks.map((k, i) => (
              <div key={k.hex + i} className={"sep-chip" + (res?.dropped.includes(k.hex) ? " shirt" : "")} title={res?.dropped.includes(k.hex) ? "Matches the shirt: not printed (the shirt shows through)" : undefined}>
                <span className="sep-chip-sw" style={{ background: shown(k) }} title={`In the art: ${k.hex}`}><i style={{ background: k.hex }} /></span>
                <input list="sep-inklist" value={k.name} onChange={(e) => setInks((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Ink" data-notranslate />
                {(() => { const m = vart?.shapes.some((sh) => sh.ink === k.name) ? { kind: "Swatch", word: "from the art", dE: 0 } : inkKind(k.name, k.hex); return (
                  <button type="button" className={"sep-chip-m" + (matchAt === i ? " on" : "") + (m ? " q-" + (m.kind === "Swatch" ? "exact" : m.word.replace(/ /g, "-")) : "")} onClick={() => setMatchAt(matchAt === i ? null : i)} title="Standard ink or PMS: see both and pick">
                    {m ? <>{m.kind} · {m.word}</> : "Pick an ink"}
                  </button>
                ); })()}
                <button type="button" className="sep-chip-x" onClick={() => { setMatchAt(null); setInks((l) => l.filter((_, j) => j !== i)); }} aria-label={`Remove ${k.name}`} title="Remove (its part of the art goes to the nearest other ink)">×</button>
              </div>
            ))}
            <button type="button" className={"sep-add" + (pick ? " on" : "")} onClick={() => setPick(!pick)} title="Add an ink: click a color in the art">{pick ? "Click the art" : "+"}</button>
            <span className="spacer" />
            <label className="sep-count">Colors <select value={st.maxColors} onChange={(e) => { set({ maxColors: +e.target.value }); }}>{Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <button type="button" className="btn sm" onClick={() => findInks()} title="Separate with this many inks. Fewer than the art has: the colors left out are mixed from the other inks as halftones.">Apply</button>
          </div>
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
          <div className={"sep-stage" + (bg === "checker" && !solo ? " checker" : "")} style={{ background: solo ? "#fff" : bg === "shirt" ? st.garment : undefined }}>
            <div className="sep-canvases">
              <canvas ref={cv} className={(pick ? "pick " : solo ? "zoom " : "") + (view === "original" && !solo ? "gone" : "")} onClick={onPick} />
              <canvas ref={cvOrig} className={"sep-orig" + (view === "proof" || solo ? " gone" : "")} style={view === "compare" && !solo ? { clipPath: `inset(0 ${100 - split}% 0 0)` } : undefined} onClick={onPick} />
              {view === "compare" && !solo && <input className="sep-split" type="range" min={0} max={100} value={split} onChange={(e) => setSplit(+e.target.value)} aria-label="Original | proof" />}
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
          <div className="sep-legend faint">{solo ? <>Film for <b>{plates.find((p) => p.key === solo)?.name}</b> (black = ink). Click it for a close-up of the real film. <button type="button" className="linkbtn" onClick={() => { setSolo(null); setLoupe(null); }}>Back to the proof</button></> : view === "compare" ? <>Left of the line: the original art. Right: how it prints.</> : <>{view === "original" ? "The original art" : "Soft proof: how it prints"}{bg === "shirt" ? ` on a ${st.garment} shirt` : ""} · {plates.length} screen{plates.length === 1 ? "" : "s"}{res?.dropped.length ? ` · ${res.dropped.length} color${res.dropped.length === 1 ? "" : "s"} left to the shirt` : ""}</>}</div>
        </section>

        {/* plates, press, save */}
        <aside className="sep-side">
          <section className="sep-card">
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
                  {" "}· mesh <input className="sep-mesh" type="number" value={p.mesh} onChange={(e) => setMesh((m) => ({ ...m, [p.key]: +e.target.value }))} aria-label="Mesh" /></small>
                <span className="sep-pa">
                  <button type="button" className="btn icon ghost sm" title="Show / hide on the shirt" onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(p.key)) n.delete(p.key); else n.add(p.key); return n; })}>{hidden.has(p.key) ? "◌" : "●"}</button>
                  <button type="button" className="btn icon ghost sm" title="See this film" onClick={() => setSolo(solo === p.key ? null : p.key)}>▣</button>
                  <button type="button" className="btn icon ghost sm" title="Print earlier" disabled={!i} onClick={() => { const k = plates.map((q) => q.key); [k[i - 1], k[i]] = [k[i], k[i - 1]]; setOrderKeys(k); }}>↑</button>
                </span>
              </li>
            ))}</ol>
          </section>
          {onPress && press && (
            <section className="sep-card">
              <h3>On the press</h3>
              <select value={press.id} onChange={(e) => setPressId(e.target.value)} aria-label="Press">{presses.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
              <div className="sep-press"><PressLayout layout={onPress.lay} size={220} mirror={!!press.mirror} inks={onPress.out} /></div>
              {onPress.note ? <div className="sep-tip">{onPress.note}</div> : <p className="sep-help">Colored heads show which screen goes where (hover for the plate). Move flashes in Equipment Status.</p>}
            </section>
          )}
          <section className="sep-card">
            <h3>Save</h3>
            <div className="sep-actions">
              <button type="button" className="btn" disabled={!res || !!busy} onClick={() => save("in_progress")}>Save Draft</button>
              <button type="button" className="btn primary" disabled={!res || !!busy} onClick={() => save("review")}>Save &amp; Send for Review</button>
              {me.boss && row.status === "review" && <button type="button" className="btn primary" disabled={!!busy} onClick={approve}>Approve</button>}
              {row.status === "approved" && <button type="button" className="btn" onClick={() => setStatus("films")}>Films Printed</button>}
            </div>
            <div className="sep-dl">
              <button type="button" className="linkbtn" disabled={!res || !!busy} onClick={async () => { try { setErr(""); download(await aiFile(), `${slug(title)}-seps.pdf`); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } setBusy(""); }}>Illustrator file (spot colors)</button>
              <button type="button" className="linkbtn" disabled={!res || !!busy} onClick={async () => { try { setErr(""); download(await filmsFile(), `${slug(title)}-films.pdf`); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } setBusy(""); }}>Films PDF ({st.dpi} dpi{tonal || plates.some((p) => p.tonal) ? `, ${st.lpi} lpi` : ""})</button>
              <button type="button" className="linkbtn" disabled={!res || !!busy} title="For FilmMaker (or any RIP): one page per screen, each its own spot color, with marks and the ink name. FilmMaker makes the halftone dots with its own settings per ink." onClick={async () => { try { setErr(""); download(await ripFile(), `${slug(title)}-filmmaker.pdf`); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } setBusy(""); }}>FilmMaker / RIP file (one page per screen)</button>
            </div>
            {(row.files || []).length > 0 && <ul className="sep-files">{row.files.filter((f) => f.kind !== "plate").map((f) => <li key={f.path}><button type="button" className="linkbtn" onClick={() => openFile(f.path)}>{f.name}</button></li>)}</ul>}
            <p className="sep-help">The Illustrator file opens straight in Illustrator: each ink is a spot color swatch, so File → Print → Separations prints one film per ink.{img && !vart ? ` Files are made from the art at full size: ${outSize().ppi} pixels per inch at ${st.widthIn}" wide${outSize().ppi < 200 ? " (low: consider Smooth vector for solid inks, or better art)" : ""}.` : vart?.ok ? " Vector art: the original shapes, sharp at any size." : ""}</p>
          </section>
        </aside>
      </div>
      )}
    </div>
  );
}

import { WILFLEX_HEX as WILFLEX_NAMES } from "@/lib/inkColors";
import { PMS_COATED } from "@/lib/pms";
const PMS_NAMES = Object.keys(PMS_COATED);

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
function Outside({ row, origUrl, onSaved, openFile }: { row: SepRow; origUrl: string; onSaved: (r: SepRow) => void; openFile: (p: string) => void }) {
  const sb = useMemo(() => createClient(), []);
  const [files, setFiles] = useState<File[]>([]);
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
      const channels: Channel[] = names.map((n, i) => ({ key: "u" + i, name: n, hex: colorHex(n) || "#999999", kind: /base|underbase/i.test(n) ? "underbase" : /highlight/i.test(n) ? "highlight" : "color", order: i + 1, mesh: /base/i.test(n) ? 156 : 230, coverage: 0 }));
      const r = await sb.from("separations").update({ status: "review", method: "outside", source: src, channels, files: [...(row.files || []), ...added], updated_at: new Date().toISOString() }).eq("id", row.id).select("*").single();
      if (r.error) throw new Error(r.error.message);
      setFiles([]); onSaved(r.data as SepRow);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  return (
    <div className="sep-outside">
      <section className="sep-card">
        <h3>1. Get the art</h3>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {origUrl ? <a className="btn" href={origUrl} target="_blank" rel="noreferrer">Download the Art</a> : <span className="faint">No art on this imprint.</span>}
          <a className="btn" href="https://separo.io" target="_blank" rel="noreferrer">Open Separo ↗</a>
        </div>
      </section>
      <section className="sep-card">
        <h3>2. Upload what came back</h3>
        <label className="sep-f">From<input value={src} onChange={(e) => setSrc(e.target.value)} /></label>
        <label className="tmx-drop"><input type="file" multiple accept=".eps,.pdf,.ai,.psd,.tif,.tiff,.png,.zip" onChange={(e) => setFiles([...(e.target.files || [])])} /><b>{files.length ? files.map((f) => f.name).join(", ") : "Choose files (EPS, PDF, AI, PSD, TIFF, PNG, ZIP)"}</b></label>
        <label className="sep-f">Inks, in print order (one per line)<textarea rows={6} value={inkText} onChange={(e) => setInkText(e.target.value)} placeholder={"Underbase\n7405 C\n2347 C\n288 C\nHighlight White\nBlack"} /></label>
        {err && <div className="pv-err">{err}</div>}
        <button type="button" className="btn primary" disabled={busy || (!files.length && !inkText.trim())} onClick={save}>{busy ? "Uploading…" : "Save & Send for Review"}</button>
      </section>
      {(row.files || []).some((f) => f.kind === "upload") && <section className="sep-card"><h3>Uploaded</h3><ul className="sep-files">{row.files.filter((f) => f.kind === "upload").map((f) => <li key={f.path}><button type="button" className="linkbtn" onClick={() => openFile(f.path)}>{f.name}</button></li>)}</ul></section>}
    </div>
  );
}
