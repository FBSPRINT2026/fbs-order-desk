import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { seesMoney } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, askClaude } from "@/lib/ai/claude";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The AI half of the search bar: a question in plain words ("what's due Friday for Cowboy Cool?", "did the Nine18
 * shirts arrive?", "who owes us the most?") answered from the shop's live data: open jobs (here and in Printavo),
 * unread messages, recent supplier shipments, open balances, plus whatever the normal search found.
 * Read-only: it answers and points to the right records; it never changes anything.
 */
type Ref = { ref: string; label: string };
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { q, found } = (await req.json().catch(() => ({}))) as { q?: string; found?: { ref: string; text: string }[] };
  const question = String(q || "").trim().slice(0, 500);
  if (question.length < 3) return NextResponse.json({ skip: true });
  const admin = createAdminClient();
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ off: true, reason: st.reason });

  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const [o, a, m, sml, bal] = await Promise.all([
    admin.from("orders").select("id, number, nickname, status, type, due_date, total, po_number, customers(company, name)").not("status", "in", "(completed)").order("number", { ascending: false }).limit(150),
    admin.from("archived_orders").select("id, visual_id, nickname, status_name, kind, due_date, total, balance, po_number, customers(company, name)").not("status_name", "in", '("Job Completed","Quote - Closed")').order("visual_id", { ascending: false }).limit(200),
    admin.from("messages").select("id, order_id, customer_id, author_name, body, created_at, customers(company, name)").eq("author_type", "customer").is("read_at", null).order("created_at", { ascending: false }).limit(25),
    admin.from("supplier_manifest_lines").select("supplier, supplier_order, customer_name, customer_po, tracking, method, track_status, est_delivery, delivered_at, qty_shipped, order_id, archived_order_id, kind").neq("kind", "ignored").order("created_at", { ascending: false }).limit(400),
    admin.from("archived_orders").select("id, visual_id, nickname, balance, customers(company, name)").eq("kind", "invoice").gt("balance", 1).order("balance", { ascending: false }).limit(25),
  ]);
  type C = { customers: { company: string; name: string } | null };
  const cn = (x: C) => x.customers?.company || x.customers?.name || "";
  const lines: string[] = [];
  lines.push("OPEN JOBS (ref | # | customer | job | status | due | total):");
  for (const x of (o.data || []) as unknown as ({ id: string; number: number; nickname: string; status: string; type: string; due_date: string | null; total: number; po_number: string } & C)[])
    lines.push(`o:${x.id} | #${x.number} | ${cn(x)} | ${x.nickname || ""}${x.po_number ? ` (PO ${x.po_number})` : ""} | ${x.type === "quote" ? "quote" : x.status} | ${x.due_date || "-"} | $${Math.round(+x.total || 0)}`);
  for (const x of (a.data || []) as unknown as ({ id: string; visual_id: string; nickname: string; status_name: string; kind: string; due_date: string | null; total: number; balance: number; po_number: string } & C)[])
    lines.push(`a:${x.id} | #${x.visual_id} | ${cn(x)} | ${x.nickname || ""}${x.po_number && x.po_number !== x.nickname ? ` (PO ${x.po_number})` : ""} | Printavo: ${x.status_name} | ${x.due_date || "-"} | $${Math.round(+x.total || 0)}${+x.balance > 0 ? ` owes $${Math.round(+x.balance)}` : ""}`);
  lines.push("\nUNREAD CUSTOMER MESSAGES (ref | customer | when | text):");
  for (const x of (m.data || []) as unknown as ({ id: string; order_id: string | null; customer_id: string | null; author_name: string; body: string; created_at: string } & C)[])
    lines.push(`${x.order_id ? `o:${x.order_id}` : x.customer_id ? `c:${x.customer_id}` : "-"} | ${cn(x) || x.author_name} | ${x.created_at.slice(0, 16)} | ${x.body.slice(0, 200).replace(/\s+/g, " ")}`);
  lines.push("\nSUPPLIER SHIPMENTS COMING TO US (supplier | their order | account name | PO | tracking | status | eta | delivered | pcs | linked):");
  const seen = new Set<string>();
  for (const x of (sml.data || []) as { supplier: string; supplier_order: string; customer_name: string; customer_po: string; tracking: string; method: string; track_status: string; est_delivery: string | null; delivered_at: string | null; qty_shipped: number; order_id: string | null; archived_order_id: string | null }[]) {
    const k = `${x.supplier}|${x.supplier_order}|${x.tracking}`; if (seen.has(k)) continue; seen.add(k);
    lines.push(`${x.supplier === "sanmar" ? "SanMar" : "S&S"} | ${x.supplier_order} | ${x.customer_name} | ${x.customer_po || "-"} | ${x.tracking || x.method} | ${x.track_status || "on the way"} | ${x.est_delivery?.slice(0, 10) || "-"} | ${x.delivered_at?.slice(0, 16) || "-"} | ${x.qty_shipped} | ${x.order_id ? `o:${x.order_id}` : x.archived_order_id ? `a:${x.archived_order_id}` : "not linked"}`);
    if (seen.size > 120) break;
  }
  lines.push("\nBIGGEST OPEN BALANCES (ref | # | customer | job | owed):");
  for (const x of (bal.data || []) as unknown as ({ id: string; visual_id: string; nickname: string; balance: number } & C)[]) lines.push(`a:${x.id} | #${x.visual_id} | ${cn(x)} | ${x.nickname || ""} | $${Math.round(+x.balance)}`);
  if (found?.length) { lines.push("\nWHAT THE KEYWORD SEARCH FOUND (ref | text):"); for (const f of found.slice(0, 60)) lines.push(`${String(f.ref).slice(0, 60)} | ${String(f.text).slice(0, 200)}`); }

  // crew (production, receiving, shipping) see no money: take the amounts and the balances list out before asking
  const crew = !seesMoney(v.role);
  if (crew) {
    const b = lines.findIndex((l) => l.includes("BIGGEST OPEN BALANCES"));
    if (b >= 0) { let e = b + 1; while (e < lines.length && !lines[e].startsWith("\n")) e++; lines.splice(b, e - b); }
    for (let i = 0; i < lines.length; i++) lines[i] = lines[i].replace(/-?\$\s?-?[\d,]+(\.\d+)?/g, "-");
  }
  const r = await askClaude<{ answer: string; refs: Ref[] }>({
    task: "search", model: st.settings.assistant.ai.fastModel || st.settings.assistant.ai.model, maxTokens: 700, admin, ctx: { by: v.email },
    system: `You are the search assistant inside ${st.settings.shop.name}'s shop software (a Dallas-area screen printing and embroidery shop). Today is ${today}. Answer the staff member's question using ONLY the data given. Be brief and specific: one to four short sentences or a very short list, with order numbers, customers, dates and amounts. If the data doesn't answer it, say so plainly and suggest where to look. Never invent orders or numbers. Point to the records you used with their ref codes (o:… a:… c:…).${crew ? " This staff member works in production and doesn't see money: never mention prices, totals, balances, payments or sales figures; if asked, say that's for the owner or an admin." : ""}`,
    prompt: `Question: ${question}\n\nSHOP DATA\n${lines.join("\n")}`,
    tool: { name: "answer", description: "The answer for the search bar.", input_schema: { type: "object", properties: {
      answer: { type: "string", description: "Short plain-English answer." },
      refs: { type: "array", maxItems: 8, items: { type: "object", properties: { ref: { type: "string", description: "A ref code from the data (o:…, a:…, c:…)" }, label: { type: "string", description: "Short label, e.g. '#34417 Peticolas Brewing'" } }, required: ["ref", "label"] } },
    }, required: ["answer", "refs"] } },
  });
  if (!r.ok) return NextResponse.json({ error: r.error });
  const href = (ref: string) => { const [k, id] = ref.split(":"); return k === "o" ? `/shop/orders/${id}` : k === "a" ? `/shop/archive/${id}` : k === "c" ? `/shop/customers/${id}` : ""; };
  return NextResponse.json({ answer: r.data.answer, refs: (r.data.refs || []).map((x) => ({ label: x.label, href: href(x.ref) })).filter((x) => x.href) });
}
