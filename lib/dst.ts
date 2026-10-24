/**
 * Reading a Tajima DST file, the machine file a digitizer sends back (Oct 23, Nick: "they'll give you back an embroidery
 * file and a DST… you need to learn how to read a DST file"). A DST has the stitches only: where the needle goes, where
 * it jumps (trims), where the machine stops for the next thread. No thread colors (those come from the run sheet or the
 * order). Units are 0.1 mm.
 *
 * Layout: a 512-byte text header (LA: name, ST: stitches, CO: color changes, +X -X +Y -Y extents in 0.1 mm…), then
 * 3-byte records. Each record moves the needle by dx, dy in -121…+121, built from bits worth ±1, ±3, ±9, ±27, ±81
 * (balanced ternary), and its third byte says stitch, jump, color change (stop) or end. Same decoding as pyembroidery
 * and libembroidery.
 */
export type DstStitch = { x: number; y: number; kind: "stitch" | "jump" | "stop" };
export type DstInfo = {
  name: string;
  /** the stitch count, as the digitizer's worksheet gives it (Wilcom's "Stitches": the header's ST, every record
   *  in the file). Volikes' Icon Only.DST: 4,333 on the sheet, 4,319 needle stitches */ stitches: number;
  /** needle stitches only (no jumps, trims or stops) */ sewn: number;
  /** thread changes in the file (colors = changes + 1) */ changes: number; colors: number;
  jumps: number; trims: number;
  /** size, inches */ wIn: number; hIn: number;
  /** the header's own numbers, when it has them */ header: Record<string, string>;
  /** each color's stitches, in sewing order (x, y in 0.1 mm, y down) */ blocks: { x: number; y: number; jump: boolean }[][];
};

const bit = (b: number, n: number) => (b >> n) & 1;
function dx(b0: number, b1: number, b2: number) {
  return bit(b2, 2) * 81 - bit(b2, 3) * 81 + bit(b1, 2) * 27 - bit(b1, 3) * 27 + bit(b0, 2) * 9 - bit(b0, 3) * 9 + bit(b1, 0) * 3 - bit(b1, 1) * 3 + bit(b0, 0) - bit(b0, 1);
}
function dy(b0: number, b1: number, b2: number) {
  return bit(b2, 5) * 81 - bit(b2, 4) * 81 + bit(b1, 5) * 27 - bit(b1, 4) * 27 + bit(b0, 5) * 9 - bit(b0, 4) * 9 + bit(b1, 7) * 3 - bit(b1, 6) * 3 + bit(b0, 7) - bit(b0, 6);
}

export function readDst(buf: ArrayBuffer): DstInfo {
  const u = new Uint8Array(buf);
  if (u.length < 515) throw new Error("That file is too short to be a DST.");
  const head = new TextDecoder("latin1").decode(u.slice(0, 512));
  const header: Record<string, string> = {};
  for (const m of head.matchAll(/(LA|ST|CO|\+X|-X|\+Y|-Y|AX|AY|MX|MY|PD):([^\r\n\x1a]*)/g)) header[m[1]] = m[2].trim();
  let x = 0, y = 0, minX = 0, maxX = 0, minY = 0, maxY = 0;
  let stitches = 0, jumps = 0, changes = 0, trims = 0, run = 0;
  const blocks: DstInfo["blocks"] = [[]];
  for (let i = 512; i + 2 < u.length; i += 3) {
    const b0 = u[i], b1 = u[i + 1], b2 = u[i + 2];
    if ((b2 & 0b11110011) === 0b11110011) break; // end
    x += dx(b0, b1, b2); y -= dy(b0, b1, b2); // y down, like the screen
    if ((b2 & 0b11000011) === 0b11000011) { changes++; blocks.push([]); run = 0; continue; } // stop: next thread
    if ((b2 & 0x43) === 0x43) { run = 0; continue; } // sequin mode on/off: no thread
    if ((b2 & 0b10000011) === 0b10000011) {
      jumps++; run++;
      // three jumps in a row is how a DST asks for a trim
      if (run === 3) trims++;
      blocks[blocks.length - 1].push({ x, y, jump: true });
      continue;
    }
    run = 0; stitches++;
    blocks[blocks.length - 1].push({ x, y, jump: false });
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const kept = blocks.filter((b) => b.some((s) => !s.jump));
  const st = parseInt(header.ST || "", 10);
  return {
    name: header.LA || "", stitches: st >= stitches && st < stitches * 1.5 ? st : stitches, sewn: stitches, changes, colors: Math.max(1, kept.length), jumps, trims,
    wIn: Math.round(((maxX - minX) / 254) * 100) / 100, hIn: Math.round(((maxY - minY) / 254) * 100) / 100,
    header, blocks: kept,
  };
}

/** the stitches drawn as thread lines (for a sew-out preview), each block in its thread color */
export function drawDst(info: DstInfo, colors: string[], size = 600): HTMLCanvasElement {
  const pts = info.blocks.flat();
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const k = (size - 20) / Math.max(1, maxX - minX, maxY - minY);
  const c = document.createElement("canvas");
  c.width = Math.ceil((maxX - minX) * k) + 20; c.height = Math.ceil((maxY - minY) * k) + 20;
  const g = c.getContext("2d")!;
  g.lineCap = "round"; g.lineJoin = "round";
  info.blocks.forEach((b, i) => {
    g.strokeStyle = colors[i % Math.max(1, colors.length)] || ["#222", "#c33", "#36c", "#3a3", "#c90"][i % 5];
    g.lineWidth = Math.max(0.6, 4 * k); // a 40 wt thread is ~0.4 mm
    g.beginPath();
    let pen = false;
    for (const p of b) {
      const px = (p.x - minX) * k + 10, py = (p.y - minY) * k + 10;
      if (p.jump || !pen) { g.moveTo(px, py); pen = !p.jump; } else g.lineTo(px, py);
    }
    g.stroke();
  });
  return c;
}
