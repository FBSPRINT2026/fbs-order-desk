import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, askClaude } from "@/lib/ai/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Mockup Creator → Helper: what garments a customer's sheet shows (Oct 27, Nick: "we upload an image and we just pull
 * the art off. There should be a button… pull art off and then draw blank… I pulled this logo, embark 3", the details
 * of it… create drawn blank garment, and then you can name it"). The page picture goes to the AI, which reads each
 * garment's name, color and look (kind, main color, trim, heather / stripes / quilted), its sizes and its prints. The
 * Helper draws the blank from it (lib/stockGarments.ts) when the garment isn't in a catalog. Nothing is saved here.
 */
const KINDS = ["tee", "long", "crew", "hoodie", "polo", "quarter", "vest", "puffer", "jacket", "tank", "hat", "beanie"];
const HEX = { type: ["string", "null"], description: "#rrggbb, or null when there isn't one" };

export type SheetGarment = {
  name: string; brand: string; style: string; color: string; kind: string; hex: string; trim: string | null; heather: boolean; stripes: string | null; quilted: boolean;
  sizes: Record<string, number>; /** where its photo is on the page, [left, top, right, bottom] as fractions (to draw it from) */ box?: number[]; prints: { location: string; method: "screen" | "embroidery" | "dtf"; width_in: number | null; ink: string }[];
};

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({})) as { image?: string; name?: string };
  const img = String(b.image || "").replace(/^data:image\/\w+;base64,/, "");
  if (!img || img.length > 6_000_000) return NextResponse.json({ error: "Send the page as a picture (under 4 MB)." }, { status: 400 });
  const admin = createAdminClient();
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ error: st.reason }, { status: 400 });
  const r = await askClaude<{ garments: SheetGarment[] }>({
    task: "sheet_garments", model: st.settings.assistant.ai.model, maxTokens: 2500, timeoutMs: 55_000, admin, ctx: { by: v.email },
    images: [{ media_type: "image/jpeg", data: img, label: `The customer's sheet: ${String(b.name || "").slice(0, 120)}` }],
    system: `You read a customer's decoration sheet for FBS Print (screen printing and embroidery). It shows one or more garments (often a photo of someone wearing it), the logo, where it goes, how big, the ink or thread, and the sizes. For each garment on the sheet, report:
- name: the garment as the sheet names it, brand and style together ("Peter Millar Ridge Vest", "Rhone Long Game Jacket").
- brand and style separately when you can tell them apart.
- color: the color name as written ("Lakeside", "Pure Black Heather").
- kind: the closest of ${KINDS.join(", ")}. A sleeveless jacket is a vest; a quilted or insulated one is a puffer; a zip or snap jacket with sleeves is a jacket; a pullover with a short zip is a quarter.
- hex: the garment's main color as it looks in the photo (look at the body of the garment, not shadows or highlights).
- trim: the color of the zipper, binding, collar lining, snaps or drawstrings when they're a different color from the body (the snaps' gold, a navy zipper); else null.
- heather: true when the fabric is a heather (flecked, "heather" in the color name). stripes: the stripe color only when the body fabric itself is striped all over (a striped polo, a rugby shirt), else null. Stripes down the sleeves, tape, piping, a striped collar or cuffs are not stripes (null): they're trim at most (Oct 27, Nick: a brown track jacket with stripes down the arms came out striped all over: "it just really needed to draw a brown jacket"). quilted: true for puffers and quilted channels.
- box: where this garment's photo (or drawing) is on the page, as [left, top, right, bottom] fractions of the page (0,0 top-left, 1,1 bottom-right), a little generous; it's cut out to draw the garment from.
- sizes: the size breakdown written on the sheet (XS, S, M, L, XL, 2XL…), numbers only. Leave out the total.
- prints: each decoration: location in our words (Left Chest, Right Chest, Full Front, Center Chest, Full Back, Left Sleeve, Right Sleeve; on a garment with long sleeves: Left Upper Arm / Right Upper Arm for "left arm" or a print up by the shoulder, Left Cuff / Right Cuff by the wrist), method (screen for "screen print", embroidery, dtf for heat transfers), width_in from the size written ("3" W" = 3), ink as written including any instruction ("PMS Cool Gray 4 C", "navy, match the zipper", "gold, match the snaps"). A logo printed in one ink is one color: the background it sits on is not an ink.
Only report what the sheet shows. Never invent sizes.`,
    prompt: "Read the sheet and report every garment on it.",
    tool: { name: "garments", description: "The garments on the sheet.", input_schema: { type: "object", required: ["garments"], properties: { garments: { type: "array", items: { type: "object", required: ["name", "color", "kind", "hex"], properties: {
      name: { type: "string" }, brand: { type: "string" }, style: { type: "string" }, color: { type: "string" }, kind: { type: "string", enum: KINDS }, hex: { type: "string", description: "#rrggbb" },
      trim: HEX, heather: { type: "boolean" }, stripes: HEX, quilted: { type: "boolean" },
      sizes: { type: "object", additionalProperties: { type: "integer" } },
      box: { type: "array", items: { type: "number" }, description: "[left, top, right, bottom] of the garment's photo, fractions of the page" },
      prints: { type: "array", items: { type: "object", properties: { location: { type: "string" }, method: { type: "string", enum: ["screen", "embroidery", "dtf"] }, width_in: { type: ["number", "null"] }, ink: { type: "string" } } } },
    } } } } } },
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  const ok = (h: unknown) => (typeof h === "string" && /^#?[0-9a-f]{6}$/i.test(h) ? (h.startsWith("#") ? h : "#" + h) : null);
  const garments = (r.data.garments || []).slice(0, 6).map((g) => ({
    ...g, name: String(g.name || "").slice(0, 120), color: String(g.color || "").slice(0, 60), kind: KINDS.includes(g.kind) ? g.kind : "tee",
    hex: ok(g.hex) || "#9aa1ab", trim: ok(g.trim), stripes: ok(g.stripes), heather: !!g.heather, quilted: !!g.quilted,
    sizes: Object.fromEntries(Object.entries(g.sizes || {}).filter(([, n]) => +n > 0).map(([z, n]) => [z.toUpperCase().replace(/^(XXL)$/, "2XL").replace(/^XXXL$/, "3XL"), Math.round(+n)])),
    prints: (g.prints || []).slice(0, 6),
    ...(Array.isArray(g.box) && g.box.length === 4 && g.box.every((n) => Number.isFinite(+n)) && +g.box[2] > +g.box[0] && +g.box[3] > +g.box[1] ? { box: g.box.map((n) => Math.min(1, Math.max(0, +n))) } : { box: undefined }),
  }));
  return NextResponse.json({ garments });
}
