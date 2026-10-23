import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { refs: ["a:<archived id>" | "o:<order id>"] } (staff) → each past job's mockup to look at in Create order's job
 * list (Oct 23, Nick: "I have no way to know which order to reorder because they're all named very similar… I should
 * at least be able to click… the picture attached, so I can see those orders and say yep, this is the reorder").
 * { pics: { [ref]: { thumb, full, pdf } } }: a small picture, and the full mockup (a Printavo job's PDF, or ours).
 */
export async function POST(req: Request) {
  const v = await getViewer(); if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { refs } = await req.json().catch(() => ({ refs: [] })) as { refs?: string[] };
  const want = [...new Set((refs || []).filter((r) => /^[ao]:[0-9a-f-]{36}$/i.test(String(r))))].slice(0, 40);
  if (!want.length) return NextResponse.json({ pics: {} });
  const admin = createAdminClient();
  const aIds = want.filter((r) => r.startsWith("a:")).map((r) => r.slice(2)), oIds = want.filter((r) => r.startsWith("o:")).map((r) => r.slice(2));
  const [{ data: as }, { data: os }, { data: ms }] = await Promise.all([
    aIds.length ? admin.from("archived_orders").select("id, files").in("id", aIds) : Promise.resolve({ data: [] }),
    oIds.length ? admin.from("orders").select("id, groups").in("id", oIds) : Promise.resolve({ data: [] }),
    oIds.length ? admin.from("mockups").select("order_id, file_path, created_at").in("order_id", oIds).is("archived_at", null).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  const pick: Record<string, { thumb: string; full: string }> = {};
  for (const a of (as || []) as { id: string; files: Record<string, string> | null }[]) {
    const paths = Object.values(a.files || {}).filter((p) => typeof p === "string");
    const pic = paths.find((p) => /\.(png|jpe?g|webp|gif)$/i.test(p)), pdf = paths.find((p) => /\.pdf$/i.test(p));
    if (pic || pdf) pick[`a:${a.id}`] = { thumb: pic || "", full: pdf || pic || "" };
  }
  for (const o of (os || []) as { id: string; groups: { mockupThumbs?: string[] }[] | null }[]) {
    const thumb = (o.groups || []).flatMap((g) => g.mockupThumbs || []).find(Boolean) || "";
    const full = ((ms || []) as { order_id: string; file_path: string }[]).find((m) => m.order_id === o.id)?.file_path || thumb;
    if (thumb || full) pick[`o:${o.id}`] = { thumb: thumb || full, full };
  }
  const paths = [...new Set(Object.values(pick).flatMap((x) => [x.thumb, x.full]).filter(Boolean))];
  const { data: signed } = paths.length ? await admin.storage.from("proofs").createSignedUrls(paths, 3600) : { data: [] };
  const url = new Map<string, string>(((signed || []) as { signedUrl: string | null }[]).map((s, i) => [paths[i], s.signedUrl || ""]));
  const pics: Record<string, { thumb: string; full: string; pdf: boolean }> = {};
  for (const [ref, x] of Object.entries(pick)) pics[ref] = { thumb: url.get(x.thumb) || "", full: url.get(x.full) || "", pdf: /\.pdf$/i.test(x.full) };
  return NextResponse.json({ pics });
}
