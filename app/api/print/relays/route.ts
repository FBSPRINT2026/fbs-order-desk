import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobActor } from "@/lib/jobAccess";
import { newRelayToken, sha } from "@/lib/printQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Print computers (staff with the Shipping Center): add one (its key is shown once) or remove one. */
export async function POST(req: Request) {
  const who = await jobActor();
  if (!who || who.kind !== "staff" || !who.can.ship) return NextResponse.json({ error: "Shipping Center staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const token = newRelayToken();
  const { data, error } = await createAdminClient().from("print_relays").insert({ name: String(b.name || "Shop computer").slice(0, 60), token_hash: sha(token), created_by: who.email }).select("id, name").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ relay: data, token });
}

export async function DELETE(req: Request) {
  const who = await jobActor();
  if (!who || who.kind !== "staff" || !who.can.ship) return NextResponse.json({ error: "Shipping Center staff only." }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id") || "";
  const { error } = await createAdminClient().from("print_relays").update({ revoked: true }).eq("id", id);
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
}
