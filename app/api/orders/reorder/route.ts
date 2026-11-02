import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calcOrder, mergeSettings, newGLine, orderGroups, type GLine, type Group, type Order } from "@/lib/pricing";

export const dynamic = "force-dynamic";

/**
 * Reorder of one of OUR orders (Nov 2, Nick: "instead of duplicate, it should just say reorder… the same thing we talked
 * about last night with the reorder helper… just now we have it in our system and we don't need to do anything
 * special"). The same Create reorder pop-up as an old Printavo job (components/tools/ReorderPick.tsx: sizes the same /
 * from a file / typed, last time's price or today's). The art and mockups come with it; its Production files and its
 * notes are asked about like a Printavo job's (Nov 2, Nick on #40359: "it brought in all the S&S stuff… you should still
 * ask me… what are these attachments… autofill… keep them where they're at… the customer notes, production notes, ask
 * me if you want to keep those"): each file starts as what it is on the old order (last time's blank orders and size
 * sheets start as Leave it off), each note ticked.
 *   GET ?id=   the order as the pop-up lists it (lines, files, notes)
 *   PUT { id, price, mode, sizes, drop, add, files: { [art file id]: category | "skip" }, carry: ["production","customer"] }
 */
async function staff() { const v = await getViewer(); return v.user && v.isStaff ? v : null; }
const uid = () => crypto.randomUUID();
const sizeText = (z: Record<string, number | undefined>) => Object.entries(z || {}).filter(([, n]) => (n || 0) > 0).map(([k, n]) => `${k} ${n}`).join(" · ");

export async function GET(req: Request) {
  const v = await staff(); if (!v) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id") || "";
  const admin = createAdminClient();
  const [{ data: o }, { data: s }] = await Promise.all([admin.from("orders").select("*").eq("id", id).maybeSingle(), admin.from("settings").select("data").eq("id", 1).maybeSingle()]);
  if (!o) return NextResponse.json({ error: "That order isn't here." }, { status: 404 });
  const { data: c } = await admin.from("customers").select("id, company, name, moved_at").eq("id", o.customer_id).maybeSingle();
  const calc = calcOrder(o as Order, mergeSettings(s?.data));
  const each = new Map(calc.groups.flatMap((g) => g.lines).map((l) => [l.id, l.each]));
  const lines = orderGroups(o as Order).flatMap((g) => g.lines.map((l) => ({ ref: l.id, style: l.style || "", brand: l.brand || "", color: l.color || "", garment: l.garment || "",
    qty: Object.values(l.sizes || {}).reduce<number>((a, n) => a + (+(n || 0)), 0), price: each.get(l.id) || 0, sizes: sizeText(l.sizes as Record<string, number>) })));
  // its Production files, each starting as what it is on this order; its notes
  const [{ data: af }, { data: inn }] = await Promise.all([
    admin.from("art_files").select("id, name, file_path, file_type, category, note, guess").eq("order_id", o.id).order("created_at"),
    admin.from("order_internal").select("production_notes").eq("order_id", o.id).maybeSingle(),
  ]);
  const files = ((af || []) as { id: string; name: string; file_path: string; file_type: string | null; category: string | null; note: string | null; guess: string | null }[]).map((f) => ({
    key: f.id, name: f.name, path: f.file_path, thumb: /^image\//.test(f.file_type || "") || /\.(png|jpe?g|webp|gif)$/i.test(f.name) ? f.file_path : "", mime: f.file_type || "", where: "", group: 0,
    guess: f.category || f.guess || "", why: f.note || "" }));
  // our own customer is always "in the new system" for this
  return NextResponse.json({ job: { visual: String(o.number), nickname: o.nickname || "", date: String(o.created_at || "").slice(0, 10), qty: lines.reduce((a, l) => a + l.qty, 0), total: +o.total || 0 },
    customer: c ? { ...c, moved_at: c.moved_at || new Date().toISOString() } : null, lines, files, own: true,
    notes: { production: String(inn?.production_notes || ""), customer: String(o.notes || "") } });
}

export async function PUT(req: Request) {
  const v = await staff(); if (!v) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({})) as { id?: string; price?: "last" | "today"; mode?: "same" | "file" | "clear"; sizes?: Record<string, Record<string, number>>; drop?: string[]; add?: { style: string; color: string; sizes: Record<string, number> }[]; files?: Record<string, string>; carry?: string[] };
  const admin = createAdminClient();
  const [{ data: o }, { data: s }] = await Promise.all([admin.from("orders").select("*").eq("id", String(b.id || "")).maybeSingle(), admin.from("settings").select("data").eq("id", 1).maybeSingle()]);
  if (!o) return NextResponse.json({ error: "That order isn't here." }, { status: 404 });
  const calc = calcOrder(o as Order, mergeSettings(s?.data));
  const each = new Map(calc.groups.flatMap((g) => g.lines).map((l) => [l.id, l.each]));
  const drop = new Set(b.drop || []);
  // every group copied with new ids (each remembers the one it came from, so its mockup comes along)
  let groups: Group[] = orderGroups(o as Order).map((g) => {
    const c = JSON.parse(JSON.stringify(g)) as Group;
    const lines = c.lines.filter((l) => !drop.has(l.id)).map((l) => {
      const was = l.id;
      const sizes = b.mode === "clear" ? {} : b.mode === "file" && b.sizes?.[was] ? b.sizes[was] : l.sizes;
      // last time's price: the price each piece was, held; today's: worked out again
      const priceOverride = b.price === "last" ? (l.priceOverride ?? each.get(was) ?? null) : l.priceOverride ?? null;
      return { ...l, id: uid(), sizes: sizes as GLine["sizes"], priceOverride };
    });
    return { ...c, id: uid(), fromGroup: g.id, lines, imprints: c.imprints.map((d) => ({ ...d, id: uid() })) } as Group;
  }).filter((g) => g.lines.length);
  // styles on the file that weren't on last time's order: added to the first group
  if (b.mode === "file" && b.add?.length && groups[0]) for (const a of b.add) { const nl = newGLine(); nl.style = a.style; nl.color = a.color; nl.sizes = a.sizes as GLine["sizes"]; groups[0].lines.push(nl); }
  if (!groups.length) groups = [];
  const qty = groups.reduce((a, g) => a + g.lines.reduce((x, l) => x + Object.values(l.sizes || {}).reduce<number>((y, n) => y + (+(n || 0)), 0), 0), 0);
  const { data: made, error } = await admin.from("orders").insert({
    customer_id: o.customer_id, nickname: o.nickname || "Job", groups, fees: o.fees, po_number: "",
    delivery_method: o.delivery_method, ship_to: o.ship_to, ship_method: o.ship_method, third_party: o.third_party || null, price_type: o.price_type,
    discount_pct: o.discount_pct, discount_amt: o.discount_amt || 0, discount_type: o.discount_type || "pct", tax_exempt: o.tax_exempt, tax_rate: o.tax_rate, waive_setup: false, notes: !b.carry || b.carry.includes("customer") ? o.notes : "", notes_on_invoice: (!b.carry || b.carry.includes("customer")) && !!o.notes_on_invoice, qty,
  }).select("id, number").single();
  if (error || !made) return NextResponse.json({ error: "Couldn't make the reorder: " + (error?.message || "unknown") }, { status: 500 });
  // its mockups (the latest of each group) and production files come with it, nothing made again
  const { data: olds } = await admin.from("mockups").select("customer_id, group_id, title, file_path, design_ids, snapshot, created_at").eq("order_id", o.id).is("archived_at", null).order("created_at", { ascending: false });
  for (const g of groups) {
    const m = (olds || []).find((x) => x.group_id === (g as Group & { fromGroup?: string }).fromGroup);
    if (m) await admin.from("mockups").insert({ customer_id: m.customer_id, order_id: made.id, group_id: g.id, proof_id: null, title: m.title, file_path: m.file_path, design_ids: m.design_ids || [], created_by: v.email || "", snapshot: m.snapshot });
  }
  // the Production files you kept, each as what you said it is (nothing said: as it was)
  const { data: all } = await admin.from("art_files").select("id, name, file_path, file_type, category, note").eq("order_id", o.id);
  const pick = b.files || {};
  const files = ((all || []) as { id: string; name: string; file_path: string; file_type: string | null; category: string | null; note: string | null }[]).filter((f) => pick[f.id] !== "skip")
    .map((f) => ({ name: f.name, file_path: f.file_path, file_type: f.file_type, category: pick[f.id] && pick[f.id] !== "keep" ? pick[f.id] : f.category, order_id: made.id, note: [f.note, `From #${o.number}`].filter(Boolean).join(" · ").slice(0, 300) }));
  if (files.length) await admin.from("art_files").insert(files);
  // last time's production notes, when ticked
  if (b.carry?.includes("production")) {
    const { data: inn } = await admin.from("order_internal").select("production_notes").eq("order_id", o.id).maybeSingle();
    if (inn?.production_notes) await admin.from("order_internal").upsert({ order_id: made.id, production_notes: inn.production_notes });
  }
  await admin.from("order_events").insert({ order_id: made.id, kind: "reorder", detail: `Reorder of #${o.number}${b.mode === "file" ? " (new sizes from a file)" : b.mode === "clear" ? " (sizes to type)" : ""}, ${b.price === "last" ? "last time's prices" : "today's price list"}`, actor: v.email || "" });
  // a wholesale reorder still at new screens: the order page offers the reprint screen fee (?reprint=1), as Duplicate did
  const reprint = o.price_type === "wholesale" && groups.some((g) => g.imprints.some((im) => im.method === "screen" && !(im.remake ?? g.remake)));
  return NextResponse.json({ id: made.id, number: made.number, groups: groups.length, pcs: qty, files: files?.length || 0, reprint });
}
