import { NextResponse, type NextRequest } from "next/server";
import { aiState, askClaude } from "@/lib/ai/claude";
import { createAdminClient } from "@/lib/supabase/admin";
import { calcRecipe, r1 } from "@/lib/draftpunk/calc";
import { entryScore, type Sheet } from "@/lib/draftpunk/judging";
import { asProposal, PROPOSAL_SCHEMA, type Proposal } from "@/lib/draftpunk/proposal";
import { getBrewer } from "@/lib/draftpunk/server";
import { styleById, STYLES } from "@/lib/draftpunk/styles";
import { styleTarget, type Point } from "@/lib/draftpunk/targets";
import type { Recipe } from "@/lib/draftpunk/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export type AssistantReply = { answer: string; proposal?: Proposal; changes?: string[] };
type Body =
  | { mode: "ask"; question: string; recipe?: Recipe; styleId?: string; goal?: "house" | "competition" }
  | { mode: "next"; recipeId: string; recipe: Recipe; question?: string }
  | { mode: "bfe"; styleId: string; kind: "competition" | "house"; refresh?: boolean };

const SYSTEM = `You are DraftPunk's brewing assistant for the Draft Punk Homebrew Club: Nick McCoy and Jeff Poirot, award-winning competition homebrewers (2017 Ninkasi Award). They brew all-grain, no-sparge, low-oxygen (LODO), in BrewBuilt kettles with RIMS/HERMS, from 100% RO water built up with salts, ferment under pressure in Fermzillas with closed transfers.
How you work:
- Be specific and brief: name malts by maltster, give percents, IBU, gravity, temperatures, days. No filler, no hedging paragraphs.
- Judge bitterness as a ratio to gravity (BU:GU = IBU / gravity points), never as an IBU range alone. Use the target given for the style.
- For competition beers aim gravity at the upper part of the style's range unless the style rewards restraint; say why.
- Base advice on what wins: BJCP guidelines, published NHC winning recipes and well-known award-winning approaches, and above all the brewer's own results given to you (their scores and judges' comments). When you lean on general knowledge rather than their data, it's fine; don't invent specific competition results, people or quotes.
- Grain bills by percent of the grist (adding to 100). Hops: bittering ounces are scaled to the IBU target by the app, so get the schedule and proportions right.
- When you change a recipe, change only what the reasons call for and list each change.`;

export async function POST(req: NextRequest) {
  const me = await getBrewer();
  if (!me.brewer) return NextResponse.json({ error: "Sign in to DraftPunk first." }, { status: 401 });
  const st = await aiState();
  if (!st.ready) return NextResponse.json({ error: st.reason }, { status: 503 });
  const body = (await req.json()) as Body;
  const admin = createAdminClient();
  const model = st.settings.assistant.ai.model;

  // ---------- best-ever recipes: one per style and kind, kept for the whole club ----------
  if (body.mode === "bfe") {
    const style = styleById(body.styleId);
    if (!style) return NextResponse.json({ error: "Pick a style." }, { status: 400 });
    if (!body.refresh) {
      const { data } = await admin.from("dp_bfe").select("data").eq("style_id", style.id).eq("kind", body.kind).maybeSingle();
      if (data) return NextResponse.json(data.data);
    }
    const ctx = await styleContext(admin, me.userId, style.id, body.kind);
    const r = await askClaude<{ answer: string; proposal: Proposal }>({
      task: "draftpunk_bfe", model, system: SYSTEM, temperature: 0.4, maxTokens: 4000, timeoutMs: 110_000,
      prompt: `Write the best-ever ${body.kind === "competition" ? "COMPETITION" : "HOUSE"} recipe for ${style.id} ${style.name}: the version you'd brew to ${body.kind === "competition" ? "win a medal at NHC (judges want a classic, flawless, expressive example)" : "drink and share at home (balanced, drinkable, the style at its best)"}.
${ctx}
In "answer", say in a few short lines what makes this the one: the key choices (malts and why, bitterness ratio, gravity, yeast, fermentation), and what winning examples of the style tend to do. Then give the recipe.`,
      tool: { name: "best_ever", description: "The recipe and why", input_schema: { type: "object", required: ["answer", "proposal"], properties: { answer: { type: "string" }, proposal: { ...PROPOSAL_SCHEMA } } } },
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
    const data = { ...r.data, proposal: { ...r.data.proposal, styleId: style.id, goal: body.kind } };
    await admin.from("dp_bfe").upsert({ style_id: style.id, kind: body.kind, data, written_by: me.userId }, { onConflict: "style_id,kind" });
    return NextResponse.json(data);
  }

  // ---------- the next version, from how it's done in competition ----------
  if (body.mode === "next") {
    const { data: rec } = await admin.from("dp_recipes").select("id, owner_id, name, visibility, goal").eq("id", body.recipeId).maybeSingle();
    if (!rec || (rec.owner_id !== me.userId && rec.visibility !== "club")) return NextResponse.json({ error: "Recipe not found." }, { status: 404 });
    const [{ data: vers }, { data: ents }, { data: brews }] = await Promise.all([
      admin.from("dp_recipe_versions").select("id, num, note, made_on").eq("recipe_id", rec.id).order("num"),
      admin.from("dp_entries").select("competition, held_on, version_id, scores, place, notes").eq("recipe_id", rec.id).order("held_on"),
      admin.from("dp_brews").select("brewed_on, version_id, measured, tasting, notes").eq("recipe_id", rec.id).order("brewed_on"),
    ]);
    const vnum = new Map((vers || []).map((v) => [v.id as string, v.num as number]));
    const history = (vers || []).map((v) => `v${v.num} (${v.made_on}): ${v.note}`).join("\n");
    const results = (ents || []).map((e) => {
      const sheets = (e.scores || []) as Sheet[];
      return `${e.competition} ${e.held_on || ""}${e.version_id ? ` (v${vnum.get(e.version_id as string)})` : ""}: ${r1(entryScore(sheets), 1) || "no score"}${e.place ? `, ${e.place}` : ""}${e.notes ? `. Notes: ${e.notes}` : ""}\n` +
        sheets.map((s) => `  Judge ${s.judge || "?"}${s.rank ? ` (${s.rank})` : ""}: A${s.aroma ?? "-"} Ap${s.appearance ?? "-"} F${s.flavor ?? "-"} M${s.mouthfeel ?? "-"} O${s.overall ?? "-"}${s.notes ? ` — ${s.notes}` : ""}`).join("\n");
    }).join("\n");
    const brewNotes = (brews || []).map((b) => `${b.brewed_on}${b.version_id ? ` v${vnum.get(b.version_id as string)}` : ""}: ${[b.notes, JSON.stringify(b.tasting || {}) !== "{}" ? `tasting ${JSON.stringify(b.tasting)}` : ""].filter(Boolean).join(" ")}`).filter((l) => l.length > 14).join("\n");
    const ctx = body.recipe.styleId ? await styleContext(admin, me.userId, body.recipe.styleId, (rec.goal as "house" | "competition") || "competition") : "";
    const r = await askClaude<AssistantReply>({
      task: "draftpunk_next_version", model, system: SYSTEM, temperature: 0.3, maxTokens: 4000, timeoutMs: 110_000,
      prompt: `Recipe "${rec.name}", working copy:\n${JSON.stringify(asProposal(body.recipe))}\n\nVersions:\n${history || "(none)"}\n\nCompetition results and scoresheets:\n${results || "(none yet)"}\n\nBrew notes:\n${brewNotes || "(none)"}\n${ctx}\n${body.question ? `The brewer asks: ${body.question}\n` : ""}
What should the next version change? Read what the judges kept saying across sheets (repeated comments count most), connect each to a recipe or process cause, and propose the next version. In "answer": the pattern you see, then each change with its reason, short. "changes": one line per change. "proposal": the whole next version.`,
      tool: { name: "next_version", description: "What to change and the next version", input_schema: { type: "object", required: ["answer", "changes", "proposal"], properties: { answer: { type: "string" }, changes: { type: "array", items: { type: "string" } }, proposal: { ...PROPOSAL_SCHEMA } } } },
    });
    return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: 502 });
  }

  // ---------- a question, about a recipe or a beer to design ----------
  const styleId = body.recipe?.styleId || body.styleId;
  const ctx = styleId ? await styleContext(admin, me.userId, styleId, body.goal || "house") : "";
  const r = await askClaude<AssistantReply>({
    task: "draftpunk_assistant", model, system: SYSTEM, temperature: 0.4, maxTokens: 4000, timeoutMs: 110_000,
    prompt: `${body.recipe ? `The brewer's recipe (working copy):\n${JSON.stringify(asProposal(body.recipe))}\n` : ""}${ctx}\nThe brewer asks: ${body.question}\n
Answer in "answer" (short, specific). If a recipe or a change to one would help (they're designing a beer, asked what to change, or asked for a recipe), give the whole recipe as "proposal" and one line per change in "changes"; otherwise leave them out.`,
    tool: { name: "assistant", description: "The answer, and a recipe if one helps", input_schema: { type: "object", required: ["answer"], properties: { answer: { type: "string" }, changes: { type: "array", items: { type: "string" } }, proposal: { ...PROPOSAL_SCHEMA } } } },
  });
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: 502 });
}

/** what the assistant should know about a style: the guide, the learned bitterness and gravity target, how this
 *  brewer's recipes in it have done, and the club's best-ever recipe for it */
async function styleContext(admin: ReturnType<typeof createAdminClient>, userId: string, styleId: string, goal: "house" | "competition") {
  const style = styleById(styleId) || STYLES.find((s) => s.id.startsWith(styleId));
  if (!style) return "";
  const [{ data: recs }, { data: ents }, { data: bfe }] = await Promise.all([
    admin.from("dp_recipes").select("id, name, status, data").eq("style_id", style.id).or(`owner_id.eq.${userId},visibility.eq.club`).limit(12),
    admin.from("dp_entries").select("recipe_id, version_id, scores, place").eq("style_id", style.id).limit(60),
    admin.from("dp_bfe").select("kind, data").eq("style_id", style.id),
  ]);
  const vids = (ents || []).map((e) => e.version_id).filter(Boolean) as string[];
  const { data: vers } = vids.length ? await admin.from("dp_recipe_versions").select("id, calc").in("id", vids) : { data: [] };
  const vcalc = new Map((vers || []).map((v) => [v.id as string, v.calc as { buGu?: number; og?: number }]));
  const rcalc = new Map((recs || []).map((r) => { const c = calcRecipe(r.data as Recipe); return [r.id as string, { buGu: c.buGu, og: c.og }]; }));
  const points: Point[] = (ents || []).map((e) => {
    const c = (e.version_id && vcalc.get(e.version_id as string)) || (e.recipe_id && rcalc.get(e.recipe_id as string));
    return c ? { buGu: Number(c.buGu) || 0, og: Number(c.og) || 0, score: entryScore((e.scores || []) as Sheet[]), medal: !!e.place && e.place !== "hm" } : null;
  }).filter(Boolean) as Point[];
  for (const r of recs || []) if (r.status === "dialed") { const c = rcalc.get(r.id as string)!; points.push({ buGu: c.buGu, og: c.og, dialed: true }); }
  const t = styleTarget(style, goal, points);
  const theirs = (recs || []).map((r) => { const p = asProposal(r.data as Recipe); return `- ${r.name} (${r.status}): OG ${p.og}, ${p.ibu} IBU, BU:GU ${r1(p.ibu / Math.max(1, (p.og - 1) * 1000), 2)}; ${p.ferms.slice(0, 5).map((f) => `${f.pct}% ${f.name}`).join(", ")}; yeast ${p.yeasts.map((y) => y.name).join(", ")}`; }).join("\n");
  const best = (bfe || []).map((b) => `${b.kind}: ${JSON.stringify((b.data as { proposal?: Proposal }).proposal || {})}`).join("\n");
  return `\nStyle ${style.id} ${style.name} (BJCP 2021): OG ${style.og.join("–")}, FG ${style.fg.join("–")}, IBU ${style.ibu.join("–")}, SRM ${style.srm.join("–")}, ABV ${style.abv.join("–")}%.
Target for a ${goal} beer: BU:GU ${r1(t.buGu, 2)} (sweet spot ${r1(t.band[0], 2)}–${r1(t.band[1], 2)}, ${t.from === "learned" ? `learned from ${t.n} of their scored or dialed-in beers` : "from the guide's middle"}), OG ${t.og[0].toFixed(3)}–${t.og[1].toFixed(3)}.
${theirs ? `Their recipes in this style:\n${theirs}\n` : ""}${best ? `The club's best-ever recipes for this style:\n${best}\n` : ""}`;
}
