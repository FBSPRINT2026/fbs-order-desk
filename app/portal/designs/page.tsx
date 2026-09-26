import Link from "next/link";
import { getPortalCtx } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Design } from "@/lib/pricing";

/** Customer portal: the customer's saved designs (logos). */
export default async function MyDesigns({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const { as } = await searchParams;
  const ctx = await getPortalCtx(as, "/portal/designs");
  const q = (p: string) => (ctx.preview ? `${p}?as=${ctx.preview.id}` : p);
  const { data } = ctx.customerIds.length ? await ctx.db.from("designs").select("*").in("customer_id", ctx.customerIds).order("number", { ascending: false }) : { data: [] };
  const designs = (data || []) as Design[];
  const withPv = designs.filter((d) => d.preview_path);
  const signed = withPv.length ? (await createAdminClient().storage.from("proofs").createSignedUrls(withPv.map((d) => d.preview_path), 3600)).data || [] : [];
  const url: Record<string, string> = {};
  withPv.forEach((d, i) => { if (signed[i]?.signedUrl) url[d.id] = signed[i].signedUrl!; });
  return (
    <>
      {ctx.preview && <div className="preview-bar">Preview of {ctx.preview.company || ctx.preview.name}&apos;s portal.</div>}
      <main className="p-main">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div><div className="eyebrow">{ctx.settings.shop.name}</div><h1>My designs</h1></div>
          <Link className="btn" href={q("/portal")}>← Orders</Link>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>Your logos and artwork on file with us. Mention a design number (like D-10001) to reorder it on anything.</p>
        {designs.length ? (
          <div className="design-grid">
            {designs.map((d) => (
              <div key={d.id} className="design-card">
                <div className="dc-img">{url[d.id] ? <img src={url[d.id]} alt={d.name} /> : <span>{(d.file_name.split(".").pop() || "file").toUpperCase()}</span>}</div>
                <div className="dc-b"><b>D-{d.number}</b><span>{d.name || "Design"}</span>{d.inks && <span className="faint">{d.inks}</span>}</div>
              </div>
            ))}
          </div>
        ) : <div className="muted">No designs on file yet. Once we set up your artwork it will show here.</div>}
      </main>
    </>
  );
}
