import Link from "next/link";
import { notFound } from "next/navigation";
import { getPortalCtx } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fileUrls, forCustomer, type PvOrder } from "@/lib/archive";
import ArchivedPortalView from "./view";

/**
 * A past order in the customer's portal. The record is read on the server and trimmed to what a customer
 * may see (no production notes, internal tasks or shop emails); artwork is served from our own storage.
 */
export default async function PortalArchivedOrder({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ as?: string }> }) {
  const { id } = await params;
  const { as } = await searchParams;
  const ctx = await getPortalCtx(as, `/portal/archive/${id}`);
  if (!ctx.customerIds.length) notFound();
  const admin = createAdminClient();
  const { data } = await admin.from("archived_orders").select("id, customer_id, data, files, imported_at").eq("id", id).in("customer_id", ctx.customerIds).maybeSingle();
  if (!data) notFound();
  const o = forCustomer(data.data as PvOrder);
  // signed links to our copies of the mockups this customer can see
  const files = (data.files || {}) as Record<string, string>;
  const wanted = fileUrls(o).filter((u) => files[u] && !["failed", "too-big"].includes(files[u]));
  const urls: Record<string, string> = {};
  if (wanted.length) {
    const { data: s } = await admin.storage.from("proofs").createSignedUrls(wanted.map((u) => files[u]), 3600);
    wanted.forEach((u, i) => { if (s?.[i]?.signedUrl) urls[u] = s[i].signedUrl!; });
  }
  return (
    <>
      {ctx.preview && <div className="preview-bar">Preview of {ctx.preview.company || ctx.preview.name}&apos;s portal.</div>}
      <main className="p-main">
        <Link className="back" href={`/portal?area=orders${ctx.preview ? `&as=${ctx.preview.id}` : ""}`}>← Your orders</Link>
        <ArchivedPortalView o={o} urls={urls} importedAt={data.imported_at} />
      </main>
    </>
  );
}
