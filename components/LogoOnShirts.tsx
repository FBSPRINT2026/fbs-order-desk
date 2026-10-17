"use client";
import { useEffect, useState } from "react";
import { colorHex, deltaE } from "@/lib/inkColors";
import { guessHex, SHIRT_COLORS } from "@/lib/mockup";
import { INK_COLORS, type BrandColor, type Design } from "@/lib/pricing";

/**
 * How a logo shows on each shirt color (Oct 16, Nick: "on a navy shirt show it as white, on a white shirt as navy, on a
 * gray shirt as navy… a portfolio of how their logos will look"). Saved on the logo as specs.onShirts; the Mockup
 * Creator prints a one-color logo in that ink on that shirt color. Set in a pop-up with a small tee mockup per version.
 */
export type OnShirt = { shirt: string; ink: string };
/** keep the logo's own colors on that shirt (no recolor) */
export const AS_IS = "Original colors";
export const onShirtsOf = (d: Pick<Design, "specs"> | null | undefined): OnShirt[] => ((d?.specs?.onShirts || []) as OnShirt[]).filter((x) => x.shirt && x.ink);
/** the ink for this logo on a shirt color, when one is set (by name, else the closest shirt color) */
export function inkOnShirt(d: Pick<Design, "specs"> | null | undefined, shirt: string): string | null {
  const list = onShirtsOf(d);
  if (!list.length || !shirt) return null;
  const n = (v: string) => v.toLowerCase().replace(/grey/g, "gray").trim(), s = n(shirt);
  const named = list.find((x) => n(x.shirt) === s) || list.find((x) => s.includes(n(x.shirt)) || n(x.shirt).includes(s));
  const near = named ? null : list.map((x) => ({ x, d: deltaE(guessHex(shirt), guessHex(x.shirt)) })).sort((a, b) => a.d - b.d)[0];
  const ink = named?.ink || (near && near.d < 15 ? near.x.ink : null);
  return ink && ink !== AS_IS ? ink : null;
}

/* ---------- the logo's art, ready to recolor: the background taken off and cropped to the art ---------- */
type Art = { mask: string; cut: string; ratio: number };
const ART = new Map<string, Promise<Art | null>>();
const keyOf = (url: string) => url.split("?")[0];
function makeArt(url: string): Promise<Art | null> {
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onerror = () => res(null);
    img.onload = () => {
      try {
        const k = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight));
        const W = Math.max(1, Math.round(img.naturalWidth * k)), H = Math.max(1, Math.round(img.naturalHeight * k));
        const c = document.createElement("canvas"); c.width = W; c.height = H;
        const g = c.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(img, 0, 0, W, H);
        const px = g.getImageData(0, 0, W, H), p = px.data;
        // the background: clear, or the color around the edges (a logo on an off-white square)
        const edge: number[] = [];
        for (let x = 0; x < W; x += 2) edge.push(x, (H - 1) * W + x);
        for (let y = 0; y < H; y += 2) edge.push(y * W, y * W + W - 1);
        const clearEdge = edge.filter((i) => p[i * 4 + 3] < 16).length / edge.length > 0.6;
        let br = 255, bg = 255, bb = 255;
        if (!clearEdge) {
          const s = edge.filter((i) => p[i * 4 + 3] > 200).map((i) => [p[i * 4], p[i * 4 + 1], p[i * 4 + 2]]);
          const mid = (j: number) => s.map((v) => v[j]).sort((a, b) => a - b)[Math.floor(s.length / 2)] ?? 255;
          br = mid(0); bg = mid(1); bb = mid(2);
        }
        // on a clear background, white fill inside a darker logo isn't ink ("remove the white"); an all-white logo is
        let dropWhite = false;
        if (clearEdge) {
          let op = 0, wh = 0;
          for (let i = 0; i < p.length; i += 4) if (p[i + 3] > 128) { op++; if (p[i] > 235 && p[i + 1] > 235 && p[i + 2] > 235) wh++; }
          dropWhite = op > 0 && wh / op > 0.03 && wh / op < 0.7;
        }
        const alpha = new Uint8ClampedArray(W * H);
        let x0 = W, y0 = H, x1 = -1, y1 = -1;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = y * W + x, r = p[i * 4], gg = p[i * 4 + 1], b = p[i * 4 + 2], a = p[i * 4 + 3];
          let v = a;
          if (!clearEdge) { const d = Math.hypot(r - br, gg - bg, b - bb); v = a * Math.max(0, Math.min(1, (d - 18) / 30)); }
          else if (dropWhite) { const w = Math.min(r, gg, b); v = w > 235 ? 0 : w > 215 ? a * (235 - w) / 20 : a; }
          alpha[i] = v;
          if (v > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        if (x1 < 0) return res(null);
        const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
        const out = (tint: boolean) => {
          const o = document.createElement("canvas"); o.width = cw; o.height = ch;
          const og = o.getContext("2d")!, im = og.createImageData(cw, ch), q = im.data;
          for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
            const s = (y + y0) * W + (x + x0), t = (y * cw + x) * 4;
            q[t] = tint ? 255 : p[s * 4]; q[t + 1] = tint ? 255 : p[s * 4 + 1]; q[t + 2] = tint ? 255 : p[s * 4 + 2]; q[t + 3] = alpha[s];
          }
          og.putImageData(im, 0, 0);
          return o.toDataURL("image/png");
        };
        res({ mask: out(true), cut: out(false), ratio: ch / cw });
      } catch { res(null); } // a picture we can't read (no CORS): the plain picture is used
    };
    img.src = url;
  });
}
/** undefined while the picture is being read; null when it can't be (the plain picture is used then) */
export function useArt(url: string): Art | null | undefined {
  const [a, setA] = useState<Art | null | undefined>(undefined);
  useEffect(() => {
    let on = true;
    setA(undefined);
    if (!url) { setA(null); return; }
    const k = keyOf(url);
    if (!ART.has(k)) ART.set(k, makeArt(url));
    ART.get(k)!.then((r) => { if (on) setA(r); });
    return () => { on = false; };
  }, [url]);
  return a;
}

const inkHex = (ink: string) => colorHex(ink) || guessHex(ink);
/** the art in one ink (or its own colors), filling its box */
function ArtIn({ url, art, ink, className }: { url: string; art: Art | null | undefined; ink: string; className: string }) {
  if (art === undefined) return null;
  if (ink === AS_IS) return <img className={className + " as-is"} src={art?.cut || url} alt="" />;
  const m = `url("${art?.mask || url}")`;
  return <span className={className} style={{ background: inkHex(ink), WebkitMaskImage: m, maskImage: m }} />;
}

/** one view, flat: the logo in one ink on a shirt-color square */
export function ShirtView({ url, shirt, ink, size, title, className }: { url: string; shirt: string; ink: string; size?: number; title?: string; className?: string }) {
  const art = useArt(url);
  return (
    <span className={"lv" + (className ? " " + className : "")} style={{ background: guessHex(shirt), ...(size ? { width: size, height: size } : {}) }} title={title || `${ink} on a ${shirt} shirt`}>
      <ArtIn url={url} art={art} ink={ink} className="lv-art" />
    </span>
  );
}

/** one view as a little tee mockup: the shirt color with the logo across the chest */
export function ShirtMock({ url, shirt, ink, size = 64, title }: { url: string; shirt: string; ink: string; size?: number; title?: string }) {
  const art = useArt(url), hex = guessHex(shirt);
  const light = deltaE(hex, "#ffffff") < 12;
  return (
    <span className="lm" style={{ width: size, height: Math.round(size * 1.14) }} title={title || `${ink === AS_IS ? "Its own colors" : ink} on a ${shirt} shirt`}>
      <svg viewBox="40 90 920 1050" aria-hidden="true">
        <path d="M405 105 L250 150 L60 390 L180 470 L245 410 L245 1120 L755 1120 L755 410 L820 470 L940 390 L750 150 L595 105 Q500 175 405 105 Z" fill={hex} stroke={light ? "#00000040" : "#00000022"} strokeWidth="8" strokeLinejoin="round" />
        <path d="M420 110 Q500 175 580 110" fill="none" stroke="#00000030" strokeWidth="8" />
      </svg>
      <ArtIn url={url} art={art} ink={ink} className="lm-art" />
    </span>
  );
}

const SHIRTS = SHIRT_COLORS.flatMap((g) => g.colors.map(([n]) => n));
const QUICK = ["White", "Black", "Navy", "Sport Grey", "Charcoal", "Royal", "Red", "Natural", "Maroon", "Forest Green"];
const lightShirt = (shirt: string) => deltaE(guessHex(shirt), "#ffffff") < 35;

/**
 * The pop-up: one card per shirt color with its mockup, the shirt color and the ink. Saved together with Save.
 * (Replaces the inline rows that saved on blur, Oct 16: "isn't working right, make that a pop-up with little mockups".)
 */
export function ShirtColorsPopup({ d, url, brandColors = [], onClose, onSave }: { d: Design; url: string; brandColors?: BrandColor[]; onClose: () => void; onSave: (list: OnShirt[]) => Promise<{ ok: boolean; error?: string }> }) {
  const [list, setList] = useState<OnShirt[]>(onShirtsOf(d).length ? onShirtsOf(d) : []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // inks to offer: the logo's own, the customer's brand inks, then the standard list
  const own = (d.inks || "").split(/\s*[,/+&]\s*|\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
  const brand = brandColors.map((b) => b.ink).filter(Boolean);
  const inks = [...new Set([AS_IS, ...own, ...brand, ...INK_COLORS])];
  const darkInk = own.find((x) => !/white/i.test(x)) || brand.find((x) => !/white/i.test(x)) || "Black";
  const add = (shirt: string) => setList((l) => [...l, { shirt, ink: lightShirt(shirt) ? darkInk : "White" }]);
  const set = (i: number, p: Partial<OnShirt>) => setList((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const used = new Set(list.map((x) => x.shirt.toLowerCase()));
  const save = async () => {
    setBusy(true); setErr("");
    const r = await onSave(list.filter((x) => x.shirt && x.ink));
    setBusy(false);
    if (!r.ok) return setErr(r.error || "Couldn't save.");
    onClose();
  };
  return (
    <div className="mk-modal-back" role="dialog" aria-modal="true" aria-labelledby="los-t" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mk-modal los-pop">
        <h2 id="los-t">D-{d.number} {d.name} on shirt colors</h2>
        <p className="faint">The ink it prints in on each shirt color. Shown on their logo card, and the Mockup Creator starts with it.</p>
        <div className="los-grid">
          {list.map((x, i) => (
            <div className="los-card" key={i}>
              <button type="button" className="los-x" aria-label={`Remove ${x.shirt}`} title="Remove" onClick={() => setList((l) => l.filter((_, j) => j !== i))}>✕</button>
              {url ? <ShirtMock url={url} shirt={x.shirt} ink={x.ink} size={120} /> : null}
              <label><span>Shirt</span>
                <select value={x.shirt} onChange={(e) => set(i, { shirt: e.target.value })}>
                  {!SHIRTS.includes(x.shirt) && <option value={x.shirt}>{x.shirt}</option>}
                  {SHIRT_COLORS.map((g) => <optgroup key={g.group} label={g.group}>{g.colors.map(([n]) => <option key={n} value={n}>{n}</option>)}</optgroup>)}
                </select>
              </label>
              <label><span>Ink</span>
                <select value={x.ink} onChange={(e) => set(i, { ink: e.target.value })}>
                  {!inks.includes(x.ink) && <option value={x.ink}>{x.ink}</option>}
                  {inks.map((n) => <option key={n} value={n}>{n}{brandColors.find((b) => b.ink === n && b.name !== n) ? ` (${brandColors.find((b) => b.ink === n)!.name})` : ""}</option>)}
                </select>
              </label>
            </div>
          ))}
          {!list.length && <div className="faint los-empty">No shirt colors yet. Pick one below.</div>}
        </div>
        <div className="los-add">
          <span className="faint">Add a shirt color</span>
          {QUICK.filter((s) => !used.has(s.toLowerCase())).map((s) => (
            <button type="button" key={s} className="los-sw" onClick={() => add(s)} title={`Add ${s}`}><i style={{ background: guessHex(s) }} />{s}</button>
          ))}
          <select aria-label="Another shirt color" value="" onChange={(e) => { if (e.target.value) add(e.target.value); }}>
            <option value="">Other…</option>
            {SHIRT_COLORS.map((g) => <optgroup key={g.group} label={g.group}>{g.colors.filter(([n]) => !used.has(n.toLowerCase())).map(([n]) => <option key={n} value={n}>{n}</option>)}</optgroup>)}
          </select>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

/** on the logo page: the versions as little mockups, and a button for the pop-up */
export default function LogoOnShirts({ d, url, brandColors, onSave }: { d: Design; url: string; brandColors?: BrandColor[]; onSave: (list: OnShirt[]) => Promise<{ ok: boolean; error?: string }> }) {
  const [open, setOpen] = useState(false);
  const vs = onShirtsOf(d);
  return (
    <div className="los">
      {vs.length > 0 && url && <div className="los-strip">{vs.map((v, i) => <figure key={i}><ShirtMock url={url} shirt={v.shirt} ink={v.ink} size={84} /><figcaption>{v.shirt}<br /><span className="faint">{v.ink}</span></figcaption></figure>)}</div>}
      <button type="button" className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(true)}>{vs.length ? "Change shirt colors" : "Set shirt colors"}</button>
      {open && <ShirtColorsPopup d={d} url={url} brandColors={brandColors} onClose={() => setOpen(false)} onSave={onSave} />}
    </div>
  );
}
