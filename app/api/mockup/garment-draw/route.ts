import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, askClaude } from "@/lib/ai/claude";
import { safeGarmentSvg, stockMarkup, STOCK_LABEL, type StockKind } from "@/lib/stockGarments";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Draw a garment to match the customer's photo (Oct 27, Nick: "you're gonna get a bunch of images, all different ones…
 * you drew it here from what I gave you… the website needs to be able to do the same thing… if we need to enable AI,
 * we can"). The stock drawings (lib/stockGarments.ts) cover 12 kinds; a ladies' cropped tee, round gold buttons, a
 * raglan with contrast sleeves, a henley placket… are drawn by the AI from the photo, in the same box and the same
 * flat-lay style, with the stock drawing of the closest kind as its template so the shoulders, neck and hem land where
 * prints expect them. Colors come back as BODY / TRIM, so one drawing serves every color of the style.
 * Returns { front, back } (the shapes, checked by safeGarmentSvg). Nothing is saved here.
 */
const KINDS: StockKind[] = ["tee", "long", "crew", "hoodie", "polo", "quarter", "vest", "puffer", "jacket", "tank", "hat", "beanie"];

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({})) as { image?: string; name?: string; color?: string; kind?: string; notes?: string };
  const img = String(b.image || "").replace(/^data:image\/\w+;base64,/, "");
  if (!img || img.length > 6_000_000) return NextResponse.json({ error: "Send the garment's photo as a picture (under 4 MB)." }, { status: 400 });
  const kind: StockKind = KINDS.includes(b.kind as StockKind) ? (b.kind as StockKind) : "tee";
  const name = String(b.name || "").slice(0, 120), color = String(b.color || "").slice(0, 60);
  const admin = createAdminClient();
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ error: st.reason }, { status: 400 });
  const head = kind === "hat" || kind === "beanie";
  const r = await askClaude<{ front: string; back: string; what?: string }>({
    task: "garment_draw", model: st.settings.assistant.ai.model, maxTokens: 12000, timeoutMs: 270_000, admin, ctx: { by: v.email },
    images: [{ media_type: "image/jpeg", data: img, label: `The customer's photo of ${name || "the garment"}${color ? ` (${color})` : ""}` }],
    system: `You draw blank garments for FBS Print's mockups (screen printing and embroidery). We have no photo of this garment, so you draw it flat, like a supplier's flat-lay photo, front and back, and our logos are printed on your drawing.
Draw it as SVG shapes only (path, rect, circle, ellipse, polygon, polyline, line, g, and linearGradient / radialGradient / clipPath in defs), in a box 240 wide and 280 tall (no <svg> wrapper, no text, no images, no styles, no logos or prints of any kind, no person, no background).
Colors: fill the garment's main fabric with the word BODY and the contrast parts (zipper, binding, collar lining, snaps, buttons, drawstrings, contrast panels) with the word TRIM, so it can be painted in any color. For shading, seams, folds and stitching use #000 or #fff with a low opacity, like the template. A part that's always its own color whatever the garment's color (gold metal buttons, a silver zipper pull, a white tag) may use its own hex.
Match the photo: the cut and length (cropped, boxy, fitted ladies' cut, longer tail), the neckline (crew, V, scoop, mock, henley placket with its buttons), the collar, sleeves (short, cap, 3/4, long, raglan seams, cuffs), the hem (straight, curved, banded, split), pockets, zippers, snaps and buttons (count them, place them where the photo has them), quilting channels, ribbing and seams. Leave out wrinkles from a person wearing it: draw it laid flat and symmetrical.
Keep the template's frame so prints land right: the garment centered on x = 120, the top of the shoulders/collar about where the template has them, the full length of a normal ${head ? "hat" : "garment"} ending near the template's hem (a cropped garment ends higher, in proportion), sleeves out to the sides like the template. The back has no front placket or buttons unless the photo shows them on the back, and its neckline is higher.
Make it look made, not cartoon: a clean outline with a thin darker edge, soft shading at the sides and under the collar, stitching lines as fine dashed strokes, like the template. Keep each side under about 9,000 characters.`,
    prompt: `The template: our stock ${STOCK_LABEL[kind].toLowerCase()} (the closest kind) in this box.
FRONT:
${stockMarkup(kind, "front")}
BACK:
${stockMarkup(kind, "back")}

Draw ${name || "the garment in the photo"}${color ? `, color ${color}` : ""}, front and back, to match the photo.${b.notes ? ` Staff say: ${String(b.notes).slice(0, 300)}` : ""}`,
    tool: { name: "garment", description: "The garment drawn flat, front and back.", input_schema: { type: "object", required: ["front", "back"], properties: {
      front: { type: "string", description: "SVG shapes for the front, in the 240 × 280 box" },
      back: { type: "string", description: "SVG shapes for the back, in the 240 × 280 box" },
      what: { type: "string", description: "A few words on what you drew (\"women's cropped boxy tee, 4 gold snap buttons\")" },
    } } },
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  const front = safeGarmentSvg(r.data.front), back = safeGarmentSvg(r.data.back);
  // a drawing needs the body painted: shapes that never use BODY can't take the line's color
  if (!front || !/\bBODY\b/.test(front)) return NextResponse.json({ error: "The drawing didn't come back usable. Try again." }, { status: 502 });
  return NextResponse.json({ front, back: back && /\bBODY\b/.test(back) ? back : "", what: String(r.data.what || "").slice(0, 160) });
}
