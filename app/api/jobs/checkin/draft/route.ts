import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobActor } from "@/lib/jobAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A count in left halfway (Nick, Nov 13 2026, #40382: "I ran into too many issues so I need to abandon that count… do you
 * want to reset to uncounted or do you want to save the count you've already done"). The sizes counted so far are kept
 * beside the job's check-in photos (proofs/checkins/<ref>/draft.json) so whoever opens the count next, on any phone or
 * the desk, picks up where it stopped. The job stays uncounted until someone checks it in.
 */
const pathOf = (ref: string) => `checkins/${ref.replace(/[^\w-]/g, "_")}/draft.json`;
export type CountDraft = { got: Record<string, number>; bad: Record<string, { issue: string; bad: number }>; by: string; at: string; counted: number; expected: number };

async function gate() { const who = await jobActor(); return who?.can.checkin ? who : null; }

export async function GET(req: Request) {
  if (!(await gate())) return NextResponse.json({ error: "Goods & Receiving only." }, { status: 403 });
  const ref = new URL(req.url).searchParams.get("ref") || "";
  if (!ref) return NextResponse.json({ draft: null });
  const { data } = await createAdminClient().storage.from("proofs").download(pathOf(ref));
  if (!data) return NextResponse.json({ draft: null });
  try { return NextResponse.json({ draft: JSON.parse(await data.text()) as CountDraft }); } catch { return NextResponse.json({ draft: null }); }
}

export async function PUT(req: Request) {
  const who = await gate(); if (!who) return NextResponse.json({ error: "Goods & Receiving only." }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.ref) return NextResponse.json({ error: "Which job?" }, { status: 400 });
  const num = (v: unknown) => Math.max(0, Math.min(99999, Math.round(+(v as number) || 0)));
  const got = Object.fromEntries(Object.entries((b.got || {}) as Record<string, unknown>).slice(0, 500).map(([k, v]) => [k.slice(0, 200), num(v)]));
  const bad = Object.fromEntries(Object.entries((b.bad || {}) as Record<string, { issue?: string; bad?: number }>).slice(0, 500).filter(([, v]) => v && num(v.bad) > 0).map(([k, v]) => [k.slice(0, 200), { issue: v.issue === "mispick" ? "mispick" : "damaged", bad: num(v.bad) }]));
  const draft: CountDraft = { got, bad, by: who.name, at: new Date().toISOString(), counted: num(b.counted), expected: num(b.expected) };
  const up = await createAdminClient().storage.from("proofs").upload(pathOf(String(b.ref)), Buffer.from(JSON.stringify(draft)), { contentType: "application/json", upsert: true });
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
  return NextResponse.json({ draft });
}

export async function DELETE(req: Request) {
  if (!(await gate())) return NextResponse.json({ error: "Goods & Receiving only." }, { status: 403 });
  const ref = new URL(req.url).searchParams.get("ref") || "";
  if (ref) await createAdminClient().storage.from("proofs").remove([pathOf(ref)]);
  return NextResponse.json({ ok: true });
}
