/**
 * Separations for a RIP such as FilmMaker (CADlink): one page per screen, made the way RIPs most reliably read them.
 *   - Each page is one plate, as an image in its own named spot color (a /Separation colorspace called
 *     "1 - Underbase White", "2 - PMS 102 C"…), so the RIP sees one ink per page and applies that ink's halftone
 *     settings (frequency, angle, dot shape) and its calibration curves. No multi-ink images, no blend modes.
 *   - Solid plates are 0 / 100%; halftone plates are gray in tones the mesh holds, with solid edges cut sharp
 *     (`ripPlate`), and the RIP makes the dots.
 *   - Every page is the art at its real print size with a 1" margin: registration targets on the four sides and crop
 *     marks at the corners (in /All, the registration color), the ink's name right of the top target, and the job
 *     line at the top left. The same marks in the same place on every page, so the films line up.
 */
import { ripPlate, plateLabel } from "./illustratorPdf";
import type { Plate } from "./separate";

const enc = new TextEncoder();
const pdfName = (s: string) => "/" + s.replace(/[^A-Za-z0-9_.-]/g, (c) => "#" + c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase());
const esc = (t: string) => t.replace(/[\\()]/g, (c) => "\\" + c).replace(/[^\x20-\x7e]/g, "?");

export type RipOpts = { widthIn: number; title: string; tonal: boolean; minDot?: number[]; sub?: (p: Plate, i: number) => string;
  /** film on a roll this wide (inches): every screen on one sheet, turned and placed side by side to use the least film */
  rollIn?: number;
  /** each screen's halftone (frequency lpi, angle, dot): written into the file as the page's halftone screen, so a RIP
   *  set to take the application's halftones (FilmMaker / CADlink: Print Mode Overrides → Halftones → "Override print
   *  mode halftoning" + "Enable application halftoning") uses these instead of its own defaults. null = solid. */
  screens?: ({ lpi: number; angle: number; dot?: "ellipse" | "round" | "square" } | null)[];
  /** marks around each screen: crop marks / registration targets (default on) */
  marks?: { crop?: boolean; targets?: boolean } };

/**
 * How the screens go on a roll: where each one sits (pt from the top-left, below the job line) and whether it's turned a
 * quarter turn. Rows (shelves) across the roll; a row can mix upright and turned screens, and a short screen can stack
 * two-high beside a tall one, whatever uses the least film. `rotate` / `cols` / `rows` describe it for people.
 */
export type RollPlace = { x: number; y: number; rot: boolean };
export type RollLayout = { rotate: boolean; mixed: boolean; cols: number; rows: number; widthIn: number; lengthIn: number; fits: boolean; savedIn: number; place: RollPlace[] };
const HEADER = 22, GAP = 18, ROLL_EDGE = 0.4; // pt, pt, in (left for the printer's own margins)

export function rollLayout(n: number, artW: number, artH: number, rollIn: number, m = 36): RollLayout {
  const iw = artW + 2 * m, ih = artH + 2 * m, P = (rollIn - ROLL_EDGE) * 72;
  const dims = [{ rot: false, w: iw, h: ih }, { rot: true, w: ih, h: iw }];
  const straight = (HEADER + n * ih + (n - 1) * GAP) / 72;
  // every way to fill one row: a columns upright, b columns turned; each column stacks as many as fit the row's height
  type Row = { a: number; b: number; h: number; su: number; sr: number; cap: number; w: number };
  const rowsOpts: Row[] = [];
  for (let a = 0; a <= n; a++) for (let b = 0; a + b <= n; b++) {
    if (!a && !b) continue;
    const w = a * dims[0].w + b * dims[1].w + (a + b - 1) * GAP; if (w > P) continue;
    const h = Math.max(a ? dims[0].h : 0, b ? dims[1].h : 0);
    const su = a ? Math.floor((h + GAP) / (dims[0].h + GAP)) : 0, sr = b ? Math.floor((h + GAP) / (dims[1].h + GAP)) : 0;
    rowsOpts.push({ a, b, h, su, sr, cap: a * su + b * sr, w });
  }
  if (!rowsOpts.length) return { rotate: false, mixed: false, cols: 1, rows: n, widthIn: iw / 72, lengthIn: straight, fits: false, savedIn: 0, place: Array.from({ length: n }, (_, i) => ({ x: 0, y: i * (ih + GAP), rot: false })) };
  // fewest inches of film for r screens left: try every row, then the best for what's left
  const best: { len: number; row: Row | null }[] = [{ len: 0, row: null }];
  for (let r = 1; r <= n; r++) {
    let pick: { len: number; row: Row | null } = { len: Infinity, row: null };
    for (const o of rowsOpts) {
      const put = Math.min(o.cap, r), len = o.h + (r - put > 0 ? GAP : 0) + best[r - put].len;
      // the same film: full rows first, then fewer turned screens, then fewer columns (easier to cut)
      const was = pick.row ? Math.min(pick.row.cap, r) : 0;
      if (len < pick.len - 0.01 || (Math.abs(len - pick.len) <= 0.01 && pick.row && (put > was || (put === was && (o.b < pick.row.b || (o.b === pick.row.b && o.a + o.b < pick.row.a + pick.row.b)))))) pick = { len, row: o };
    }
    best[r] = pick;
  }
  const place: RollPlace[] = [];
  let r = n, y = 0, rows = 0, maxW = 0, cols = 0, anyRot = false, anyUp = false;
  while (r > 0) {
    const o = best[r].row!; let left = Math.min(o.cap, r), x = 0;
    for (const [d, k, stack] of [[dims[0], o.a, o.su], [dims[1], o.b, o.sr]] as const) {
      for (let c = 0; c < k && left > 0; c++) {
        for (let s2 = 0; s2 < stack && left > 0; s2++) { place.push({ x, y: y + s2 * (d.h + GAP), rot: d.rot }); left--; if (d.rot) anyRot = true; else anyUp = true; }
        x += d.w + GAP;
      }
    }
    maxW = Math.max(maxW, x - GAP); cols = Math.max(cols, o.a + o.b);
    r -= Math.min(o.cap, r); y += o.h + GAP; rows++;
  }
  const lengthIn = (HEADER + y - GAP) / 72;
  return { rotate: anyRot && !anyUp, mixed: anyRot && anyUp, cols, rows, widthIn: maxW / 72, lengthIn, fits: true, savedIn: Math.max(0, straight - lengthIn), place };
}

export async function ripPdf(plates: Plate[], w: number, h: number, o: RipOpts, z: (u8: Uint8Array) => Promise<Uint8Array>): Promise<Uint8Array> {
  const W = o.widthIn * 72, H = W * (h / w), N = plates.length, roll = !!o.rollIn;
  // each screen is a box: the art at real size, a margin with the marks and the ink's name around it
  const m = roll ? 36 : 72, iw = W + 2 * m, ih = H + 2 * m;
  const L = roll ? rollLayout(N, W, H, o.rollIn!, m) : null;
  const parts: Uint8Array[] = []; const offsets: number[] = []; let pos = 0;
  const push = (x: Uint8Array | string) => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); pos += b.length; };
  const obj = (n: number, body: (Uint8Array | string)[]) => { offsets[n] = pos; push(`${n} 0 obj\n`); for (const b of body) push(b); push("\nendobj\n"); };
  push("%PDF-1.5\n%\xE2\xE3\xCF\xD3\n");
  // 1 catalog, 2 pages, 3 font, 4 /All; then 2 objects a screen (image, its spot colorspace); then the pages (page, content)
  const imgObj = (i: number) => 6 + i * 2, pageObj = (k: number) => 6 + N * 2 + k * 2;
  const pages = roll ? 1 : N;
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, [`<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, k) => `${pageObj(k)} 0 R`).join(" ")}] /Count ${pages} >>`]);
  obj(3, ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"]);
  obj(4, ["[/Separation /All /DeviceGray << /FunctionType 2 /Domain [0 1] /C0 [1] /C1 [0] /N 1 >>]"]);
  obj(5, ["<< >>"]);
  for (let i = 0; i < N; i++) {
    const p = plates[i], g = ripPlate(p.alpha, w, h, !(o.tonal || p.tonal), o.minDot?.[i] || 0), iz = await z(g);
    obj(imgObj(i), [`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace ${imgObj(i) + 1} 0 R /BitsPerComponent 8 /Filter /FlateDecode /Length ${iz.length} >>\nstream\n`, iz, "\nendstream"]);
    // the plate's own spot color: 100% shows black on screen
    obj(imgObj(i) + 1, [`[/Separation ${pdfName(plateLabel(p, i))} /DeviceGray << /FunctionType 2 /Domain [0 1] /C0 [1] /C1 [0] /N 1 >>]`]);
  }
  const target = (x: number, y: number) => { const r = 7, k = r * 0.5523; return `${x - 14} ${y} m ${x + 14} ${y} l S ${x} ${y - 14} m ${x} ${y + 14} l S ${x + r} ${y} m ${x + r} ${y + k} ${x + k} ${y + r} ${x} ${y + r} c ${x - k} ${y + r} ${x - r} ${y + k} ${x - r} ${y} c ${x - r} ${y - k} ${x - k} ${y - r} ${x} ${y - r} c ${x + k} ${y - r} ${x + r} ${y - k} ${x + r} ${y} c S\n`; };
  const crop = (x: number, y: number, dx: number, dy: number) => `${x + dx * 6} ${y} m ${x + dx * 30} ${y} l S ${x} ${y + dy * 6} m ${x} ${y + dy * 30} l S\n`;
  /** one screen in its own box (0…iw × 0…ih): the art, registration targets on four sides, crop marks, the ink's name */
  const box = (i: number) => {
    const p = plates[i], tx = m + W / 2, ty = m + H + m / 2;
    const ink = `${p.name}  (${i + 1}/${N})${roll ? "  " + o.title.split(" ")[0] : ""}`, size = roll ? 11 : 13, tw = ink.length * size * 0.6;
    let lx = tx + 20; if (lx + tw > iw - 4) lx = Math.max(4, tx - 20 - tw);
    return `q ${o.screens?.[i] ? `/HT${i} gs ` : ""}${W.toFixed(2)} 0 0 ${H.toFixed(2)} ${m} ${m} cm /Im${i} Do Q\n` +
      `q /CSA CS 1 SCN /CSA cs 1 scn 0.5 w\n` + (o.marks?.targets === false ? "" : target(tx, ty) + target(tx, m / 2) + target(m / 2, m + H / 2) + target(m + W + m / 2, m + H / 2)) +
      (o.marks?.crop === false ? "" : crop(m, m, -1, -1) + crop(m + W, m, 1, -1) + crop(m, m + H, -1, 1) + crop(m + W, m + H, 1, 1)) +
      `BT /F1 ${size} Tf ${lx.toFixed(2)} ${(ty - size / 3).toFixed(2)} Td (${esc(ink)}) Tj ET\nQ\n`;
  };
  const xobjects = plates.map((_, i) => `/Im${i} ${imgObj(i)} 0 R`).join(" ");
  // the halftone screens (PDF type 1 halftone: frequency, angle, spot function), one graphics state per screen
  const SPOT = { ellipse: "EllipseA", round: "Round", square: "Square" } as const;
  const gstates = (o.screens || []).map((sc, i) => (sc ? `/HT${i} << /Type /ExtGState /HT << /Type /Halftone /HalftoneType 1 /Frequency ${sc.lpi} /Angle ${sc.angle} /SpotFunction /${SPOT[sc.dot || "ellipse"]} >> >>` : "")).filter(Boolean).join(" ");
  const page = async (k: number, PW: number, PH: number, content: string, trim?: string) => {
    const n = pageObj(k), cz = await z(enc.encode(content));
    obj(n, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW.toFixed(2)} ${PH.toFixed(2)}]${trim ? ` /TrimBox [${trim}]` : ""} /Resources << /Font << /F1 3 0 R >> /ColorSpace << /CSA 4 0 R >> /XObject << ${xobjects} >>${gstates ? ` /ExtGState << ${gstates} >>` : ""} >> /Contents ${n + 1} 0 R >>`]);
    obj(n + 1, [`<< /Length ${cz.length} /Filter /FlateDecode >>\nstream\n`, cz, "\nendstream"]);
  };
  if (L) {
    // every screen on one sheet for the roll, row by row from the top; turned a quarter turn when that's shorter
    const PW = L.widthIn * 72, PH = L.lengthIn * 72;
    let content = `q /CSA cs 1 scn BT /F1 8 Tf 2 ${(PH - 12).toFixed(2)} Td (${esc(`${o.title} - ${N} screen${N === 1 ? "" : "s"} - print at 100% - ${o.widthIn}" wide art`)}) Tj ET Q\n`;
    for (let i = 0; i < N; i++) {
      const p = L.place[i], x = p.x, y = PH - HEADER - p.y - (p.rot ? iw : ih);
      // a quarter turn: (u, v) → (x + ih − v, y + u)
      content += (p.rot ? `q 0 1 -1 0 ${(x + ih).toFixed(2)} ${y.toFixed(2)} cm\n` : `q 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} cm\n`) + box(i) + "Q\n";
    }
    await page(0, PW, PH, content);
  } else {
    for (let k = 0; k < N; k++) {
      const p = plates[k], PW = iw, PH = ih;
      const head = `q /CSA cs 1 scn BT /F1 8 Tf 18 ${(PH - 18).toFixed(2)} Td (${esc(`${o.title} - ${plateLabel(p, k)}${o.sub ? " - " + o.sub(p, k) : ""}`)}) Tj ET Q\n`;
      await page(k, PW, PH, box(k) + head, `${m} ${m} ${(m + W).toFixed(2)} ${(m + H).toFixed(2)}`);
    }
  }
  const count = pageObj(pages), xref = pos;
  let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) x += offsets[i] != null ? `${String(offsets[i]).padStart(10, "0")} 00000 n \n` : "0000000000 65535 f \n";
  push(x + `trailer\n<< /Size ${count} /Root 1 0 R /Info << /Title (${esc(o.title)}) /Creator (FBS Print Separations) >> >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos); let off = 0; for (const b of parts) { out.set(b, off); off += b.length; }
  return out;
}
