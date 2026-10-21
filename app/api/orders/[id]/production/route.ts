import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PROD_ROLES, productionView } from "@/lib/productionView";
import type { Group, Imprint } from "@/lib/pricing";
import { mergeProduction } from "@/lib/production";
import type { DesignSpecs } from "@/lib/designSpecs";

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
 *   "rounds" { n: 1-3 }: times around the press (the schedule's run time counts each round)
 *   "byColor" { skip: { <shirt color>: [screen ink names] } }: screens left off on some shirt colors ({} = the same on all)
 *   "sample" { have: true | false | null }: a physical sample is in the shop (every print of the group)
 *   "pressOnly" { press: id | "" }: this print only runs on that press (the schedule only puts it there); the design's
 *              latest confirmed spec of the print gets it too, so every reorder of it does the same
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
    if (b.op === "colors") {
      // the art's colors onto screens (Oct 21, Nick: "we need to combine colors… put in PMS colors, or a custom color,
      // half this, half that"): each screen's ink, and which art colors print through it
      const screens = (Array.isArray(b.screens) ? b.screens : []).slice(0, 20).map((x) => { const s = x as { name?: string; hex?: string; mix?: string }; return { name: clip(s.name, 60), hex: /^#[0-9a-f]{6}$/i.test(String(s.hex || "")) ? String(s.hex).toUpperCase() : "#888888", mix: clip(s.mix, 160) }; }).filter((x) => x.name);
      const map = (b.map || {}) as Record<string, number>;
      if (!screens.length) return NextResponse.json({ error: "Name at least one ink." }, { status: 400 });
      im.inks = screens.map((x) => x.name).join(", ");
      if ((im.method || "screen") === "screen") im.colors = screens.length;
      // -1 = the shirt color: not printed ("none", as the Mockup Creator and the proof paint it: the shirt shows through)
      if (im.design_id) im.inkMap = { design: im.design_id, map: Object.fromEntries(Object.entries(map).filter(([h, i]) => /^#[0-9a-f]{6}$/i.test(h) && (screens[i] || i === -1)).map(([h, i]) => [h.toUpperCase(), i === -1 ? { name: "none", hex: h.toUpperCase() } : { name: screens[i].name, hex: screens[i].hex, ...(screens[i].mix ? { mix: screens[i].mix } : {}) }])) };
      if (im.confirm) im.confirm = { ...im.confirm, filled: { by: w.by, at } };
      const mixes = screens.filter((x) => x.mix).map((x) => `${x.name} = ${x.mix}`);
      events.push(`${im.location}: ${screens.length} screen${screens.length === 1 ? "" : "s"}: ${im.inks}${mixes.length ? ` (mixed: ${mixes.join("; ")})` : ""}`);
    } else if (b.op === "draft") {
      if (b.location !== undefined && clip(b.location, 60)) im.location = clip(b.location, 60);
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
    } else if (b.op === "pressOnly") {
      const pid = clip(b.press, 60);
      if (pid) {
        const { data: stRow } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
        const m = mergeProduction((stRow?.data as { production?: unknown } | null)?.production).machines.find((x) => x.id === pid && x.type === "screen");
        if (!m) return NextResponse.json({ error: "Which press?" }, { status: 400 });
        im.pressOnly = { id: m.id, name: m.name, by: w.by, at };
        events.push(`${im.location}: must run on ${m.name}`);
      } else { delete im.pressOnly; events.push(`${im.location}: can run on any press that fits`); }
      if (im.design_id) {
        const { data: d } = await admin.from("designs").select("id, specs").eq("id", im.design_id).maybeSingle();
        const specs = (d?.specs || {}) as DesignSpecs;
        const lk = (x: string) => x.toLowerCase().replace(/[^a-z]/g, "");
        const last = [...(specs.history || [])].reverse().find((h) => lk(h.location) === lk(im!.location));
        if (d && last) {
          if (im.pressOnly) last.press = { id: im.pressOnly.id, name: im.pressOnly.name }; else delete last.press;
          await admin.from("designs").update({ specs }).eq("id", d.id);
        }
      }
    } else if (b.op === "rounds") {
      // times around the press (Oct 21, Nick: "go a second round… because we don't have the space to add a flash")
      const n = Math.max(1, Math.min(3, Math.round(+(b.n as number) || 1)));
      if ((im.rounds || 1) !== n) events.push(`${im.location}: ${n > 1 ? `${n} rounds on press` : "one round on press"}`);
      if (n > 1) im.rounds = n; else delete im.rounds;
    } else if (b.op === "byColor") {
      // prints differently by shirt color (Oct 21, Nick: "you may not print the black on one mockup")
      const skip: Record<string, string[]> = {};
      for (const [c, list] of Object.entries((b.skip || {}) as Record<string, unknown>).slice(0, 40)) {
        const names = (Array.isArray(list) ? list : []).map((x) => clip(x, 60)).filter(Boolean).slice(0, 20);
        if (clip(c, 60) && names.length) skip[clip(c, 60)] = names;
      }
      const was = JSON.stringify(im.byColor?.skip || {});
      if (Object.keys(skip).length) im.byColor = { skip, by: w.by, at }; else delete im.byColor;
      if (was !== JSON.stringify(skip)) events.push(Object.keys(skip).length ? `${im.location}: by shirt color: ${Object.entries(skip).map(([c, n]) => `${c} skips ${n.join(", ")}`).join("; ")}` : `${im.location}: prints the same on every shirt color`);
    } else if (b.op === "sample") {
      // a physical sample (the garment with every print on it): set on every print of the group
      const g = groups.find((x) => (x.imprints || []).some((y) => y.id === im.id));
      for (const x of g?.imprints || [im]) {
        if (b.have === true || b.have === false) x.sample = { have: b.have, by: w.by, at }; else delete x.sample;
      }
      events.push(b.have === true ? "We have a physical sample" : b.have === false ? "No physical sample" : "Physical sample: not set");
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
