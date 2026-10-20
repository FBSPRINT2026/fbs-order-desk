import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calcOrder, mergeSettings, orderGroups, type Customer, type Order, type Payment } from "@/lib/pricing";
import { loadGroupLook } from "@/lib/groupLook";
import PrintButton from "./PrintButton";
import { DOC_CSS } from "./docCss";
import { InvoiceDoc, ProofDoc, WorkOrderDoc, type DocData } from "./Docs";

export const dynamic = "force-dynamic";

// Quote/invoice for customers, or (?work=1, shop only) a work order for the press with no prices.
export default async function PrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ work?: string; proof?: string }> }) {
  const { id } = await params;
  const { work, proof } = await searchParams;
  const { supabase, user, isStaff } = await getViewer();
  if (!user) redirect(`/login?next=/print/${id}`);
  const db = isStaff ? createAdminClient() : supabase; // customers read through row security
  const { data: od } = await db.from("orders").select("*").eq("id", id).maybeSingle();
  if (!od) notFound();
  const o = od as Order;
  const admin = createAdminClient();
  const [{ data: cu }, { data: s }, { data: pays }] = await Promise.all([
    admin.from("customers").select("*").eq("id", o.customer_id).maybeSingle(),
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    db.from("payments").select("*").eq("order_id", id),
  ]);
  const settings = mergeSettings(s?.data);
  const groups = orderGroups(o);
  const c = calcOrder(o, settings, (pays || []) as Payment[]);
  const cust = (cu || {}) as Partial<Customer>;

  // designs (proportions for the print sizes; previews for the work order), mockup pictures, the shirt colors
  const { designs, hexes, maxes } = await loadGroupLook(admin, groups);
  const work0 = !!work && isStaff;
  // the art proof (?proof=1): every mockup big and each print's art up close, for the customer to approve (Oct 20)
  const proof0 = !!proof && !work0;
  const mkPaths = groups.map((g) => {
    // ours first; the customer's own mockup only when we haven't made one
    const all = g.mockupThumbs?.length ? g.mockupThumbs : (g.customerMockups || []).map((m) => m.path);
    return proof0 ? all.slice(0, 12) : work0 ? all.slice(0, 5) : all.slice(0, 1);
  });
  const dPaths = work0 || proof0 ? Object.values(designs).filter((d) => d.preview_path) : [];
  const toSign = [...mkPaths.flat(), ...dPaths.map((d) => d.preview_path)];
  const signed = toSign.length ? (await admin.storage.from("proofs").createSignedUrls(toSign, 3600)).data || [] : [];
  const urlOf = new Map<string, string>();
  toSign.forEach((x, i) => { if (signed[i]?.signedUrl) urlOf.set(x, signed[i].signedUrl!); });
  const mockups = mkPaths.map((ps) => ps.map((x) => urlOf.get(x) || "").filter(Boolean));
  const designUrls: Record<string, string> = {};
  dPaths.forEach((d) => { const u = urlOf.get(d.preview_path); if (u) designUrls[d.id] = u; });
  const data: DocData = { o, cust, groups, c, settings, pays: (pays || []) as Payment[], designs, designUrls, mockups, hexes, maxes, printavo: !!(od as { printavo_id?: string | null }).printavo_id };

  // one tidy file name for every PDF (Oct 20, Nick): "40072 - Methodist Dallas - 2026 Donor Shirts - Proof v1"
  const short = (t: string, n: number) => { const x = (t || "").replace(/\s+/g, " ").trim(); return x.length <= n ? x : (x.slice(0, n).replace(/\s+\S*$/, "") || x.slice(0, n)); };
  const nameOf = (kind: string) => [String(o.number), short(cust.company || cust.name || "", 24), short(o.nickname || "", 30), kind]
    .filter(Boolean).join(" - ").replace(/[\\/:*?"<>|#]+/g, "").replace(/\s+/g, " ").trim();

  if (proof0) {
    // the proof's version: the one out with the customer when these mockups were sent, else the next one
    const [{ data: pf }, { data: cm }] = await Promise.all([
      admin.from("proofs").select("version, archived_at, mockup_id").eq("order_id", id).not("version", "is", null),
      admin.from("mockups").select("id, proof_id").eq("order_id", id).is("archived_at", null),
    ]);
    const rows = (pf || []) as { version: number; archived_at: string | null; mockup_id: string | null }[];
    const cur = (cm || []) as { id: string; proof_id: string | null }[];
    const live = rows.filter((r) => !r.archived_at);
    const liveV = live.length ? Math.max(...live.map((r) => r.version)) : 0;
    const sentNow = liveV > 0 && cur.length > 0 && cur.every((m) => live.some((r) => r.mockup_id === m.id));
    const version = sentNow ? liveV : (rows.length ? Math.max(...rows.map((r) => r.version)) : 0) + 1;
    const printed = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
    return (
      <div className="pdoc">
        <title>{nameOf(`Proof v${version}`)}</title>
        <style dangerouslySetInnerHTML={{ __html: DOC_CSS }} />
        <div className="print-bar"><PrintButton fileName={nameOf(`Proof v${version}`)} /></div>
        <ProofDoc {...data} printed={printed} version={version} />
      </div>
    );
  }

  if (work0) {
    const [{ data: inn }, { data: jn }, { data: apc }] = await Promise.all([
      admin.from("order_internal").select("production_notes").eq("order_id", id).maybeSingle(),
      // the customer approved with changes: the press needs to see what they asked for
      admin.from("proofs").select("customer_comment, decided_name, decided_at").eq("order_id", id).eq("status", "approved").neq("customer_comment", "").is("archived_at", null),
      admin.from("job_files").select("tag, body, by_name, created_at").eq("order_id", id).eq("kind", "note").eq("archived", false).order("created_at", { ascending: false }).limit(8),
    ]);
    const printed = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
    return (
      <div className="pdoc">
        <style dangerouslySetInnerHTML={{ __html: DOC_CSS }} />
        <title>{nameOf("Work Order")}</title>
        <div className="print-bar"><PrintButton fileName={nameOf("Work Order")} /></div>
        <WorkOrderDoc {...data} notes={[...((apc || []) as { customer_comment: string; decided_name: string | null; decided_at: string | null }[]).map((x) => `APPROVED WITH CHANGES${x.decided_name ? ` (${x.decided_name})` : ""}: ${x.customer_comment}`), inn?.production_notes || ""].filter(Boolean).join("\n\n")} shopNotes={(jn || []) as { tag: string; body: string; by_name: string; created_at: string }[]} printed={printed} />
      </div>
    );
  }

  return (
    <div className="pdoc">
      <style dangerouslySetInnerHTML={{ __html: DOC_CSS }} />
      <title>{nameOf(o.type === "quote" ? "Quote" : "Invoice")}</title>
      <div className="print-bar"><PrintButton fileName={nameOf(o.type === "quote" ? "Quote" : "Invoice")} /></div>
      <InvoiceDoc {...data} />
    </div>
  );
}
