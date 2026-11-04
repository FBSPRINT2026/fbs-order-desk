import { ONE_SIZE, type GLine, type Group } from "@/lib/pricing";

/**
 * Orders that aren't apparel (Nov 4, Nick: "we do a lot of invoices that are not garment related… signs and printing…
 * these are all outsourced products… business cards, signage, promotional products… paper printing"). The order page
 * keeps everything (header, art, messages, payments, activity, fees, notes); only the middle changes to simple item lines.
 * They never go to our production: no imprints, no work order, no blanks to order. The customer sees an ordinary invoice:
 * each line's name with its description under it.
 *
 * Each item is stored as an ordinary order line (one group, one line, one size "OS" = the quantity, its price as the
 * line's price), so totals, the invoice, the portal, payments and QuickBooks all work as they do; what it is lives in
 * `GLine.spec` and its plain description in `GLine.note`.
 */
export type ProductKind = "apparel" | "signage" | "promo" | "paper";
export const KINDS: { k: ProductKind; label: string; sub: string }[] = [
  { k: "apparel", label: "Apparel", sub: "Screen print, embroidery, DTF" },
  { k: "signage", label: "Signage", sub: "Banners, signs: by the square foot" },
  { k: "promo", label: "Promotional products", sub: "Items from a supplier, decorated" },
  { k: "paper", label: "Paper printing", sub: "Business cards, brochures, flyers" },
];
export const kindLabel = (k?: string | null) => KINDS.find((x) => x.k === (k || "apparel"))?.label || "Apparel";
export const isSimpleKind = (k?: string | null): k is Exclude<ProductKind, "apparel"> => k === "signage" || k === "promo" || k === "paper";

/** the customer's answer on one line's picture (sent with "Send proofs for approval") */
export type LineProof = { status: "sent" | "approved" | "changes"; at: string; note?: string; by?: string };

export type SimpleSpec = {
  kind: Exclude<ProductKind, "apparel">;
  /** the line's picture (proofs bucket): what the customer approves */ image?: string; imageName?: string;
  /** a PDF's first page as a PNG (made when it's added), what every page shows for a PDF */ preview?: string;
  proof?: LineProof;
  // signage
  material?: string; w?: number; h?: number; /** feet or inches */ unit?: "ft" | "in"; sides?: "single" | "double"; finishing?: string; /** price per square foot */ rate?: number;
  // promotional products
  itemNo?: string; supplier?: string; productColor?: string; imprintType?: string; imprintColor?: string;
  // paper printing
  size?: string; stock?: string; ink?: string; details?: string;
};

/** banner and sign materials with a starting price per square foot (typed over on the line) */
export const SIGN_MATERIALS: { name: string; rate: number }[] = [
  { name: "13 oz vinyl", rate: 4 }, { name: "Mesh", rate: 5 }, { name: "Fabric", rate: 6 }, { name: "Coroplast", rate: 3.5 },
  { name: "Foam board", rate: 5 }, { name: "Aluminum", rate: 10 }, { name: "Adhesive vinyl", rate: 6 },
];
export const SIGN_FINISHING = ["Hems + grommets", "Pole pockets", "Hems only", "No finishing", "H-stakes", "Grommets every 2'"];
export const IMPRINT_TYPES = ["Pad print", "Screen print", "Laser engrave", "Embroidery", "Full color (4CP)", "Deboss", "Deboss + color fill", "Heat transfer", "Sublimation", "UV print"];

const r2 = (n: number) => Math.round(n * 100) / 100;
/** square feet of one piece */
export function sqft(s: SimpleSpec): number {
  const w = +(s.w || 0), h = +(s.h || 0);
  if (!(w > 0 && h > 0)) return 0;
  return r2(s.unit === "in" ? (w * h) / 144 : w * h);
}
/** a sign's price each from its size and rate */
export const signEach = (s: SimpleSpec) => r2(sqft(s) * +(s.rate || 0));
const dim = (n?: number, u?: string) => (n ? `${n}${u === "in" ? '"' : "'"}` : "");

/** the plain words the customer reads under the line (the invoice, the portal, the proof) */
export function specText(s: SimpleSpec): string {
  if (s.kind === "signage") {
    const a = sqft(s);
    return [s.material, s.w && s.h ? `${dim(s.w, s.unit)} × ${dim(s.h, s.unit)}${a ? ` (${a} sq ft)` : ""}` : "", s.sides === "double" ? "Double-sided" : s.sides === "single" ? "Single-sided" : "", s.finishing].filter(Boolean).join(" · ");
  }
  if (s.kind === "promo") return [s.itemNo ? `Item #${s.itemNo}` : "", s.supplier, s.productColor, s.imprintType, s.imprintColor ? `Imprint ${s.imprintColor}` : ""].filter(Boolean).join(" · ");
  return [s.size, s.stock, s.ink, s.details].filter(Boolean).join(" · ");
}

const uid = () => Math.random().toString(36).slice(2, 10);
/** a new item line of this kind, in its own group */
export function newSimpleGroup(kind: Exclude<ProductKind, "apparel">): Group {
  const spec: SimpleSpec = kind === "signage" ? { kind, material: SIGN_MATERIALS[0].name, rate: SIGN_MATERIALS[0].rate, unit: "ft", sides: "single", finishing: SIGN_FINISHING[0] } : { kind };
  const line: GLine = { id: uid(), style: "", brand: "", garment: "", color: "", cost: "", sizes: { [ONE_SIZE]: 1 }, priceOverride: null, spec, note: "" };
  return { id: uid(), lines: [line], imprints: [] } as unknown as Group;
}
/** the line's quantity (its one size) */
export const qtyOf = (l: GLine) => Object.values(l.sizes || {}).reduce((a: number, q) => a + (+(q || 0) || 0), 0);

/** the picture to show for a line: its own image, or a PDF's first-page preview */
export const linePic = (s?: SimpleSpec | null) => (!s?.image ? "" : /\.(png|jpe?g|webp|gif|svg)$/i.test(s.image) ? s.image : s.preview || "");

/** a PDF's first page as a PNG file (in the browser), for the line's preview */
export async function pdfFirstPage(src: Blob, name: string, maxPx = 1400): Promise<File | null> {
  try {
    const { PDFJS, PDFJS_WORKER } = await import("@/lib/artPrep");
    const pdfjs = (await import(/* webpackIgnore: true */ PDFJS)) as { GlobalWorkerOptions: { workerSrc: string }; getDocument: (o: { data: ArrayBuffer }) => { promise: Promise<{ getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: Record<string, unknown>) => { promise: Promise<void> } }> }> } };
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const doc = await pdfjs.getDocument({ data: await src.arrayBuffer() }).promise;
    const page = await doc.getPage(1);
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(4, maxPx / Math.max(v1.width, v1.height)) });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    return blob ? new File([blob], name.replace(/\.[^.]+$/, "") + ".png", { type: "image/png" }) : null;
  } catch { return null; }
}

/** the quote approved: every item with a picture is approved with it (Nov 4, Nick: "here's your quote. Approved") */
export function withItemsApproved<G extends { lines: { spec?: SimpleSpec }[] }>(groups: G[], by: string, at: string): { groups: G[]; n: number } {
  let n = 0;
  const out = groups.map((g) => ({ ...g, lines: g.lines.map((l) => {
    if (!l.spec?.image || l.spec.proof?.status === "approved") return l;
    n++;
    return { ...l, spec: { ...l.spec, proof: { status: "approved" as const, at, by } } };
  }) }));
  return { groups: out, n };
}
