"use client";
import { useEffect, useState } from "react";
import { colorHex, deltaE } from "@/lib/inkColors";
import { guessHex } from "@/lib/mockup";
import { useShirtBg } from "@/lib/fabricTile";
import type { Design } from "@/lib/pricing";

/**
 * How a logo shows on each shirt color (Oct 16, Nick: "on a navy shirt show it as white, on a white shirt as navy, on a
 * gray shirt as navy… a portfolio of how their logos will look"). Saved on the logo as specs.onShirts; the Mockup
 * Creator prints a one-color logo in that ink on that shirt color. Set in Edit logo → Backgrounds (components/LogoEditor.tsx).
 */
export type OnShirt = { shirt: string; ink: string; /** its own version: the picture made in Edit logo for this background */ path?: string; /** that version's color changes */ map?: Record<string, unknown> };
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
type Art = { mask: string; cut: string; ratio: number; /** mostly white / very light: shown on a dark tile */ light: boolean };
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
        let lum = 0, cnt = 0;
        for (let i = 0; i < W * H; i += 3) if (alpha[i] > 128) { lum += 0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2]; cnt++; }
        res({ mask: out(true), cut: out(false), ratio: ch / cw, light: cnt > 0 && lum / cnt > 205 });
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
  const art = useArt(url), bg = useShirtBg(shirt);
  return (
    <span className={"lv" + (className ? " " + className : "")} style={{ background: bg, ...(size ? { width: size, height: size } : {}) }} title={title || `${ink} on a ${shirt} shirt`}>
      <ArtIn url={url} art={art} ink={ink} className="lv-art" />
    </span>
  );
}

/**
 * A logo's picture on a card without the checkerboard (Oct 16, Nick: "I just don't like seeing the checkered stuff"):
 * on the shirt color it was printed on when known, else white, or a dark tile for a light (white) logo.
 */
export function LogoPic({ url, alt, shirt }: { url: string; alt: string; shirt?: string }) {
  const art = useArt(shirt ? "" : url), bg = useShirtBg(shirt || "");
  return (
    <span className="lp" style={{ background: shirt ? bg : art?.light ? "#2b3140" : "#fff" }}>
      <img src={url} alt={alt} />
    </span>
  );
}
