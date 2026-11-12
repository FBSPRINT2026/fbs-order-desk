import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { orderGroups, type Fee, type Group, type Order } from "@/lib/pricing";
import { sampleCredit, type FromSample } from "@/lib/samples";

export const dynamic = "force-dynamic";

/**
 * Make the order from a sample (Nov 11 2026, Nick: "we should be able to come back and say on that sample run… they chose
 * this one… and then it's all linked together"). POST { id, group }: a new order for the same customer from that one
 * sample (its garments with no sizes yet, its prints, art and mockup), linked both ways: the new order's from_sample
 * points at the sample, the sample's group says which order it became. Whatever the sample charged with "credit on the
 * full run" comes off the new order as a Sample credit fee.
 */
const uid = () => crypto.randomUUID();
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; group?: string };
  const admin = createAdminClient();
  const { data: o } = await admin.from("orders").select("*").eq("id", String(b.id || "")).maybeSingle();
  if (!o) return NextResponse.json({ error: "That order isn't here." }, { status: 404 });
  const groups = orderGroups(o as Order);
  // one sample (a group of a Sample only order), or the whole Sample order ("all", its Production ▾ → Make the order)
  const srcs = b.group === "all" ? groups.filter((g) => g.sample?.kind !== "pre") : groups.filter((g) => g.id === b.group);
  if (!srcs.length) return NextResponse.json({ error: "That sample isn't on the order." }, { status: 404 });
  const done = srcs.find((g) => g.sample?.made);
  if (b.group !== "all" && done?.sample?.made) return NextResponse.json({ error: `That sample is already #${done.sample.made.number}.`, id: done.sample.made.id, number: done.sample.made.number }, { status: 409 });
  const made0 = srcs.map((src) => {
    const c = JSON.parse(JSON.stringify(src)) as Group;
    delete c.sample;
    return { src, g: { ...c, id: uid(), fromGroup: src.id, lines: c.lines.map((l) => ({ ...l, id: uid(), sizes: {}, priceOverride: null, sampleOf: undefined })), imprints: c.imprints.map((d) => ({ ...d, id: uid() })) } as Group };
  });
  const credit = Math.round(srcs.reduce((a2, g) => a2 + sampleCredit(g.sample), 0) * 100) / 100;
  const name = b.group === "all" ? (o.nickname || "") : srcs[0].name?.trim() || srcs[0].lines.map((l) => l.style).filter(Boolean).slice(0, 2).join(", ");
  const fees: Fee[] = credit ? [{ label: `Sample credit (#${o.number}${name ? ` · ${name}` : ""})`, amount: -credit }] : [];
  const from: FromSample = { id: o.id, number: o.number, group: b.group === "all" ? "all" : srcs[0].id, name, credit };
  const { data: made, error } = await admin.from("orders").insert({
    customer_id: o.customer_id, nickname: name || o.nickname || "Job", groups: made0.map((x) => x.g), fees, po_number: "",
    delivery_method: o.delivery_method, ship_to: o.ship_to, ship_method: o.ship_method, price_type: o.price_type,
    tax_exempt: o.tax_exempt, tax_rate: o.tax_rate, notes: "", order_type: "new", from_sample: from,
  }).select("id, number").single();
  if (error || !made) return NextResponse.json({ error: "Couldn't make the order: " + (error?.message || "unknown") }, { status: 500 });
  // each group's mockup comes along (the latest for that group)
  for (const { src, g } of made0) {
    const { data: m } = await admin.from("mockups").select("customer_id, title, file_path, design_ids, snapshot").eq("order_id", o.id).eq("group_id", src.id).is("archived_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (m) await admin.from("mockups").insert({ customer_id: m.customer_id, order_id: made.id, group_id: g.id, proof_id: null, title: m.title, file_path: m.file_path, design_ids: m.design_ids || [], created_by: v.email || "", snapshot: m.snapshot });
  }
  // a single sample remembers the order it became (a whole Sample order is told by its activity)
  if (b.group !== "all") {
    const next = groups.map((x) => (x.id === srcs[0].id ? { ...x, sample: { ...(x.sample || { kind: "only" as const, source: "extra" as const, charges: [] }), made: { id: made.id, number: made.number } } } : x));
    await admin.from("orders").update({ groups: next, updated_at: new Date().toISOString() }).eq("id", o.id);
  }
  await admin.from("order_events").insert([
    { order_id: made.id, kind: "from_sample", detail: `Made from sample #${o.number}${name ? ` (${name})` : ""}${credit ? `, $${credit.toFixed(2)} credited` : ""}`, actor: v.email || "" },
    { order_id: o.id, kind: "sample_made", detail: `${name || "Sample"} became #${made.number}`, actor: v.email || "" },
  ]).then(() => null, () => null);
  return NextResponse.json({ id: made.id, number: made.number, credit });
}
