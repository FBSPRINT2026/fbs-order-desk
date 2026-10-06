import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { printSettings, sha } from "@/lib/printQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The print relay on a shop computer (fbs-print-relay.ps1) asks here for labels to print, with its key in the
 * x-relay-token header. The answer waits up to ~22 seconds for a label (so the computer isn't asking every second),
 * and says where the printer is. POST reports how each label went.
 */
async function relayOf(req: Request) {
  const t = req.headers.get("x-relay-token") || "";
  if (!/^fbsr_[\w-]{20,}$/.test(t)) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("print_relays").select("id, revoked").eq("token_hash", sha(t)).maybeSingle();
  return data && !data.revoked ? { admin, id: data.id as string } : null;
}

export async function GET(req: Request) {
  const r = await relayOf(req);
  if (!r) return NextResponse.json({ error: "Unknown print computer. Make a new relay key in the Shipping Center." }, { status: 401 });
  const ps = await printSettings(r.admin);
  const until = Date.now() + 22000;
  for (;;) {
    await r.admin.from("print_relays").update({ last_seen_at: new Date().toISOString() }).eq("id", r.id);
    const { data, error } = await r.admin.rpc("claim_print_jobs", { p_relay: r.id, p_max: 10 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const jobs = (data || []) as { id: string; title: string; zpl: string }[];
    if (jobs.length || Date.now() > until) return NextResponse.json({ host: ps.host, port: ps.port, jobs: jobs.map((j) => ({ id: j.id, title: j.title, zpl: j.zpl })) });
    await new Promise((res) => setTimeout(res, 1200));
  }
}

export async function POST(req: Request) {
  const r = await relayOf(req);
  if (!r) return NextResponse.json({ error: "Unknown print computer." }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (typeof b.id !== "string") return NextResponse.json({ error: "Which label?" }, { status: 400 });
  await r.admin.from("print_jobs").update(b.ok ? { status: "printed", done_at: new Date().toISOString(), error: "" } : { status: "error", error: String(b.error || "Couldn't reach the printer").slice(0, 300) }).eq("id", b.id).eq("relay_id", r.id);
  return NextResponse.json({ ok: true });
}
