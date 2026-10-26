"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { colorHex, detectColors, paintPrint } from "@/lib/inkColors";
import { inkNames, type Imprint } from "@/lib/pricing";

/** cut exactly to the art (the painter leaves a small clear margin), so the measured width × height lines meet its edges */
export function tight(c: HTMLCanvasElement): HTMLCanvasElement {
  const W = c.width, H = c.height, d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0 || (x0 === 0 && y0 === 0 && x1 === W - 1 && y1 === H - 1)) return c;
  const o = document.createElement("canvas"); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext("2d")!.drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}

type Box = { x: number; y: number; w: number; h: number; of: { w: number; h: number } };

/**
 * A print's art in the inks picked for it in the Mockup Creator (imprint.inkMap), else as uploaded. Used on the proof
 * and the work order so the close-up matches the mockup (Oct 20: art set to yellow still showed its uploaded green).
 *
 * Painted by the one print painter (lib/inkColors paintPrint), the same as the order's print tiles, the production
 * mockup and the Mockup Creator (Oct 26, Nick on the work order: "the graphic images still look bad… the same problem
 * we were having on the invoices on Saturday… it looks grainy"): small art is drawn up to 3× before it's painted so the
 * edges stay smooth, the white page comes off, white in the art is the shirt for spot colors with no white ink, and the
 * result is cut to the art.
 */
const rgbOf = (h: string) => { const x = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) || 0); };
const dist = (a: string, b: string) => { const p = rgbOf(a), q = rgbOf(b); return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; };

export default function PaintedArt({ src, imp, inkMap, designId, className, style, alt, hires, hiresName, crop, swap }: {
  src: string; imp?: Pick<Imprint, "inks" | "colors" | "method">;
  /** a color change (Imprint.inkBy for one garment color): ink name (lower case) → the ink printed instead (Oct 26) */ swap?: Record<string, string> | null; inkMap?: Imprint["inkMap"]; designId?: string; className?: string; style?: CSSProperties; alt?: string;
  /** the original vector file (signed link): the saved PDF draws the art from it at full resolution */ hires?: string; hiresName?: string;
  /** where the art sits in the file: shown cut to it until the painted (already cut) picture is ready */ crop?: Box | null;
}) {
  const im = inkMap && inkMap.design === designId ? inkMap.map : null;
  const want: Record<string, string> = {};
  const sw = swap && Object.keys(swap).length ? swap : null;
  if (im) for (const [s, v] of Object.entries(im)) {
    const to = sw && v.name ? sw[v.name.trim().toLowerCase()] : "";
    want[s] = v.name === "none" || !v.hex ? "none" : (to && colorHex(to)) || v.hex;
  }
  const targets = Object.values(want).filter((v) => v !== "none").map((v) => v.toLowerCase());
  const dropWhite = imp?.method !== "dtf" && (imp?.colors || 0) > 0 && (imp?.colors || 0) < 11 && !/white/i.test(imp?.inks || "") && !targets.some((h) => /^#?f[a-f0-9]f[a-f0-9]f[a-f0-9]$/i.test(h));
  const changed = Object.entries(want).some(([s, v]) => v === "none" || v.toLowerCase() !== s.toLowerCase());
  const key = `${JSON.stringify(want)}|${dropWhite ? "w" : ""}|${sw && !im ? JSON.stringify(sw) : ""}`;
  const [out, setOut] = useState("");
  useEffect(() => {
    let live = true;
    setOut("");
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        let w = want;
        // a color change on art with no ink picks: each of its colors goes to the nearest of the print's inks, then swapped
        if (sw && !im) {
          const inks = inkNames(imp?.inks || "").map((n) => ({ n, hex: colorHex(n) })).filter((x) => x.hex) as { n: string; hex: string }[];
          w = {};
          for (const q of detectColors(img)) {
            if (q.share < 0.004) continue;
            const near = inks.length === 1 ? inks[0] : inks.slice().sort((a, b) => dist(a.hex, q.hex) - dist(b.hex, q.hex))[0];
            const to = near ? sw[near.n.toLowerCase()] : "";
            if (to && colorHex(to)) w[q.hex.toUpperCase()] = colorHex(to)!;
          }
        }
        const u = tight(paintPrint(img, w, { paper: dropWhite, maxSide: 1800 })).toDataURL("image/png"); if (live) setOut(u);
      } catch { /* can't read the picture: as uploaded */ }
    };
    img.src = src;
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, key]);
  // the saved PDF paints it again from the same file, bigger (PrintButton cropAtFullSize)
  const data = { "data-hires": hires || undefined, "data-hires-name": hiresName || undefined, "data-inkmap": changed ? JSON.stringify(want) : undefined, "data-src": out ? src : undefined, "data-paint": out && !(sw && !im) ? JSON.stringify({ want, paper: dropWhite }) : undefined };
  // eslint-disable-next-line @next/next/no-img-element
  if (out || !crop) return <img className={className} style={style} src={out || src} alt={alt || ""} {...data} />;
  // not painted yet (or can't be): the file as uploaded, cut to where the art sits
  return (
    <div className={className} style={{ ...style, overflow: "hidden" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt || ""} {...data}
        style={{ position: "absolute", maxWidth: "none", left: `${(-crop.x / crop.w) * 100}%`, top: `${(-crop.y / crop.h) * 100}%`, width: `${(crop.of.w / crop.w) * 100}%`, height: `${(crop.of.h / crop.h) * 100}%` }} />
    </div>
  );
}
