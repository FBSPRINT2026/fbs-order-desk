import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobActor } from "@/lib/jobAccess";
import { loadJobCard, parseJobCode } from "@/lib/jobCard";
import { boxLabelSvg, boxLabelZpl, testLabelZpl } from "@/lib/zpl";
import { printSettings, queueLabels } from "@/lib/printQueue";
import { shopNetwork } from "@/lib/shopNetwork";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Print to the Zebra: { action: "box", job: "34110" | { kind, id }, boxes: 5, only?: 2 } prints box labels 1–5 (or
 * just box 2); { action: "test" } prints a test label. Staff or employees.
 */
export async function POST(req: Request) {
  const who = await jobActor();
  if (!who) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const admin = createAdminClient();
  const ps = await printSettings(admin);
  if (b.action === "test") {
    const r = await queueLabels(admin, [{ title: "Test label", zpl: testLabelZpl(ps.dpi, who.name), kind: "test" }], who.name);
    return NextResponse.json(r, { status: r.ok ? 200 : 202 });
  }
  // the box label as a picture, before it prints (Outbound's Print box label pop-up)
  if (b.action === "preview") {
    const ref = typeof b.job === "object" && b.job && (b.job.kind === "o" || b.job.kind === "a") ? { kind: b.job.kind as "o" | "a", id: String(b.job.id) } : parseJobCode(String(b.job || ""));
    if (!ref) return NextResponse.json({ error: "Which job?" }, { status: 400 });
    const card = await loadJobCard(admin, ref);
    if (!card) return NextResponse.json({ error: "No job with that number." }, { status: 404 });
    const n = Math.max(0, Math.min(99, Math.round(+b.boxes || 0))), of = b.known === false ? 0 : n;
    const box = of ? Math.max(1, Math.min(of, Math.round(+b.box || 1))) : 0;
    return NextResponse.json({ svg: boxLabelSvg(card, box, of), job: { kind: card.kind, id: card.id, number: card.number, name: card.name, customer: card.customer, qty: card.qty } });
  }
  if (b.action === "box") {
    const ref = typeof b.job === "object" && b.job && (b.job.kind === "o" || b.job.kind === "a") ? { kind: b.job.kind as "o" | "a", id: String(b.job.id) } : parseJobCode(String(b.job || ""));
    if (!ref) return NextResponse.json({ error: "Which job?" }, { status: 400 });
    const card = await loadJobCard(admin, ref);
    if (!card) return NextResponse.json({ error: "No job with that number." }, { status: 404 });
    // boxes = how many labels; known: false = the box count isn't known yet, so each prints "BOX ___ OF ___" to write
    // in (Nick, Nov 13: "I'm going to print 10 labels because I think I'll probably need 8")
    const count = Math.max(1, Math.min(99, Math.round(+b.boxes || 0))), of = b.known === false ? 0 : count;
    const only = of ? Math.round(+b.only || 0) : 0;
    const list = only ? [only] : Array.from({ length: count }, (_, i) => i + 1);
    const r = await queueLabels(admin, list.map((n) => ({ title: `#${card.number} ${of ? `box ${n} of ${of}` : `label ${n} of ${count} (box count to write in)`}`, zpl: boxLabelZpl(card, of ? n : 0, of, ps.dpi), kind: "box", order_id: card.kind === "o" ? card.id : null, archived_order_id: card.kind === "a" ? card.id : null })), who.name);
    return NextResponse.json(r, { status: r.ok ? 200 : 202 });
  }
  return NextResponse.json({ error: "Print what?" }, { status: 400 });
}

/** The label printer's status (staff): recent labels and the print computers. */
export async function GET() {
  const who = await jobActor();
  if (!who || who.kind !== "staff") return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const admin = createAdminClient();
  const [{ data: jobs }, { data: relays }, ps, net] = await Promise.all([
    admin.from("print_jobs").select("id, title, kind, status, error, created_by, created_at, sent_at, done_at").order("created_at", { ascending: false }).limit(15),
    admin.from("print_relays").select("id, name, last_seen_at, revoked, created_by, created_at").eq("revoked", false).order("created_at"),
    printSettings(admin),
    shopNetwork(admin),
  ]);
  return NextResponse.json({ jobs: jobs || [], relays: relays || [], settings: ps, printnode: !!process.env.PRINTNODE_API_KEY?.trim(), network: { ip: net.ip, ips: net.ips, names: net.names, on: net.on } });
}
