import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobCard } from "@/lib/jobCard";
import { mergeProduction, needsForPrintavo } from "@/lib/production";
import { jobInks, jobsFromOrders, jobsFromPrintavo, mergeInkPlan, type FormulaLite, type GarmentFabric, type JobInk, type StockLite } from "@/lib/inkPlan";
import { batchesFor, type Batch } from "@/lib/inkBatches";

/**
 * The inks a scanned job needs, for the phone menu: each ink with an estimate of how much the job uses (lib/inkPlan.ts,
 * the same math as Ink Room → Inventory), its swatch, the Epic Rio formula when it's a PMS color to mix, and the last
 * batches made of it (ink_batches), so the crew can tell whether some is probably still on the shelf.
 */
export type FormulaLine = { type: string; code: string; desc: string; pct: number; g?: number };
export type PhoneInk = JobInk & { hex: string; lines: FormulaLine[] | null; gramsPerQt: number | null; batches: Batch[] };
export type PhoneInks = { inks: PhoneInk[]; unnamed: boolean; noSeps: boolean };

const norm = (s: string) => s.toLowerCase().replace(/^(pms|pantone)\s*/, "").replace(/\s+/g, " ").trim();
/** what a screen's ink name could be called in IMS: "PMS 123C" → "123 C" */
const candidates = (name: string) => {
  const t = norm(name), m = t.match(/^(\d{3,4})\s*c?$/);
  if (m) return [`${m[1]} C`];
  return /[(),*%\\]/.test(t) || !t ? [] : [t];
};

export async function phoneInks(admin: SupabaseClient, card: JobCard, settingsData: unknown): Promise<PhoneInks | null> {
  const d = (settingsData || {}) as { inkPlan?: unknown; production?: unknown };
  const s = mergeInkPlan(d.inkPlan);
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  let jobs;
  if (card.kind === "o") {
    const { data: o } = await admin.from("orders").select("id, number, nickname, groups").eq("id", card.id).maybeSingle();
    if (!o) return null;
    const { data: seps } = await admin.from("separations").select("order_id, imprint_id, garment_color, location, design_id, status, settings, channels").eq("order_id", card.id);
    const orders = [o] as Parameters<typeof jobsFromOrders>[1];
    const dIds = [...new Set([...((seps || []) as { design_id: string | null }[]).map((x) => x.design_id), ...orders.flatMap((x) => (x.groups || []).flatMap((g) => (g.imprints || []).map((i) => i.design_id)))].filter(Boolean))] as string[];
    const styles = [...new Set(orders.flatMap((x) => (x.groups || []).flatMap((g) => (g.lines || []).map((l) => l.style || ""))).filter(Boolean))];
    const [{ data: designs }, { data: gar }] = await Promise.all([
      dIds.length ? admin.from("designs").select("id, width_px, height_px").in("id", dIds) : Promise.resolve({ data: [] }),
      styles.length ? admin.from("garments").select("style, brand, fabric, supplier").in("style", styles) : Promise.resolve({ data: [] }),
    ]);
    // the whole job as one booking (every location)
    const slot = { order_id: card.id, archived_order_id: null, day, status: "", finished_at: null, locations: null, label: null };
    jobs = jobsFromOrders([slot], orders, (seps || []) as Parameters<typeof jobsFromOrders>[2], (designs || []) as Parameters<typeof jobsFromOrders>[3], s, (gar || []) as GarmentFabric[]);
  } else {
    const { data: r } = await admin.from("archived_orders").select("id, visual_id, nickname, qty, status_name, data").eq("id", card.id).maybeSingle();
    if (!r) return null;
    const ps = mergeProduction(d.production);
    type Arch = Parameters<typeof jobsFromPrintavo>[1][number] & { qty: number | null; status_name: string };
    const slot = { order_id: null, archived_order_id: card.id, day, status: "", finished_at: null, locations: null, label: null };
    jobs = jobsFromPrintavo([slot], [r as Arch], (x) => needsForPrintavo(ps, { ...(x as Arch), nickname: x.nickname || "" } as Parameters<typeof needsForPrintavo>[1]).filter((n) => n.type === "screen").flatMap((n) => n.steps), s);
  }
  const job = jobs[0];
  if (!job?.prints.length) return { inks: [], unnamed: false, noSeps: false };

  // the shelf, and only the formulas this job's colors could be
  const names = [...new Set(job.prints.flatMap((p) => p.screens.map((x) => x.name)).filter(Boolean))];
  const cands = [...new Set(names.flatMap(candidates))].slice(0, 60);
  const [{ data: st }, { data: fs }] = await Promise.all([
    admin.from("stock_inks").select("id, brand, line, name, product, pms, stocked, section, hex").is("archived_at", null),
    cands.length ? admin.from("ink_formulas").select("code, rec_type, lines, grams_per_qt, hex").eq("system", "RX").eq("rec_type", "S").is("archived_at", null).not("lines", "is", null).or(cands.map((c) => `code.ilike.${c}`).join(",")) : Promise.resolve({ data: [] }),
  ]);
  const stock = (st || []) as (StockLite & { hex: string })[];
  const formulas = (fs || []) as (FormulaLite & { hex: string | null })[];
  const list = jobInks(job, stock, formulas, s);
  const fByCode = new Map(formulas.map((f) => [f.code.toUpperCase(), f])), sById = new Map(stock.map((x) => [x.id, x]));
  const batches = await batchesFor(admin, list.filter((x) => x.kind === "pms").map((x) => x.code));
  const inks: PhoneInk[] = list.map((x) => {
    const f = x.kind === "pms" ? fByCode.get(x.code.toUpperCase()) : null;
    return {
      ...x, hex: f?.hex || sById.get(x.key)?.hex || (x.kind === "white" ? "#FFFFFF" : ""),
      lines: (f?.lines as FormulaLine[] | null) || null, gramsPerQt: f?.grams_per_qt ? +f.grams_per_qt : null,
      batches: x.kind === "pms" ? batches.filter((b) => b.code.toUpperCase() === x.code.toUpperCase()) : [],
    };
  });
  return { inks, unnamed: card.kind === "a", noSeps: job.prints.some((p) => p.note === "no separation yet") };
}
