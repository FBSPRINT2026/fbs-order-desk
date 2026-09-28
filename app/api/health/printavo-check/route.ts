import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pv } from "@/lib/printavo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORARY: reads (read-only) everything about approvals and messages on invoice 34189 so the importer can bring them over.
// The data is saved to a private table for review; this page returns only counts. Removed after use.
type TRef = { kind: string; name: string | null; ofType?: TRef | null };
type Field = { name: string; args: { name: string; type: TRef }[]; type: TRef };
type TypeInfo = { name: string; kind: string; fields: Field[] | null; possibleTypes: { name: string }[] | null };
const base = (t: TRef): TRef => (t.ofType ? base(t.ofType) : t);
const T = "kind name ofType { kind name ofType { kind name ofType { kind name } } }";

export async function GET() {
  const admin = createAdminClient();
  const intro = await pv<{ __schema: { types: TypeInfo[] } }>(`query{ __schema{ types{ name kind possibleTypes{ name } fields{ name args{ name type{ ${T} } } type{ ${T} } } } } }`);
  const types = new Map(intro.__schema.types.map((t) => [t.name, t]));
  const pick = [...types.values()].filter((t) => /approv|message|thread|attachment|email|activit|comment|history|event|timeline/i.test(t.name) && !t.name.startsWith("__"));
  await admin.from("printavo_probe").insert({ label: "types", data: pick.map((t) => ({ name: t.name, kind: t.kind, possible: t.possibleTypes?.map((p) => p.name), fields: t.fields?.map((f) => `${f.name}${f.args.length ? "(" + f.args.map((a) => a.name).join(",") + ")" : ""}: ${base(f.type).name}`) })) });
  const inv = types.get("Invoice");
  await admin.from("printavo_probe").insert({ label: "invoice-fields", data: inv?.fields?.map((f) => `${f.name}${f.args.length ? "(" + f.args.map((a) => a.name).join(",") + ")" : ""}: ${base(f.type).name}`) });

  // selection builder: scalars, plus nested objects / connections a few levels deep (only fields without required args)
  const sel = (tn: string, depth: number, seen: string[]): string => {
    const t = types.get(tn);
    if (!t) return "";
    if (t.kind === "UNION" || t.kind === "INTERFACE") return "__typename " + (t.possibleTypes || []).map((p) => `... on ${p.name}{ ${sel(p.name, depth, seen)} }`).join(" ");
    const parts: string[] = [];
    for (const f of t.fields || []) {
      if (f.args.some((a) => a.type.kind === "NON_NULL" && !["first"].includes(a.name))) continue;
      const b = base(f.type), bt = types.get(b.name || "");
      if (!bt || bt.kind === "SCALAR" || bt.kind === "ENUM") { parts.push(f.name); continue; }
      if (depth <= 0 || seen.includes(bt.name) || /^(Invoice|Quote|Customer|Account|LineItemGroup|LineItem)$/.test(bt.name)) continue;
      const hasFirst = f.args.some((a) => a.name === "first");
      const inner = sel(bt.name, depth - 1, [...seen, bt.name]);
      if (inner.trim()) parts.push(`${f.name}${hasFirst ? "(first:50)" : ""}{ ${inner} }`);
    }
    return parts.join(" ");
  };
  const found = await pv<{ invoices: { nodes: { id: string; visualId: string }[] } }>(`query{ invoices(query:"34189", first:10){ nodes{ id visualId } } }`);
  const hit = found.invoices.nodes.find((n) => String(n.visualId) === "34189");
  if (!hit) return NextResponse.json({ found: found.invoices.nodes.length, hit: false });
  const want = (inv?.fields || []).filter((f) => /approv|message|thread|email|activit|comment|history|event|timeline/i.test(f.name));
  const out: Record<string, unknown> = {};
  for (const f of want) {
    const b = base(f.type);
    const inner = types.get(b.name || "")?.kind === "SCALAR" || types.get(b.name || "")?.kind === "ENUM" ? "" : `{ ${sel(b.name || "", 3, [b.name || ""])} }`;
    const hasFirst = f.args.some((a) => a.name === "first");
    try { out[f.name] = (await pv<{ invoice: Record<string, unknown> }>(`query($id:ID!){ invoice(id:$id){ ${f.name}${hasFirst ? "(first:50)" : ""}${inner} } }`, { id: hit.id })).invoice?.[f.name]; }
    catch (e) { out[f.name] = { error: e instanceof Error ? e.message : String(e) }; }
  }
  // the order's message thread, in full
  try {
    const ts = await pv<{ invoice: { threadSummary: { id: string } | null } }>(`query($id:ID!){ invoice(id:$id){ threadSummary{ id } } }`, { id: hit.id });
    if (ts.invoice.threadSummary?.id) out.thread = (await pv<{ thread: unknown }>(`query($id:ID!){ thread(id:$id){ ${sel("Thread", 3, ["Thread"])} } }`, { id: ts.invoice.threadSummary.id })).thread;
  } catch (e) { out.thread = { error: e instanceof Error ? e.message : String(e) }; }
  await admin.from("printavo_probe").insert({ label: "invoice-34189", data: out });
  return NextResponse.json({ hit: true, fields: Object.keys(out) });
}
