import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState } from "@/lib/ai/claude";
import { applyTraining, dismissTraining, trainingChat, trainingThread, type TrainFile } from "@/lib/ai/trainingChat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Order training chat (staff). Body { customerId, action: "thread" | "chat" | "apply" | "dismiss", text?, files?,
 * base?, index? }. "chat" asks Claude and returns its proposed training; "apply" saves one staff approved.
 */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return Response.json({ ok: false, error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const customerId = String(b.customerId || "");
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) return Response.json({ ok: false, error: "Which customer?" }, { status: 400 });
  const admin = createAdminClient();
  try {
    if (b.action === "thread") return Response.json({ ok: true, messages: await trainingThread(admin, customerId) });
    if (b.action === "apply") { const r = await applyTraining(admin, customerId, +b.index, v.email); return Response.json(r, { status: r.ok ? 200 : 400 }); }
    if (b.action === "dismiss") return Response.json(await dismissTraining(admin, customerId, +b.index, v.email));
    const st = await aiState(admin);
    if (!st.ready) return Response.json({ ok: false, off: true, error: st.reason }, { status: 400 });
    const files: TrainFile[] = (Array.isArray(b.files) ? b.files : [])
      .filter((f: TrainFile) => typeof f?.path === "string" && f.path.startsWith(`brand-guides/${customerId}/training/`) && !f.path.includes(".."))
      .slice(0, 4).map((f: TrainFile) => ({ path: f.path, name: String(f.name || "file").slice(0, 120), type: String(f.type || "").slice(0, 100) }));
    const base = b.base && typeof b.base === "object" ? { training: String(b.base.training ?? ""), name: String(b.base.name ?? ""), when: String(b.base.when ?? "") } : undefined;
    const r = await trainingChat(admin, st.settings, customerId, v.email, String(b.text || ""), files, base);
    return Response.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Something went wrong." }, { status: 500 });
  }
}
