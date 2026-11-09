/**
 * Art copied in Illustrator and pasted here (Nov 1, Nick: "if I grab an element in Illustrator… copy… paste into the
 * helper… treat that like a vector file"). With Illustrator's "Copy As: SVG Code" on (Preferences → File Handling →
 * Clipboard), a copy puts the art on the clipboard as SVG text: still vector, its own colors, and its size in points
 * (72 to the inch). Without it, the browser only gets a picture. Pure, so it can be tested.
 */
import { fitRoundedImages } from "@/lib/svgFit";

export type PastedSvg = { svg: string; wPt: number; hPt: number };

/** the SVG in what was pasted, or null; sized for showing (Illustrator's code often has only a viewBox) */
export function pastedSvg(text: string): PastedSvg | null {
  const at = text.search(/<svg[\s>]/i);
  if (at < 0) return null;
  const end = text.toLowerCase().lastIndexOf("</svg>");
  if (end < at) return null;
  let svg = text.slice(at, end + 6);
  const open = svg.slice(0, svg.indexOf(">") + 1);
  const vb = /viewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)/i.exec(open);
  const num = (k: string) => { const m = new RegExp(`\\s${k}\\s*=\\s*["']\\s*([\\d.]+)\\s*(px|pt|in|mm|cm)?`, "i").exec(open); if (!m) return 0; const v = +m[1]; return m[2] === "in" ? v * 72 : m[2] === "mm" ? (v * 72) / 25.4 : m[2] === "cm" ? (v * 72) / 2.54 : v; };
  const wPt = num("width") || (vb ? +vb[3] : 0), hPt = num("height") || (vb ? +vb[4] : 0);
  if (!(wPt > 0 && hPt > 0)) return null;
  if (!/xmlns\s*=/.test(open)) svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  // a size to show it at (a picture of a viewBox-only SVG comes out 300 × 150), the shape kept
  if (!/\swidth\s*=/.test(open) || !/\sheight\s*=/.test(open) || /\s(width|height)\s*=\s*["'][\d.]+%/.test(open)) {
    const k = 1200 / Math.max(wPt, hPt);
    svg = svg.replace(/<svg([^>]*)>/i, (_m, a: string) => `<svg${a.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, "")} width="${Math.round(wPt * k)}" height="${Math.round(hPt * k)}"${vb ? "" : ` viewBox="0 0 ${wPt} ${hPt}"`}>`);
  }
  // a picture inside it set back to the art's exact box (Illustrator rounds its scale, and its clip cut the edge off)
  svg = fitRoundedImages(svg).svg;
  return { svg, wPt, hPt };
}

/**
 * How wide each pasted piece prints. Art copied off a mockup is drawn at the mockup's scale, not the print's, so sizes
 * are read against each other: art at a real size (1" to 15" at 72 to the inch, as an art file is) keeps it; art that's
 * all small (copied off a shirt picture) is scaled so the biggest piece is a full print (11"), the rest in proportion.
 */
export function pastedWidths(wPts: number[]): number[] {
  const big = Math.max(...wPts);
  const real = big / 72 >= 5.5 && big / 72 <= 15;
  const k = real ? 1 / 72 : wPts.length > 1 ? 11 / big : 0;
  return wPts.map((w) => (k ? Math.max(1, Math.round(w * k * 4) / 4) : 10));
}
