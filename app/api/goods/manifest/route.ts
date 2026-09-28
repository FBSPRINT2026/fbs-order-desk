import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readXlsx } from "@/lib/xlsx";
import { applyGroup, importManifest, parseManifest, rememberAccount, unmatchedGroups, type ManifestLine } from "@/lib/manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function staff() {
  const v = await getViewer();
  return v.user && v.isStaff ? v : null;
}

/** Manifest shipments waiting to be matched to an order. */
export async function GET() {
  if (!(await staff())) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  return NextResponse.json({ groups: await unmatchedGroups(createAdminClient()) });
}

/**
 * Upload a supplier manifest (.xlsx or .csv): multipart form with `file`.
 * Or JSON { assign: { lineIds, orderId, kind } } to match a shipment by hand, { alias: { supplier, name, account, customerId } }
 * to say which customer a supplier account is, or { ignore: lineIds }.
 */
export async function POST(req: Request) {
  if (!(await staff())) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const admin = createAdminClient();
  try {
    if ((req.headers.get("content-type") || "").includes("application/json")) {
      const b = await req.json();
      if (b.alias) {
        // "who is this account?" → a customer; remembered for every future manifest
        const a = b.alias as { supplier: string; name: string; account: string; customerId: string };
        if (!a.customerId || !a.supplier) return NextResponse.json({ error: "Pick the customer." }, { status: 400 });
        return NextResponse.json({ ok: true, ...(await rememberAccount(admin, a.supplier, a.name || "", a.account || "", a.customerId)) });
      }
      if (Array.isArray(b.ignore)) { await admin.from("supplier_manifest_lines").update({ kind: "ignored", match_how: "ignored by staff" }).in("id", b.ignore); return NextResponse.json({ ok: true }); }
      const a = b.assign as { lineIds: string[]; orderId: string; kind: "goods" | "blanks" };
      if (!a?.lineIds?.length || !a.orderId) return NextResponse.json({ error: "Pick an order." }, { status: 400 });
      const { data: ls } = await admin.from("supplier_manifest_lines").select("*").in("id", a.lineIds);
      const lines = (ls || []) as (ManifestLine & { id: string; supplier: string })[];
      if (!lines.length) return NextResponse.json({ error: "Those lines are gone." }, { status: 404 });
      const f = lines[0];
      await applyGroup(admin, f.supplier, { key: "", supplier: f.supplier, customer_name: f.customer_name, customer_account: f.customer_account, customer_po: f.customer_po, supplier_order: f.supplier_order, lines }, a.orderId, a.kind === "blanks" ? "blanks" : "goods", "matched by staff");
      return NextResponse.json({ ok: true });
    }
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose the manifest file." }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "That file is too big for a manifest." }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    const rows = /\.csv$/i.test(file.name)
      ? buf.toString("utf8").split(/\r?\n/).map((line) => (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')))
      : readXlsx(buf);
    const title = rows.slice(0, 3).flat().join(" ");
    const supplier = String(form.get("supplier") || "") === "sanmar" || /sanmar/i.test(title + file.name) ? "sanmar" : "ss";
    const lines = parseManifest(rows);
    if (!lines.length) return NextResponse.json({ error: "No shipments in that file." }, { status: 400 });
    return NextResponse.json({ supplier, ...(await importManifest(admin, supplier, lines, file.name)) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
