import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, askClaude } from "@/lib/ai/claude";
import { mergeSig, splitSig, type AiMerge, type AiSplit, type CatalogRules } from "@/lib/designCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The AI review of a customer's design catalog (Oct 20, Nick, Peticolas: "use AI to look at this and see when orders
 * should be combined… look at the mockups and see how they compare on each order… a couple different versions of
 * the koozies, so they have to be busted out into different ones… You should be able to learn it").
 *
 * The browser draws the pictures small and sends them in batches:
 *  { customer, phase: "split", designs: [{ key, name, pics: [{ id, refs, label, data }] }] } → designs whose orders
 *    are really more than one artwork, as groups of orders;
 *  { customer, phase: "merge", designs: [{ key, name, label, data? }] } → designs that are the same artwork.
 * Only suggestions: nothing changes until staff taps Merge or Split (POST /api/designs). What staff turned down (here
 * and for every customer) goes to the AI each time, so it learns what the shop calls the same and different.
 */
type Pic = { id: string; refs: string[]; label: string; data?: string };
type InSplit = { key: string; name: string; pics: Pic[] };
type InMerge = { key: string; name: string; label: string; data?: string };

const SYSTEM = `You sort a screen-printing shop's order history for one customer into designs. A design is one piece of artwork.
The same design is often printed on many garments and colors (t-shirts, ringers, hoodies, tanks, different shirt colors), with the ink colors swapped for dark or light garments, and it can be shown as a flat art file, a mockup on a shirt, or a photo. All of that is still the same design.
It is a different design when the artwork itself is different: a different drawing or logo, a different layout, different words, a different year or event, a redesign ("new art"), or a product printed in a different way (for example koozies printed in 3 places with one layout vs. koozies with a different logo).
The same logo on a shirt and on a hat or koozie is the same design only when the art is clearly the same; a hat's embroidered logo that differs from the shirt art is its own design.
Only suggest what you can see in the pictures (and the names when a picture is missing). When you're not sure, leave it alone: a wrong suggestion costs the shop more than a missed one.
Names are short, the way the customer would say it ("PBC Logo", "Velvet Hammer Ringer", "Koozies 3-Location"), without words like shirts or reprint unless they tell two designs apart.`;

const clean = (s: unknown, n = 400) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const jpeg = (d?: string) => { const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(d || "")); return m && m[1].length < 400_000 ? m[1] : ""; };

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { customer?: string; phase?: string; designs?: unknown[] };
  const cid = String(b.customer || "");
  if (!/^[0-9a-f-]{36}$/i.test(cid)) return NextResponse.json({ error: "Which customer?" }, { status: 400 });
  const admin = createAdminClient();
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ error: st.reason, off: true }, { status: 400 });

  // what staff turned down: this customer's, then the most recent from other customers
  const [{ data: mine }, { data: others }] = await Promise.all([
    admin.from("customer_designs").select("rules").eq("customer_id", cid).maybeSingle(),
    admin.from("customer_designs").select("rules, updated_at").neq("customer_id", cid).order("updated_at", { ascending: false }).limit(40),
  ]);
  const rules = (mine?.rules || {}) as CatalogRules;
  const no = new Set((rules.aiNo || []).map((x) => x.sig));
  const lessons = [
    ...(rules.aiNo || []).slice(-40).map((x) => x.text),
    ...((others || []) as { rules: CatalogRules }[]).flatMap((o) => (o.rules?.aiNo || []).slice(-5).map((x) => `(another customer) ${x.text}`)).slice(0, 20),
  ].filter(Boolean);
  const learned = lessons.length ? `\n\nStaff turned down these earlier suggestions. Learn from them what the shop considers different designs, and don't suggest them again:\n${lessons.map((t) => `- ${t}`).join("\n")}` : "";
  const model = st.settings.assistant.ai.model;
  const ctx = { customer_id: cid, by: v.email };

  if (b.phase === "split") {
    const ds: InSplit[] = (Array.isArray(b.designs) ? b.designs : []).slice(0, 20).map((x) => {
      const d = x as InSplit;
      return { key: clean(d.key, 200), name: clean(d.name, 120), pics: (Array.isArray(d.pics) ? d.pics : []).slice(0, 40).map((p) => ({ id: clean(p.id, 12), refs: (Array.isArray(p.refs) ? p.refs : []).map((r) => clean(r, 160)).slice(0, 80), label: clean(p.label, 500), data: jpeg(p.data) })) };
    }).filter((d) => d.key && d.pics.length >= 2 && !no.has(splitSig(d.key)));
    if (!ds.length) return NextResponse.json({ splits: [] });
    const images = ds.flatMap((d) => d.pics.filter((p) => p.data).map((p) => ({ media_type: "image/jpeg" as const, data: p.data!, label: `Design "${d.name}" (key ${d.key}), picture ${p.id}: ${p.label}` })));
    if (images.length > 90) return NextResponse.json({ error: "Too many pictures in one batch." }, { status: 400 });
    const text = ds.map((d) => `Design "${d.name}" (key ${d.key}):\n${d.pics.map((p) => `  ${p.id}${p.data ? "" : " (no picture)"}: ${p.label}`).join("\n")}`).join("\n\n");
    const r = await askClaude<{ designs?: { key?: string; groups?: { pictures?: string[]; name?: string; why?: string }[] }[] }>({
      task: "design_split", model, system: SYSTEM + learned, maxTokens: 4000, timeoutMs: 55_000, admin, ctx, images,
      prompt: `Each design below is a group of this customer's orders that were put together by their names. Each picture stands for one or more orders that had the same mockup.\n\n${text}\n\nFor each design, look at its pictures: are they all the same artwork? Report only the designs whose pictures show two or more different artworks, with the pictures grouped by artwork and a short name for each group (the group with the most orders keeps the design's name unless that name is wrong). A picture that isn't the art (an order form, a blank garment) goes with the group it's most likely part of.`,
      tool: { name: "report_splits", description: "Designs that are really more than one artwork", input_schema: { type: "object", properties: { designs: { type: "array", items: { type: "object", properties: {
        key: { type: "string" }, groups: { type: "array", items: { type: "object", properties: { pictures: { type: "array", items: { type: "string" } }, name: { type: "string" }, why: { type: "string", description: "one short line: what's different about this group's art" } }, required: ["pictures", "name", "why"] } },
      }, required: ["key", "groups"] } } }, required: ["designs"] } },
    });
    if (!r.ok) return NextResponse.json({ error: r.error, off: r.off }, { status: 502 });
    const splits: AiSplit[] = [];
    for (const out of r.data.designs || []) {
      const d = ds.find((x) => x.key === out.key); if (!d) continue;
      const byId = new Map(d.pics.map((p) => [p.id, p] as const));
      const used = new Set<string>();
      const groups = (out.groups || []).map((g) => {
        const ids = (g.pictures || []).map((x) => clean(x, 12)).filter((x) => byId.has(x) && !used.has(x));
        ids.forEach((x) => used.add(x));
        return { name: clean(g.name, 120) || d.name, why: clean(g.why, 300), refs: [...new Set(ids.flatMap((x) => byId.get(x)!.refs))] };
      }).filter((g) => g.refs.length);
      if (groups.length < 2) continue;
      // pictures the AI didn't place stay with the biggest group
      const rest = d.pics.filter((p) => !used.has(p.id)).flatMap((p) => p.refs);
      if (rest.length) groups.reduce((a, g) => (g.refs.length > a.refs.length ? g : a), groups[0]).refs.push(...rest);
      splits.push({ sig: splitSig(d.key), key: d.key, groups });
    }
    return NextResponse.json({ splits });
  }

  if (b.phase === "merge") {
    const ds: InMerge[] = (Array.isArray(b.designs) ? b.designs : []).slice(0, 90).map((x) => { const d = x as InMerge; return { key: clean(d.key, 200), name: clean(d.name, 120), label: clean(d.label, 600), data: jpeg(d.data) }; }).filter((d) => d.key);
    if (ds.length < 2) return NextResponse.json({ merges: [] });
    const ids = new Map<string, InMerge>(ds.map((d, i) => [`D${i + 1}`, d]));
    const images = [...ids.entries()].filter(([, d]) => d.data).map(([id, d]) => ({ media_type: "image/jpeg" as const, data: d.data!, label: `${id} "${d.name}"` }));
    const text = [...ids.entries()].map(([id, d]) => `${id} "${d.name}"${d.data ? "" : " (no picture)"}: ${d.label}`).join("\n");
    const r = await askClaude<{ groups?: { designs?: string[]; name?: string; why?: string }[] }>({
      task: "design_merge", model, system: SYSTEM + learned, maxTokens: 4000, timeoutMs: 55_000, admin, ctx, images,
      prompt: `These are all of this customer's designs, one picture each, with the names they were ordered under and what they were printed on.\n\n${text}\n\nFind the designs that are really the same artwork ordered under different names (for example "PBC Logo" and "Peticolas Logo Shirts" with the same logo) and should be one design. Report each such group with the name to keep. Leave out anything you're not sure of.`,
      tool: { name: "report_merges", description: "Designs that are the same artwork", input_schema: { type: "object", properties: { groups: { type: "array", items: { type: "object", properties: {
        designs: { type: "array", items: { type: "string" }, description: "the D numbers" }, name: { type: "string" }, why: { type: "string", description: "one short line: what's the same" },
      }, required: ["designs", "name", "why"] } } }, required: ["groups"] } },
    });
    if (!r.ok) return NextResponse.json({ error: r.error, off: r.off }, { status: 502 });
    const merges: AiMerge[] = [];
    const taken = new Set<string>();
    for (const g of r.data.groups || []) {
      const keys = [...new Set((g.designs || []).map((x) => ids.get(clean(x, 8))?.key || "").filter((k) => k && !taken.has(k)))];
      if (keys.length < 2) continue;
      const sig = mergeSig(keys);
      if (no.has(sig)) continue;
      keys.forEach((k) => taken.add(k));
      merges.push({ sig, keys, into: keys[0], name: clean(g.name, 120), why: clean(g.why, 300) });
    }
    return NextResponse.json({ merges });
  }
  return NextResponse.json({ error: "Which check?" }, { status: 400 });
}
