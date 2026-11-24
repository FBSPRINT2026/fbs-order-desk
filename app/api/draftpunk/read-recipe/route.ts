import { NextResponse, type NextRequest } from "next/server";
import { aiState, askClaude, imageTypeOf } from "@/lib/ai/claude";
import { PROPOSAL_SCHEMA, type Proposal } from "@/lib/draftpunk/proposal";
import { getBrewer } from "@/lib/draftpunk/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * Photos of a recipe (a page of a brewing book the brewer owns, a printout, a handwritten card; Nick, Nov 24 2026:
 * Brewing Classic Styles and Gordon Strong's book) read into one recipe for the brewer's own account. Only what's on
 * the page: a number that isn't printed stays out, and the notes say where it came from.
 */
export async function POST(req: NextRequest) {
  const me = await getBrewer();
  if (!me.brewer) return NextResponse.json({ error: "Sign in to DraftPunk first." }, { status: 401 });
  const st = await aiState();
  if (!st.ready) return NextResponse.json({ error: st.reason }, { status: 503 });
  const form = await req.formData();
  const files = (form.getAll("photo").filter((f) => typeof f !== "string") as Blob[]).slice(0, 4);
  if (!files.length) return NextResponse.json({ error: "Send a photo of the recipe." }, { status: 400 });
  const images: { media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string }[] = [];
  for (const f of files) {
    if (f.size > 12_000_000) return NextResponse.json({ error: "Each photo must be under 12 MB." }, { status: 400 });
    const bytes = new Uint8Array(await f.arrayBuffer());
    const type = imageTypeOf(bytes);
    if (!type) return NextResponse.json({ error: "Send JPEG, PNG or WebP photos." }, { status: 400 });
    images.push({ media_type: type, data: Buffer.from(bytes).toString("base64") });
  }
  const source = String(form.get("source") || "").slice(0, 200);
  const r = await askClaude<{ proposal: Proposal; batchGal?: number; unread?: string }>({
    task: "draftpunk_read_recipe", model: st.settings.assistant.ai.model, maxTokens: 3000, timeoutMs: 85_000, images,
    system: "You read homebrew recipes from photos for the brewer's own recipe software. Copy what is printed: ingredients, amounts, times, temperatures, gravities, IBU, yeast, water and fermentation notes. Convert the grain amounts to percent of the grist. Don't add anything that isn't on the page; if something can't be read, list it in unread.",
    prompt: `Read this recipe${source ? ` (from ${source})` : ""}. Give the grain bill as percents, the target OG and IBU as printed, hops with their amounts in ounces as printed and the batch size it was written for (batchGal), mash and fermentation as printed, and the method in notes, in short lines of your own words.`,
    tool: { name: "recipe", description: "The recipe on the page", input_schema: { type: "object", required: ["proposal"], properties: { proposal: { ...PROPOSAL_SCHEMA }, batchGal: { type: "number" }, unread: { type: "string" } } } },
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  const p = r.data.proposal;
  // hop ounces were written for the page's batch: the dry hops scale to this brewer's batch with the rest
  if (r.data.batchGal && r.data.batchGal > 0) p.hops = p.hops.map((h) => ({ ...h, oz: h.oz ? Math.round(((h.oz * 5.5) / r.data.batchGal!) * 100) / 100 : h.oz }));
  p.notes = [source ? `From ${source}.` : "", p.notes || "", r.data.unread ? `Couldn't read: ${r.data.unread}` : ""].filter(Boolean).join("\n\n");
  return NextResponse.json({ proposal: p, unread: r.data.unread || "" });
}
