import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PROD_ROLES, productionView } from "@/lib/productionView";
import type { Group, Imprint } from "@/lib/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The production view of an order (lib/productionView.ts): Nick and Jose only.
 *  GET → the view.
 *  POST { op, print, … } → small saves on one print, written straight onto the order (nothing else changes):
 *   "draft"    { size?, drop?, inks?, colors?, underbase? }: what production thinks, still to confirm
 *   "film"     { state: asPrinted | physical | new, note? }: where this print's film stands
 *   "filmFile" { path, name }: a film file (from the Dropbox film folder or uploaded) is this print's as-printed film
 *   "filmOk"   {}: production looked the film over (fresh separations stay "new, never printed")
 *   "printed"  {}: after Confirm & save: film printed from becomes the as-printed film
 *   "note"     { text }: added to the production notes
 */
async function who() {
  const v = await getViewer(", name");
  if (!v.user || !v.isStaff || !PROD_ROLES.includes(v.role)) return null;
  return { v, by: String(v.staff?.name || "") || v.email.split("@")[0] };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const w = await who();
  if (!w) return NextResponse.json({ error: "The production view is for Nick and Jose (owner or production)." }, { status: 403 });
  const { id } = await ctx.params;
  const view = await productionView(createAdminClient(), id);
  if (!view) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  return NextResponse.json(view);
}

const clip = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const w = await who();
  if (!w) return NextResponse.json({ error: "The production view is for Nick and Jose (owner or production)." }, { status: 403 });
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const admin = createAdminClient();
  const at = new Date().toISOString();

  if (b.op === "note") {
    const text = clip(b.text, 2000);
    if (!text) return NextResponse.json({ error: "Nothing to add." }, { status: 400 });
    const { data: inn } = await admin.from("order_internal").select("production_notes").eq("order_id", id).maybeSingle();
    const pn = [String(inn?.production_notes || "").trim(), text].filter(Boolean).join("\n\n").slice(0, 8000);
    const { error } = await admin.from("order_internal").upsert({ order_id: id, production_notes: pn });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, productionNotes: pn });
  }

  const { data: o } = await admin.from("orders").select("id, number, groups").eq("id", id).maybeSingle();
  if (!o) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  const groups = (o.groups || []) as Group[];
  if (!groups.length) return NextResponse.json({ error: "This order is in the old format: open and save it once on the order page first." }, { status: 400 });
  const all = groups.flatMap((g) => g.imprints || []);
  const events: string[] = [];

  if (b.op === "printed") {
    const { data: seps } = await admin.from("separations").select("id, number, imprint_id, status, files").eq("order_id", id).neq("status", "cancelled");
    for (const im of all) {
      if ((im.method || "screen") !== "screen") continue;
      const s = (seps || []).find((x) => x.imprint_id === im.id);
      if (im.film?.state === "asPrinted" && (im.film.files || []).length) continue;
      const files = ((s?.files || []) as { path: string; name: string; kind: string }[]).filter((f) => f.kind === "illustrator" || f.kind === "films").map((f) => ({ path: f.path, name: f.name }));
      if (!s && !im.film) continue;
      im.film = { ...(im.film || {}), state: "asPrinted", files: [...(im.film?.files || []), ...files], note: s ? `Printed from separation S-${s.number} (${at.slice(0, 10)})` : im.film?.note, by: w.by, at };
      events.push(`${im.location}: film is now the as-printed film`);
    }
  } else {
    const im = all.find((x) => x.id === String(b.print || ""));
    if (!im) return NextResponse.json({ error: "Which print?" }, { status: 400 });
    if (b.op === "draft") {
      if (b.size !== undefined) im.size = clip(b.size, 80);
      if (b.drop !== undefined) im.drop = clip(b.drop, 20);
      if (b.inks !== undefined) im.inks = clip(b.inks, 200);
      const n = Math.round(+(b.colors as number));
      if (n >= 1 && n <= 20) im.colors = n;
      if (b.underbase === "yes") im.underbase = true; else if (b.underbase === "no") im.underbase = false; else if (b.underbase === "") delete im.underbase;
      // still a suggestion until Confirm & save: who filled it in
      if (im.confirm) im.confirm = { ...im.confirm, filled: { by: w.by, at } };
    } else if (b.op === "film") {
      const state = String(b.state || "");
      if (!["asPrinted", "physical", "new"].includes(state)) return NextResponse.json({ error: "Which film?" }, { status: 400 });
      im.film = { ...(im.film || {}), state: state as NonNullable<Imprint["film"]>["state"], note: b.note !== undefined ? clip(b.note, 300) : im.film?.note, by: w.by, at };
      events.push(`${im.location}: film ${state === "asPrinted" ? "is the as-printed film" : state === "physical" ? "is physical only (in the drawer)" : "is new, never printed"}`);
    } else if (b.op === "filmFile") {
      const path = clip(b.path, 300), name = clip(b.name, 160);
      if (!path || path.includes("..")) return NextResponse.json({ error: "Which file?" }, { status: 400 });
      const files = [...(im.film?.files || []).filter((f) => f.path !== path), { path, name: name || path.split("/").pop() || "Film" }];
      im.film = { ...(im.film || {}), state: "asPrinted", files, by: w.by, at };
      events.push(`${im.location}: as-printed film on file: ${name}`);
    } else if (b.op === "filmOk") {
      im.film = { ...(im.film || { state: "new" as const }), checked: { by: w.by, at } };
      events.push(`${im.location}: film checked`);
    } else return NextResponse.json({ error: "What change?" }, { status: 400 });
  }

  const { error } = await admin.from("orders").update({ groups }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (events.length) await admin.from("order_events").insert({ order_id: id, kind: "details", detail: `Production view: ${events.join("; ")}`.slice(0, 2000), actor: w.by });
  const view = await productionView(admin, id);
  return NextResponse.json(view);
}
