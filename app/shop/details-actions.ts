"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Group, Imprint } from "@/lib/pricing";
import { needsDetails, type DetailsInput } from "@/lib/productionDetails";

/**
 * Production Details: production (Jose) confirms, corrects or leaves blank what an old Printavo reorder guessed for
 * each print (size, inks, colors, underbase, drop, screens on file, press notes). The confirmed details go on the order
 * and on the customer's design, so the next reorder starts from them.
 */
const CAN = ["owner", "admin", "production"];
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) });
const clip = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);

export async function confirmDetails(orderId: string, prints: DetailsInput[]): Promise<{ ok: true; left: number } | { ok: false; error: string }> {
  try {
    const v = await getViewer(", name");
    if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
    if (!CAN.includes(v.role)) throw new Error("Production confirms these (production, owner or admin).");
    const by = String(v.staff?.name || "") || v.email.split("@")[0];
    const admin = createAdminClient();
    const { data: o } = await admin.from("orders").select("id, number, groups, customer_id").eq("id", orderId).maybeSingle();
    if (!o) throw new Error("Order not found.");
    const groups = (o.groups || []) as Group[];
    const at = new Date().toISOString(), lines: string[] = [], designs = new Map<string, string[]>();
    for (const p of prints) {
      let im: Imprint | undefined;
      for (const g of groups) { im = g.imprints.find((x) => x.id === p.id); if (im) break; }
      if (!im || !needsDetails(im)) continue;
      const before = { size: im.size, inks: im.inks, colors: im.colors };
      im.size = clip(p.size, 80);
      im.inks = clip(p.inks, 200);
      const n = Math.round(+p.colors);
      if (n >= 1 && n <= 20) im.colors = n;
      if (p.underbase === "yes") im.underbase = true; else if (p.underbase === "no") im.underbase = false; else delete im.underbase;
      im.drop = clip(p.drop, 20);
      if (p.screensOnFile) im.remake = true;
      // the size is now what production says we printed (the Mockup Creator asks before changing it)
      if (im.size) im.sizeFrom = "film";
      const note = clip(p.notes, 240);
      if (note) im.notes = [im.notes, `Press: ${note}`].filter(Boolean).join(". ").slice(0, 300);
      delete im.confirm;
      im.confirmed = { by, at };
      const spec = [im.location, im.size || "size left blank", im.inks || "inks left blank", im.colors !== before.colors ? `${im.colors} color${im.colors === 1 ? "" : "s"} (was ${before.colors})` : "", im.underbase === true ? "underbase" : im.underbase === false ? "no underbase" : "", im.drop ? `${im.drop}" drop` : "", p.screensOnFile ? "screens on file" : "", note].filter(Boolean).join(", ");
      const changed = [before.size !== im.size && "size", before.inks !== im.inks && "inks", before.colors !== im.colors && "colors"].filter(Boolean);
      lines.push(`${spec}${changed.length ? ` (changed: ${changed.join(", ")})` : " (as guessed)"}`);
      if (im.design_id) designs.set(im.design_id, [...(designs.get(im.design_id) || []), [im.location, im.size, im.inks, im.underbase === true ? "underbase" : ""].filter(Boolean).join(", ")]);
    }
    if (!lines.length) throw new Error("Nothing waiting on production details here (already confirmed?).");
    const { error } = await admin.from("orders").update({ groups }).eq("id", o.id);
    if (error) throw new Error(error.message);
    await admin.from("order_events").insert({ order_id: o.id, kind: "details", detail: `Production details confirmed: ${lines.join("; ")}`.slice(0, 2000), actor: by });
    // the customer's design remembers how it printed, for the next reorder
    const day = at.slice(0, 10);
    for (const [id, specs] of designs) {
      const { data: d } = await admin.from("designs").select("id, notes, inks, colors").eq("id", id).maybeSingle();
      if (!d) continue;
      const im = groups.flatMap((g) => g.imprints).find((x) => x.design_id === id && x.confirmed?.at === at);
      const add = `Printed (production confirmed ${day}, #${o.number}): ${specs.join("; ")}`;
      await admin.from("designs").update({
        notes: [String(d.notes || ""), add].filter(Boolean).join("\n").slice(-2000),
        ...(im?.inks ? { inks: im.inks, colors: im.colors } : {}),
      }).eq("id", id);
    }
    const left = groups.reduce((n, g) => n + g.imprints.filter(needsDetails).length, 0);
    return { ok: true, left };
  } catch (e) { return fail(e); }
}
