import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * A vector logo in other colors (Oct 28, Nick on D-10251 ShipStation Global: the vector pulled off #34053 came in
 * ShipStation green, the logo is stitched in Oxford Blue). Staff only. POST { id, to: "#2F375C", name?, keepAs? }:
 * every color in the logo's SVG becomes `to` (a one-color logo; `from` limits it to one color), saved as the logo's art;
 * the art it had stays on the logo as a colorway named `keepAs` (e.g. "ShipStation green"). Nothing is deleted.
 */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const id = String(b.id || ""), to = String(b.to || "").toUpperCase(), from = b.from ? String(b.from).toUpperCase() : "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^#[0-9A-F]{6}$/.test(to)) return NextResponse.json({ error: "Give the logo and a color like #2F375C." }, { status: 400 });
  const admin = createAdminClient();
  const { data: d } = await admin.from("designs").select("id, number, name, file_path, file_name, file_type, preview_path, specs").eq("id", id).maybeSingle();
  if (!d) return NextResponse.json({ error: "No such logo." }, { status: 404 });
  if (!/\.svg$/i.test(String(d.file_path || ""))) return NextResponse.json({ error: "Only an SVG logo can be recolored here." }, { status: 400 });
  const { data: f } = await admin.storage.from("proofs").download(String(d.file_path));
  if (!f) return NextResponse.json({ error: "Couldn't open the logo's file." }, { status: 502 });
  const svg = await f.text();
  const out = svg.replace(/(fill|stroke|stop-color)="(#[0-9a-fA-F]{6})"/g, (m, k, h) => (!from || h.toUpperCase() === from ? `${k}="${to}"` : m));
  if (out === svg) return NextResponse.json({ error: "No colors to change in that file." }, { status: 400 });
  const path = `designs/${id}-recolor-${Date.now().toString(36)}/${String(d.file_name || "logo.svg").replace(/[^\w.\-]+/g, "_")}`;
  const up = await admin.storage.from("proofs").upload(path, new Blob([out], { type: "image/svg+xml" }), { contentType: "image/svg+xml" });
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 502 });
  const sp = (d.specs || {}) as Record<string, unknown>;
  const cws = (sp.colorways || []) as { name: string; inks: string[]; preview?: string; file?: { path: string; name: string } }[];
  const keepAs = String(b.keepAs || "As it came in").slice(0, 60);
  const colorways = cws.some((c) => c.file?.path === d.file_path) ? cws : [...cws, { name: keepAs, inks: [], preview: String(d.preview_path || d.file_path), file: { path: String(d.file_path), name: String(d.file_name || "") } }];
  const history = [...((sp.history || []) as unknown[]), { date: new Date().toISOString().slice(0, 10), note: `Recolored to ${b.name || to} (was kept as the "${keepAs}" colorway) by ${v.user.email}` }];
  const { error } = await admin.from("designs").update({ file_path: path, preview_path: path, art_hash: null, specs: { ...sp, colorways, history } }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, path, number: d.number });
}
