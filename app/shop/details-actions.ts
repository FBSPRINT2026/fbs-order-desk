"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calcOrder, cleanPrintNotes, mergeSettings, shopNotes, type Group, type Imprint, type Order } from "@/lib/pricing";
import { fullColorWaiting } from "@/lib/fullColor";
import { needsDetails, type DetailsInput } from "@/lib/productionDetails";
import { addSpec, reorderLabel, type DesignSpecs, type SpecEntry } from "@/lib/designSpecs";
import { rememberEmbroidery } from "@/lib/embroideryLast";

/**
 * Reorder Details: production (Jose) confirms, corrects or leaves blank what an old Printavo reorder guessed for
 * each print (size, inks, colors, underbase, drop, screens on file, press notes). The confirmed details go on the order
 * and on the customer's design, so the next reorder starts from them.
 */
const CAN = ["owner", "admin", "production", "embroidery"];
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) });
const clip = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);

export async function confirmDetails(orderId: string, prints: DetailsInput[], edit = false): Promise<{ ok: true; left: number } | { ok: false; error: string }> {
  try {
    const v = await getViewer(", name");
    if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
    if (!CAN.includes(v.role)) throw new Error("Production confirms these (production, embroidery, owner or admin).");
    const by = String(v.staff?.name || "") || v.email.split("@")[0];
    const admin = createAdminClient();
    const { data: o } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (!o) throw new Error("Order not found.");
    const groups = (o.groups || []) as Group[];
    // full color prints waiting on production (Oct 26): their colors set the price, and the quote waits for them
    const fullIds = new Set(groups.flatMap((g) => g.imprints).filter(fullColorWaiting).map((im) => im.id));
    const { data: st0 } = fullIds.size ? await admin.from("settings").select("data").eq("id", 1).maybeSingle() : { data: null };
    const total = () => { try { return calcOrder({ ...(o as Order), groups } as Order, mergeSettings(st0?.data)).total; } catch { return 0; } };
    const before = fullIds.size ? total() : 0;
    const fullDone: string[] = [];
    const at = new Date().toISOString(), pressNotes: string[] = [], lines: string[] = [], designs = new Map<string, string[]>(), entries: { design: string; e: SpecEntry }[] = [];
    // the old job this order repeats, so the next reorder of it takes what's confirmed here
    const { data: rev } = await admin.from("order_events").select("detail").eq("order_id", o.id).eq("kind", "reorder").order("created_at").limit(1).maybeSingle();
    const job = reorderLabel(rev?.detail) || reorderLabel(o.notes) || undefined;
    for (const p of prints) {
      let im: Imprint | undefined;
      for (const g of groups) { im = g.imprints.find((x) => x.id === p.id); if (im) break; }
      // edit: a print already confirmed, corrected (Oct 23, Nick: "you should be able to go back in and edit it… I made a
      // typo there. It should have been 2 inches")
      if (!im || !(needsDetails(im) || (edit && im.confirmed))) continue;
      // embroidery's manager confirms the embroidered prints; screen printing's production confirms the rest
      if (v.role === "embroidery" && im.method !== "embroidery") continue;
      if (v.role === "production" && im.method === "embroidery") continue;
      const before = { size: im.size, inks: im.inks, colors: im.colors };
      im.size = clip(p.size, 80);
      im.inks = clip(p.inks, 200);
      const n = Math.round(+p.colors);
      if (n >= 1 && n <= 20) im.colors = n;
      const emb = im.method === "embroidery";
      if (!emb) { if (p.underbase === "yes") im.underbase = true; else if (p.underbase === "no") im.underbase = false; else delete im.underbase; }
      im.drop = clip(p.drop, 20);
      if (p.screensOnFile && !emb) im.remake = true;
      if (emb) {
        const st = Math.round(+String(p.stitches || "").replace(/[^\d.]/g, ""));
        if (st >= 300 && st < 200000) im.stitches = st;
        im.emb = { ...(im.emb || {}), ...(st >= 300 ? { stitchesFrom: im.emb?.file && im.emb.file.stitches === st ? "file" as const : "staff" as const } : {}), ...(clip(p.backing, 60) ? { backing: clip(p.backing, 60) } : {}), ...(clip(p.topping, 60) ? { topping: clip(p.topping, 60) } : {}) };
      }
      // the size is now what production says we printed (the Mockup Creator asks before changing it)
      if (im.size) im.sizeFrom = "film";
      const note = clip(p.notes, 240);
      // the notes for next time go in the order's Production notes (Oct 23, Nick: "if I write something in the production
      // notes in the production document, it should save to the production notes"), not squeezed onto the print
      if (note) pressNotes.push(`${im.location}: ${note}`);
      im.notes = cleanPrintNotes(shopNotes(im.notes));
      if (fullIds.has(im.id)) fullDone.push(`${im.location}: ${im.colors} color${im.colors === 1 ? "" : "s"}${im.underbase ? " + underbase" : ""}${im.inks ? ` (${im.inks})` : ""}`);
      delete im.confirm; delete im.visualOnly; // confirmed: the details are real now, the mockup no longer visual only
      im.confirmed = { by, at };
      const spec = [im.location, im.size || "size left blank", im.inks || (emb ? "threads left blank" : "inks left blank"), emb && im.stitches ? `${im.stitches.toLocaleString()} stitches` : "", emb && im.emb?.backing ? im.emb.backing : "", im.colors !== before.colors ? `${im.colors} color${im.colors === 1 ? "" : "s"} (was ${before.colors})` : "", im.underbase === true ? "underbase" : im.underbase === false ? "no underbase" : "", im.drop ? `${im.drop}" drop` : "", p.screensOnFile ? "screens on file" : "", note].filter(Boolean).join(", ");
      const changed = [before.size !== im.size && "size", before.inks !== im.inks && "inks", before.colors !== im.colors && "colors"].filter(Boolean);
      lines.push(`${spec}${edit ? " (corrected)" : changed.length ? ` (changed: ${changed.join(", ")})` : " (as guessed)"}`);
      if (im.design_id) {
        designs.set(im.design_id, [...(designs.get(im.design_id) || []), [im.location, im.size, im.inks, im.underbase === true ? "underbase" : ""].filter(Boolean).join(", ")]);
        const garment = [...new Set(groups.filter((g) => g.imprints.includes(im!)).flatMap((g) => g.lines.map((l) => [l.style, l.color].filter(Boolean).join(" "))))].join(", ");
        // embroidery: what it sewed with, on the logo for its next reorder (the Mockup Creator's "Last time")
        if (emb) await rememberEmbroidery(admin, im, o.number, garment).catch(() => null);
        entries.push({ design: im.design_id, e: { location: im.location, method: im.method, size: im.size, drop: im.drop || "", inks: im.inks, colors: im.colors, ...(im.underbase !== undefined ? { underbase: im.underbase } : {}), garment, notes: [note, emb && im.stitches ? `${im.stitches} stitches` : "", emb ? [im.emb?.backing, im.emb?.topping && im.emb.topping !== "None" ? im.emb.topping : ""].filter(Boolean).join(" + ") : ""].filter(Boolean).join("; "), by, at, order_id: o.id, order_number: o.number, ...(job ? { job } : {}), ...(im.pressOnly?.id ? { press: { id: im.pressOnly.id, name: im.pressOnly.name } } : {}), ...(im.byColor && Object.keys(im.byColor.skip || {}).length ? { skip: im.byColor.skip } : {}), ...(im.rounds && im.rounds > 1 ? { rounds: im.rounds } : {}) } });
      }
    }
    if (!lines.length) throw new Error("Nothing waiting on production details here (already confirmed?).");
    const { error } = await admin.from("orders").update({ groups }).eq("id", o.id);
    if (error) throw new Error(error.message);
    if (pressNotes.length) {
      const { data: inn } = await admin.from("order_internal").select("production_notes").eq("order_id", o.id).maybeSingle();
      const pn = String(inn?.production_notes || "").trim();
      const add = pressNotes.filter((n) => !pn.includes(n.split(": ").slice(1).join(": ")));
      if (add.length) await admin.from("order_internal").upsert({ order_id: o.id, production_notes: [pn, `Production (${by}, ${at.slice(0, 10)}):\n${add.join("\n")}`].filter(Boolean).join("\n\n").slice(-8000) });
    }
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
    // full color confirmed: back to whoever's selling it, with the price as it is now (Oct 26, Nick: "production's got to
    // confirm how many colors it's going to be, and then it comes back")
    if (fullDone.length) {
      const after = total(), money = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const priced = Math.abs(after - before) >= 0.01 ? `The price changed: ${money(before)} → ${money(after)}.` : `The price stays ${money(after)}.`;
      const stillWaiting = groups.some((g) => g.imprints.some(fullColorWaiting));
      const detail = `Full color confirmed by ${by}: ${fullDone.join("; ")}. ${priced}${stillWaiting ? " Another full color print is still waiting." : " Send the quote."}`;
      await admin.from("order_events").insert({ order_id: o.id, kind: "full_color", detail: detail.slice(0, 500), actor: v.email || by });
      // the person working the order: the last one on it who isn't production, else an owner
      const { data: evs } = await admin.from("order_events").select("actor").eq("order_id", o.id).order("created_at", { ascending: false }).limit(40);
      const { data: crew } = await admin.from("staff").select("email, role");
      const roleOf = new Map(((crew || []) as { email: string; role: string }[]).map((x) => [String(x.email).toLowerCase(), x.role]));
      const owner = (((evs || []) as { actor: string }[]).map((e) => String(e.actor || "").toLowerCase()).find((a) => a.includes("@") && a !== String(v.email || "").toLowerCase() && !["production", "embroidery"].includes(roleOf.get(a) || "")))
        || ((crew || []) as { email: string; role: string }[]).find((x) => x.role === "owner")?.email || "";
      if (owner && !stillWaiting) await admin.from("tasks").insert({ owner: owner.toLowerCase(), title: `#${o.number}: full color confirmed, send the quote`.slice(0, 200), notes: detail.slice(0, 1000), area: "shop", status: "open", source: "order", order_id: o.id, url: `/shop/orders/${o.id}`, created_by: v.email || "production" });
    }
    const left = groups.reduce((n, g) => n + g.imprints.filter(needsDetails).length, 0);
    return { ok: true, left };
  } catch (e) { return fail(e); }
}
