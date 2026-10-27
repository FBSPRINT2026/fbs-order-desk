/**
 * Stock garments (Oct 27, Nick: "create better stock graphics for when we don't have the actual garment… a really
 * good shirt for mockup for a t-shirt, a long sleeve shirt, a hoodie, a vest, a polo… you should be able to look at
 * the color… if it has stripes… if it's puffer"). A drawn garment in its own color, front and back, for any style we
 * have no photo of: real flat-lay proportions, seams, ribbing, folds and shading. Drawn in the photo frame
 * (PHOTO_W × PHOTO_H, like a supplier photo) so prints are placed on it the same way. A line's `look` (read off the
 * customer's mockup: kind, color, trim, heather / stripes / quilted) picks the drawing and paints it.
 */
import type { View } from "@/lib/mockup";

export type StockKind = "tee" | "long" | "crew" | "hoodie" | "polo" | "quarter" | "vest" | "puffer" | "jacket" | "tank" | "hat" | "beanie";
export type GarmentLook = {
  kind?: StockKind;
  /** the main color (hex) */ hex?: string;
  /** zipper, binding, collar lining, drawstrings (hex) */ trim?: string;
  heather?: boolean;
  /** stripes across the body in this color (hex) */ stripes?: string;
  /** quilted channels (a puffer) */ quilted?: boolean;
  /** what the look was read from ("Embark Ridge Vest sheet") */ from?: string;
};
export const STOCK_LABEL: Record<StockKind, string> = { tee: "T-shirt", long: "Long sleeve", crew: "Crewneck sweatshirt", hoodie: "Hoodie", polo: "Polo", quarter: "Quarter-zip", vest: "Vest", puffer: "Puffer vest", jacket: "Jacket", tank: "Tank", hat: "Hat", beanie: "Beanie" };

/** the drawing for a garment, from its name ("Peter Millar Ridge Vest", "Gildan 18500 Hooded Sweatshirt") */
export function stockKind(text: string): StockKind {
  const t = ` ${(text || "").toLowerCase()} `;
  if (/\bbeanie|\bknit (cap|hat)|\btoque|cuffed knit/.test(t)) return "beanie";
  if (/\b(cap|caps|hat|hats|trucker|snapback|dad hat|visor|bucket)\b|\b(richardson|flexfit|yupoong)\b/.test(t)) return "hat";
  if (/\bvest\b/.test(t)) return /puffer|down|quilt|insulated|packable/.test(t) ? "puffer" : "vest";
  if (/hood/.test(t)) return "hoodie";
  if (/quarter|1\/4|half[- ]?zip|1\/2 zip|pullover zip/.test(t)) return "quarter";
  if (/jacket|soft ?shell|windbreaker|coat|full[- ]?zip|anorak|bomber/.test(t)) return "jacket";
  if (/\bpolo|sport shirt|golf shirt/.test(t)) return "polo";
  if (/\btank|sleeveless|muscle/.test(t)) return "tank";
  if (/crew ?neck sweat|sweatshirt|\bcrew\b.*fleece|fleece crew/.test(t)) return "crew";
  if (/long ?sleeve|\bl\/s\b|\bls\b|3\/4|raglan/.test(t)) return "long";
  return "tee";
}

const hexOk = (h?: string) => (h && /^#?[0-9a-f]{6}$/i.test(h) ? (h.startsWith("#") ? h : "#" + h) : "");
/** a darker shade of a color (seams, default trim) */
function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * k)));
  return `#${((f(r) << 16) | (f(g) << 8) | f(b)).toString(16).padStart(6, "0")}`;
}
const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };

// ---- the drawings, in a 240 × 280 box (scaled into the photo frame below) ----
const TEE = (v: View) => `M98 34 Q120 ${v === "front" ? 52 : 40} 142 34 L182 48 L218 104 L190 124 L178 102 Q175 180 180 254 Q120 260 60 254 Q65 180 62 102 L50 124 L22 104 L58 48 Z`;
const LONG = (v: View, neckY = v === "front" ? 52 : 40) => `M98 34 Q120 ${neckY} 142 34 L182 48 Q196 62 200 104 L210 208 L188 213 L180 128 L178 110 Q175 180 180 254 Q120 260 60 254 Q65 180 62 110 L60 128 L52 213 L30 208 L40 104 Q44 62 58 48 Z`;
const HOOD_BODY = "M92 40 Q120 60 148 40 L184 52 Q198 66 202 108 L210 208 L188 213 L180 130 L178 112 Q175 180 180 254 Q120 260 60 254 Q65 180 62 112 L60 130 L52 213 L30 208 L38 108 Q42 66 56 52 Z";
const POLO = "M100 32 L182 48 L216 104 L190 122 L178 102 Q175 180 180 254 Q120 260 60 254 Q65 180 62 102 L50 122 L24 104 L58 48 L140 32 Z";
const QZ = "M100 34 L140 34 L182 48 Q196 62 200 104 L210 208 L188 213 L180 128 L178 110 Q175 180 180 254 Q120 260 60 254 Q65 180 62 110 L60 128 L52 213 L30 208 L40 104 Q44 62 58 48 Z";
const VEST = "M98 40 L142 40 L168 48 Q170 88 182 114 Q178 180 182 254 Q120 260 58 254 Q62 180 58 114 Q70 88 72 48 Z";
const PUFF = "M98 40 L142 40 L168 48 Q170 88 184 114 Q182 180 186 256 Q120 264 54 256 Q58 180 56 114 Q70 88 72 48 Z";
const TANK = (v: View) => `M88 30 Q120 ${v === "front" ? 74 : 54} 152 30 L164 30 Q166 72 180 98 L180 254 Q120 260 60 254 L60 98 Q74 72 76 30 Z`;
const COLLAR = "M98 16 Q120 12 142 16 L145 44 Q120 50 95 44 Z";
const SIDES_LONG = "M40 104 Q36 156 34 208 L30 208 Z M200 104 Q204 156 206 208 L210 208 Z M62 110 Q70 180 64 254 L60 254 Z M178 110 Q170 180 176 254 L180 254 Z";
const SIDES_TEE = "M62 102 Q70 180 64 254 L60 254 Q65 180 62 102 Z M178 102 Q170 180 176 254 L180 254 Q175 180 178 102 Z";
const CUFFS = "M30 208 L52 213 L51 221 L29 216 Z M188 213 L210 208 L211 216 L189 221 Z";
const WAIST = "M60 247 Q120 253 180 247 L180 254 Q120 260 60 254 Z";
const SHINE = "M84 70 Q120 64 156 70 L152 236 Q120 240 88 236 Z";

type Ink = { hex: string; trim: string; dark: boolean };
const p = (d: string, fill: string, extra = "") => `<path d="${d}" fill="${fill}"${extra}/>`;
const shadow = (d: string, o: number) => p(d, "#000", ` opacity="${o}"`);
const line = (d: string, o: number, extra = "") => `<path d="${d}" fill="none" stroke="#000" stroke-opacity="${o}"${extra}/>`;

/** one garment drawn: [the body outline (for the heather / stripes clip), the whole drawing] */
function draw(kind: StockKind, v: View, c: Ink): [string, string] {
  const f = c.hex, edge = ` stroke="rgba(0,0,0,${c.dark ? ".45" : ".28"})" stroke-width="1"`, k = c.dark ? 1.5 : 1;
  const sh = (d: string, o: number) => shadow(d, Math.min(0.5, o * k));
  switch (kind) {
    case "tee": {
      const b = TEE(v);
      return [b, p(b, f, edge) + (v === "front"
        ? shadow("M100 35 Q120 43 140 35 Q120 39 100 35 Z", 0.3) + sh("M98 34 Q120 52 142 34 L147 36 Q120 60 93 36 Z", 0.12) + line("M93 36 Q120 60 147 36", 0.12, ` stroke-dasharray="2 2"`)
        : sh("M98 34 Q120 40 142 34 L145 39 Q120 46 95 39 Z", 0.14))
        + sh("M50 124 L22 104 L26 99 L54 119 Z M190 124 L218 104 L214 99 L186 119 Z", 0.1) + line("M26 99 L54 119 M214 99 L186 119", 0.14, ` stroke-dasharray="2 2"`)
        + line("M58 48 Q66 70 62 102 M182 48 Q174 70 178 102", 0.14) + sh(SIDES_TEE, 0.13)
        + line("M96 118 Q104 170 98 236", 0.05, ` stroke-width="8"`) + line("M150 130 Q144 180 150 238", 0.05, ` stroke-width="10"`)
        + line("M60 246 Q120 252 180 246", 0.16, ` stroke-dasharray="2 2"`)];
    }
    case "long": case "crew": {
      const b = LONG(v);
      const rib = kind === "crew" ? 2 : 1;
      return [b, p(b, f, edge) + (v === "front"
        ? shadow("M100 35 Q120 43 140 35 Q120 39 100 35 Z", 0.35) + sh(`M98 34 Q120 52 142 34 L${145 + rib} ${36 + rib} Q120 ${58 + rib * 3} ${95 - rib} ${36 + rib} Z`, 0.16)
        : sh("M98 34 Q120 40 142 34 L145 39 Q120 46 95 39 Z", 0.16))
        + sh(CUFFS, 0.22) + sh(kind === "crew" ? "M60 240 Q120 246 180 240 L180 254 Q120 260 60 254 Z" : WAIST, 0.22)
        + (kind === "crew" ? line("M30 202 L52 207 M188 207 L210 202", 0.2) : "")
        + sh(SIDES_LONG, 0.14) + line("M58 48 Q66 72 62 110 M182 48 Q174 72 178 110", 0.18)];
    }
    case "hoodie": {
      const hood = v === "front"
        ? p("M86 50 Q82 6 120 4 Q158 6 154 50 Z", shade(f, 0.82), edge)
        : "";
      const body = p(HOOD_BODY, f, edge);
      const front = v === "front"
        ? p("M94 42 Q96 14 120 13 Q144 14 146 42 Q120 64 94 42 Z", shade(f, 0.45))
          + `<path d="M112 52 L110 110 M128 52 L130 110" stroke="${c.trim}" stroke-width="1.8" fill="none"/><circle cx="110" cy="112" r="2" fill="${c.trim}"/><circle cx="130" cy="112" r="2" fill="${c.trim}"/>`
          + sh("M82 176 L158 176 L170 230 L70 230 Z", 0.16) + line("M82 176 L158 176 L170 230 L70 230 Z", 0.2)
        : p("M82 58 Q76 8 120 6 Q164 8 158 58 Q120 74 82 58 Z", f, edge) + sh("M82 58 Q76 8 120 6 Q164 8 158 58 Q120 74 82 58 Z", 0.06) + line("M120 8 L120 68", 0.15);
      return [HOOD_BODY, hood + body + front + sh(CUFFS, 0.25) + sh("M60 244 Q120 250 180 244 L180 254 Q120 260 60 254 Z", 0.25) + sh(SIDES_LONG, 0.14)];
    }
    case "polo": {
      const collar = v === "front"
        ? p("M120 46 L96 40 Q92 34 98 26 Q120 18 142 26 Q148 34 144 40 Z", f, edge) + shadow("M98 26 Q120 18 142 26 Q120 22 98 26 Z", 0.35)
          + `<rect x="113" y="44" width="14" height="56" fill="${f}"${edge}/>` + sh("M113 44 h14 v56 h-14 Z", 0.1)
          + `<circle cx="120" cy="64" r="2.2" fill="#ecebe4"/><circle cx="120" cy="82" r="2.2" fill="#ecebe4"/>`
          + p("M120 46 L98 28 Q90 34 86 44 L106 74 Z", f, edge) + p("M120 46 L142 28 Q150 34 154 44 L134 74 Z", f, edge)
          + p("M120 46 L98 28 Q90 34 86 44 L106 74 Z M120 46 L142 28 Q150 34 154 44 L134 74 Z", "#fff", ` opacity=".07"`)
        : p("M98 22 Q120 16 142 22 L146 40 Q120 34 94 40 Z", f, edge) + sh("M98 22 Q120 16 142 22 L146 40 Q120 34 94 40 Z", 0.12);
      return [POLO, p(POLO, f, edge) + sh("M50 122 L24 104 L28 98 L54 116 Z M190 122 L216 104 L212 98 L186 116 Z", 0.2) + sh(SIDES_TEE, 0.14)
        + line("M58 48 Q66 70 62 102 M182 48 Q174 70 178 102", 0.14) + collar];
    }
    case "quarter": {
      const collar = p("M98 14 Q120 10 142 14 L144 38 Q120 44 96 38 Z", f, edge) + sh("M98 14 Q120 10 142 14 L144 38 Q120 44 96 38 Z", 0.12);
      return [QZ, p(QZ, f, edge) + collar + (v === "front" ? `<path d="M120 12 L120 100" stroke="${c.trim}" stroke-width="2.4"/><rect x="117" y="40" width="6" height="12" rx="2" fill="#c8c8c8"/>` : "")
        + sh(CUFFS, 0.22) + sh(WAIST, 0.22) + sh(SIDES_LONG, 0.14) + line("M58 48 Q66 72 62 110 M182 48 Q174 72 178 110", 0.18)];
    }
    case "jacket": {
      const collar = p("M96 14 Q120 9 144 14 L148 42 Q120 48 92 42 Z", f, edge) + sh("M96 14 Q120 9 144 14 L148 42 Q120 48 92 42 Z", 0.14);
      return [QZ, p(QZ, f, edge) + collar + (v === "front"
        ? `<path d="M120 12 L120 256" stroke="${c.trim}" stroke-width="2.6"/><rect x="117" y="44" width="6" height="13" rx="2" fill="${c.trim}"/>` + line("M78 180 L96 176 M162 180 L144 176", 0.3, ` stroke-width="1.5"`)
        : line("M58 70 Q120 80 182 70", 0.14))
        + sh(CUFFS, 0.25) + sh(WAIST, 0.25) + sh(SIDES_LONG, 0.15) + line("M58 48 Q66 72 62 110 M182 48 Q174 72 178 110", 0.18)];
    }
    case "vest": case "puffer": {
      const b = kind === "puffer" ? PUFF : VEST;
      const quilt = kind === "puffer"
        ? `<g fill="none" stroke="#000" stroke-opacity="${c.dark ? 0.6 : 0.28}" stroke-width="1.5"><path d="M68 84 Q120 92 172 84"/><path d="M58 118 Q120 126 182 118"/><path d="M56 152 Q120 160 184 152"/><path d="M55 186 Q120 194 185 186"/><path d="M55 220 Q120 228 185 220"/></g>`
          + `<g fill="#fff" opacity=".09"><path d="M72 60 Q120 68 168 60 L170 80 Q120 88 70 80 Z"/><path d="M62 92 Q120 100 178 92 L180 114 Q120 122 60 114 Z"/><path d="M58 126 Q120 134 182 126 L183 148 Q120 156 57 148 Z"/><path d="M57 160 Q120 168 183 160 L184 182 Q120 190 56 182 Z"/><path d="M56 194 Q120 202 184 194 L185 216 Q120 224 55 216 Z"/></g>`
        : line("M72 128 Q76 190 72 254", 0.12) + line("M168 128 Q164 190 168 254", 0.12) + p("M84 64 Q100 60 114 62 L113 236 Q98 238 84 234 Z", "#fff", ` opacity=".12"`);
      return [b, p(COLLAR, f, edge) + (v === "front" ? p("M102 20 Q120 17 138 20 L138 40 Q120 44 102 40 Z", c.trim, ` opacity=".88"`) : sh(COLLAR, 0.1)) + p(b, f, edge)
        + `<path d="M72 48 Q70 88 ${kind === "puffer" ? 56 : 58} 114" fill="none" stroke="${c.trim}" stroke-width="3"/><path d="M168 48 Q170 88 ${kind === "puffer" ? 184 : 182} 114" fill="none" stroke="${c.trim}" stroke-width="3"/>`
        + quilt + (v === "front" ? `<path d="M120 14 L120 257" stroke="${c.trim}" stroke-width="2.8"/><rect x="117" y="46" width="6" height="13" rx="2" fill="${c.trim}"/>` : line("M72 92 Q120 100 168 92", 0.13))
        + sh("M58 114 Q68 180 62 254 L58 254 Z M182 114 Q172 180 178 254 L182 254 Z", 0.09) + line("M58 247 Q120 253 182 247", 0.18, ` stroke-dasharray="2 2"`)];
    }
    case "tank": {
      const b = TANK(v);
      return [b, p(b, f, edge) + sh(v === "front" ? "M88 30 Q120 74 152 30 L156 32 Q120 82 84 32 Z" : "M88 30 Q120 54 152 30 L156 33 Q120 62 84 33 Z", 0.16)
        + line("M76 30 Q74 72 60 98 M164 30 Q166 72 180 98", 0.25, ` stroke-width="2"`) + sh("M60 98 Q68 180 64 254 L60 254 Z M180 98 Q172 180 176 254 L180 254 Z", 0.12)
        + line("M60 246 Q120 252 180 246", 0.16, ` stroke-dasharray="2 2"`)];
    }
    case "hat": {
      const crown = "M50 170 Q48 82 120 76 Q192 82 190 170 Z";
      return [crown, v === "front"
        ? p(crown, f, edge) + sh("M144 86 Q182 98 190 170 L156 170 Q158 116 144 86 Z M96 86 Q58 98 50 170 L84 170 Q82 116 96 86 Z", 0.1)
          + line("M120 76 L120 170", 0.22) + `<circle cx="120" cy="77" r="4" fill="${f}"${edge}/>` + line("M84 170 Q82 116 96 86 M156 170 Q158 116 144 86", 0.15)
          + p("M36 170 Q120 154 204 170 Q208 196 120 196 Q32 196 36 170 Z", shade(f, 0.88), edge) + line("M44 174 Q120 162 196 174", 0.18, ` stroke-dasharray="2 2"`)
        : p(crown, f, edge) + sh("M144 86 Q182 98 190 170 L156 170 Q158 116 144 86 Z M96 86 Q58 98 50 170 L84 170 Q82 116 96 86 Z", 0.1)
          + p("M96 170 Q96 136 120 134 Q144 136 144 170 Z", "#fff") + line("M96 170 Q96 136 120 134 Q144 136 144 170", 0.25)
          + `<rect x="90" y="162" width="60" height="9" rx="3" fill="${c.trim}"/>` + line("M120 76 L120 134", 0.22) + `<circle cx="120" cy="77" r="4" fill="${f}"${edge}/>`];
    }
    case "beanie": {
      const b = "M62 196 Q58 76 120 70 Q182 76 178 196 Z", cuff = "M56 186 Q120 178 184 186 L186 246 Q120 254 54 246 Z";
      const ribs = Array.from({ length: 16 }, (_, i) => `M${60 + i * 8} ${188 - Math.sin((i / 15) * Math.PI) * 4} L${59 + i * 8} ${248 + Math.sin((i / 15) * Math.PI) * 4}`).join(" ");
      return [b, p(b, f, edge) + sh("M150 82 Q178 100 178 196 L156 196 Q158 120 150 82 Z", 0.1) + line("M86 82 Q74 130 76 192 M120 70 L120 190 M154 82 Q166 130 164 192", 0.1)
        + p(cuff, shade(f, 0.92), edge) + line(ribs, 0.12)];
    }
  }
}

/**
 * A stock garment as a picture: a data URL in the photo frame (1000 × 1250, white around it like a supplier photo).
 * The garment fills the frame like S&S photos (shoulders ~7% in from the sides).
 */
export function stockSvg(kind: StockKind, view: View, look: GarmentLook = {}): string {
  const hex = hexOk(look.hex) || "#9aa1ab";
  const dark = lum(hex) < 0.3;
  const trim = hexOk(look.trim) || (dark ? shade(hex, 1.5) : shade(hex, 0.55));
  const [outline, body] = draw(kind, view, { hex, trim, dark });
  const head = kind === "hat" || kind === "beanie";
  // 240 × 280 into 1000 × 1250: garments scaled to fill like a supplier photo; headwear smaller and centered
  const g = head ? `translate(20,40) scale(4)` : `translate(-28,20) scale(4.4)`;
  const heather = look.heather
    ? `<filter id="hx" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.06 0.7" numOctaves="2" seed="11" stitchTiles="stitch" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  2.6 0 0 0 -1.25" result="lite"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 -2.6 0 0 1.2" result="dark"/><feMerge><feMergeNode in="dark"/><feMergeNode in="lite"/></feMerge></filter>`
    : "";
  const stripe = hexOk(look.stripes);
  const defs = `<defs>${heather}<clipPath id="cb"><path d="${outline}"/></clipPath>${stripe ? `<pattern id="st" width="10" height="11" patternUnits="userSpaceOnUse"><rect width="10" height="3.6" fill="${stripe}"/></pattern>` : ""}</defs>`;
  // the texture goes over the fill, under the shading: drawn after the body's own fill, clipped to it
  const fx = (stripe ? `<rect x="0" y="0" width="240" height="280" fill="url(#st)" clip-path="url(#cb)"/>` : "") + (heather ? `<rect x="0" y="0" width="240" height="280" filter="url(#hx)" opacity=".35" clip-path="url(#cb)"/>` : "");
  // the body's fill is the first path of the drawing: put the texture right after it so the details stay on top
  const at = body.indexOf("/>", body.indexOf(`d="${outline}"`));
  const art = at > 0 && fx ? body.slice(0, at + 2) + fx + body.slice(at + 2) : body + fx;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1250">${defs}<rect width="1000" height="1250" fill="#ffffff"/><g transform="${g}">${art}<path d="${SHINE}" fill="#fff" opacity="${head ? 0 : 0.05}"/></g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
