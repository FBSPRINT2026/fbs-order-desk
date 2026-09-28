"use server";
import { revalidatePath } from "next/cache";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { mergeSettings, uid, type Group } from "@/lib/pricing";
import { money } from "@/lib/format";
import { PROGRAM_SIZES, type ProgramItem } from "@/lib/programs";

export type ProgramCartLine = { itemId: string; color: string; sizes: Record<string, number> };

/**
 * A program order: the customer picks sizes on their program items; it comes to the shop as an order request
 * with the program's flat prices already set (no setup fees). Prices and items are checked here, never taken from the browser.
 */
export async function placeProgramOrder(input: { lines: ProgramCartLine[]; due_date: string | null; po: string; notes: string; projectId?: string | null }): Promise<{ ok: boolean; error?: string; id?: string; number?: number }> {
  try {
    const { supabase, user, email, isStaff } = await getViewer();
    if (!user) return { ok: false, error: "Please sign in again." };
    if (isStaff) return { ok: false, error: "This is a preview. Customers order from their own login." };
    const { data: cs } = await supabase.from("customers").select("id, name, company, price_type, tax_exempt");
    const cust = (cs || [])[0];
    if (!cust) return { ok: false, error: "We couldn't find your account." };
    // row security: only their own active program items come back
    const ids = [...new Set(input.lines.map((l) => l.itemId))];
    const { data: its } = ids.length ? await supabase.from("program_items").select("*").in("id", ids) : { data: [] };
    const items = new Map(((its || []) as ProgramItem[]).map((i) => [i.id, i]));
    const groups: Group[] = [];
    let total = 0, pcs = 0;
    const summary: string[] = [];
    for (const l of input.lines) {
      const it = items.get(l.itemId);
      if (!it) return { ok: false, error: "One of those items isn't in your program anymore. Refresh and try again." };
      const sizes: Record<string, number> = {};
      for (const [z, n] of Object.entries(l.sizes || {})) { const q = Math.max(0, Math.min(100000, Math.round(+n || 0))); if (q && PROGRAM_SIZES.includes(z) && (!it.sizes.length || it.sizes.includes(z))) sizes[z] = q; }
      const q = Object.values(sizes).reduce((a, b) => a + b, 0);
      if (!q) continue;
      if (it.min_qty && q < it.min_qty) return { ok: false, error: `${it.name}: the minimum is ${it.min_qty} pieces.` };
      const color = it.colors.length ? (it.colors.includes(l.color) ? l.color : it.colors[0]) : l.color || "";
      groups.push({
        id: uid(), name: it.name,
        lines: [{ id: uid(), style: it.style, brand: it.brand, garment: it.garment, color, cost: "", sizes, priceOverride: +it.price }],
        imprints: (it.imprints || []).map((im) => ({ id: uid(), method: im.method || "screen", location: im.location || "Full Front", colors: +im.colors || 1, inks: im.inks || "", size: im.size || "", notes: im.notes || "", inkChanges: 0, ...(it.design_id ? { design_id: it.design_id } : {}) })),
      });
      total += q * +it.price; pcs += q;
      summary.push(`${q} × ${it.name}${color ? ` (${color})` : ""} @ ${money(+it.price)}`);
    }
    if (!groups.length) return { ok: false, error: "Add quantities to at least one item." };
    const admin = createAdminClient();
    let projectId: string | null = null;
    if (input.projectId) { const { data: p } = await supabase.from("projects").select("id").eq("id", input.projectId).maybeSingle(); projectId = p?.id || null; }
    const { data, error } = await admin.from("orders").insert({
      customer_id: cust.id, status: "request", type: "quote", source: "program", submitted_at: new Date().toISOString(),
      price_type: cust.price_type || "wholesale", tax_exempt: !!cust.tax_exempt, waive_setup: true, groups, total: Math.round(total * 100) / 100, qty: pcs,
      nickname: `Program order${groups.length === 1 ? `: ${groups[0].name}` : ""}`.slice(0, 120), po_number: (input.po || "").slice(0, 60),
      due_date: input.due_date && /^\d{4}-\d{2}-\d{2}$/.test(input.due_date) ? input.due_date : null, notes: (input.notes || "").slice(0, 2000), project_id: projectId,
    }).select("id, number").single();
    if (error) return { ok: false, error: error.message };
    await admin.from("order_events").insert({ order_id: data.id, kind: "created", detail: "Program order from the portal", actor: email });
    if (SHOP_NOTIFY_EMAIL) {
      const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
      await sendEmail({ to: SHOP_NOTIFY_EMAIL, subject: `Program order #${data.number} from ${cust.company || cust.name}: ${money(total)}`,
        html: emailLayout(mergeSettings(s?.data).shop.name, `${cust.company || cust.name} placed a program order`, `${summary.join("\n")}\n\nTotal ${money(total)} (${pcs} pcs)${input.po ? `\nPO ${input.po}` : ""}${input.due_date ? `\nNeeded by ${input.due_date}` : ""}${input.notes ? `\n\n${input.notes}` : ""}`, "Open order", `${siteUrl()}/shop/orders/${data.id}`) });
    }
    revalidatePath("/portal");
    return { ok: true, id: data.id, number: data.number };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." }; }
}
