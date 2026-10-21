import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orderGroups, type Order } from "@/lib/pricing";
import { customerStatus, stageOf, type AutoFacts, type Check, type CustomerStatus, type Flag, type StageState, type StepKey } from "@/lib/orderStages";

/**
 * An order's shop stage, worked out from what already happens (lib/orderStages.ts): the proof approval, the schedule,
 * separations and film, goods check-in, the press timer, shipping. Steps nobody records anywhere else (supplies, screens
 * burned, finishing, QC, packing…) are checked off by hand (orders.stage_checks).
 */
export type StageView = StageState & { methods: string[]; flags: Flag[]; customer: CustomerStatus; manual: Partial<Record<StepKey, Check>> };

export async function stageView(admin: SupabaseClient, orderId: string): Promise<StageView | null> {
  const { data: o } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!o) return null;
  const order = o as Order & { status: string; stage_checks?: Record<string, Check>; flags?: Flag[]; delivery_method?: string; approved_at?: string | null; created_at: string };
  const groups = orderGroups(order);
  const ims = groups.flatMap((g) => g.imprints);
  const methods = [...new Set(ims.map((i) => i.method || "screen"))];
  const [{ data: ev }, { data: slots }, { data: seps }, { data: times }, { data: goods }, { data: checkins }, { data: ships }, { data: proofs }] = await Promise.all([
    admin.from("order_events").select("kind, actor, created_at").eq("order_id", orderId).in("kind", ["proof_approved", "art_approved", "approved", "changes", "proof_changes"]).order("created_at"),
    admin.from("production_slots").select("status, day, machine, created_at").eq("order_id", orderId),
    admin.from("separations").select("imprint_id, status, updated_at").eq("order_id", orderId).neq("status", "cancelled"),
    admin.from("job_time").select("started_at").eq("order_id", orderId).eq("voided", false).order("started_at").limit(1),
    admin.from("order_goods").select("status, updated_at, updated_by").eq("order_id", orderId).maybeSingle(),
    admin.from("goods_checkins").select("created_at, by").eq("order_id", orderId).order("created_at", { ascending: false }).limit(1),
    admin.from("shipments").select("status, shipped_at").eq("order_id", orderId).neq("status", "void"),
    admin.from("proofs").select("created_at").eq("order_id", orderId).limit(1),
  ]);
  const at = (s?: string | null) => s || order.created_at;
  const auto: AutoFacts = {};
  const sys = (when?: string | null, note?: string): Check => ({ by: "auto", at: at(when), auto: true, ...(note ? { note } : {}) });
  const st = order.status;
  if (!["request", "quote", "quote_sent"].includes(st)) auto.approved = sys(order.approved_at, "the order was approved");
  const pa = (ev || []).find((e) => e.kind === "proof_approved" || e.kind === "art_approved");
  if (pa || ["blanks", "production", "ready", "completed"].includes(st)) auto.proof = sys(pa?.created_at, pa ? "proof approved" : "past the art step");
  if ((slots || []).length) auto.scheduled = sys((slots || [])[0].created_at, `on the schedule: ${(slots || []).map((x) => `${x.machine} ${x.day}`).join(", ")}`);
  const screens = ims.filter((i) => (i.method || "screen") === "screen");
  if (screens.length) {
    const sepOf = (id: string) => (seps || []).find((x) => x.imprint_id === id);
    if (screens.every((i) => sepOf(i.id) && ["review", "approved", "films"].includes(sepOf(i.id)!.status) || i.film)) auto.seps = sys(null, "separations made");
    if (screens.every((i) => sepOf(i.id)?.status === "films" || i.film?.state === "physical" || (i.film?.files || []).length)) auto.film = sys(null, "film on hand");
    if (screens.every((i) => i.film?.checked)) auto.film_checked = { by: screens[0].film?.checked?.by || "auto", at: screens[0].film?.checked?.at || order.created_at, auto: true };
  }
  if ((checkins || []).length || ["received", "arrived"].includes(String(goods?.status || ""))) auto.goods = checkins?.length ? { by: checkins[0].by || "auto", at: checkins[0].created_at, auto: true } : sys(goods?.updated_at, "goods received");
  if ((times || []).length || (slots || []).some((x) => x.status === "running" || x.status === "done")) auto.on_press = sys(times?.[0]?.started_at, "on press");
  const shipped = (ships || []).find((x) => x.status === "shipped");
  if (["ready", "completed"].includes(st) || shipped) auto.out = sys(shipped?.shipped_at, shipped ? "shipped" : "ready");
  // a finished order: everything before it counts as done
  if (st === "completed" || st === "ready") for (const k of ["finishing", "qc", "packing"] as StepKey[]) auto[k] = auto[k] || sys(null, "the order is ready");
  const manual = (order.stage_checks || {}) as Partial<Record<StepKey, Check>>;
  const state = stageOf(methods, auto, manual);
  const flags = (Array.isArray(order.flags) ? order.flags : []) as Flag[];
  const changes = (ev || []).filter((e) => e.kind === "changes" || e.kind === "proof_changes").pop();
  const customer = customerStatus({ ...order, flags }, { proofSent: (proofs || []).length > 0, shipped: !!shipped, changesRequested: !!changes && st === "quote_sent" });
  return { ...state, methods, flags, customer, manual };
}
