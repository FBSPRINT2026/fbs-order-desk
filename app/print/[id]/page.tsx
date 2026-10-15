import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calcOrder, mergeSettings, orderGroups, SIZES, type Customer, type Design, type Garment, type Order, type Payment } from "@/lib/pricing";
import { guessHex, spotFor } from "@/lib/mockup";
import { bodyAt, bodyOf, smallestOrdered, sortSizes } from "@/lib/garmentBody";
import PrintButton from "./PrintButton";
import { DOC_CSS } from "./docCss";
import { InvoiceDoc, WorkOrderDoc, type DocData } from "./Docs";

export const dynamic = "force-dynamic";

// Quote/invoice for customers, or (?work=1, shop only) a work order for the press with no prices.
export default async function PrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ work?: string }> }) {
  const { id } = await params;
  const { work } = await searchParams;
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
  const dIds = [...new Set(groups.flatMap((g) => g.imprints.map((d) => d.design_id).filter(Boolean) as string[]))];
  const styles = [...new Set(groups.flatMap((g) => g.lines.map((l) => (l.style || "").trim()).filter(Boolean)))];
  const [{ data: dz }, { data: gz }] = await Promise.all([
    dIds.length ? admin.from("designs").select("*").in("id", dIds) : Promise.resolve({ data: [] }),
    styles.length ? admin.from("garments").select("style, sizes, specs, color_images").in("style", styles) : Promise.resolve({ data: [] }),
  ]);
  const designs = Object.fromEntries(((dz || []) as Design[]).map((d) => [d.id, d]));
  const cat = (gz || []) as Pick<Garment, "style" | "sizes" | "specs" | "color_images">[];
  const garOf = (style: string) => cat.find((x) => x.style.toLowerCase() === (style || "").trim().toLowerCase()) || null;
  const work0 = !!work && isStaff;
  const mkPaths = groups.map((g) => {
    const all = [...(g.mockupThumbs || []), ...(g.customerMockups || []).map((m) => m.path)];
    return work0 ? all.slice(0, 5) : all.slice(0, 1);
  });
  const dPaths = work0 ? ((dz || []) as Design[]).filter((d) => d.preview_path) : [];
  const toSign = [...mkPaths.flat(), ...dPaths.map((d) => d.preview_path)];
  const signed = toSign.length ? (await admin.storage.from("proofs").createSignedUrls(toSign, 3600)).data || [] : [];
  const urlOf = new Map<string, string>();
  toSign.forEach((x, i) => { if (signed[i]?.signedUrl) urlOf.set(x, signed[i].signedUrl!); });
  const mockups = mkPaths.map((ps) => ps.map((x) => urlOf.get(x) || "").filter(Boolean));
  const designUrls: Record<string, string> = {};
  dPaths.forEach((d) => { const u = urlOf.get(d.preview_path); if (u) designUrls[d.id] = u; });
  const key = (c: string) => (c || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const hexes = groups.map((g) => {
    const l = g.lines.find((x) => (x.style || "").trim()) || g.lines[0];
    if (!l) return "#9aa1ab";
    const ci = Object.entries(garOf(l.style)?.color_images || {}).find(([k]) => key(k) === key(l.color))?.[1];
    return (ci?.hex && /^#?[0-9a-f]{6}$/i.test(ci.hex) ? (ci.hex.startsWith("#") ? ci.hex : "#" + ci.hex) : "") || guessHex(l.color) || "#9aa1ab";
  });
  // the largest each print can be, on the smallest size ordered (one screen prints every size)
  const maxes = groups.map((g) => {
    const l = g.lines.find((x) => (x.style || "").trim()) || g.lines[0];
    const gar = l ? garOf(l.style) : null;
    const ordered = [...new Set(g.lines.flatMap((x) => SIZES.filter((z) => x.sizes?.[z])))] as string[];
    const run = sortSizes(ordered);
    const shown = g.mockupSize && run.includes(g.mockupSize) ? bodyAt(gar, g.mockupSize) : bodyOf(gar, run);
    const small = smallestOrdered(gar, ordered, shown);
    const b = small || shown;
    return g.imprints.map((d) => {
      if (!d.location) return null;
      const sp = spotFor(d.location, b);
      return sp.maxW && sp.maxH ? { w: sp.maxW, h: sp.maxH, on: b.kind === "adult" ? "" : b.size } : null;
    });
  });
  const data: DocData = { o, cust, groups, c, settings, pays: (pays || []) as Payment[], designs, designUrls, mockups, hexes, maxes, printavo: !!(od as { printavo_id?: string | null }).printavo_id };

  if (work0) {
    const [{ data: inn }, { data: jn }] = await Promise.all([
      admin.from("order_internal").select("production_notes").eq("order_id", id).maybeSingle(),
      admin.from("job_files").select("tag, body, by_name, created_at").eq("order_id", id).eq("kind", "note").eq("archived", false).order("created_at", { ascending: false }).limit(8),
    ]);
    const printed = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
    return (
      <div className="pdoc">
        <style dangerouslySetInnerHTML={{ __html: DOC_CSS }} />
        <div className="print-bar"><PrintButton /></div>
        <WorkOrderDoc {...data} notes={inn?.production_notes || ""} shopNotes={(jn || []) as { tag: string; body: string; by_name: string; created_at: string }[]} printed={printed} />
      </div>
    );
  }

  return (
    <div className="pdoc">
      <style dangerouslySetInnerHTML={{ __html: DOC_CSS }} />
      <div className="print-bar"><PrintButton /></div>
      <InvoiceDoc {...data} />
    </div>
  );
}
