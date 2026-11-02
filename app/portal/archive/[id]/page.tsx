import BackLink from "@/components/BackLink";
import { notFound } from "next/navigation";
import { getPortalCtx } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fileUrls, forCustomer, type PvOrder, storedPath } from "@/lib/archive";
import ArchivedPortalView from "./view";
import { pvHandle } from "@/lib/printavoNames";
import { namesFor } from "@/lib/printavoFileMeta";
import { OldReorderButton } from "@/components/PortalOldReorder";
import { money } from "@/lib/format";

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
  const { data } = await admin.from("archived_orders").select("id, customer_id, data, files, imported_at, balance").eq("id", id).in("customer_id", ctx.customerIds).maybeSingle();
  if (!data) notFound();
  const o = forCustomer(data.data as PvOrder);
  const raw = data.data as { urls?: { publicUrl?: string } } & Record<string, unknown>;
  const payUrl = /^https:\/\//.test(String(raw?.urls?.publicUrl || "")) ? String(raw.urls!.publicUrl) : "";
  const bal = +((data as { balance?: number | string | null }).balance ?? 0) || 0;
  // signed links to our copies of the mockups this customer can see
  const files = (data.files || {}) as Record<string, string>;
  const wanted = fileUrls(o).filter((u) => storedPath(files[u]));
  let names: Record<string, string> = {};
  const urls: Record<string, string> = {}, paths: Record<string, string> = {};
  if (wanted.length) {
    const [{ data: s }, nm] = await Promise.all([
      admin.storage.from("proofs").createSignedUrls(wanted.map((u) => files[u]), 3600),
      namesFor(admin, wanted.map(pvHandle)),
    ]);
    wanted.forEach((u, i) => { paths[u] = files[u]; if (s?.[i]?.signedUrl) urls[u] = s[i].signedUrl!; });
    names = nm;
  }
  return (
    <>
      {ctx.preview && <div className="preview-bar">Preview of {ctx.preview.company || ctx.preview.name}&apos;s portal.</div>}
      <main className="p-main">
        <ArchivedPortalView back={<BackLink href={`/portal?area=orders${ctx.preview ? `&as=${ctx.preview.id}` : ""}`} label="Your orders" trail={false} />} o={o} urls={urls} names={names} paths={paths} importedAt={data.imported_at} actions={<>
          {/* still owed (Nov 2 portal check: the old order showed its balance with no way to pay it): paid through its own link */}
          {payUrl && +bal > 0.004 && <a className="btn primary" href={payUrl} target="_blank" rel="noreferrer">Pay {money(+bal)}</a>}
          <OldReorderButton archivedId={data.id} as={ctx.preview?.id} primary={!(payUrl && +bal > 0.004)} />
        </>} />
      </main>
    </>
  );
}
