import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findSisters, rememberPair, styleRun, type Sister } from "@/lib/garmentSister";
import { asYouth, offRun, ourRun, type SizeKind } from "@/lib/sizeFit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sizes a style doesn't come in, and the sister style that does (Oct 30, Nick: PC099Y written for the whole run).
 *  POST { lines: [{ key, style, brand, color, sizes }] } (staff) →
 *    { lines: [{ key, style, brand, title, run, moves: [{ kind, sizes, guesses: Sister[] }], youth }] }
 *    only lines with sizes their style doesn't come in. `youth`: the youth sizes S/M/L would be, when the style only
 *    comes in youth sizes and they could be its youth sizes (asked, never guessed).
 *  PUT { style, styleBrand, kind, sister, sisterBrand, source } (staff) → remembered for everyone (lib/garmentSister.ts).
 */
type In = { key?: string; style?: string; brand?: string; color?: string; sizes?: Record<string, number> };

export async function POST(req: Request) {
  const v = await getViewer(); if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { lines } = (await req.json().catch(() => ({}))) as { lines?: In[] };
  const admin = createAdminClient();
  const out: { key: string; style: string; brand: string; title: string; run: string[]; moves: { kind: SizeKind; sizes: Record<string, number>; guesses: Sister[] }[]; youth: Record<string, number> | null }[] = [];
  await Promise.all((lines || []).slice(0, 40).map(async (l) => {
    const style = String(l.style || "").trim(); if (!style) return;
    const run = await styleRun(admin, style, String(l.brand || ""));
    if (!run || !ourRun(run.sizes).length) return;
    const off = offRun(l.sizes || {}, run.sizes);
    const kinds = Object.keys(off) as SizeKind[];
    if (!kinds.length) return;
    const moves = await Promise.all(kinds.map(async (kind) => ({ kind, sizes: off[kind]!, guesses: await findSisters(admin, { style: run.style, brand: run.brand || String(l.brand || ""), title: run.title, color: String(l.color || ""), kind, need: Object.keys(off[kind]!) }) })));
    out.push({ key: String(l.key || ""), style: run.style, brand: run.brand, title: run.title, run: ourRun(run.sizes), moves, youth: asYouth(l.sizes || {}, run.sizes) });
  }));
  return NextResponse.json({ lines: out });
}

export async function PUT(req: Request) {
  const v = await getViewer(", name"); if (!v.user || !v.isStaff) return NextResponse.json({ ok: true, learned: false });
  const b = (await req.json().catch(() => ({}))) as { style?: string; styleBrand?: string; kind?: SizeKind; sister?: string; sisterBrand?: string; source?: string };
  if (!b.style || !b.sister || !["adult", "youth", "toddler", "infant"].includes(String(b.kind))) return NextResponse.json({ error: "Which styles?" }, { status: 400 });
  try {
    await rememberPair(createAdminClient(), { style: b.style, styleBrand: b.styleBrand, kind: b.kind as SizeKind, sister: b.sister, sisterBrand: String(b.sisterBrand || ""), source: b.source === "catalog" ? "catalog" : "staff", by: String(v.staff?.name || "") || v.email.split("@")[0] });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
  return NextResponse.json({ ok: true, learned: true });
}
