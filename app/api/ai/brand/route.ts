import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState } from "@/lib/ai/claude";
import { applyBrand, brandChat, brandThread, dismissBrand } from "@/lib/ai/brandChat";
import type { BrandFile } from "@/lib/brandStandards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Brand standards chat (owners and admins). Body { customerId, action: "thread" | "chat" | "apply" | "dismiss",
 * text?, files?, index? }. "chat" asks the AI and returns its proposal; "apply" saves a proposal an admin approved.
 */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return Response.json({ error: "Staff only." }, { status: 403 });
  if (v.role !== "owner" && v.role !== "admin") return Response.json({ error: "Only owners and admins can set up brand standards with AI." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const customerId = String(b.customerId || "");
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) return Response.json({ error: "Which customer?" }, { status: 400 });
  const admin = createAdminClient();
  try {
    if (b.action === "thread") return Response.json({ ok: true, messages: await brandThread(admin, customerId) });
    if (b.action === "apply") { const r = await applyBrand(admin, customerId, +b.index, v.email); return Response.json(r, { status: r.ok ? 200 : 400 }); }
    if (b.action === "dismiss") return Response.json(await dismissBrand(admin, customerId, +b.index, v.email));
    const st = await aiState(admin);
    if (!st.ready) return Response.json({ ok: false, off: true, error: st.reason }, { status: 400 });
    const files: BrandFile[] = (Array.isArray(b.files) ? b.files : [])
      .filter((f: BrandFile) => typeof f?.path === "string" && f.path.startsWith(`brand-guides/${customerId}/`) && !f.path.includes(".."))
      .slice(0, 4).map((f: BrandFile) => ({ path: f.path, name: String(f.name || "file").slice(0, 120), type: String(f.type || "").slice(0, 100) }));
    const r = await brandChat(admin, st.settings, customerId, v.email, String(b.text || ""), files);
    return Response.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "Something went wrong." }, { status: 500 });
  }
}
