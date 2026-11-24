import { NextResponse, type NextRequest } from "next/server";
import { aiState, askClaude, imageTypeOf } from "@/lib/ai/claude";
import { getBrewer } from "@/lib/draftpunk/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export type HopLabel = { variety: string; alpha: number | null; beta: number | null; form: string; weight_oz: number | null; crop_year: string; lot: string; supplier: string; confidence: "high" | "medium" | "low"; note: string };

/**
 * A photo of a hop package on brew day (Nick, Nov 24 2026: "you click adjust or substitute and you click a picture and
 * it adjusts"): Claude reads the label for the variety, alpha (and beta) acid, form, weight, crop year and lot. A range
 * printed on the bag ("AA 11.5–13.0%") comes back as its middle; a reading it isn't sure of says so.
 */
export async function POST(req: NextRequest) {
  const me = await getBrewer();
  if (!me.brewer) return NextResponse.json({ error: "Sign in to DraftPunk first." }, { status: 401 });
  const st = await aiState();
  if (!st.ready) return NextResponse.json({ error: st.reason }, { status: 503 });
  const f = (await req.formData()).get("photo");
  if (!(f instanceof Blob) || f.size > 12_000_000) return NextResponse.json({ error: "Send one photo under 12 MB." }, { status: 400 });
  const bytes = new Uint8Array(await f.arrayBuffer());
  const type = imageTypeOf(bytes);
  if (!type) return NextResponse.json({ error: "That isn't a photo we can read (JPEG, PNG or WebP)." }, { status: 400 });
  const r = await askClaude<HopLabel>({
    task: "draftpunk_hop_label",
    model: st.settings.assistant.ai.fastModel || st.settings.assistant.ai.model,
    system: "You read hop packaging for homebrewers. Read only what is printed on the package in the photo; never guess a value that isn't visible. Alpha and beta acids are percentages; if a range is printed, give its middle and say so in note. If the variety name is a brand name (e.g. 'Citra®', 'HBC 394'), give the common name.",
    prompt: "Read this hop package: variety, alpha acid %, beta acid %, form (pellet, leaf, cryo/lupulin powder, extract), net weight in ounces (convert grams), crop year, lot number and supplier. Use null for numbers you can't read and an empty string for text you can't read.",
    images: [{ media_type: type, data: Buffer.from(bytes).toString("base64") }],
    maxTokens: 600,
    tool: { name: "hop_label", description: "What the hop package says", input_schema: { type: "object", required: ["variety", "alpha", "confidence"], properties: {
      variety: { type: "string" }, alpha: { type: ["number", "null"] }, beta: { type: ["number", "null"] }, form: { type: "string" },
      weight_oz: { type: ["number", "null"] }, crop_year: { type: "string" }, lot: { type: "string" }, supplier: { type: "string" },
      confidence: { type: "string", enum: ["high", "medium", "low"] }, note: { type: "string" },
    } } },
  });
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: 502 });
}
