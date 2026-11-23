import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { groupPictures } from "@/lib/mockupFresh";
import { linePic } from "@/lib/simpleOrders";
import { mergeSettings, orderGroups, type Customer, type Order } from "@/lib/pricing";
import PoDoc, { type PoLine, type PoRow } from "./PoDoc";

export const dynamic = "force-dynamic";

/**
 * A purchase order to a vendor for this order's items (Documents ▾ → Purchase order; Nick, Nov 23 2026: "quantity, a
 * picture, item, description, those kind of things, and then the shipping information. Typically it's going to be to
 * us"; "on purchase orders you just leave off pricing"; "only promo products get POs"). Every line of the order is offered with its picture; staff
 * pick the vendor, untick what this vendor isn't making, and print. ?po=<n> opens PO <order #>-<n> as it was saved.
 */
export default async function PoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ po?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const v = await getViewer(", name");
  if (!v.user) redirect(`/login?next=/print/${id}/po`);
  if (!v.isStaff) notFound();
  const admin = createAdminClient();
  const { data: od } = await admin.from("orders").select("*").eq("id", id).maybeSingle();
  if (!od) notFound();
  const o = od as Order;
  if (o.product_kind !== "promo") notFound();
  const [{ data: cu }, { data: s }, { data: pos }, { data: vend }] = await Promise.all([
    o.customer_id ? admin.from("customers").select("*").eq("id", o.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    admin.from("purchase_orders").select("*").eq("order_id", id).order("seq"),
    // the vendors we've sent POs to before, newest first, with how we reached them: picked again next time
    admin.from("purchase_orders").select("vendor, vendor_contact, updated_at").neq("vendor", "").order("updated_at", { ascending: false }).limit(300),
  ]);
  const c = cu as Customer | null;
  const shop = mergeSettings(s?.data).shop;

  // each line: its own picture (a promo item's), else its group's mockup
  const groups = orderGroups(o);
  const raw = groups.flatMap((g, gi) => {
    const gp = groupPictures(g)[0] || ""; void gi;
    return g.lines.filter((l) => l.spec?.kind === "promo").map((l) => {
      const sizes = Object.entries(l.sizes || {}).filter(([, n]) => (n || 0) > 0) as [string, number][];
      const qty = sizes.reduce((a, [, n]) => a + n, 0);
      const sp0 = l.spec;
      const desc = [
        l.garment || "",
        sp0 ? [sp0.productColor && sp0.productColor !== "Custom" ? `Color: ${sp0.productColor}` : "", sp0.imprintType ? `${sp0.imprintType}${sp0.imprintColor ? `: ${sp0.imprintColor}` : ""}` : (sp0.imprintColor ? `Imprint: ${sp0.imprintColor}` : "")].filter(Boolean).join(" · ") : [l.color, l.brand].filter(Boolean).join(" · "),
        !sp0 && l.note ? l.note : "",
      ].filter(Boolean);
      const approved = sp0?.proof?.status === "approved" && sp0.proof.at ? `Art approved ${new Date(sp0.proof.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "";
      return {
        id: l.id, group: groups.length > 1 ? (g.name?.trim() || "") : "",
        item: sp0?.itemNo || l.style || "", kind: sp0?.imprintType ? "" : (sp0 ? "" : l.brand || ""),
        desc, approved, qty, sizes: sizes.length > 1 || (sizes[0] && sizes[0][0] !== "OS") ? sizes : [],
        supplier: sp0?.supplier || "",
        path: linePic(sp0) || gp,
      };
    });
  }).filter((l) => l.qty > 0);
  const paths = [...new Set(raw.map((l) => l.path).filter(Boolean))];
  const signed = paths.length ? (await admin.storage.from("proofs").createSignedUrls(paths, 3600)).data || [] : [];
  const url = new Map<string, string>(signed.filter((x) => x.signedUrl && !x.error).map((x) => [String(x.path), String(x.signedUrl)]));
  const lines: PoLine[] = raw.map(({ path, ...l }) => ({ ...l, pic: url.get(path) || "" }));

  const seen = new Set<string>();
  const vendors = ((vend || []) as { vendor: string; vendor_contact: string }[]).filter((x) => { const k = x.vendor.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).map((x) => ({ name: x.vendor, contact: x.vendor_contact }));
  const customerShip = (o.ship_to || c?.ship_address || c?.address || "").trim();
  const custName = c?.company || c?.name || "";
  return (
    <PoDoc orderId={id} number={String(o.number)} job={o.nickname || ""} customer={custName}
      shop={{ name: shop.name || "FBS Print", address: shop.address || "", phone: shop.phone || "" }}
      customerShip={customerShip ? `${custName}\n${customerShip}` : ""} me={String((v.staff as { name?: string } | null)?.name || "")}
      lines={lines} saved={(pos || []) as PoRow[]} vendors={vendors} open={sp.po ? +sp.po || 0 : 0} />
  );
}
