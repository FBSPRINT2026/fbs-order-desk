"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import { orderGroups, type Design, type Group, type Order } from "@/lib/pricing";
import { DEFAULT_SEP, composite, filmBits, findColors, findSimInks, gradientShare, isDark, separate, snapInk, type Plate, type Px, type SepInk, type SepResult, type SepSettings } from "@/lib/separate";
import { closestPms, colorHex } from "@/lib/inkColors";
import { guessHex } from "@/lib/mockup";
import { filmPdf, deflate } from "@/lib/filmPdf";
import { illustratorPdf } from "@/lib/illustratorPdf";
import { parseSvg, type VArt } from "@/lib/svgVector";
import { parseEps, vartSvg } from "@/lib/epsVector";
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

type Studio = SepSettings & { widthIn: number; lpi: number; angle: number; dpi: number; removeBg: boolean; lib: "wilflex" | "pms" };
const MAX_SIDE = 2400;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "plate";
const inkName = (hex: string, lib: Studio["lib"]) => {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (r > 238 && g > 238 && b > 238) return "White";
  if (r < 30 && g < 30 && b < 30) return "Black";
  return lib === "pms" ? closestPms(hex).name : snapInk(hex).name;
};
const shown = (ink: SepInk) => colorHex(ink.name) || ink.hex;

/** the art as pixels, at most MAX_SIDE on the long side; a white background around the art becomes transparent */
function pixelsOf(img: HTMLImageElement, removeBg: boolean, vector = false): Px {
  // vector art is drawn big (an SVG's own size is often tiny); photos are never blown up
  const k = vector ? MAX_SIDE / Math.max(img.naturalWidth || 1, img.naturalHeight || 1) : Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!; x.drawImage(img, 0, 0, w, h);
  const data = x.getImageData(0, 0, w, h).data;
  if (removeBg) {
    // flood from the edges through near-white, opaque pixels
    const near = (i: number) => data[i * 4 + 3] > 200 && data[i * 4] > 242 && data[i * 4 + 1] > 242 && data[i * 4 + 2] > 242;
    const seen = new Uint8Array(w * h), q: number[] = [];
    for (let i = 0; i < w; i++) { q.push(i, (h - 1) * w + i); }
    for (let j = 0; j < h; j++) { q.push(j * w, j * w + w - 1); }
    while (q.length) {
      const i = q.pop()!; if (seen[i] || !near(i)) continue; seen[i] = 1; data[i * 4 + 3] = 0;
      const xx = i % w, yy = (i / w) | 0;
      if (xx > 0) q.push(i - 1); if (xx < w - 1) q.push(i + 1); if (yy > 0) q.push(i - w); if (yy < h - 1) q.push(i + w);
    }
  }
  return { w, h, data };
}
/** art uploaded straight to a separation (no order): kept in its folder, remembered in settings.art */
export type SepArt = { path: string; name: string; type: string; preview?: string };
export const ART_ACCEPT = ".png,.jpg,.jpeg,.webp,.svg,.eps,image/png,image/jpeg,image/webp,image/svg+xml,application/postscript";
export const ART_KINDS = "PNG, JPG, WebP, SVG or Illustrator EPS";
const isEps = (name: string, type = "") => /postscript|eps/i.test(type) || /\.eps$/i.test(name);
export const artOk = (f: File) => /^image\/(png|jpe?g|webp|svg\+xml)$/i.test(f.type) || /\.(png|jpe?g|webp|svg|eps)$/i.test(f.name);
/** null when the file can be separated, else why not (an EPS has to be flat filled shapes) */
export async function artProblem(f: File): Promise<string | null> {
  if (!artOk(f)) return `Use a ${ART_KINDS}. (AI or PDF: in Illustrator, File → Save As → EPS or Export → SVG / PNG.)`;
  if (!isEps(f.name, f.type)) return null;
  const v = parseEps(await f.text());
  return v.ok ? null : `This EPS ${v.why}. Fix that in Illustrator, or save it as SVG or PNG.`;
}
export async function uploadSepArt(sb: ReturnType<typeof createClient>, id: string, f: File): Promise<SepArt> {
  const stamp = Date.now(), path = `separations/${id}/art-${stamp}-${f.name.replace(/[^\w.-]+/g, "_")}`;
  const eps = isEps(f.name, f.type);
  const type = f.type || (/\.svg$/i.test(f.name) ? "image/svg+xml" : eps ? "application/postscript" : "application/octet-stream");
  const r = await sb.storage.from("proofs").upload(path, f, { upsert: true, contentType: type });
  if (r.error) throw new Error(r.error.message);
  const art: SepArt = { path, name: f.name, type };
  if (eps) {
    // a picture of it for the list (the Studio reads the EPS itself)
    const v = parseEps(await f.text());
    if (v.ok) { const pv = `separations/${id}/art-${stamp}-preview.svg`; const u = await sb.storage.from("proofs").upload(pv, new Blob([vartSvg(v)], { type: "image/svg+xml" }), { upsert: true, contentType: "image/svg+xml" }); if (!u.error) art.preview = pv; }
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
  const [st, setSt] = useState<Studio>({ ...DEFAULT_SEP, widthIn: 11, lpi: 55, angle: 22.5, dpi: 600, removeBg: true, lib: "wilflex" });
  const [inks, setInks] = useState<SepInk[]>([]);
  const [res, setRes] = useState<SepResult | null>(null);
  const [orderKeys, setOrderKeys] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [solo, setSolo] = useState<string | null>(null);
  const [mesh, setMesh] = useState<Record<string, number>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [presses, setPresses] = useState<Machine[]>([]);
  const [pressId, setPressId] = useSticky("sep.press", "");
  const [pick, setPick] = useState(false);
  const [cancelAsk, setCancelAsk] = useState(false);
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
    if (des && isEps(des.file_name || des.file_path, des.file_type || "")) {
      const [{ data: ev }, { data: su }] = await Promise.all([sb.storage.from("proofs").download(des.file_path), sb.storage.from("proofs").createSignedUrl(des.file_path, 3600)]);
      setOrigUrl(su?.signedUrl || "");
      const v = ev ? parseEps(await ev.text()) : null;
      if (v?.ok) { setVart(v); setArtUrl(URL.createObjectURL(new Blob([vartSvg(v)], { type: "image/svg+xml" }))); return; }
      if (!des.preview_path) { setErr(`This EPS ${v?.why || "couldn't be read"}. Fix that in Illustrator, or upload it as SVG or PNG.`); setHasArt(false); return; }
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
  const findInks = useCallback((method = st.method) => {
    const px = pxRef.current; if (!px) return;
    // sim tries every candidate ink against the whole art (a few seconds): let the page say so first
    setBusy("Finding inks…");
    setTimeout(() => {
      const f = method === "sim" ? findSimInks(px, st.garment, st.maxColors) : findColors(px, st.maxColors);
      setInks(f.map((x) => ({ hex: x.hex, name: inkName(x.hex, st.lib) })));
      setOrderKeys([]); setNames({}); setHidden(new Set()); setBusy("");
    }, 30);
  }, [st.method, st.garment, st.maxColors, st.lib]);
  const hint = useMemo(() => { const px = pxRef.current; if (!px || !inks.length || st.method === "sim") return 0; return gradientShare(px, inks.map((k) => k.hex)); }, [pxTick, inks, st.method]);
  useEffect(() => { if (pxTick && !inks.length) findInks(); }, [pxTick]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- separate (a moment after anything changes) ---------- */
  useEffect(() => {
    const px = pxRef.current; if (!px || !inks.length) return;
    setBusy("Separating…");
    const t = setTimeout(() => {
      const r = separate(px, inks.map((k) => ({ hex: k.hex, name: k.name })), st);
      // show the ink's real color, not the art's
      r.plates.forEach((p) => { const k = inks.find((x) => "c" + x.hex.slice(1) === p.key); if (k) p.hex = shown(k); });
      setRes(r); setBusy("");
    }, 60);
    return () => clearTimeout(t);
  }, [pxTick, inks, st.method, st.garment, st.underbase, st.choke, st.highlight, st.dropGarment]); // eslint-disable-line react-hooks/exhaustive-deps

  // plates in the chosen print order (new plates keep their default spot)
  const plates = useMemo(() => {
    if (!res) return [];
    const list = res.plates.map((p) => ({ ...p, name: names[p.key] || p.name, mesh: mesh[p.key] ?? p.mesh }));
    if (!orderKeys.length) return list;
    return [...list].sort((a, b) => { const x = orderKeys.indexOf(a.key), y = orderKeys.indexOf(b.key); return (x < 0 ? 999 : x) - (y < 0 ? 999 : y); });
  }, [res, orderKeys, names, mesh]);

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
      imgData.data.set(composite({ plates, w: res.w, h: res.h }, st.garment, new Set(plates.filter((p) => !hidden.has(p.key)).map((p) => p.key))));
    }
    x.putImageData(imgData, 0, 0);
  }, [res, plates, hidden, solo, st.garment]);

  useEffect(() => {
    const c = cvOrig.current, px = pxRef.current; if (!c || !px) return;
    c.width = px.w; c.height = px.h;
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.w, px.h), 0, 0);
  }, [pxTick, view]);

  // eyedropper: click the preview to add that color from the art as an ink
  const onPick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!pick) return;
    const px = pxRef.current, c = cv.current; if (!px || !c) return;
    const r = c.getBoundingClientRect(), x = Math.floor(((e.clientX - r.left) / r.width) * px.w), y = Math.floor(((e.clientY - r.top) / r.height) * px.h);
    const o = (y * px.w + x) * 4; if (px.data[o + 3] < 128) { setMsg("That spot is the shirt (no art there)."); return; }
    const hex = "#" + [px.data[o], px.data[o + 1], px.data[o + 2]].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
    setInks((l) => [...l, { hex, name: inkName(hex, st.lib) }]); setPick(false);
  };

  /* ---------- outputs ---------- */
  const title = `${order ? `#${order.number}` : `S-${row?.number ?? ""}`} ${row?.location || ""}`.trim();
  const tonal = st.method === "sim";
  // spot color on vector art: each original shape goes on the plate of the ink its color maps to
  const vectorOut = vart?.ok && !tonal ? {
    art: vart,
    plateOf: (fill: string) => {
      let best = -1, bd = Infinity;
      inks.forEach((k, j) => { const d = deltaE(fill, k.hex); if (d < bd) { bd = d; best = j; } });
      if (best < 0) return null;
      const k = inks[best], white = /^#F[A-F0-9]F[A-F0-9]F[A-F0-9]$/i.test(k.hex) || k.name === "White";
      const key = white && res?.underbase && st.highlight ? "hw" : "c" + k.hex.slice(1);
      const at = plates.findIndex((p) => p.key === key);
      return at < 0 ? null : at;
    },
  } : undefined;
  async function aiFile() { return illustratorPdf(plates, res!.w, res!.h, { widthIn: st.widthIn, tonal, title, vector: vectorOut }, deflate); }
  async function filmsFile() {
    const pages = plates.map((p, i) => {
      const f = filmBits(p, res!.w, res!.h, st.widthIn, st.dpi, tonal, st.lpi, st.angle);
      return { ...f, widthIn: st.widthIn, heightIn: st.widthIn * (res!.h / res!.w), label: `${title} - ${i + 1}/${plates.length} ${p.name}`, sub: `${p.kind === "underbase" ? "Underbase (flash after)" : p.kind === "highlight" ? "Highlight white" : "Color"} - mesh ${p.mesh}${tonal ? ` - ${st.lpi} lpi ${st.angle} deg` : " - solid"} - print ${st.widthIn}" wide at 100%` };
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
            <div className="rv-seg sep-full">{([["spot", "Spot color"], ["sim", "Simulated process"]] as const).map(([k, l]) => <button key={k} type="button" className={st.method === k ? "on" : ""} onClick={() => { set({ method: k }); findInks(k); }}>{l}</button>)}</div>
            <p className="sep-help">{st.method === "spot" ? "Flat colors, solid screens. Logos, text, cartoon art." : "Photos and painted art: a few bright inks in halftones, mixed on the shirt."}</p>
            {vart && <div className={vart.ok ? "sep-ok" : "sep-tip"}>{vart.ok ? `Vector art (${vart.shapes.length} shapes): the Illustrator file keeps the original shapes for each ink.` : `Vector art, but it ${vart.why}: the plates are traced from a picture of it instead.`}</div>}
            {st.method === "spot" && hint > 0.18 && <div className="sep-tip">This art has a lot of shading ({Math.round(hint * 100)}% between colors). <button type="button" className="linkbtn" onClick={() => { set({ method: "sim" }); findInks("sim"); }}>Try simulated process</button></div>}
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
            <label className="sep-f">Ink names<select value={st.lib} onChange={(e) => set({ lib: e.target.value as Studio["lib"] })}><option value="wilflex">Wilflex RFU</option><option value="pms">PMS</option></select></label>
            <button type="button" className="btn sm" onClick={() => findInks()}>Find Inks Again</button>
          </section>
          <section className="sep-card">
            <h3>Underbase{dark ? "" : " (light shirt)"}</h3>
            <div className="rv-seg sep-full">{([["auto", "Auto"], ["on", "On"], ["off", "Off"]] as const).map(([k, l]) => <button key={k} type="button" className={st.underbase === k ? "on" : ""} onClick={() => set({ underbase: k })}>{l}</button>)}</div>
            <label className="sep-f">Choke <input type="range" min={0} max={6} value={st.choke} onChange={(e) => set({ choke: +e.target.value })} /> <b>{st.choke}px</b></label>
            <label className="sep-chk"><input type="checkbox" checked={st.highlight} onChange={(e) => set({ highlight: e.target.checked })} /> Highlight white on top</label>
            <label className="sep-chk"><input type="checkbox" checked={st.removeBg} onChange={(e) => set({ removeBg: e.target.checked })} /> White background isn&apos;t printed</label>
          </section>
          <section className="sep-card">
            <h3>Output</h3>
            <label className="sep-f">Print width (in)<input type="number" min={1} max={20} step={0.25} value={st.widthIn} onChange={(e) => set({ widthIn: +e.target.value || 1 })} /></label>
            {tonal && <><label className="sep-f">Halftone LPI<input type="number" min={25} max={85} value={st.lpi} onChange={(e) => set({ lpi: +e.target.value || 55 })} /></label><label className="sep-f">Angle<input type="number" min={0} max={90} step={0.5} value={st.angle} onChange={(e) => set({ angle: +e.target.value })} /></label></>}
            <label className="sep-f">Film DPI<select value={st.dpi} onChange={(e) => set({ dpi: +e.target.value })}>{[360, 600, 720].map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
          </section>
        </aside>

        {/* preview */}
        <section className="sep-main">
          {/* the inks, big, like Separo: art color → ink, click the name to change it */}
          <div className="sep-inkbar">
            {inks.map((k, i) => (
              <div key={k.hex + i} className={"sep-chip" + (res?.dropped.includes(k.hex) ? " shirt" : "")} title={res?.dropped.includes(k.hex) ? "Matches the shirt: not printed (the shirt shows through)" : undefined}>
                <span className="sep-chip-sw" style={{ background: shown(k) }} title={`In the art: ${k.hex}`}><i style={{ background: k.hex }} /></span>
                <input list="sep-inklist" value={k.name} onChange={(e) => setInks((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Ink" />
                <button type="button" className="sep-chip-x" onClick={() => setInks((l) => l.filter((_, j) => j !== i))} aria-label={`Remove ${k.name}`} title="Remove (its part of the art goes to the nearest other ink)">×</button>
              </div>
            ))}
            <button type="button" className={"sep-add" + (pick ? " on" : "")} onClick={() => setPick(!pick)} title="Add an ink: click a color in the art">{pick ? "Click the art" : "+"}</button>
            <span className="spacer" />
            <label className="sep-count">Colors <select value={st.maxColors} onChange={(e) => { set({ maxColors: +e.target.value }); }}>{Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <button type="button" className="btn sm" onClick={() => findInks()} title="Find the inks again with this many colors">Apply</button>
          </div>
          <datalist id="sep-inklist">{[...Object.keys(WILFLEX_NAMES), ...PMS_NAMES].map((n) => <option key={n} value={n} />)}</datalist>
          <div className="sep-vbar">
            <div className="rv-seg">{([["proof", "Proof"], ["compare", "Compare"], ["original", "Original"]] as const).map(([k, l]) => <button key={k} type="button" className={view === k ? "on" : ""} onClick={() => { setView(k); setSolo(null); }}>{l}</button>)}</div>
            <div className="rv-seg">{([["shirt", "On the shirt"], ["checker", "Transparent"]] as const).map(([k, l]) => <button key={k} type="button" className={bg === k ? "on" : ""} onClick={() => setBg(k)}>{l}</button>)}</div>
          </div>
          <div className={"sep-stage" + (bg === "checker" && !solo ? " checker" : "")} style={{ background: solo ? "#fff" : bg === "shirt" ? st.garment : undefined }}>
            <div className="sep-canvases">
              <canvas ref={cv} className={(pick ? "pick " : "") + (view === "original" && !solo ? "gone" : "")} onClick={onPick} />
              <canvas ref={cvOrig} className={"sep-orig" + (view === "proof" || solo ? " gone" : "")} style={view === "compare" && !solo ? { clipPath: `inset(0 ${100 - split}% 0 0)` } : undefined} onClick={onPick} />
              {view === "compare" && !solo && <input className="sep-split" type="range" min={0} max={100} value={split} onChange={(e) => setSplit(+e.target.value)} aria-label="Original | proof" />}
            </div>
            {busy && <div className="sep-busy">{busy}</div>}
            {!img && !err && <div className="sep-busy">Loading the art…</div>}
          </div>
          <div className="sep-legend faint">{solo ? <>Film for <b>{plates.find((p) => p.key === solo)?.name}</b> (black = ink). <button type="button" className="linkbtn" onClick={() => setSolo(null)}>Back to the proof</button></> : view === "compare" ? <>Left of the line: the original art. Right: how it prints.</> : <>{view === "original" ? "The original art" : "Soft proof: how it prints"}{bg === "shirt" ? ` on a ${st.garment} shirt` : ""} · {plates.length} screen{plates.length === 1 ? "" : "s"}{res?.dropped.length ? ` · ${res.dropped.length} color${res.dropped.length === 1 ? "" : "s"} left to the shirt` : ""}</>}</div>
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
                <small className="sep-meta">{p.kind === "underbase" ? "Base · flash after" : p.kind === "highlight" ? "Top white" : "Color"} · {(p.coverage * 100).toFixed(1)}% · mesh <input className="sep-mesh" type="number" value={p.mesh} onChange={(e) => setMesh((m) => ({ ...m, [p.key]: +e.target.value }))} aria-label="Mesh" /></small>
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
              <button type="button" className="linkbtn" disabled={!res || !!busy} onClick={async () => { setBusy("Making the Illustrator file…"); download(await aiFile(), `${slug(title)}-seps.pdf`); setBusy(""); }}>Illustrator file (spot colors)</button>
              <button type="button" className="linkbtn" disabled={!res || !!busy} onClick={async () => { setBusy("Making films…"); download(await filmsFile(), `${slug(title)}-films.pdf`); setBusy(""); }}>Films PDF ({st.dpi} dpi{tonal ? `, ${st.lpi} lpi` : ""})</button>
            </div>
            {(row.files || []).length > 0 && <ul className="sep-files">{row.files.filter((f) => f.kind !== "plate").map((f) => <li key={f.path}><button type="button" className="linkbtn" onClick={() => openFile(f.path)}>{f.name}</button></li>)}</ul>}
            <p className="sep-help">The Illustrator file opens straight in Illustrator: each ink is a spot color swatch, so File → Print → Separations prints one film per ink.</p>
          </section>
        </aside>
      </div>
      )}
    </div>
  );
}

import { WILFLEX_HEX as WILFLEX_NAMES, PMS_HEX } from "@/lib/inkColors";
const PMS_NAMES = Object.keys(PMS_HEX);

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
