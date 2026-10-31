"use client";
import { needsDarkBackdrop } from "@/lib/lightArt";
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
        // white on a clear background is the logo's own ink and stays (Oct 30, Nick on D-10301: "you're losing the white
        // block under All My Sons"): the old guess (3-70% white = "not ink") took real white out of multi-color logos.
        // White comes off only when someone says so (Edit logo → Remove the white), like the order page, which drops it
        // only when the print's inks are known and have no white (GroupEditor paintPrint).
        const dropWhite = false;
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
        // light parts that would vanish on white get the dark tile (lib/lightArt.ts, the same test as the logo's page)
        res({ mask: out(true), cut: out(false), ratio: ch / cw, light: needsDarkBackdrop(p, (i) => alpha[i] > 128, 3) });
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
export function LogoPic({ url, alt, shirt, cut }: { url: string; alt: string; shirt?: string; /** off a shirt too: the art with its background square taken off (components/LogoThumb.tsx) */ cut?: boolean }) {
  const art = useArt(url), bg = useShirtBg(shirt || "");
  if (cut && !shirt) return <span className="lp" style={{ background: art?.light ? "#2b3140" : "#fff" }}>{art === undefined ? null : <img src={art ? art.cut : url} alt={alt} />}</span>;
  // on its shirt: the art with its background and white fill taken off, so a logo saved on a white square doesn't show a
  // white box on the shirt (Oct 28, Nick on the Artwork page: "He Makes a Way with white box… The Lord is my shepherd
  // doesn't have the white knocked out")
  return (
    <span className="lp" style={{ background: shirt ? bg : art?.light ? "#2b3140" : "#fff" }}>
      {shirt && art === undefined ? null : <img src={shirt && art ? art.cut : url} alt={alt} />}
    </span>
  );
}

/* ---------- the logo painted in the inks it printed in (Imprint.inkMap): each file color → its ink, "none" left off ---------- */
const PAINTED = new Map<string, Promise<string | null>>();
const rgbOf = (h: string) => { const v = parseInt((h || "").replace("#", "").slice(0, 6), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
function paint(url: string, map: Record<string, { hex: string; name: string }>): Promise<string | null> {
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onerror = () => res(null);
    img.onload = () => {
      try {
        const k = Math.min(1, 500 / Math.max(img.naturalWidth, img.naturalHeight));
        const W = Math.max(1, Math.round(img.naturalWidth * k)), H = Math.max(1, Math.round(img.naturalHeight * k));
        const c = document.createElement("canvas"); c.width = W; c.height = H;
        const g = c.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(img, 0, 0, W, H);
        const px = g.getImageData(0, 0, W, H), p = px.data;
        const keys = Object.entries(map).map(([from, to]) => ({ f: rgbOf(from), t: to.name === "none" || !to.hex ? null : rgbOf(to.hex) }));
        // a picture on a solid square: that square isn't printed (unless the map prints it)
        const edge: number[] = [];
        for (let x = 0; x < W; x += 2) edge.push(x, (H - 1) * W + x);
        for (let y = 0; y < H; y += 2) edge.push(y * W, y * W + W - 1);
        const solid = edge.filter((i) => p[i * 4 + 3] > 200);
        let bg: number[] | null = null;
        if (solid.length / edge.length > 0.6) {
          const mid = (j: number) => solid.map((i) => p[i * 4 + j]).sort((a, b) => a - b)[Math.floor(solid.length / 2)];
          bg = [mid(0), mid(1), mid(2)];
          const kept = keys.find((x) => Math.hypot(x.f[0] - bg![0], x.f[1] - bg![1], x.f[2] - bg![2]) < 30);
          if (kept?.t) bg = null;
        }
        for (let i = 0; i < p.length; i += 4) {
          if (p[i + 3] < 8) continue;
          const r = p[i], gg = p[i + 1], b = p[i + 2];
          if (bg && Math.hypot(r - bg[0], gg - bg[1], b - bg[2]) < 40) { p[i + 3] = 0; continue; }
          let best = keys[0], bd = Infinity;
          for (const x of keys) { const d = Math.hypot(r - x.f[0], gg - x.f[1], b - x.f[2]); if (d < bd) { bd = d; best = x; } }
          if (!best?.t) { p[i + 3] = 0; continue; }
          p[i] = best.t[0]; p[i + 1] = best.t[1]; p[i + 2] = best.t[2];
        }
        g.putImageData(px, 0, 0);
        res(c.toDataURL("image/png"));
      } catch { res(null); }
    };
    img.src = url;
  });
}
function usePainted(url: string, map?: Record<string, { hex: string; name: string }> | null): string | null | undefined {
  const [v, setV] = useState<string | null | undefined>(undefined);
  const key = url && map ? keyOf(url) + "|" + JSON.stringify(map) : "";
  useEffect(() => {
    let on = true;
    if (!key || !map) { setV(null); return; }
    if (!PAINTED.has(key)) PAINTED.set(key, paint(url, map));
    PAINTED.get(key)!.then((r) => { if (on) setV(r); });
    return () => { on = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}
/** the logo in the inks it printed in, on its shirt */
export function PaintedPic({ url, map, shirt, alt }: { url: string; map: Record<string, { hex: string; name: string }>; shirt: string; alt: string }) {
  const src = usePainted(url, map), bg = useShirtBg(shirt);
  if (src === null) return <LogoPic url={url} alt={alt} shirt={shirt} />;
  return <span className="lp" style={{ background: bg }}>{src ? <img src={src} alt={alt} /> : null}</span>;
}

/**
 * A logo's face on a tile, the same everywhere: its own first background (Edit logo → Backgrounds) when it has one;
 * else how it last printed (Imprint.shownArt, the art as the mockup showed it: inks painted, background off) on that
 * order's shirt; else the logo itself on the shirt it was printed on (Oct 28, Nick: "the Keslow camera D10252 has the red
 * square still instead of how we actually did it").
 */
export function LogoFace({ d, urls, shirt, shown, printed }: { d: Pick<Design, "id" | "name" | "specs">; urls: Record<string, string>; shirt?: string; shown?: { url: string; shirt: string } | null;
  /** how it last printed when there's no mockup picture: the ink map, or its one ink, on that shirt (lib/logoShirts.ts logoPrintFrom) */
  printed?: { shirt: string; map?: Record<string, { hex: string; name: string }>; ink?: string } | null }) {
  const v = onShirtsOf(d)[0], own = v?.path ? urls[v.path] : "";
  if (v && urls[d.id]) return <ShirtView className="main" url={own || urls[d.id]} shirt={v.shirt} ink={own ? AS_IS : v.ink} />;
  if (shown?.url) return <LogoPic url={shown.url} alt={d.name} shirt={shown.shirt || shirt} />;
  if (urls[d.id] && printed?.map && printed.shirt) return <PaintedPic url={urls[d.id]} map={printed.map} shirt={printed.shirt} alt={d.name} />;
  if (urls[d.id] && printed?.ink && printed.shirt) return <ShirtView className="main" url={urls[d.id]} shirt={printed.shirt} ink={printed.ink} />;
  return urls[d.id] ? <LogoPic url={urls[d.id]} alt={d.name} shirt={printed?.shirt || shirt} /> : null;
}
