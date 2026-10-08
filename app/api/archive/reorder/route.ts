import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { groupsFromPrintavo } from "@/lib/ai/emailOrder";
import { createOrderFromDraft } from "@/lib/emailOrderCreate";
import type { EODraft } from "@/lib/emailOrderShared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reorder on an archived Printavo job (staff only):
 *   POST { id }                        the job as a new order to check: same garments, sizes and prints
 *   PUT  { customer, draft, status }   create it (the art pulled from the old mockup by the browser first)
 */
async function staff() { const v = await getViewer(); return v.user && v.isStaff ? v : null; }

export async function POST(req: Request) {
  const v = await staff(); if (!v) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { id } = await req.json().catch(() => ({}));
  const admin = createAdminClient();
  const { data: r } = await admin.from("archived_orders").select("id, visual_id, nickname, qty, status_name, order_date, files, data, customer_id").eq("id", String(id || "")).maybeSingle();
  if (!r) return NextResponse.json({ error: "That job isn't in the archive." }, { status: 404 });
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const groups = groupsFromPrintavo(r as never, (st?.data as { production?: unknown } | null)?.production);
  if (!groups.length) return NextResponse.json({ error: "That job has no garments with sizes to copy." }, { status: 400 });
  const { data: c } = await admin.from("customers").select("id, company, name, moved_at").eq("id", r.customer_id as string).maybeSingle();
  const draft: EODraft = {
    v: 2, kind: "reorder", summary: `Exact reorder of Printavo #${r.visual_id}`, confidence: "high",
    nickname: String(r.nickname || "").slice(0, 120), due_date: null, delivery: "pickup", ship_to: "", po_number: "", notes: "",
    goods: { supplied: false, supplier: "", expected: "", note: "" }, groups, art: {}, mockups: {}, reorderOf: `a:${r.id}`, questions: [], files: [],
  };
  return NextResponse.json({ draft, customer: c, job: { label: `#${r.visual_id}${r.nickname ? ` ${r.nickname}` : ""} (Printavo)`, date: r.order_date || "" } });
}

export async function PUT(req: Request) {
  const v = await staff(); if (!v) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  if (!b.draft || typeof b.draft !== "object" || !b.customer) return NextResponse.json({ error: "Nothing to create." }, { status: 400 });
  const { data: c } = await v.supabase.from("customers").select("id, moved_at").eq("id", String(b.customer)).maybeSingle();
  if (!c) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  if (!c.moved_at) return NextResponse.json({ error: "Move this customer to the new system first (customer page → Move to the new system)." }, { status: 400 });
  const r = await createOrderFromDraft(createAdminClient(), v.user!.email || "staff", { customerId: c.id as string, draft: b.draft as EODraft, status: b.status === "approved" ? "approved" : "quote" });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json(r);
}
