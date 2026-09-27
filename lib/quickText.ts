"use client";
import { FONTS_CSS_URL, fontOf, type DesignDoc } from "@/lib/designerArt";

/** Put the shirt fonts on the page (once), so text can be drawn in them. */
let fontsReady: Promise<void> | null = null;
export function loadShirtFonts(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  if (fontsReady) return fontsReady;
  const have = document.getElementById("sd-fonts") as HTMLLinkElement | null;
  if (have?.sheet) return (fontsReady = Promise.resolve());
  fontsReady = new Promise<void>((res) => {
    const ln = have || document.createElement("link");
    ln.addEventListener("load", () => res()); ln.addEventListener("error", () => res());
    setTimeout(res, 4000);
    if (!have) { ln.id = "sd-fonts"; ln.rel = "stylesheet"; ln.href = FONTS_CSS_URL; document.head.appendChild(ln); }
  });
  return fontsReady;
}

/** A few words typed straight into the Mockup Creator (no Idea Lab needed). */
export type QuickText = { text: string; font: string; /** 0 straight, 1 arch, -1 smile */ arc: number; color: { name: string; hex: string } };
const SWEEP = (70 * Math.PI) / 180;

/** Cut a canvas down to its painted pixels. */
function trim(c: HTMLCanvasElement) {
  const x = c.getContext("2d")!;
  const { data, width: w, height: h } = x.getImageData(0, 0, c.width, c.height);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let X = 0; X < w; X++) if (data[(y * w + X) * 4 + 3] > 8) { if (X < x0) x0 = X; if (X > x1) x1 = X; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const pad = 2, out = document.createElement("canvas");
  out.width = x1 - x0 + 1 + pad * 2; out.height = y1 - y0 + 1 + pad * 2;
  out.getContext("2d")!.drawImage(c, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Draw the text as a transparent PNG (straight lines, or one line on an arch / smile). px = font size in pixels. */
export async function renderQuickText(q: QuickText, px = 160): Promise<{ url: string; w: number; h: number } | null> {
  await loadShirtFonts();
  const f = fontOf(q.font), font = `${f.weight} ${px}px '${f.name}'`;
  try { await document.fonts?.load?.(font, q.text); } catch { /* falls back to a system font */ }
  const c = document.createElement("canvas"), x = c.getContext("2d")!;
  x.font = font;
  const lines = q.text.split("\n").map((l) => l.trimEnd());
  const curved = q.arc !== 0 && lines.length === 1 && lines[0].trim();
  if (!curved) {
    const lh = px * 1.1, widths = lines.map((l) => x.measureText(l).width);
    c.width = Math.ceil(Math.max(10, ...widths) + px); c.height = Math.ceil(lines.length * lh + px);
    x.font = font; x.fillStyle = q.color.hex; x.textAlign = "center"; x.textBaseline = "middle";
    lines.forEach((l, i) => x.fillText(l, c.width / 2, px / 2 + (i + 0.5) * lh));
  } else {
    const t = lines[0], tw = x.measureText(t).width, R = Math.max(px, tw / SWEEP), h = SWEEP / 2;
    c.width = Math.ceil(2 * R * Math.sin(h) + px * 2); c.height = Math.ceil(R * (1 - Math.cos(h)) + px * 2.6);
    x.font = font; x.fillStyle = q.color.hex; x.textAlign = "center"; x.textBaseline = "alphabetic";
    const up = q.arc > 0, cx = c.width / 2;
    // arch: circle center below the top line; smile: circle center above the bottom line
    const cy = up ? px * 1.3 + R : c.height - px * 0.6 - R;
    let s = -tw / 2;
    for (const ch of t) {
      const w = x.measureText(ch).width, th = (s + w / 2) / R;
      x.save();
      if (up) { x.translate(cx + R * Math.sin(th), cy - R * Math.cos(th)); x.rotate(th); }
      else { x.translate(cx + R * Math.sin(th), cy + R * Math.cos(th)); x.rotate(-th); }
      x.fillText(ch, 0, 0);
      x.restore();
      s += w;
    }
  }
  const out = trim(c);
  if (!out) return null;
  return { url: out.toDataURL("image/png"), w: out.width, h: out.height };
}

/** The same words as an Idea Lab design, so "do more with it" starts from what they typed. */
export function quickTextDoc(q: QuickText): DesignDoc {
  return { v: 1, w: 600, h: 700, layers: [{ id: "qt1", kind: "text", text: q.text, font: q.font, size: q.text.includes("\n") ? 70 : 90, color: q.color.hex, stroke: "", strokeW: 0, spacing: 0, arc: q.text.includes("\n") ? 0 : q.arc * 60, x: 300, y: 220, rot: 0, s: 1 }] };
}
