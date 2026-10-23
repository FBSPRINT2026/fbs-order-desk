"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { viewerPerms } from "@/lib/access";

/**
 * AI Workbench → Tools (lib/aiTools.ts): what Create order is opened on from the Workbench. An email or a ClickUp job
 * already in the system, or files dropped here (a PO, a work order, art) made into one the same way, so the order
 * maker reads them exactly as it reads an email (Oct 23, Nick: "one uniform tool that works throughout the site").
 */
async function staff() {
  const v = await getViewer(", name");
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  const perms = await viewerPerms(v.supabase, v.email, v.role);
  if (!perms.workbench) throw new Error("The AI Workbench isn't on for you (Settings → User Access).");
  return { admin: createAdminClient(), email: v.email.toLowerCase() };
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });

export type OrderSource = { id: string; kind: string; subject: string; from: string; customer: string; when: string; files: number };

/** recent emails and ClickUp jobs to make an order from (newest first), or ones matching what's typed */
export async function orderSources(q: string) {
  try {
    const { admin } = await staff();
    const t = q.replace(/[,()%*\\]/g, " ").trim().slice(0, 60);
    let sel = admin.from("activities").select("id, kind, subject, from_email, occurred_at, meta, customers(company, name)").eq("direction", "in").in("kind", ["email", "clickup", "note"]).order("occurred_at", { ascending: false }).limit(30);
    if (t) sel = sel.or(`subject.ilike.%${t}%,from_email.ilike.%${t}%`);
    const { data, error } = await sel;
    if (error) return fail(new Error(error.message));
    const list: OrderSource[] = ((data || []) as unknown as { id: string; kind: string; subject: string | null; from_email: string | null; occurred_at: string; meta: { attachments?: unknown[]; from_name?: string; source?: string } | null; customers: { company: string | null; name: string | null } | null }[])
      .filter((a) => a.kind !== "note" || a.meta?.source === "workbench")
      .map((a) => ({ id: a.id, kind: a.meta?.source === "workbench" ? "files" : a.kind, subject: a.subject || "(no subject)", from: a.meta?.from_name || a.from_email || "", customer: a.customers?.company || a.customers?.name || "", when: a.occurred_at, files: (a.meta?.attachments || []).length }));
    return { ok: true as const, list };
  } catch (e) { return fail(e); }
}

/** files dropped in the Workbench (uploaded with uploadTarget) for a customer: made into something Create order reads */
export async function sourceFromFiles(o: { customerId: string; note: string; files: { name: string; path: string; type: string; size: number }[] }) {
  try {
    const { admin, email } = await staff();
    if (!/^[0-9a-f-]{36}$/i.test(o.customerId)) return { ok: false as const, error: "Pick the customer first." };
    const files = (o.files || []).filter((f) => typeof f.path === "string" && f.path.startsWith("ai/uploads/")).slice(0, 12);
    if (!files.length && !o.note.trim()) return { ok: false as const, error: "Drop in the files (or say what the order is)." };
    const { data: c } = await admin.from("customers").select("company, name, email").eq("id", o.customerId).maybeSingle();
    if (!c) return { ok: false as const, error: "That customer isn't on file." };
    const key = `wb:${crypto.randomUUID()}`;
    const subject = `From the AI Workbench: ${files.map((f) => f.name).join(", ").slice(0, 120) || "an order"}`;
    const { data, error } = await admin.from("activities").insert({
      customer_id: o.customerId, kind: "note", direction: "in", subject,
      body: (o.note.trim() || "Make the order from the attached files.").slice(0, 4000),
      from_email: String(c.email || ""), to_email: "", external_id: key, thread_id: key, occurred_at: new Date().toISOString(), created_by: email,
      meta: { source: "workbench", from_name: c.company || c.name || "", att_checked: true, attachments: files.map((f) => ({ name: String(f.name).slice(0, 200), path: f.path, type: String(f.type || ""), size: Math.max(0, +f.size || 0) })) },
    }).select("id").single();
    if (error || !data) return { ok: false as const, error: error?.message || "Couldn't start it." };
    return { ok: true as const, id: data.id as string, text: subject };
  } catch (e) { return fail(e); }
}
