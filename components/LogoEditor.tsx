"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { colorHex, deltaE } from "@/lib/inkColors";
import { INK_COLORS, type BrandColor, type Design } from "@/lib/pricing";
import { guessHex, SHIRT_COLORS } from "@/lib/mockup";
import { AS_IS, onShirtsOf, useArt, type OnShirt } from "@/components/LogoOnShirts";
import { parseSvg, type VArt, type VShape } from "@/lib/svgVector";
import { vartSvg } from "@/lib/epsVector";
import { readVector } from "@/components/SeparationStudio";

/**
 * Edit a logo (Oct 16, Nick: "remove the white in the two Peticolas full logos and set the standard color to navy").
 * Vector art (PDF, .ai, EPS, SVG made of filled shapes) is edited as its shapes and saved as a vector SVG, so separations
 * stay sharp: each color in it can be kept, removed (the white knocked out) or changed to an ink. Pictures (PNG, JPG)
 * get the same choices pixel by pixel. Either way it's cropped to the art. The original file is kept on the logo
 * (specs.original) and the edited one becomes the logo's file.
 * Backgrounds (Oct 16, Nick: "add as many backgrounds as you want… click on that color and it should drop down: how
 * would this logo appear on this color?"): each background is a shirt color with the ink the logo prints in on it,
 * saved on the logo (specs.onShirts), shown on its logo card and used by the Mockup Creator.
 */
type Act = { kind: "keep" } | { kind: "remove" } | { kind: "ink"; name: string; hex: string };
type Src = { hex: string; share: number };
const isWhite = (hex: string) => { const v = parseInt(hex.slice(1), 16); return ((v >> 16) & 255) > 238 && ((v >> 8) & 255) > 238 && (v & 255) > 238; };
const hx = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();

/** a vector shape's outline points (for the bounding box): every number pair in its path */
function bbox(shapes: VShape[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of shapes) for (const line of s.ops.split("\n")) {
    const n = line.trim().split(/\s+/).slice(0, -1).map(Number);
    for (let i = 0; i + 1 < n.length; i += 2) { if (!isFinite(n[i]) || !isFinite(n[i + 1])) continue; x0 = Math.min(x0, n[i]); x1 = Math.max(x1, n[i]); y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1]); }
  }
  return isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => rej(new Error("Couldn't draw the logo.")); i.src = src; });

export default function LogoEditor({ d, onClose, onSaved }: { d: Design; onClose: () => void; onSaved: (d: Design) => void }) {
  const sb = useMemo(() => createClient(), []);
  const [vec, setVec] = useState<VArt | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [srcs, setSrcs] = useState<Src[]>([]);
  const [acts, setActs] = useState<Record<string, Act>>({});
  const [bgs, setBgs] = useState<OnShirt[]>(onShirtsOf(d));
  const [sel, setSel] = useState(-1); // -1: see-through
  const [brand, setBrand] = useState<BrandColor[]>([]);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState("Reading the logo…");
  const [err, setErr] = useState("");

  // read it: vector shapes when it's flat vector art, else the preview picture
  useEffect(() => {
    (async () => {
      try {
        const { data: blob } = await sb.storage.from("proofs").download(d.file_path);
        let v: VArt | null = null;
        if (blob) {
          if (/svg/i.test(d.file_type) || /\.svg$/i.test(d.file_name)) v = parseSvg(await blob.text());
          else v = await readVector(blob, d.file_name, d.file_type);
        }
        if (v?.ok && v.shapes.length) {
          setVec(v);
          const area = new Map<string, number>();
          for (const s of v.shapes) area.set(s.fill.toUpperCase(), (area.get(s.fill.toUpperCase()) || 0) + 1);
          setSrcs([...area.entries()].map(([hex, n]) => ({ hex, share: n / v!.shapes.length })).sort((a, b) => b.share - a.share));
        } else {
          const { data: pu } = await sb.storage.from("proofs").createSignedUrl(d.preview_path || d.file_path, 600);
          if (!pu?.signedUrl) throw new Error("This logo has no picture to edit.");
          const im = await loadImg(pu.signedUrl);
          setImg(im);
          setSrcs(pixelColors(im));
        }
        setBusy("");
      } catch (e) { setBusy(""); setErr(e instanceof Error ? e.message : "Couldn't read the logo."); }
    })();
  }, [sb, d]);
  useEffect(() => {
    if (d.customer_id) sb.from("customers").select("brand_colors").eq("id", d.customer_id).maybeSingle().then(({ data }) => setBrand(((data?.brand_colors || []) as BrandColor[]).filter((b) => b?.ink)));
  }, [sb, d.customer_id]);

  const act = (hex: string): Act => acts[hex] || { kind: "keep" };
  // the edited art, drawn for the preview (and saved)
  const edited = useMemo(() => {
    if (vec) {
      const shapes = vec.shapes.flatMap((s): VShape[] => {
        const a = act(s.fill.toUpperCase());
        return a.kind === "remove" ? [] : a.kind === "ink" ? [{ ...s, fill: a.hex, grad: undefined, ink: a.name }] : [s];
      });
      const b = bbox(shapes);
      const pad = b ? Math.max(b.w, b.h) * 0.005 : 0;
      return { kind: "vec" as const, art: { ...vec, shapes, ...(b ? { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 } : {}) } };
    }
    return img ? { kind: "img" as const } : null;
  }, [vec, img, acts]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let url = "";
    (async () => {
      if (edited?.kind === "vec") url = URL.createObjectURL(new Blob([vartSvg(edited.art)], { type: "image/svg+xml" }));
      else if (edited?.kind === "img" && img) { const c = rasterEdit(img, srcs, acts); const b = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png")); if (b) url = URL.createObjectURL(b); }
      setPreview(url);
    })();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [edited, img, srcs, acts]);

  const cur = sel >= 0 ? bgs[sel] : null;
  // inks to offer for a background: as edited, the logo's own, the customer's brand inks, then the stock list
  const own = (d.inks || "").split(/\s*[,/+&]\s*|\s+and\s+/i).map((x) => x.trim()).filter(Boolean);
  const picked = Object.values(acts).flatMap((a) => (a.kind === "ink" ? [a.name] : []));
  const inkList = [...new Set([AS_IS, ...picked, ...own, ...brand.map((b) => b.ink), ...INK_COLORS])];
  const darkInk = [...picked, ...own, ...brand.map((b) => b.ink)].find((x) => !/white/i.test(x)) || "Black";
  const setAct = (hex: string, a: Act) => setActs((x) => ({ ...x, [hex]: a }));
  const removeWhite = () => setActs((x) => { const n = { ...x }; for (const s of srcs) if (isWhite(s.hex)) n[s.hex] = { kind: "remove" }; return n; });
  const allTo = (name: string) => { const hex = colorHex(name); if (!hex) return setErr(`"${name}" isn't an ink we know.`); setErr(""); setActs((x) => { const n = { ...x }; for (const s of srcs) if (!isWhite(s.hex) && x[s.hex]?.kind !== "remove") n[s.hex] = { kind: "ink", name, hex }; return n; }); };

  async function save() {
    if (!edited) return;
    setBusy("Saving…"); setErr("");
    const onShirts = bgs.filter((x) => x.shirt && x.ink);
    try {
      // only the backgrounds changed: keep the file as it is
      if (!Object.values(acts).some((a) => a.kind !== "keep")) {
        const { data, error } = await sb.from("designs").update({ specs: { ...((d.specs || {}) as object), onShirts } }).eq("id", d.id).select("*").single();
        if (error) throw new Error(error.message);
        setBusy(""); onSaved(data as Design); return;
      }
      const stamp = Date.now().toString(36), base = (d.name || "logo").replace(/[^\w.\-]+/g, "_");
      let fileBlob: Blob, fileName: string, fileType: string, pvBlob: Blob, w: number, h: number;
      if (edited.kind === "vec") {
        const svg = vartSvg(edited.art);
        fileBlob = new Blob([svg], { type: "image/svg+xml" }); fileName = `${base}-edited.svg`; fileType = "image/svg+xml";
        const im = await loadImg(URL.createObjectURL(fileBlob));
        const k = 2400 / Math.max(edited.art.w, edited.art.h);
        w = Math.max(1, Math.round(edited.art.w * k)); h = Math.max(1, Math.round(edited.art.h * k));
        const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d")!.drawImage(im, 0, 0, w, h);
        pvBlob = await new Promise<Blob>((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error("Couldn't draw it."))), "image/png"));
      } else {
        const c = cropCanvas(rasterEdit(img!, srcs, acts));
        w = c.width; h = c.height;
        pvBlob = await new Promise<Blob>((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error("Couldn't draw it."))), "image/png"));
        fileBlob = pvBlob; fileName = `${base}-edited.png`; fileType = "image/png";
      }
      const dir = `designs/${d.id}-${stamp}`;
      const fp = `${dir}/${fileName}`, pp = edited.kind === "vec" ? `${dir}/preview-${base}.png` : fp;
      const u1 = await sb.storage.from("proofs").upload(fp, fileBlob, { contentType: fileType });
      if (u1.error) throw new Error(u1.error.message);
      if (pp !== fp) { const u2 = await sb.storage.from("proofs").upload(pp, pvBlob, { contentType: "image/png" }); if (u2.error) throw new Error(u2.error.message); }
      // the inks it prints in now: the inks picked, plus the colors kept
      const inks = [...new Set(srcs.flatMap((s) => { const a = act(s.hex); return a.kind === "remove" ? [] : a.kind === "ink" ? [a.name] : []; }))];
      const kept = srcs.filter((s) => act(s.hex).kind === "keep").length;
      const specs = { ...((d.specs || {}) as object), onShirts, original: (d.specs as { original?: unknown } | null)?.original || { path: d.file_path, name: d.file_name, type: d.file_type, preview: d.preview_path } };
      const patch = { file_path: fp, file_name: fileName, file_type: fileType, preview_path: pp, width_px: w, height_px: h, art_box: null, print_plan: null,
        colors: Math.max(1, inks.length + kept), ...(inks.length && !kept ? { inks: inks.join(", ") } : {}), specs };
      const { data, error } = await sb.from("designs").update(patch).eq("id", d.id).select("*").single();
      if (error) throw new Error(error.message);
      setBusy("");
      onSaved(data as Design);
    } catch (e) { setBusy(""); setErr(e instanceof Error ? e.message : "Couldn't save."); }
  }

  return (
    <div className="le-overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="le" role="dialog" aria-label="Edit logo">
        <div className="le-h"><h2>Edit {d.number ? `D-${d.number}` : "logo"}</h2><span className="faint">{vec ? `Vector art · ${vec.shapes.length} shapes · saved as a vector SVG` : img ? "A picture · edited pixel by pixel" : ""}</span></div>
        <div className="le-b">
          <div className="le-pic" style={{ background: cur ? guessHex(cur.shirt) : undefined }} data-check={!cur || undefined}>
            {preview ? (cur && cur.ink !== AS_IS ? <InkArt url={preview} ink={cur.ink} /> : <img src={preview} alt="The edited logo" />) : <span className="faint">{busy || err}</span>}
            {cur && <span className="le-pic-tag">{cur.ink === AS_IS ? "As edited" : cur.ink} on {cur.shirt}</span>}
          </div>
          <div className="le-side">
            <Backgrounds bgs={bgs} sel={sel} inks={inkList} onSel={setSel}
              onAdd={(shirt) => { setBgs((l) => [...l, { shirt, ink: light(shirt) ? darkInk : "White" }]); setSel(bgs.length); }}
              onInk={(i, ink) => setBgs((l) => l.map((x, j) => (j === i ? { ...x, ink } : x)))}
              onRemove={(i) => { setBgs((l) => l.filter((_, j) => j !== i)); setSel(-1); }} />
            <div className="le-quick">
              {srcs.some((s) => isWhite(s.hex)) && <button type="button" className="btn sm" onClick={removeWhite}>Remove the white</button>}
              <OneInk onPick={allTo} />
            </div>
            <div className="lbl">Edit the logo</div>
            {srcs.map((s) => {
              const a = act(s.hex);
              return (
                <div key={s.hex} className="le-row">
                  <span className="sw" style={{ background: s.hex }} title={s.hex} />
                  <span className="arrow">→</span>
                  {a.kind === "remove" ? <span className="le-gone">Removed</span> : <span className="sw" style={{ background: a.kind === "ink" ? a.hex : s.hex }} />}
                  <select aria-label="What to do with this color" value={a.kind === "ink" ? "ink:" + a.name : a.kind} onChange={(e) => { const v = e.target.value; if (v === "keep" || v === "remove") setAct(s.hex, { kind: v }); else if (v.startsWith("ink:")) { const n = v.slice(4); setAct(s.hex, { kind: "ink", name: n, hex: colorHex(n) || s.hex }); } }}>
                    <option value="keep">Keep as is</option>
                    <option value="remove">Remove (see-through)</option>
                    {a.kind === "ink" && !INK_COLORS.includes(a.name) && <option value={"ink:" + a.name}>{a.name}</option>}
                    {INK_COLORS.map((n) => <option key={n} value={"ink:" + n}>Change to {n}</option>)}
                  </select>
                </div>
              );
            })}
            {err && <div className="err">{err}</div>}
            <p className="faint le-note">Saved as this logo&apos;s file, cropped to the art. The original stays on the logo. Orders already using it keep their saved mockups.</p>
          </div>
        </div>
        <div className="le-f"><button type="button" className="btn" disabled={!!busy && busy !== "Reading the logo…"} onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={!!busy || !edited} onClick={save}>{busy === "Saving…" ? "Saving…" : "Save"}</button></div>
      </div>
    </div>
  );
}

const light = (shirt: string) => deltaE(guessHex(shirt), "#ffffff") < 35;
const QUICK = ["White", "Black", "Navy", "Charcoal", "Red", "Royal", "Sport Grey", "Maroon", "Forest Green", "Natural"];

/** the edited logo in one ink (its art read off any background, then filled with the ink) */
function InkArt({ url, ink }: { url: string; ink: string }) {
  const art = useArt(url);
  if (art === undefined) return null;
  const m = `url("${art?.mask || url}")`;
  return <span className="le-ink" style={{ background: colorHex(ink) || guessHex(ink), WebkitMaskImage: m, maskImage: m }} role="img" aria-label={`The logo in ${ink}`} />;
}

/** Backgrounds: see-through, then each shirt color added; the one picked opens to choose its ink */
function Backgrounds({ bgs, sel, inks, onSel, onAdd, onInk, onRemove }: { bgs: OnShirt[]; sel: number; inks: string[]; onSel: (i: number) => void; onAdd: (shirt: string) => void; onInk: (i: number, ink: string) => void; onRemove: (i: number) => void }) {
  const [adding, setAdding] = useState(false);
  const used = new Set(bgs.map((b) => b.shirt.toLowerCase()));
  return (
    <div className="le-bgw">
      <div className="lbl">Backgrounds <span className="faint">how it looks on each shirt color</span></div>
      <div className="le-bgl">
        <button type="button" className={"le-chip" + (sel === -1 ? " on" : "")} onClick={() => onSel(-1)}><i data-check="" />See-through</button>
        {bgs.map((b, i) => (
          <button key={i} type="button" className={"le-chip" + (sel === i ? " on" : "")} onClick={() => onSel(sel === i ? -1 : i)} aria-expanded={sel === i}>
            <i style={{ background: guessHex(b.shirt) }} />{b.shirt}<small>{b.ink === AS_IS ? "as edited" : b.ink}</small>
          </button>
        ))}
        <button type="button" className="le-chip add" onClick={() => setAdding((x) => !x)} aria-expanded={adding}>+ Add background</button>
      </div>
      {adding && (
        <div className="le-add">
          {QUICK.filter((q) => !used.has(q.toLowerCase())).map((q) => <button key={q} type="button" className="le-chip" onClick={() => { onAdd(q); setAdding(false); }}><i style={{ background: guessHex(q) }} />{q}</button>)}
          <select aria-label="Another shirt color" value="" onChange={(e) => { if (e.target.value) { onAdd(e.target.value); setAdding(false); } }}>
            <option value="">More colors…</option>
            {SHIRT_COLORS.map((g) => <optgroup key={g.group} label={g.group}>{g.colors.filter(([n]) => !used.has(n.toLowerCase())).map(([n]) => <option key={n} value={n}>{n}</option>)}</optgroup>)}
          </select>
        </div>
      )}
      {sel >= 0 && bgs[sel] && (
        <div className="le-drop">
          <span>On <b>{bgs[sel].shirt}</b> it prints in</span>
          <select aria-label={`Ink on ${bgs[sel].shirt}`} value={bgs[sel].ink} onChange={(e) => onInk(sel, e.target.value)}>
            {!inks.includes(bgs[sel].ink) && <option value={bgs[sel].ink}>{bgs[sel].ink}</option>}
            {inks.map((n) => <option key={n} value={n}>{n === AS_IS ? "Its colors, as edited" : n}</option>)}
          </select>
          <button type="button" className="btn sm ghost" onClick={() => onRemove(sel)}>Remove</button>
        </div>
      )}
    </div>
  );
}

/** "Make it one color": every color but white (and what's removed) becomes this ink */
function OneInk({ onPick }: { onPick: (name: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form className="le-one" onSubmit={(e) => { e.preventDefault(); if (v.trim()) onPick(v.trim()); }}>
      <input list="le-inks" placeholder="Navy, PMS 289 C…" aria-label="Make it one ink" value={v} onChange={(e) => setV(e.target.value)} />
      <datalist id="le-inks">{INK_COLORS.map((n) => <option key={n} value={n} />)}</datalist>
      <button type="submit" className="btn sm">Make it one color</button>
    </form>
  );
}

/* ---------- pictures ---------- */
function pixelColors(im: HTMLImageElement): Src[] {
  const k = Math.min(1, 400 / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
  const x = c.getContext("2d", { willReadFrequently: true })!; x.drawImage(im, 0, 0, c.width, c.height);
  const p = x.getImageData(0, 0, c.width, c.height).data;
  const bins = new Map<string, { r: number; g: number; b: number; n: number }>();
  let total = 0;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] < 200) continue;
    total++;
    const key = `${p[i] >> 4},${p[i + 1] >> 4},${p[i + 2] >> 4}`, e = bins.get(key) || { r: 0, g: 0, b: 0, n: 0 };
    e.r += p[i]; e.g += p[i + 1]; e.b += p[i + 2]; e.n++; bins.set(key, e);
  }
  // the main colors: the biggest bins, merged when they look alike (anti-aliased edges fold into them)
  const out: Src[] = [];
  for (const e of [...bins.values()].sort((a, b) => b.n - a.n)) {
    const hex = hx(Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n));
    const near = out.find((o) => deltaE(o.hex, hex) < 12);
    if (near) near.share += e.n / total; else if (e.n / total > 0.01 && out.length < 8) out.push({ hex, share: e.n / total });
  }
  return out;
}
function rasterEdit(im: HTMLImageElement, srcs: Src[], acts: Record<string, Act>) {
  const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
  const x = c.getContext("2d", { willReadFrequently: true })!; x.drawImage(im, 0, 0);
  if (!srcs.length || !Object.keys(acts).length) return c;
  const data = x.getImageData(0, 0, c.width, c.height), p = data.data;
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const S = srcs.map((s) => ({ c: rgb(s.hex), a: acts[s.hex] || { kind: "keep" as const } }));
  for (let i = 0; i < p.length; i += 4) {
    if (!p[i + 3]) continue;
    let best = 0, bd = Infinity;
    for (let j = 0; j < S.length; j++) { const d = (p[i] - S[j].c[0]) ** 2 + (p[i + 1] - S[j].c[1]) ** 2 + (p[i + 2] - S[j].c[2]) ** 2; if (d < bd) { bd = d; best = j; } }
    const a = S[best].a;
    if (a.kind === "remove") p[i + 3] = 0;
    else if (a.kind === "ink") { const t = rgb(a.hex); p[i] = t[0]; p[i + 1] = t[1]; p[i + 2] = t[2]; }
  }
  x.putImageData(data, 0, 0);
  return c;
}
function cropCanvas(c: HTMLCanvasElement) {
  const x = c.getContext("2d", { willReadFrequently: true })!, p = x.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) if (p[(y * c.width + xx) * 4 + 3] > 8) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return c;
  const o = document.createElement("canvas"); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext("2d")!.drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}
