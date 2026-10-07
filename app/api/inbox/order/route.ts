import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState } from "@/lib/ai/claude";
import { pastJobs, suggestEmailOrder } from "@/lib/ai/emailOrder";
import { createOrderFromDraft } from "@/lib/emailOrderCreate";
import type { EODraft, EOFile } from "@/lib/emailOrderShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Inbox → Create order (staff only).
 *   GET  ?activity=<email id>  the saved suggestion (if the AI already read it), the customer's past jobs, the files
 *   POST { activity }          the AI reads the email and its attachments again and suggests the order
 *   PUT  { activity, draft, status }  create the order staff checked
 */
async function staff() { const v = await getViewer(); return v.user && v.isStaff ? v : null; }

async function signed(admin: ReturnType<typeof createAdminClient>, files: EOFile[]) {
  const paths = files.map((f) => f.path).filter(Boolean);
  if (!paths.length) return files;
  const { data } = await admin.storage.from("proofs").createSignedUrls(paths, 3600);
  const url = new Map((data || []).map((x) => [x.path, x.signedUrl]));
  return files.map((f) => ({ ...f, url: url.get(f.path) || "" }));
}

export async function GET(req: Request) {
  const v = await staff(); if (!v) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const id = new URL(req.url).searchParams.get("activity") || "";
  const admin = createAdminClient();
  const { data: a } = await admin.from("activities").select("id, customer_id, meta").eq("id", id).maybeSingle();
  if (!a) return NextResponse.json({ error: "Email not found." }, { status: 404 });
  const [{ data: sg }, past, st, { data: cust }] = await Promise.all([
    admin.from("ai_suggestions").select("id, status, order_id, payload").eq("dedupe_key", `email:${id}:order`).maybeSingle(),
    pastJobs(admin, a.customer_id as string | null),
    aiState(admin),
    a.customer_id ? admin.from("customers").select("id, company, name, price_type").eq("id", a.customer_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const draft = (sg?.payload as { v?: number; draft?: EODraft } | null)?.v === 2 ? (sg!.payload as { draft: EODraft }).draft : null;
  const atts = ((a.meta as { attachments?: { name: string; path: string; type: string; size: number }[] })?.attachments || []).map((f) => ({ ...f, role: "other" as const }));
  const files = await signed(admin, draft?.files || atts);
  return NextResponse.json({
    draft: draft ? { ...draft, files } : null, files, past, created: sg?.status === "done" ? sg.order_id : null,
    finishing: st.settings.finishing || [], ai: st.ready, aiReason: st.reason, customer: cust,
  });
}

export async function POST(req: Request) {
  const v = await staff(); if (!v) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const admin = createAdminClient();
  const r = await suggestEmailOrder(admin, String(b.activity || ""), v.user!.email || "staff");
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  const files = await signed(admin, r.draft.files);
  return NextResponse.json({ draft: { ...r.draft, files }, files, past: r.past });
}

export async function PUT(req: Request) {
  const v = await staff(); if (!v) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  if (!b.draft || typeof b.draft !== "object") return NextResponse.json({ error: "Nothing to create." }, { status: 400 });
  const draft = { ...(b.draft as EODraft), files: ((b.draft as EODraft).files || []).map(({ url: _u, ...f }) => f) } as EODraft;
  const r = await createOrderFromDraft(createAdminClient(), v.user!.email || "staff", { activityId: String(b.activity || ""), draft, status: b.status === "approved" ? "approved" : "quote" });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json(r);
}
