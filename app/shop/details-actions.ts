"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { shopNotes, type Group, type Imprint } from "@/lib/pricing";
import { needsDetails, type DetailsInput } from "@/lib/productionDetails";
import { addSpec, reorderLabel, type DesignSpecs, type SpecEntry } from "@/lib/designSpecs";

/**
 * Reorder Details: production (Jose) confirms, corrects or leaves blank what an old Printavo reorder guessed for
 * each print (size, inks, colors, underbase, drop, screens on file, press notes). The confirmed details go on the order
 * and on the customer's design, so the next reorder starts from them.
 */
const CAN = ["owner", "admin", "production"];
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) });
const clip = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);

export async function confirmDetails(orderId: string, prints: DetailsInput[], edit = false): Promise<{ ok: true; left: number } | { ok: false; error: string }> {
  try {
    const v = await getViewer(", name");
    if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
    if (!CAN.includes(v.role)) throw new Error("Production confirms these (production, owner or admin).");
    const by = String(v.staff?.name || "") || v.email.split("@")[0];
    const admin = createAdminClient();
    const { data: o } = await admin.from("orders").select("id, number, groups, customer_id, notes").eq("id", orderId).maybeSingle();
    if (!o) throw new Error("Order not found.");
    const groups = (o.groups || []) as Group[];
    const at = new Date().toISOString(), lines: string[] = [], designs = new Map<string, string[]>(), entries: { design: string; e: SpecEntry }[] = [];
    // the old job this order repeats, so the next reorder of it takes what's confirmed here
    const { data: rev } = await admin.from("order_events").select("detail").eq("order_id", o.id).eq("kind", "reorder").order("created_at").limit(1).maybeSingle();
    const job = reorderLabel(rev?.detail) || reorderLabel(o.notes) || undefined;
    for (const p of prints) {
      let im: Imprint | undefined;
      for (const g of groups) { im = g.imprints.find((x) => x.id === p.id); if (im) break; }
      // edit: a print already confirmed, corrected (Oct 23, Nick: "you should be able to go back in and edit it… I made a
      // typo there. It should have been 2 inches")
      if (!im || !(needsDetails(im) || (edit && im.confirmed))) continue;
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
      if (note && !String(im.notes || "").includes(note)) im.notes = [im.notes, `Press: ${note}`].filter(Boolean).join(". ").slice(0, 300);
      im.notes = shopNotes(im.notes);
      delete im.confirm; delete im.visualOnly; // confirmed: the details are real now, the mockup no longer visual only
      im.confirmed = { by, at };
      const spec = [im.location, im.size || "size left blank", im.inks || "inks left blank", im.colors !== before.colors ? `${im.colors} color${im.colors === 1 ? "" : "s"} (was ${before.colors})` : "", im.underbase === true ? "underbase" : im.underbase === false ? "no underbase" : "", im.drop ? `${im.drop}" drop` : "", p.screensOnFile ? "screens on file" : "", note].filter(Boolean).join(", ");
      const changed = [before.size !== im.size && "size", before.inks !== im.inks && "inks", before.colors !== im.colors && "colors"].filter(Boolean);
      lines.push(`${spec}${edit ? " (corrected)" : changed.length ? ` (changed: ${changed.join(", ")})` : " (as guessed)"}`);
      if (im.design_id) {
        designs.set(im.design_id, [...(designs.get(im.design_id) || []), [im.location, im.size, im.inks, im.underbase === true ? "underbase" : ""].filter(Boolean).join(", ")]);
        const garment = [...new Set(groups.filter((g) => g.imprints.includes(im!)).flatMap((g) => g.lines.map((l) => [l.style, l.color].filter(Boolean).join(" "))))].join(", ");
        entries.push({ design: im.design_id, e: { location: im.location, method: im.method, size: im.size, drop: im.drop || "", inks: im.inks, colors: im.colors, ...(im.underbase !== undefined ? { underbase: im.underbase } : {}), garment, notes: note, by, at, order_id: o.id, order_number: o.number, ...(job ? { job } : {}), ...(im.pressOnly?.id ? { press: { id: im.pressOnly.id, name: im.pressOnly.name } } : {}), ...(im.byColor && Object.keys(im.byColor.skip || {}).length ? { skip: im.byColor.skip } : {}), ...(im.rounds && im.rounds > 1 ? { rounds: im.rounds } : {}) } });
      }
    }
    if (!lines.length) throw new Error("Nothing waiting on production details here (already confirmed?).");
    const { error } = await admin.from("orders").update({ groups }).eq("id", o.id);
    if (error) throw new Error(error.message);
    // every print confirmed: the "REORDER: confirm the print specs… <link>" line comes off the production notes
    if (!groups.some((g) => (g.imprints || []).some((x) => x.confirm && (x.confirm.size || x.confirm.ink)))) {
      const { data: inn } = await admin.from("order_internal").select("production_notes").eq("order_id", o.id).maybeSingle();
      const pn = String(inn?.production_notes || ""), clean = pn.replace(/REORDER: confirm the print specs \([^)]*\) before printing:[ \t]*\S*\s*/gi, "").trim();
      if (clean !== pn.trim()) await admin.from("order_internal").update({ production_notes: clean }).eq("order_id", o.id);
    }
    // the customer's design keeps every confirmation (designs.specs history; lib/designSpecs.ts): never overwritten, and
    // one that differs from an earlier confirmation of the same print says so
    const differs: string[] = [];
    for (const { design, e } of entries) {
      const { data: d } = await admin.from("designs").select("id, specs").eq("id", design).maybeSingle();
      if (!d) continue;
      const r = addSpec(d.specs as DesignSpecs, e);
      await admin.from("designs").update({ specs: r.specs }).eq("id", design);
      if (r.differs) differs.push(`${e.location} ${r.differs}`);
    }
    await admin.from("order_events").insert({ order_id: o.id, kind: "details", detail: `Production details ${edit ? "corrected" : "confirmed"}: ${lines.join("; ")}${differs.length ? `. Note: ${differs.join("; ")}` : ""}`.slice(0, 2000), actor: by });
    // the customer's design remembers how it printed, for the next reorder
    const day = at.slice(0, 10);
    for (const [id, specs] of designs) {
      const { data: d } = await admin.from("designs").select("id, notes, inks, colors").eq("id", id).maybeSingle();
      if (!d) continue;
      const im = groups.flatMap((g) => g.imprints).find((x) => x.design_id === id && x.confirmed?.at === at);
      const add = `Printed (production confirmed ${day}, #${o.number}): ${specs.join("; ")}`;
      await admin.from("designs").update({
        notes: [String(d.notes || ""), add].filter(Boolean).join("\n").slice(-8000),
        ...(im?.inks ? { inks: im.inks, colors: im.colors } : {}),
      }).eq("id", id);
    }
    const left = groups.reduce((n, g) => n + g.imprints.filter(needsDetails).length, 0);
    return { ok: true, left };
  } catch (e) { return fail(e); }
}
