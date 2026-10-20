import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState } from "@/lib/ai/claude";
import { emailConversation, pastJobs, suggestEmailOrder } from "@/lib/ai/emailOrder";
import { createOrderFromDraft } from "@/lib/emailOrderCreate";
import type { EmailPlan } from "@/lib/ai/emailPlan";
import type { EODraft, EOFile, EOPart } from "@/lib/emailOrderShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Inbox → Create order (staff only).
 *   GET  ?activity=<email id>  the saved suggestion (if the AI already read it), the customer's past jobs, the files
 *   POST { activity }          the AI reads the email and its attachments again and suggests the order
 *   PUT  { activity, draft, status }  create the order staff checked
 * With `part` (GET ?part=, POST/PUT { part }): one of several orders in the email (lib/ai/emailPlan.ts), read and saved
 * on its own with only its files.
 */
async function partOf(admin: ReturnType<typeof createAdminClient>, activity: string, key: string): Promise<EOPart | null> {
  if (!key) return null;
  const { data } = await admin.from("ai_suggestions").select("payload").eq("dedupe_key", `email:${activity}:plan`).maybeSingle();
  return ((data?.payload as EmailPlan | null)?.parts || []).find((p) => p.key === key) || null;
}
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
  const sp = new URL(req.url).searchParams;
  const id = sp.get("activity") || "";
  const admin = createAdminClient();
  const part = await partOf(admin, id, sp.get("part") || "");
  const { data: a } = await admin.from("activities").select("id, customer_id, meta").eq("id", id).maybeSingle();
  if (!a) return NextResponse.json({ error: "Email not found." }, { status: 404 });
  const [{ data: sg }, past, st, { data: cust }, cv] = await Promise.all([
    admin.from("ai_suggestions").select("id, status, order_id, payload").eq("dedupe_key", `email:${id}:order${part ? `:${part.key}` : ""}`).maybeSingle(),
    pastJobs(admin, a.customer_id as string | null),
    aiState(admin),
    a.customer_id ? admin.from("customers").select("*").eq("id", a.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    emailConversation(admin, id).catch(() => null),
  ]);
  // a draft read before the conversation's newest email (new sizes came in, Oct 12) is read again, the whole
  // conversation this time
  let pl = sg?.payload as { v?: number; draft?: EODraft; seen?: string } | null;
  const newest = cv?.convo[0]?.occurred_at || "";
  // no draft on this email, but one from another email in the same conversation that has read it all (Oct 12: starting
  // from a different email in Methodist's thread read the whole thing again)
  if (!pl && !part && cv && cv.convo.length > 1) {
    const { data: others } = await admin.from("ai_suggestions").select("payload, updated_at").eq("kind", "draft_order").eq("status", "open").in("activity_id", cv.convo.map((e) => e.id)).order("updated_at", { ascending: false }).limit(5);
    const fresh = ((others || []) as { payload: { v?: number; draft?: EODraft; seen?: string } | null }[]).find((x) => x.payload?.v === 2 && x.payload.seen && x.payload.seen >= newest);
    if (fresh) pl = fresh.payload;
  }
  const stale = !!pl && sg?.status !== "done" && st.ready && (pl.seen ? newest > pl.seen : (cv?.convo.length || 1) > 1);
  const draft = pl?.v === 2 && !stale ? (pl as { draft: EODraft }).draft : null;
  // the files from the whole conversation, newest first
  type F = { name: string; path: string; type: string; size: number };
  const all: F[] = [];
  for (const e of cv?.convo || [a]) for (const f of ((e.meta as { attachments?: F[] } | null)?.attachments || [])) if (!all.some((x) => x.path === f.path)) all.push(f);
  const mine = part ? all.filter((f) => part.files.includes(f.path) || (part.names || []).includes(f.name)) : all;
  const atts = mine.slice(0, 12).map((f) => ({ ...f, role: "other" as const }));
  const files = await signed(admin, draft?.files || atts);
  return NextResponse.json({
    draft: draft ? { ...draft, files } : null, files, past, emails: cv?.convo.length || 1, created: sg?.status === "done" ? sg.order_id : null,
    finishing: st.settings.finishing || [], ai: st.ready, aiReason: st.reason, customer: cust,
  });
}

export async function POST(req: Request) {
  const v = await staff(); if (!v) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const admin = createAdminClient();
  const part = await partOf(admin, String(b.activity || ""), typeof b.part === "string" ? b.part : "");
  if (b.part && !part) return NextResponse.json({ error: "That order isn't in this email's plan any more. Close it and start again." }, { status: 400 });
  const r = await suggestEmailOrder(admin, String(b.activity || ""), v.user!.email || "staff", { told: typeof b.told === "string" ? b.told : "", jobRef: typeof b.job === "string" ? b.job : part?.job || null, reorderOk: !!b.reorderOk || !!(part?.job && !b.job), lookedUp: b.lookedUp && typeof b.lookedUp === "object" ? b.lookedUp : null, part });
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
