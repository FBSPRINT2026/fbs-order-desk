import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readXlsx } from "@/lib/xlsx";
import { applyGroup, importManifest, linkByHand, markReceived, openOrdersFor, receiveFreight, receiveTruck, searchManifests, truckPending, parseManifest, printavoGoods, rememberAccount, resolvePending, unmatchedGroups, type ManifestLine } from "@/lib/manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function staff() {
  const v = await getViewer();
  return v.user && v.isStaff ? v : null;
}

/** Manifest shipments waiting to be matched to an order. */
export async function GET(req: Request) {
  if (!(await staff())) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const admin = createAdminClient();
  const sp = new URL(req.url).searchParams;
  if (sp.get("orders")) {
    // "Link order" pop-up: this customer's open orders (and open Printavo jobs), the PO's match first
    try { return NextResponse.json({ orders: await openOrdersFor(admin, sp.get("orders")!, sp.get("po") || "") }); }
    catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
  }
  const q = sp.get("q");
  if (q != null) {
    try { return NextResponse.json({ hits: await searchManifests(admin, q) }); }
    catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
  }
  if (new URL(req.url).searchParams.get("truck")) {
    try { return NextResponse.json({ stops: await truckPending(admin) }); }
    catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
  }
  // one list failing must not blank the other (show the problem instead of an empty page)
  const [groups, printavo] = await Promise.all([
    unmatchedGroups(admin).catch((e) => ({ error: e instanceof Error ? e.message : String(e) })),
    printavoGoods(admin).catch((e) => ({ error: e instanceof Error ? e.message : String(e) })),
  ]);
  const err = [groups, printavo].map((x) => (!Array.isArray(x) ? x.error : "")).filter(Boolean).join(" · ");
  return NextResponse.json({ groups: Array.isArray(groups) ? groups : [], printavo: Array.isArray(printavo) ? printavo : [], error: err || undefined });
}

/**
 * Upload a supplier manifest (.xlsx or .csv): multipart form with `file`.
 * Or JSON { assign: { lineIds, orderId, kind } } to match a shipment by hand, { alias: { supplier, name, account, customerId } }
 * to say which customer a supplier account is, { link: [{ lineId, orderId }] } (resolution center), { retry: true }, or { ignore: lineIds }.
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
      if (Array.isArray(b.link)) {
        // resolution center: line → order (a suggestion OK'd, or picked by hand)
        const v = await staff();
        const n = await linkByHand(admin, (b.link as { lineId: string; orderId: string }[]).filter((x) => x.lineId && x.orderId), v?.email || "staff");
        return NextResponse.json({ ok: true, orders: n });
      }
      if (b.received?.lineIds?.length) {
        const v = await staff();
        await markReceived(admin, b.received.lineIds as string[], !!b.received.yes, v?.email || "staff");
        return NextResponse.json({ ok: true });
      }
      if (b.truck) {
        // the S&S local truck is here: sign for what came
        const t = b.truck as { lineIds: string[]; at: string; signedBy: string };
        return NextResponse.json({ ok: true, ...(await receiveTruck(admin, t.lineIds || [], t.at, t.signedBy || "")) });
      }
      if (b.freight) {
        // an LTL pallet is here: sign for it (no parcel tracking for freight)
        const f = b.freight as { lineIds: string[]; at: string; signedBy: string; undo?: boolean };
        return NextResponse.json({ ok: true, ...(await receiveFreight(admin, f.lineIds || [], f.at, f.signedBy || "", !f.undo)) });
      }
      if (b.retry) return NextResponse.json({ ok: true, ...(await resolvePending(admin, Date.now() + 45000)) });
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
    // SanMar's freight manifest never says "SanMar": know it by its columns (Decorator customer name, Catalog Style,
    // Carton Number, Sales Order "SO-…"); S&S's says "S&S Activewear" in its title row
    const head = rows.slice(0, 5).flat().join(" | ");
    const sanmarCols = /decorator\s*customer\s*name|catalog\s*style|carton\s*number|customer\s*account/i.test(head) || rows.slice(0, 20).some((r) => r.some((c) => /^SO-\d{6,}$/.test(c.trim())));
    const supplier = String(form.get("supplier") || "") === "sanmar" || /sanmar/i.test(title + file.name) || (sanmarCols && !/s&s\s*activewear/i.test(title)) ? "sanmar" : "ss";
    const lines = parseManifest(rows);
    if (!lines.length) return NextResponse.json({ error: "No shipments in that file." }, { status: 400 });
    return NextResponse.json({ supplier, ...(await importManifest(admin, supplier, lines, file.name)) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
