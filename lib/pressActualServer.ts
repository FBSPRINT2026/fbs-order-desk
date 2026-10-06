import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobCard } from "@/lib/jobCard";
import type { JobActor } from "@/lib/jobAccess";
import { mergeProduction } from "@/lib/production";
import { orderGroups, type Order } from "@/lib/pricing";
import { diffSetup, setupLine, type PHead, type PressActual, type PressOption, type PressSheet } from "@/lib/pressActual";

/**
 * Press sheets for a job (suggested setup + what really ran) and saving "as printed" from the phone.
 *
 * Learning ("use this next time", on by default): the changes go back into
 *  - the separation: ink names and meshes on its screens, and its press setup becomes the one that ran (the original
 *    kept as `pressSetupPlanned`), so the Separation Center and the next press sheet show the truth;
 *  - the design: its ink list and print plan get the new ink names, so new separations of that art start with them;
 *  - the order: the location's ink list, which a reorder copies.
 * Printavo jobs are never written to; their "as printed" is kept here and shown on the job.
 */
type Ch = { key: string; name: string; hex: string; kind: string; mesh?: number; order?: number };
type SepRow = { id: string; number: number; location: string; status: string; channels: Ch[] | null; settings: Record<string, unknown> | null; notes: string; garment_color: string; design_id: string | null; imprint_id: string | null };

export function screenPresses(settingsData: unknown): PressOption[] {
  const ms = mergeProduction((settingsData as Record<string, unknown> | null)?.production).machines;
  return ms.filter((m) => m.type === "screen" && m.active !== false).map((m) => ({ id: m.id, name: m.name, colors: m.colors || m.heads || 0, flashes: m.flashes ?? 2 }));
}

const slotToHead = (h: string, ch: Ch[]): PHead => {
  if (h.startsWith("p:")) { const k = h.slice(2), c = ch.find((x) => x.key === k); return { what: "screen", key: k, name: c?.name || k, hex: c?.hex || "", mesh: c?.mesh || null }; }
  return { what: h === "flash" ? "flash" : h === "cool" ? "cool" : "empty", name: "", hex: "", mesh: null };
};
const headToSlot = (h: PHead) => (h.what === "screen" ? (h.key ? `p:${h.key}` : "") : h.what === "empty" ? "" : h.what);

export async function pressSheets(admin: SupabaseClient, card: JobCard, settingsData: unknown): Promise<{ sheets: PressSheet[]; presses: PressOption[] }> {
  const presses = screenPresses(settingsData);
  const pname = (id: string) => presses.find((p) => p.id === id)?.name || "";
  const sheets: PressSheet[] = [];
  if (card.kind === "o") {
    const { data } = await admin.from("separations").select("id, number, location, status, channels, settings, notes, garment_color, design_id, imprint_id").eq("order_id", card.id).neq("status", "cancelled").order("created_at");
    for (const s of (data || []) as SepRow[]) {
      const ch = (s.channels || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const setup = (s.settings?.pressSetup || null) as { press: string; heads: string[] } | null;
      const heads = setup?.heads?.length ? setup.heads.map((h) => slotToHead(h, ch)) : ch.map((c) => ({ what: "screen" as const, key: c.key, name: c.name, hex: c.hex, mesh: c.mesh || null }));
      sheets.push({ id: s.id, sepId: s.id, number: s.number, location: s.location, status: s.status, garment: s.garment_color || "", notes: s.notes || "", pressId: setup?.press || "", press: setup ? pname(setup.press) : "", heads, actual: null });
    }
  }
  // locations with no separation (Printavo jobs, or not separated yet): the inks typed on the job
  for (const g of card.groups) for (const p of g.prints) {
    if (/embroid|dtf|heat|transfer|dtg|sublim/i.test(p.method || "")) continue;
    if (sheets.some((x) => x.location.trim().toLowerCase() === (p.location || "").trim().toLowerCase())) continue;
    const inks = (p.inks || "").split(/\s*[,/;]\s*|\s+\+\s+/).map((x) => x.trim()).filter(Boolean);
    if (!inks.length) continue;
    sheets.push({ id: `loc:${p.location || "Print"}`, sepId: null, number: 0, location: p.location || "Print", status: "", garment: "", notes: p.notes || "", pressId: "", press: "", heads: inks.map((n) => ({ what: "screen" as const, name: n, hex: "", mesh: null })), actual: null });
  }
  if (sheets.length) {
    const { data: acts } = await admin.from("press_actuals").select("*").eq(card.kind === "o" ? "order_id" : "archived_order_id", card.id).order("created_at", { ascending: false }).limit(200);
    for (const s of sheets) s.actual = ((acts || []) as PressActual[]).find((a) => (s.sepId ? a.separation_id === s.sepId : !a.separation_id && a.location.trim().toLowerCase() === s.location.trim().toLowerCase())) || null;
  }
  return { sheets, presses };
}

const clean = (hs: unknown): PHead[] => (Array.isArray(hs) ? hs : []).slice(0, 24).map((h) => {
  const x = h as Partial<PHead>;
  const what = (["screen", "flash", "cool", "empty"] as const).includes(x.what as never) ? (x.what as PHead["what"]) : "empty";
  return { what, ...(what === "screen" && x.key ? { key: String(x.key).slice(0, 40) } : {}), name: what === "screen" ? String(x.name || "").trim().slice(0, 60) || "Ink" : "", hex: /^#[0-9a-f]{6}$/i.test(String(x.hex || "")) ? String(x.hex) : "", mesh: what === "screen" && +(x.mesh || 0) > 0 ? Math.round(+x.mesh!) : null };
});

export async function saveActual(admin: SupabaseClient, who: JobActor, card: JobCard, settingsData: unknown, b: { sheet: string; pressId: string; heads: unknown; notes?: string; learn?: boolean }) {
  const { sheets, presses } = await pressSheets(admin, card, settingsData);
  const plan = sheets.find((s) => s.id === b.sheet);
  if (!plan) throw new Error("That print location isn't on this job any more.");
  const heads = clean(b.heads);
  if (!heads.some((h) => h.what === "screen")) throw new Error("Add the screens that ran.");
  const press = presses.find((p) => p.id === b.pressId);
  const act = { pressId: press?.id || plan.pressId, press: press?.name || plan.press, heads };
  const changes = diffSetup(plan, act);
  const notes = String(b.notes || "").trim().slice(0, 2000);
  const learn = !!b.learn && !!plan.sepId && card.kind === "o";
  const row = {
    [card.kind === "o" ? "order_id" : "archived_order_id"]: card.id, separation_id: plan.sepId, location: plan.location, press_id: act.pressId, press_name: act.press,
    heads, changes, notes, learned: learn, by_name: who.name, by_email: who.email, employee_id: who.employeeId,
  };
  const { data: saved, error } = await admin.from("press_actuals").insert(row).select("*").single();
  if (error) throw new Error(error.message);

  // a shop note on the job, so it's in Production files & notes and on the work order
  const body = [`As printed, ${plan.location}: ${setupLine(act.press, heads)}`, changes.length ? `Changed from the suggestion: ${changes.map((c) => c.text).join("; ")}` : "Same as the suggested setup.", notes].filter(Boolean).join("\n");
  await admin.from("job_files").insert({ [card.kind === "o" ? "order_id" : "archived_order_id"]: card.id, customer_id: card.customerId || null, kind: "note", tag: "Press setup", body, by_name: who.name, by_email: who.email, employee_id: who.employeeId });

  if (learn) await learnFrom(admin, card.id, plan, act, changes, who.name);
  if (card.kind === "o") await admin.from("order_events").insert({ order_id: card.id, kind: "press_actual", detail: `${plan.location}: ${changes.length ? changes.map((c) => c.text).join("; ") : "as suggested"}`, actor: who.email || who.name });
  return saved as PressActual;
}

/** "Use this next time": the inks and setup that really ran go into the separation, the design and the order. */
async function learnFrom(admin: SupabaseClient, orderId: string, plan: PressSheet, act: { pressId: string; press: string; heads: PHead[] }, changes: { kind: string; text: string }[], by: string) {
  const { data: s } = await admin.from("separations").select("id, channels, settings, notes, design_id, imprint_id").eq("id", plan.sepId!).maybeSingle();
  if (!s) return;
  const sep = s as SepRow;
  // renamed inks: the same screen (key), a different ink
  const renames = new Map<string, string>();
  for (const a of act.heads.filter((h) => h.what === "screen" && h.key)) {
    const p = plan.heads.find((x) => x.key === a.key);
    if (p && p.name.trim().toLowerCase() !== a.name.trim().toLowerCase()) renames.set(p.name.trim().toLowerCase(), a.name);
  }
  const st = { ...(sep.settings || {}) } as Record<string, unknown>;
  const names = { ...((st.names as Record<string, string>) || {}) }, mesh = { ...((st.mesh as Record<string, number>) || {}) };
  const channels = (sep.channels || []).map((c) => {
    const a = act.heads.find((h) => h.what === "screen" && h.key === c.key);
    if (!a) return c;
    names[c.key] = a.name; if (a.mesh) mesh[c.key] = a.mesh;
    return { ...c, name: a.name, ...(a.hex ? { hex: a.hex } : {}), ...(a.mesh ? { mesh: a.mesh } : {}) };
  });
  if (!st.pressSetupPlanned && st.pressSetup) st.pressSetupPlanned = st.pressSetup;
  st.pressSetup = { press: act.pressId, heads: act.heads.map(headToSlot), manual: true, at: new Date().toISOString(), asPrinted: true };
  const day = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });
  const note = `As printed ${day} (${by}): ${changes.length ? changes.map((c) => c.text).join("; ") : "as suggested"}`;
  await admin.from("separations").update({ channels, settings: { ...st, names, mesh }, notes: [sep.notes, note].filter(Boolean).join("\n").slice(-4000), updated_at: new Date().toISOString() }).eq("id", sep.id);
  if (!renames.size) return;

  const swap = (list: string) => list.split(",").map((x) => { const k = x.trim().toLowerCase(); return renames.has(k) ? ` ${renames.get(k)}` : x; }).join(",").trim();
  // the design: its ink list and print plan
  if (sep.design_id) {
    const { data: d } = await admin.from("designs").select("inks, print_plan").eq("id", sep.design_id).maybeSingle();
    if (d) {
      const pp = d.print_plan as { inks?: { name: string }[] } | null;
      const plan2 = pp?.inks ? { ...pp, inks: pp.inks.map((i) => (renames.has(i.name.trim().toLowerCase()) ? { ...i, name: renames.get(i.name.trim().toLowerCase())! } : i)) } : pp;
      await admin.from("designs").update({ inks: swap(String(d.inks || "")), ...(plan2 ? { print_plan: plan2 } : {}) }).eq("id", sep.design_id);
    }
  }
  // the order: that location's ink list (a reorder copies it)
  if (sep.imprint_id) {
    const { data: o } = await admin.from("orders").select("groups, lines").eq("id", orderId).maybeSingle();
    if (o) {
      const gs = orderGroups(o as Order);
      let hit = false;
      const groups = gs.map((g) => ({ ...g, imprints: g.imprints.map((im) => { if (im.id !== sep.imprint_id) return im; hit = true; return { ...im, inks: swap(im.inks || "") }; }) }));
      if (hit) await admin.from("orders").update({ groups, updated_at: new Date().toISOString() }).eq("id", orderId);
    }
  }
}
