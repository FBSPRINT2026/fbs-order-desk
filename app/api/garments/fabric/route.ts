import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/supabase/server";
import { ssConfigured, ssFabric, ssLookup } from "@/lib/ss";
import { sanmarConfigured, sanmarSkus, sanmarLookup } from "@/lib/sanmar";
import { fabricLines } from "@/lib/fabric";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Fill in garments' fabric content from S&S / SanMar (the supplier's description lines that give fiber percentages),
 * for the Ink Room's white choice. Staff, or the sync token. ?all=1 re-reads every garment; ?scheduled=1 first adds
 * any garment on an upcoming screen job that isn't in the catalog yet. Runs until the minute is nearly up; call again
 * to continue ("left" says how many remain).
 */
export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: ps } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (req.headers.get("x-sync-token") !== (ps as { token: string } | null)?.token) {
    const { user, isStaff } = await getViewer();
    if (!user || !isStaff) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  const sp = new URL(req.url).searchParams, deadline = Date.now() + 50000;
  const out = { added: [] as string[], filled: [] as string[], none: [] as string[], failed: [] as string[], left: 0 };
  type G = { id: string; style: string; brand: string; supplier: string | null; supplier_style: string | null; ss_style_id: number | null; fabric: string; fabric_at: string | null };
  const { data: all } = await admin.from("garments").select("id, style, brand, supplier, supplier_style, ss_style_id, fabric, fabric_at");
  const gs = (all || []) as G[];

  if (sp.get("scheduled")) {
    const from = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const { data: sl } = await admin.from("production_slots").select("order_id").eq("kind", "screen").gte("day", from).not("order_id", "is", null);
    const ids = [...new Set(((sl || []) as { order_id: string }[]).map((x) => x.order_id))];
    const { data: os } = ids.length ? await admin.from("orders").select("groups").in("id", ids) : { data: [] };
    const want = new Map<string, { style: string; brand: string }>();
    for (const o of (os || []) as { groups: { lines?: { style?: string; brand?: string }[] }[] | null }[]) for (const g of o.groups || []) for (const l of g.lines || []) if (l.style) want.set(`${(l.brand || "").toLowerCase()}|${l.style.toLowerCase()}`, { style: l.style, brand: l.brand || "" });
    for (const w of want.values()) {
      if (Date.now() > deadline) break;
      if (gs.some((g) => g.style.toLowerCase() === w.style.toLowerCase() && (!w.brand || g.brand.toLowerCase() === w.brand.toLowerCase()))) continue;
      try {
        const g = ssConfigured() ? await ssLookup(`${w.brand} ${w.style}`.trim()).catch(() => null) : null;
        const row = g ? { ...g, supplier: "ss", synced_at: new Date().toISOString() } : sanmarConfigured() ? await sanmarLookup(w.style).then((x) => (x ? { ...x, ss_style_id: null, synced_at: new Date().toISOString() } : null)) : null;
        if (!row) { out.none.push(`${w.brand} ${w.style}`); continue; }
        const { data: ins, error } = await admin.from("garments").insert(row).select("id, style, brand, supplier, supplier_style, ss_style_id, fabric, fabric_at").single();
        if (error) throw new Error(error.message);
        gs.push(ins as G); out.added.push(`${w.brand} ${w.style}`);
      } catch { out.failed.push(`${w.brand} ${w.style}`); }
    }
  }

  const todo = gs.filter((g) => sp.get("all") || (!g.fabric && !g.fabric_at));
  for (const g of todo) {
    if (Date.now() > deadline) { out.left++; continue; }
    try {
      let fabric = "";
      if (g.supplier === "sanmar") {
        if (!sanmarConfigured()) continue;
        const skus = await sanmarSkus(g.supplier_style || g.style);
        fabric = fabricLines([...new Set(skus.map((x) => x.description).filter(Boolean))].join("\n"));
      } else if (ssConfigured()) {
        const f = await ssFabric(g.ss_style_id || `${g.brand} ${g.style}`.trim());
        fabric = f?.fabric || "";
      }
      await admin.from("garments").update({ fabric, fabric_at: new Date().toISOString() }).eq("id", g.id);
      (fabric ? out.filled : out.none).push(`${g.brand} ${g.style}`);
    } catch { out.failed.push(`${g.brand} ${g.style}`); }
  }
  return NextResponse.json(out);
}
