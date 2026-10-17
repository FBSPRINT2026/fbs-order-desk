"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { guessHex, isHeather, shirtBg, ssImg } from "@/lib/mockup";

/**
 * NOTE: lib/fabric.ts is the garment fabric content (poly %, specialty); this file is the heather swatch tiles.
 * Real heather fabric for shirt swatches (Oct 16, Nick: "go into the other colors and take a blow up and crop out some
 * of the actual fabric"). For a heather color, the blank's flat photo from the supplier (any catalog style that has the
 * color, popular blanks first) is loaded through our image link, a small patch of the body is cropped, enlarged 2×
 * and mirrored into a seamless tile. Made once per color per visit; the drawn heather shows until then (or when no
 * photo has that color).
 */
const PREF = ["64000", "5000", "3001CVC", "3001", "2000", "G500", "PC54", "6210", "3413", "BC3001", "BC3001CVC", "3600", "8000"];
type Cat = { style: string; color_images: Record<string, { front?: string }> | null };
let catalog: Promise<Cat[]> | null = null;
const tiles = new Map<string, Promise<string | null>>();
const norm = (c: string) => (c || "").toLowerCase().replace(/grey/g, "gray").replace(/[^a-z0-9]/g, "");

function photoFor(color: string): Promise<string | null> {
  catalog ||= Promise.resolve(createClient().from("garments").select("style, color_images").in("style", PREF))
    .then(({ data }) => ((data || []) as Cat[]).sort((a, b) => PREF.indexOf(a.style) - PREF.indexOf(b.style)))
    .catch(() => []);
  return catalog.then((cat) => {
    const want = norm(color);
    for (const g of cat) {
      const hit = Object.entries(g.color_images || {}).find(([k]) => norm(k) === want);
      if (hit?.[1]?.front) return hit[1].front;
    }
    return null;
  });
}

function makeTile(src: string): Promise<string | null> {
  return new Promise((res) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onerror = () => res(null);
    im.onload = () => {
      try {
        const W = im.naturalWidth, H = im.naturalHeight;
        // a patch from the middle of the body (flat-lay photos: the shirt fills the frame, the chest is clear),
        // blown up 1.5x
        const P = Math.max(32, Math.round(W * 0.13)), x = Math.round(W * 0.5 - P / 2), y = Math.round(H * 0.55 - P / 2);
        const S = Math.round(P * 1.5);
        const a = document.createElement("canvas"); a.width = S; a.height = S;
        const ga = a.getContext("2d", { willReadFrequently: true })!;
        ga.imageSmoothingQuality = "high";
        ga.drawImage(im, x, y, P, P, 0, 0, S, S);
        // even out the photo's shading (folds, light falloff): keep the knit's fine texture on one even tone
        const blur = document.createElement("canvas"); blur.width = S; blur.height = S;
        const gb = blur.getContext("2d")!; gb.filter = `blur(${Math.max(4, Math.round(S / 7))}px)`; gb.drawImage(a, 0, 0);
        const src = ga.getImageData(0, 0, S, S).data, low = gb.getImageData(0, 0, S, S).data;
        const avg = [0, 0, 0], n = S * S;
        for (let i2 = 0; i2 < src.length; i2 += 4) { avg[0] += src[i2]; avg[1] += src[i2 + 1]; avg[2] += src[i2 + 2]; }
        avg.forEach((v, k) => { avg[k] = v / n; });
        const flat = new Float32Array(n * 3);
        for (let q = 0; q < n; q++) for (let k = 0; k < 3; k++) flat[q * 3 + k] = avg[k] + (src[q * 4 + k] - low[q * 4 + k]) * 1.1;
        // seamless without mirroring: cross-fade with itself shifted half a tile, so every edge meets its own
        // continuation (mirroring made a kaleidoscope pattern, Oct 16)
        const h = Math.floor(S / 2), wt = (d: number) => Math.min(1, Math.max(0, (1 - Math.abs(d - h) / h) * 2.2));
        // across first, then down: each pass hides the other's seam
        const pass = (A: Float32Array, dx: number, dy: number) => {
          const B = new Float32Array(n * 3);
          for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
            const w = wt(dx ? xx : yy), q = yy * S + xx, q2 = ((yy + dy) % S) * S + ((xx + dx) % S);
            for (let k = 0; k < 3; k++) B[q * 3 + k] = A[q * 3 + k] * w + A[q2 * 3 + k] * (1 - w);
          }
          return B;
        };
        const fin = pass(pass(flat, h, 0), 0, h);
        const c = document.createElement("canvas"); c.width = S; c.height = S;
        const g = c.getContext("2d")!, out = g.createImageData(S, S), o = out.data;
        for (let q = 0; q < n; q++) { for (let k = 0; k < 3; k++) o[q * 4 + k] = Math.max(0, Math.min(255, fin[q * 3 + k])); o[q * 4 + 3] = 255; }
        g.putImageData(out, 0, 0);
        res(c.toDataURL("image/jpeg", 0.9));
      } catch { res(null); }
    };
    im.src = src;
  });
}

/** a tile of the real fabric for a heather color (data URL), or null */
export function fabricTile(color: string): Promise<string | null> {
  const k = norm(color);
  if (!tiles.has(k)) tiles.set(k, photoFor(color).then((p) => (p ? makeTile(ssImg(p)) : null)).catch(() => null));
  return tiles.get(k)!;
}

/** CSS background for a shirt color: the real fabric for heathers once it's loaded, else the drawn one / flat color */
export function useShirtBg(color: string, tilePx = 120): string {
  const [tile, setTile] = useState("");
  useEffect(() => {
    let on = true;
    setTile("");
    if (isHeather(color)) fabricTile(color).then((t) => { if (on && t) setTile(t); });
    return () => { on = false; };
  }, [color]);
  return tile ? `url("${tile}") 0 0 / ${tilePx}px ${tilePx}px, ${guessHex(color)}` : shirtBg(color);
}
