import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { askClaude, hasAiKey } from "@/lib/ai/claude";

/**
 * POST { lang: "es", strings: ["Ready To Schedule", "{0} jobs can't fit", …] } → { t: { [src]: translated } }
 * For the "Translate to Spanish" toggle. Saved translations come back right away; new phrases are translated by
 * Claude (fast model) once and saved for everyone. Numbers arrive as {0}, {1}… and must stay in place.
 */
export const maxDuration = 60;
const MODEL = "claude-haiku-4-5-20251001";
const LANGS: Record<string, string> = { es: "Latin American Spanish (the everyday Spanish of a Texas print shop's staff and customers)" };

export async function POST(req: Request) {
  const { user } = await getViewer();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { lang?: string; strings?: unknown };
  const lang = String(body.lang || "");
  if (!LANGS[lang]) return NextResponse.json({ error: "Unknown language." }, { status: 400 });
  const strings = [...new Set((Array.isArray(body.strings) ? body.strings : []).filter((x): x is string => typeof x === "string" && x.trim().length > 0 && x.length <= 400))].slice(0, 150);
  if (!strings.length) return NextResponse.json({ t: {} });
  const admin = createAdminClient();
  const t: Record<string, string> = {};
  const { data: have } = await admin.from("ui_translations").select("src, dst").eq("lang", lang).in("src", strings);
  for (const r of have || []) t[r.src as string] = r.dst as string;
  const miss = strings.filter((x) => !(x in t));
  if (!miss.length) return NextResponse.json({ t });
  if (!hasAiKey()) return NextResponse.json({ t, error: "Translation needs the ANTHROPIC_API_KEY in Vercel." });

  const r = await askClaude<{ t: string[] }>({
    task: "translate_ui",
    model: MODEL,
    maxTokens: 8000,
    ctx: { by: user.email || "system" },
    system: [
      `You translate the on-screen text of FBS Print's web app (a screen printing, embroidery and promotional products shop: orders, quotes, invoices, production calendar, shipping, customer portal) from English into ${LANGS[lang]}.`,
      "Each item is one piece of text from a page: a button, label, heading, sentence or table cell. Translate it the way a Spanish-language app would say it: short, natural, same tone and capitalization style (Title Case buttons stay short).",
      "Keep {0}, {1}… placeholders exactly as they are, in the right place. Keep punctuation, symbols, arrows and emoji.",
      "Do NOT translate: company, customer and people's names; brand names (Gildan, Bella+Canvas, SanMar, S&S, Printavo, Stripe, UPS, FedEx…); garment style numbers and SKUs; sizes (XS S M L XL 2XL, YXS…); color names that are product colors; email addresses; codes. Return those unchanged. If the whole item is a name or code, return it exactly as given.",
      "Shop words: screen print = serigrafía, embroidery = bordado, heat press = planchado/transfer, press = prensa (the machine), in-hands date = fecha de entrega, mockup = maqueta (mockup), artwork = arte, pcs = pzs, blanks = prendas en blanco.",
    ].join("\n"),
    prompt: `Translate each item. Return exactly ${miss.length} translations in the same order.\n\n${JSON.stringify(miss)}`,
    tool: {
      name: "translations",
      description: "The translations, one per item, same order as given.",
      input_schema: { type: "object", properties: { t: { type: "array", items: { type: "string" } } }, required: ["t"] },
    },
  });
  if (!r.ok) return NextResponse.json({ t, error: r.error });
  const out = Array.isArray(r.data.t) ? r.data.t : [];
  if (out.length !== miss.length) return NextResponse.json({ t, error: "Translation came back incomplete; try again." });
  // a translation that lost or invented a placeholder isn't used
  const ph = (x: string) => (x.match(/\{\d+\}/g) || []).sort().join(",");
  const rows = miss.map((src, i) => ({ lang, src, dst: String(out[i] ?? "") })).filter((x) => x.dst.trim() && ph(x.src) === ph(x.dst));
  for (const x of rows) t[x.src] = x.dst;
  if (rows.length) await admin.from("ui_translations").upsert(rows, { onConflict: "lang,src", ignoreDuplicates: true });
  return NextResponse.json({ t });
}
