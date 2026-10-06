import { SITE_URL } from "@/lib/config";
import type { JobCard } from "@/lib/jobCard";
import { bySize } from "@/lib/checkinShared";

/**
 * Zebra labels (ZPL) for the ZT231: 4×6 box labels and a test label. Laid out on a 203 dpi grid (812 × 1218 dots)
 * and scaled for 300 dpi printers. The QR code (the job's phone menu) and the Code 128 barcode (order-box, for the
 * shipping scanner and the employee app) are drawn by the printer itself.
 */
export const jobLink = (number: string | number, box?: number | null) => `${SITE_URL}/j/${number}${box ? `-${box}` : ""}`;

/** text for a ^FD field: ^FH lets us hex-escape the characters ZPL uses itself */
const fd = (s: string) => "^FH_^FD" + String(s ?? "").replace(/[_^~\\]/g, (c) => "_" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")).replace(/[\r\n]+/g, " ") + "^FS";

class Z {
  out: string[] = [];
  constructor(public k: number) {}
  n = (v: number) => Math.round(v * this.k);
  /** text at x,y (dots at 203 dpi), height h; w = width for wrapping (lines = max lines), align L/C/R */
  text(x: number, y: number, h: number, s: string, o: { w?: number; lines?: number; align?: "L" | "C" | "R"; reverse?: boolean; wide?: number } = {}) {
    const { n } = this;
    this.out.push(`^FO${n(x)},${n(y)}${o.reverse ? "^FR" : ""}^A0N,${n(h)},${n(o.wide ?? h)}${o.w ? `^FB${n(o.w)},${o.lines || 1},0,${o.align || "L"},0` : ""}${fd(s)}`);
  }
  box(x: number, y: number, w: number, h: number, t = 2, fill = false) { const { n } = this; this.out.push(`^FO${n(x)},${n(y)}^GB${n(w)},${n(h)},${fill ? n(Math.min(w, h)) : Math.max(1, n(t))}^FS`); }
  line(x: number, y: number, w: number, h: number) { this.box(x, y, Math.max(w, 2), Math.max(h, 2), Math.min(Math.max(w, 2), Math.max(h, 2)), true); }
  qr(x: number, y: number, mag: number, data: string) { const { n } = this; this.out.push(`^FO${n(x)},${n(y)}^BQN,2,${Math.max(2, Math.round(mag * this.k))}^FDMA,${data}^FS`); }
  code128(x: number, y: number, h: number, data: string, module = 2) { const { n } = this; this.out.push(`^FO${n(x)},${n(y)}^BY${Math.max(1, Math.round(module * this.k))},3,${n(h)}^BCN,${n(h)},N,N,N^FD${data}^FS`); }
  zpl() { return `^XA^CI28^PW${this.n(812)}^LL${this.n(1218)}^LH0,0\n${this.out.join("\n")}\n^XZ`; }
}

const DATE = (d: string | null) => (d ? new Date(d.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "—");

/** One 4×6 box label: box `box` of `of` (of = 0 → "BOX __ OF __" to write in). */
export function boxLabelZpl(j: JobCard, box: number, of: number, dpi = 203): string {
  const z = new Z(dpi / 203);
  const L = 22, W = 812 - 2 * L;
  // header: job number + who it's from, delivery tag, box count
  z.text(L, 18, 78, `#${j.number}`, { w: 330 });
  z.text(L, 100, 26, (j.brand || "").toUpperCase(), { w: 330 });
  // delivery tag, and RUSH under it
  const tag = j.delivery === "ship" ? "SHIP" : j.delivery === "deliver" ? "DELIVERY" : "PICKUP";
  z.box(372, 20, 196, 46, 0, true); z.text(372, 28, 34, tag, { w: 196, align: "C", reverse: true });
  if (j.rush) { z.box(372, 74, 196, 46, 0, true); z.text(372, 82, 34, "RUSH", { w: 196, align: "C", reverse: true }); }
  z.text(590, 18, 34, "BOX", { w: W - 568, align: "R" });
  if (of) z.text(590, 52, 64, `${box} OF ${of}`, { w: W - 568, align: "R" });
  else z.text(560, 64, 44, "___ OF ___", { w: W - 538, align: "R" });
  z.line(L, 132, W, 4);

  // job name + PO on the left, the QR (phone menu) on the right, the barcode under the name
  z.text(L, 146, 38, j.name || "Untitled job", { w: 560, lines: 2 });
  if (j.po) z.text(L, 228, 28, `PO ${j.po}`, { w: 560 });
  z.code128(L, 266, 62, `${j.number}-${box || 1}`, 2);
  z.text(L, 334, 22, `${j.number}-${box || 1}  ·  scan the square code with a phone`, { w: 560 });
  z.qr(600, 140, 4.6, jobLink(j.number, box || null));

  // ship-to (or customer) and dates
  const top = 372;
  z.box(L, top, 520, 196, 3);
  z.text(L + 10, top + 8, 22, j.shipTo.length ? (j.delivery === "ship" ? "SHIP TO" : "DELIVER TO") : "CUSTOMER");
  const addr = j.shipTo.length ? j.shipTo : [j.customer, j.contact, j.phone].filter(Boolean);
  addr.slice(0, 5).forEach((ln, i) => z.text(L + 10, top + 38 + i * 30, i === 0 ? 30 : 27, ln.toUpperCase(), { w: 500 }));
  z.box(L + 530, top, W - 530, 196, 3);
  z.text(L + 542, top + 10, 20, "IN HANDS"); z.text(L + 542, top + 34, 26, DATE(j.due), { w: W - 550, lines: 2 });
  if (j.delivery === "ship") { z.text(L + 542, top + 98, 20, "SHIP VIA"); z.text(L + 542, top + 122, 26, j.shipMethod || "—", { w: W - 550, lines: 2 }); }
  else if (j.customer && j.shipTo.length) { z.text(L + 542, top + 98, 20, "FOR"); z.text(L + 542, top + 122, 26, j.customer, { w: W - 550, lines: 2 }); }

  // the size grid: what was ordered, with room to write what's in this box
  const rows = j.groups.flatMap((g) => g.rows);
  const sizes = [...new Set(rows.flatMap((r) => r.sizes.map((s) => s.label)))].sort((a, b) => bySize(a.toUpperCase(), b.toUpperCase()));
  const gy = top + 214, foot = 1218 - 92;
  // rows grow to fill the label (room to write what's in the box); at least 54 dots each
  const maxRows = Math.max(1, Math.min(rows.length, Math.floor((foot - gy - 80) / 54)));
  const rh = Math.min(140, Math.floor((foot - gy - 80) / Math.max(1, maxRows)));
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
  return z.zpl();
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
