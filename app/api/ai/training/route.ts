import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState } from "@/lib/ai/claude";
import { applyTraining, dismissTraining, trainingChat, trainingThread, type TrainFile } from "@/lib/ai/trainingChat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Order training chat (staff). Body { trainingId, action: "thread" | "chat" | "apply" | "dismiss" | "archive", text?,
 * files?, base?, index? }, or { customerId, action: "create", name?, when? } for a new training. "chat" asks Claude and returns its proposed training; "apply" saves one staff approved.
 */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return Response.json({ ok: false, error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const admin = createAdminClient();
  // a new training for a customer (Program & training → "+ New training"): made empty, then talked into shape
  if (b.action === "create") {
    const customerId = String(b.customerId || "");
    if (!/^[0-9a-f-]{36}$/i.test(customerId)) return Response.json({ ok: false, error: "Which customer?" }, { status: 400 });
    const { data, error } = await admin.from("order_trainings").insert({ customer_id: customerId, name: String(b.name || "").trim().slice(0, 120), when_words: String(b.when || "").trim().slice(0, 300), updated_by: v.email }).select("id").single();
    return error ? Response.json({ ok: false, error: error.message }, { status: 400 }) : Response.json({ ok: true, id: data.id });
  }
  const trainingId = String(b.trainingId || "");
  if (!/^[0-9a-f-]{36}$/i.test(trainingId)) return Response.json({ ok: false, error: "Which training?" }, { status: 400 });
  const { data: tr } = await admin.from("order_trainings").select("customer_id").eq("id", trainingId).maybeSingle();
  if (!tr) return Response.json({ ok: false, error: "That training isn't there any more." }, { status: 404 });
  const customerId = tr.customer_id as string;
  try {
    if (b.action === "thread") return Response.json({ ok: true, messages: await trainingThread(admin, trainingId) });
    if (b.action === "apply") { const r = await applyTraining(admin, trainingId, +b.index, v.email); return Response.json(r, { status: r.ok ? 200 : 400 }); }
    if (b.action === "dismiss") return Response.json(await dismissTraining(admin, trainingId, +b.index, v.email));
    // set aside (kept, not deleted)
    if (b.action === "archive") { await admin.from("order_trainings").update({ archived_at: new Date().toISOString(), updated_by: v.email }).eq("id", trainingId); return Response.json({ ok: true }); }
    const st = await aiState(admin);
    if (!st.ready) return Response.json({ ok: false, off: true, error: st.reason }, { status: 400 });
    const files: TrainFile[] = (Array.isArray(b.files) ? b.files : [])
      .filter((f: TrainFile) => typeof f?.path === "string" && f.path.startsWith(`brand-guides/${customerId}/training/`) && !f.path.includes(".."))
      .slice(0, 4).map((f: TrainFile) => ({ path: f.path, name: String(f.name || "file").slice(0, 120), type: String(f.type || "").slice(0, 100) }));
    const base = b.base && typeof b.base === "object" ? { training: String(b.base.training ?? ""), name: String(b.base.name ?? ""), when: String(b.base.when ?? "") } : undefined;
    const r = await trainingChat(admin, st.settings, trainingId, v.email, String(b.text || ""), files, base);
    return Response.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Something went wrong." }, { status: 500 });
  }
}
