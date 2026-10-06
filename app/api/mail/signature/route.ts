import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { explain, findSignature } from "@/lib/mail/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** check the signature reader against a mailbox's sent email (sync token only): how each email splits, and what it finds */
export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: ps } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (req.headers.get("x-sync-token") !== (ps as { token: string } | null)?.token) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const account = new URL(req.url).searchParams.get("account") || "";
  const { data } = await admin.from("activities").select("id, meta").eq("kind", "email").eq("direction", "out").eq("meta->>account_id", account).eq("meta->>mailbox", "sent")
    .not("meta->>html", "is", null).order("occurred_at", { ascending: false }).limit(8);
  const htmls: string[] = [], out: unknown[] = [];
  for (const r of data || []) {
    const meta = (r.meta || {}) as { html?: string; via?: string };
    if (meta.via === "portal" || !meta.html) continue;
    const { data: blob } = await admin.storage.from("proofs").download(meta.html);
    if (!blob) { out.push({ id: r.id, missing: meta.html }); continue; }
    const h = await blob.text(); htmls.push(h); out.push({ id: r.id, ...explain(h) });
  }
  const sig = findSignature(htmls);
  return NextResponse.json({ found: sig ? { how: sig.how, len: sig.html.length } : null, emails: out });
}
