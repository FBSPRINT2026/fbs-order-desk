"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { guessHex, isHeather, shirtBg, ssImg } from "@/lib/mockup";

/**
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
        // a patch from the middle of the body (flat-lay photos: the shirt fills the frame, the chest is clear)
        const P = Math.max(24, Math.round(W * 0.07)), x = Math.round(W * 0.5 - P / 2), y = Math.round(H * 0.56 - P / 2);
        const S = P * 2; // blown up 2x
        const c = document.createElement("canvas"); c.width = S * 2; c.height = S * 2;
        const g = c.getContext("2d")!;
        g.imageSmoothingQuality = "high";
        // mirrored four ways, so the tile repeats without seams
        for (const [fx, fy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
          g.save(); g.translate(fx < 0 ? S * 2 : 0, fy < 0 ? S * 2 : 0); g.scale(fx, fy);
          g.drawImage(im, x, y, P, P, 0, 0, S, S);
          g.restore();
        }
        // even out the photo's shading (folds, light falloff): keep the knit's fine texture on one even tone
        const blur = document.createElement("canvas"); blur.width = c.width; blur.height = c.height;
        const bg = blur.getContext("2d")!; bg.filter = `blur(${Math.max(3, Math.round(S / 8))}px)`; bg.drawImage(c, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height), p = d.data, q = bg.getImageData(0, 0, c.width, c.height).data;
        const n = p.length / 4, avg = [0, 0, 0];
        for (let i = 0; i < p.length; i += 4) { avg[0] += p[i]; avg[1] += p[i + 1]; avg[2] += p[i + 2]; }
        if (!n) return res(null);
        avg.forEach((v, j) => { avg[j] = v / n; });
        for (let i = 0; i < p.length; i += 4) for (let j = 0; j < 3; j++) p[i + j] = Math.max(0, Math.min(255, avg[j] + (p[i + j] - q[i + j]) * 1.15));
        g.putImageData(d, 0, 0);
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
