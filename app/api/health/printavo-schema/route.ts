import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// TEMPORARY: lists Printavo's API structure (field names and types only, never shop data) so the importer
// can be built against the real schema. Removed once the importer is done.
const T = "kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } }";
const Q = `{ __schema { types { name kind possibleTypes { name } enumValues { name } inputFields { name type { ${T} } } fields { name args { name type { ${T} } } type { ${T} } } } } }`;
let cache: { at: number; body: unknown } | null = null;

export async function GET(req: Request) {
  const want = new URL(req.url).searchParams.get("types")?.split(",").filter(Boolean);
  if (!cache || Date.now() - cache.at > 600000) {
    const email = process.env.PRINTAVO_EMAIL?.trim(), token = process.env.PRINTAVO_TOKEN?.trim();
    if (!email || !token) return NextResponse.json({ error: "not configured" });
    const r = await fetch("https://www.printavo.com/api/v2", { method: "POST", headers: { "Content-Type": "application/json", email, token }, body: JSON.stringify({ query: Q }) });
    const j = await r.json().catch(() => null);
    if (!j?.data) return NextResponse.json({ status: r.status, errors: j?.errors?.map((e: { message: string }) => e.message) });
    cache = { at: Date.now(), body: j.data.__schema.types.filter((t: { name: string }) => !t.name.startsWith("__")) };
  }
  const fmt = (t: { kind: string; name: string | null; ofType?: unknown }): string => t.kind === "NON_NULL" ? fmt(t.ofType as never) + "!" : t.kind === "LIST" ? `[${fmt(t.ofType as never)}]` : String(t.name);
  type F = { name: string; args?: { name: string; type: never }[]; type: never };
  const types = (cache.body as { name: string; kind: string; fields: F[] | null; inputFields: F[] | null; possibleTypes: { name: string }[] | null; enumValues: { name: string }[] | null }[])
    .filter((t) => !want || want.includes(t.name) || want.includes("ALL"));
  if (!want) return NextResponse.json(types.map((t) => `${t.kind} ${t.name}`));
  return new NextResponse(types.map((t) => `${t.kind} ${t.name}` + (t.possibleTypes ? ` = ${t.possibleTypes.map((p) => p.name).join(" | ")}` : "") + (t.enumValues ? ` { ${t.enumValues.map((e) => e.name).join(" ")} }` : "") + "\n" +
    [...(t.fields || []), ...(t.inputFields || [])].map((f) => `  ${f.name}${f.args?.length ? `(${f.args.map((a) => `${a.name}: ${fmt(a.type)}`).join(", ")})` : ""}: ${fmt(f.type)}`).join("\n")).join("\n\n"), { headers: { "content-type": "text/plain" } });
}
