import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, askClaude } from "@/lib/ai/claude";
import { PROD_ROLES } from "@/lib/productionView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Is this film the same art? (Oct 21, Nick: "it may not be named correctly, but it generally matches and the artwork
 * looks to be the same. Do you want to upload this… and make this the separation?"). The browser draws each candidate
 * film from the Dropbox film folder (every print on every artboard, black, at real size) and sends them with the
 * print's art; the AI says which film, if any, is this print's art.
 * POST { location, art: jpeg data URL, films: [{ id, name, pieces: [{ data, widthIn, heightIn }] }] }
 */
type Piece = { data: string; widthIn: number; heightIn: number };
type Film = { id: string; name: string; pieces: Piece[] };
const jpeg = (d: unknown) => { const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(d || "")); return m && m[1].length < 500_000 ? m[1] : ""; };

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const v = await getViewer();
  if (!v.user || !v.isStaff || !PROD_ROLES.includes(v.role)) return NextResponse.json({ error: "Owner or production only." }, { status: 403 });
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as { location?: string; art?: string; films?: Film[] };
  const art = jpeg(b.art);
  const films = (Array.isArray(b.films) ? b.films : []).slice(0, 8).map((f) => ({ id: String(f.id || "").slice(0, 80), name: String(f.name || "").slice(0, 160), pieces: (Array.isArray(f.pieces) ? f.pieces : []).slice(0, 6).map((p) => ({ data: jpeg(p.data), widthIn: +p.widthIn || 0, heightIn: +p.heightIn || 0 })).filter((p) => p.data) })).filter((f) => f.id && f.pieces.length);
  if (!art) return NextResponse.json({ error: "This print has no art picture to compare with." }, { status: 400 });
  if (!films.length) return NextResponse.json({ matches: [] });
  const admin = createAdminClient();
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ error: st.reason, off: true }, { status: 400 });
  const { data: o } = await admin.from("orders").select("customer_id").eq("id", id).maybeSingle();
  const images = [
    { media_type: "image/jpeg" as const, data: art, label: `THE PRINT'S ART (${String(b.location || "this print").slice(0, 40)}), in color:` },
    ...films.flatMap((f, fi) => f.pieces.map((p, pi) => ({ media_type: "image/jpeg" as const, data: p.data, label: `Film F${fi + 1} "${f.name}", piece ${pi + 1}: ${p.widthIn}" × ${p.heightIn}" (black = ink on that screen)` }))),
  ];
  const r = await askClaude<{ films?: { film?: string; verdict?: string; why?: string }[] }>({
    task: "film_match", model: st.settings.assistant.ai.model, maxTokens: 1200, timeoutMs: 55_000, admin, images,
    ctx: { order_id: id, customer_id: o?.customer_id || null, by: v.email },
    system: "You help a screen printing shop find the film (positives) a job was printed from. A film shows one ink's screen in black, at real print size; a multi-color print has one film per ink, so each piece is only part of the art. Film files are often named badly, so judge by the picture: the same drawing, lettering and layout as the print's art (any one ink layer of it counts). A different design, a different version of the art (changed words, layout or year), or a different print location is not a match.",
    prompt: `For each film (F1, F2…), is it this print's art? verdict: "same" (clearly the same art), "likely" (looks the same, can't be sure), or "no". why: one short line naming what matches or differs.`,
    tool: { name: "film_matches", description: "Which films are this print's art", input_schema: { type: "object", properties: { films: { type: "array", items: { type: "object", properties: {
      film: { type: "string", description: "F1, F2…" }, verdict: { type: "string", enum: ["same", "likely", "no"] }, why: { type: "string" },
    }, required: ["film", "verdict", "why"] } } }, required: ["films"] } },
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  const matches = (Array.isArray(r.data.films) ? r.data.films : []).map((m) => {
    const i = parseInt(String(m.film || "").replace(/\D/g, ""), 10) - 1;
    const f = films[i];
    return f ? { id: f.id, name: f.name, verdict: ["same", "likely", "no"].includes(String(m.verdict)) ? String(m.verdict) : "no", why: String(m.why || "").slice(0, 300), widthIn: Math.max(...f.pieces.map((p) => p.widthIn)) } : null;
  }).filter(Boolean);
  return NextResponse.json({ matches });
}
