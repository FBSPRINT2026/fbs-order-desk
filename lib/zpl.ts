import { SITE_URL } from "@/lib/config";
import type { JobCard } from "@/lib/jobCard";
import { bySize } from "@/lib/checkinShared";
import { qrSvg } from "@/lib/qr";
import { code128Modules } from "@/lib/barcode";

/**
 * Zebra labels (ZPL) for the ZT231: 4×6 box labels and a test label. Laid out on a 203 dpi grid (812 × 1218 dots)
 * and scaled for 300 dpi printers. The QR code (the job's phone menu) and the Code 128 barcode (order-box, for the
 * shipping scanner and the employee app) are drawn by the printer itself.
 */
export const jobLink = (number: string | number, box?: number | null) => `${SITE_URL}/j/${number}${box ? `-${box}` : ""}`;

/** text for a ^FD field: ^FH lets us hex-escape the characters ZPL uses itself */
/**
 * Plain letters only (Nick, Nov 13: "50000-1 Â· scan", "FedEx Ground Â· Nine18"): the printer read "·" as two odd
 * characters, and any accent, curly quote or dash would do the same. Punctuation becomes its plain twin, accents come off.
 */
export const plain = (s: string) => String(s ?? "")
  .replace(/[·•]/g, "-").replace(/[‐-―−]/g, "-").replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/…/g, "...").replace(/×/g, "x")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "");
const fd = (s: string) => "^FH_^FD" + plain(s).replace(/[_^~\\]/g, (c) => "_" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")).replace(/[\r\n]+/g, " ") + "^FS";

const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/**
 * Draws a label once, two ways: the ZPL the Zebra prints, and an SVG picture of the same label (the Outbound pop-up's
 * preview), so what's shown is always what prints. The SVG is on the 203 dpi grid (812 × 1218).
 */
class Z {
  out: string[] = [];
  pic: string[] = [];
  /** filled boxes so far: text drawn reversed (^FR) over one comes out white */
  private fills: { x: number; y: number; w: number; h: number }[] = [];
  constructor(public k: number) {}
  n = (v: number) => Math.round(v * this.k);
  /** text at x,y (dots at 203 dpi), height h; w = width for wrapping (lines = max lines), align L/C/R */
  text(x: number, y: number, h: number, s: string, o: { w?: number; lines?: number; align?: "L" | "C" | "R"; reverse?: boolean; wide?: number } = {}) {
    const { n } = this;
    this.out.push(`^FO${n(x)},${n(y)}${o.reverse ? "^FR" : ""}^A0N,${n(h)},${n(o.wide ?? h)}${o.w ? `^FB${n(o.w)},${o.lines || 1},0,${o.align || "L"},0` : ""}${fd(s)}`);
    const white = o.reverse && this.fills.some((f) => x >= f.x - 1 && x < f.x + f.w && y >= f.y - 1 && y < f.y + f.h);
    const w = o.w || 812 - x, lines = o.lines || 1, al = o.align === "C" ? "center" : o.align === "R" ? "right" : "left";
    // the Zebra's font is narrow (about half its height per letter): draw Arial squeezed to match, wrapping at the same width
    const sq = 0.74;
    this.pic.push(`<foreignObject x="${x}" y="${y}" width="${w}" height="${h * lines * 1.05}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${w / sq}px;font:700 ${h}px/${h * 1.02}px Arial,'Helvetica Neue',sans-serif;color:${white ? "#fff" : "#000"};text-align:${al};white-space:${lines > 1 ? "normal" : "nowrap"};overflow:hidden;max-height:${h * lines * 1.05}px;transform:scaleX(${sq});transform-origin:${al === "center" ? "center" : al} top;margin-left:${al === "center" ? (w - w / sq) / 2 : al === "right" ? w - w / sq : 0}px">${esc(plain(s))}</div></foreignObject>`);
  }
  box(x: number, y: number, w: number, h: number, t = 2, fill = false) {
    const { n } = this; this.out.push(`^FO${n(x)},${n(y)}^GB${n(w)},${n(h)},${fill ? n(Math.min(w, h)) : Math.max(1, n(t))}^FS`);
    if (fill) { this.fills.push({ x, y, w, h }); this.pic.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#000"/>`); }
    else { const tt = Math.max(1, t); this.pic.push(`<rect x="${x + tt / 2}" y="${y + tt / 2}" width="${Math.max(0, w - tt)}" height="${Math.max(0, h - tt)}" fill="none" stroke="#000" stroke-width="${tt}"/>`); }
  }
  line(x: number, y: number, w: number, h: number) { this.box(x, y, Math.max(w, 2), Math.max(h, 2), Math.min(Math.max(w, 2), Math.max(h, 2)), true); }
  qr(x: number, y: number, mag: number, data: string) {
    const { n } = this; this.out.push(`^FO${n(x)},${n(y)}^BQN,2,${Math.max(2, Math.round(mag * this.k))}^FDMA,${data}^FS`);
    const q = qrSvg(data, 0), m = Math.max(2, Math.round(mag)), size = q.modules * m;
    this.pic.push(q.svg.replace("<svg ", `<svg x="${x}" y="${y + 10}" width="${size}" height="${size}" `));
  }
  code128(x: number, y: number, h: number, data: string, module = 2) {
    const { n } = this; this.out.push(`^FO${n(x)},${n(y)}^BY${Math.max(1, Math.round(module * this.k))},3,${n(h)}^BCN,${n(h)},N,N,N^FD${data}^FS`);
    let bx = x; const bars: string[] = [];
    code128Modules(data).forEach((w, i) => { if (i % 2 === 0) bars.push(`<rect x="${bx}" y="${y}" width="${w * module}" height="${h}"/>`); bx += w * module; });
    this.pic.push(`<g fill="#000">${bars.join("")}</g>`);
  }
  zpl() { return `^XA^CI28^PW${this.n(812)}^LL${this.n(1218)}^LH0,0\n${this.out.join("\n")}\n^XZ`; }
  svg() { return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 812 1218" shape-rendering="crispEdges"><rect width="812" height="1218" fill="#fff"/>${this.pic.join("")}</svg>`; }
}

/** One 4×6 box label: box `box` of `of` (of = 0 → "BOX __ OF __" to write in). */
export function boxLabelZpl(j: JobCard, box: number, of: number, dpi = 203): string {
  return drawBoxLabel(new Z(dpi / 203), j, box, of).zpl();
}
/** The same box label as a picture (SVG), for the preview before it prints. */
export function boxLabelSvg(j: JobCard, box: number, of: number): string {
  return drawBoxLabel(new Z(1), j, box, of).svg();
}

function drawBoxLabel(z: Z, j: JobCard, box: number, of: number): Z {
  const L = 22, W = 812 - 2 * L;
  // header: job number + who it's from, delivery tag, box count
  z.text(L, 24, 92, `#${j.number}`, { w: 340 });
  // delivery tag, and RUSH under it
  const tag = j.delivery === "ship" ? "SHIP" : j.delivery === "deliver" ? "DELIVERY" : "PICKUP";
  z.box(372, 20, 196, 46, 0, true); z.text(372, 28, 34, tag, { w: 196, align: "C", reverse: true });
  if (j.rush) { z.box(372, 74, 196, 46, 0, true); z.text(372, 82, 34, "RUSH", { w: 196, align: "C", reverse: true }); }
  z.text(590, 18, 34, "BOX", { w: W - 568, align: "R" });
  if (of) z.text(590, 52, 64, `${box} OF ${of}`, { w: W - 568, align: "R" });
  else { z.line(596, 104, 64, 4); z.text(664, 64, 40, "OF", { w: 60, align: "C" }); z.line(W + L - 64, 104, 64, 4); } // box count not known yet: written in
  z.line(L, 132, W, 4);

  // job name + PO on the left, the QR (phone menu) on the right, the barcode under the name
  // the customer, the whole job name and the PO (Nick, Nov 13: the QR scanner reads the square code, so no barcode,
  // and the QR opens everything else: no ship-to, dates or ship method), stacked by how many lines each takes
  const lines = (s: string, h: number, w: number) => Math.max(1, Math.ceil((plain(s).length * 0.42 * h) / w));
  const TW = 550; let y = 150;
  const cust = j.customer || j.brand || "";
  if (cust) { const n = Math.min(2, lines(cust, 50, TW)); z.text(L, y, 50, cust, { w: TW, lines: n }); y += n * 50 + 10; }
  const nm = j.name || "Untitled job", nn = Math.min(3, lines(nm, 38, TW));
  z.text(L, y, 38, nm, { w: TW, lines: nn }); y += nn * 38 + 12;
  if (j.po) { z.text(L, y, 46, `PO ${j.po}`, { w: TW }); y += 46; }
  z.qr(600, 140, 4.6, jobLink(j.number, box || null));
  z.text(586, 318, 20, "SCAN FOR THE JOB", { w: 204, align: "C" });

  // the size grid: what was ordered, with room to write what's in this box
  const rows = j.groups.flatMap((g) => g.rows);
  const sizes = [...new Set(rows.flatMap((r) => r.sizes.map((s) => s.label)))].sort((a, b) => bySize(a.toUpperCase(), b.toUpperCase()));
  const gy = Math.max(y, 340) + 18, foot = 1218 - 92;
  // rows grow to fill the label (room to write what's in the box); at least 54 dots each
  const maxRows = Math.max(1, Math.min(rows.length, Math.floor((foot - gy - 80) / 54)));
  const rh = Math.min(320, Math.floor((foot - gy - 80) / Math.max(1, maxRows)));
  const itemW = sizes.length > 8 ? 190 : 230, cols = sizes.length + 1, cw = Math.floor((W - itemW) / Math.max(1, cols));
  z.box(L, gy, W, 38, 0, true);
  z.text(L + 8, gy + 8, 24, "ITEM", { reverse: true });
  sizes.forEach((s, i) => z.text(L + itemW + i * cw, gy + 8, 24, s, { w: cw, align: "C", reverse: true }));
  z.text(L + itemW + sizes.length * cw, gy + 8, 24, "TOTAL", { w: cw, align: "C", reverse: true });
  rows.slice(0, maxRows).forEach((r, ri) => {
    const y = gy + 38 + ri * rh;
    z.box(L, y, W, rh, 2);
    z.text(L + 6, y + 6, 24, r.style || r.desc || "Item", { w: itemW - 10 });
    z.text(L + 6, y + 32, 20, r.color, { w: itemW - 10 });
    sizes.forEach((s, i) => {
      const x = L + itemW + i * cw, q = r.sizes.find((v) => v.label === s)?.qty || 0;
      z.line(x, y, 2, rh);
      if (q) z.text(x + 5, y + 4, 22, String(q));
      else z.line(x + cw * 0.3, y + rh / 2, cw * 0.4, 3);
    });
    const tx = L + itemW + sizes.length * cw;
    z.line(tx, y, 2, rh); z.text(tx + 5, y + 4, 22, String(r.total));
  });
  const after = gy + 38 + Math.min(rows.length, maxRows) * rh + 8;
  if (rows.length > maxRows) z.text(L, after, 22, `+ ${rows.length - maxRows} more item${rows.length - maxRows === 1 ? "" : "s"} (see the work order)`);
  else if (!rows.length) z.text(L, after, 24, "No garments on this order yet.");
  z.text(L, foot - 40, 22, "Small # = ordered. Write in what's in this box.", { w: 500 });
  z.text(L + 500, foot - 40, 24, `Order: ${j.qty} pcs`, { w: W - 500, align: "R" });

  // footer
  z.box(L, foot, W, 70, 3);
  z.text(L + 10, foot + 10, 22, "PACKED BY");
  z.line(L + 470, foot, 3, 70);
  z.text(L + 470, foot + 20, 34, "THANK YOU!", { w: W - 470, align: "C" });
  return z;
}

/** A small label to check the printer, its darkness and that the QR scans. */
export function testLabelZpl(dpi = 203, by = ""): string {
  const z = new Z(dpi / 203);
  z.text(30, 40, 60, "FBS PRINT");
  z.text(30, 110, 34, "Label printer test");
  z.text(30, 156, 26, new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }) + (by ? ` · ${by}` : ""), { w: 750 });
  z.box(30, 210, 752, 4, 4, true);
  z.code128(30, 240, 80, "TEST-1234", 2);
  z.qr(560, 230, 5, `${SITE_URL}/shop/shipping`);
  z.text(30, 340, 26, `${dpi} dpi · 4 x 6`, { w: 500 });
  z.text(30, 380, 22, "Scan the square code with a phone: it opens the Shipping Center.", { w: 500, lines: 2 });
  return z.zpl();
}
