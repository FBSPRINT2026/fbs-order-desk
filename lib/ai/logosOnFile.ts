import type { SupabaseClient } from "@supabase/supabase-js";
import { colorwaysOf, pickSewFile, sewFilesOf, sewKindOf, type Brand } from "@/lib/brands";
import type { Design, GLine, Group, Imprint } from "@/lib/pricing";

/**
 * The customer's logos on file and their brand standards, for the order reader (Oct 27, Nick on Cedar Promos' ShipStation
 * SO#73417: "I see the customer… I see their logo on file, I see he has polos… I know the brand standards, it's navy on
 * one and white on another. There's no reason you shouldn't be able to get there from that PDF"). The reader names the
 * logo by its D-number (prints[].logo_on_file); code then fills the print from the logo itself: its sew file (size,
 * stitches, digitized), the brand's thread or colorway, and a color change for the garments the files show in another.
 */
export type LogosOnFile = { designs: (Design & { brand_id?: string | null })[]; brands: Brand[]; text: string; pictures: { path: string; label: string }[] };

export async function logosOnFile(admin: SupabaseClient, customerId: string): Promise<LogosOnFile | null> {
  const [{ data: bs }, { data: ds }] = await Promise.all([
    admin.from("brands").select("*").eq("customer_id", customerId).is("archived_at", null).order("sort"),
    admin.from("designs").select("*").eq("customer_id", customerId).is("archived_at", null).eq("draft", false)
      .order("starred", { ascending: false }).order("number", { ascending: false }).limit(60),
  ]);
  const brands = (bs || []) as Brand[];
  // the brands' logos first, then their others (starred, newest)
  const designs = ((ds || []) as (Design & { brand_id?: string | null })[]).sort((a, b) => Number(!!b.brand_id) - Number(!!a.brand_id)).slice(0, 40);
  if (!designs.length) return null;
  const bName = (id?: string | null) => brands.find((b) => b.id === id)?.name || "";
  const lines = designs.map((d) => {
    const parts: string[] = [];
    const sews = sewFilesOf(d);
    if (sews.length) parts.push(`embroidery ready: ${sews.map((f) => `sew file ${f.name || f.code} ${f.wIn}" × ${f.hIn}" ${f.stitches} stitches (${f.kind || "flat"}${f.placement ? `, ${f.placement}` : ""})`).join("; ")}`);
    const cws = colorwaysOf(d);
    if (cws.length) parts.push(`colorways: ${cws.map((c) => `${c.name} (${c.inks.join(", ")})`).join("; ")}`);
    if (!parts.length && d.inks) parts.push(`inks: ${d.inks}`);
    return `- D-${d.number} "${d.name}"${d.brand_id ? ` · brand ${bName(d.brand_id)}` : ""}${parts.length ? ` · ${parts.join(" · ")}` : ""}`;
  });
  const brandLines = brands.map((b) => {
    const r = b.rules || {}, e = b.embroidery || {};
    const rule = [r.light ? `light goods get ${r.light}` : "", r.dark ? `dark goods get ${r.dark}` : "", r.one_light ? `one color on light ${r.one_light}` : "", r.one_dark ? `one color on dark ${r.one_dark}` : "",
      e.light?.length ? `embroidery thread on light goods ${e.light.join(", ")}` : "", e.dark?.length ? `on dark goods ${e.dark.join(", ")}` : ""].filter(Boolean).join("; ");
    return `- Brand "${b.name}"${rule ? `: ${rule}` : ""}${b.notes ? `. Notes: ${b.notes.slice(0, 200)}` : ""}`;
  });
  const text = [brands.length ? `THIS CUSTOMER'S BRANDS (they order for these companies; each has its standards):\n${brandLines.join("\n")}` : "",
    `THEIR LOGOS ON FILE (rule 4g: when the files show one of these, name it in logo_on_file):\n${lines.join("\n")}`].filter(Boolean).join("\n\n");
  // the brands' logos as pictures, so a logo in their photos can be matched by how it looks (a few, small)
  const pictures = designs.filter((d) => d.brand_id && d.preview_path).slice(0, 4).map((d) => ({ path: d.preview_path, label: `Logo on file D-${d.number} "${d.name}" (${bName(d.brand_id)}):` }));
  return { designs, brands, text, pictures };
}

/** a color name as the order's lines write it (the reader's "Navy" → the line's "Navy"), or "" when none matches */
const lineColor = (lines: GLine[], c: string) => {
  const k = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return lines.find((l) => k(l.color) === k(c))?.color || lines.find((l) => k(l.color).includes(k(c)) || (k(c).includes(k(l.color)) && k(l.color).length > 2))?.color || "";
};

/**
 * A print filled from a logo on file: the logo, and for embroidery its sew file for these goods (size, stitches, already
 * digitized), the thread (what the reader read, else the brand's thread for light goods), and a color change for the
 * garment colors the files show in another thread or ink.
 */
export function fillFromLogo(im: Imprint, o: { design: Design & { brand_id?: string | null }; brands: Brand[]; lines: GLine[]; changes?: { garment_colors?: string[]; inks?: string }[] | null }) {
  const { design: d, lines } = o;
  const brand = o.brands.find((b) => b.id === d.brand_id) || null;
  im.design_id = d.id;
  im.fromBrand = brand?.name || "their logos";
  if (im.method === "embroidery") {
    const sew = pickSewFile(sewFilesOf(d), sewKindOf(lines));
    if (sew) {
      im.size = `${sew.wIn}" × ${sew.hIn}"`;
      im.stitches = sew.stitches;
      im.digitized = true;
      im.emb = { ...(im.emb || {}), file: sew, stitchesFrom: "file" };
      if (sew.wIn) im.artRatio = Math.round((sew.hIn / sew.wIn) * 1000) / 1000;
      im.sizeFrom = "brand";
    }
    if (!(im.inks || "").trim()) im.inks = (sew?.threads?.light?.length ? sew.threads.light : brand?.embroidery?.light || []).join(", ");
  } else if (!(im.inks || "").trim()) {
    const cw = colorwaysOf(d).find((c) => c.name.toLowerCase() === String(brand?.rules?.light || "").toLowerCase()) || colorwaysOf(d)[0];
    if (cw) im.inks = cw.inks.join(", ");
    else if (d.inks) im.inks = d.inks;
  }
  im.colors = Math.max(1, (im.inks || "").split(/\s*,\s*/).filter(Boolean).length || im.colors || 1);
  // the garments in another thread or ink: one color change per garment color (Imprint.inkBy)
  const from = (im.inks || "").split(/\s*,\s*/)[0] || "";
  const inkBy: NonNullable<Imprint["inkBy"]> = {};
  for (const ch of o.changes || []) {
    const to = String(ch.inks || "").trim();
    if (!to || !from || to.toLowerCase() === from.toLowerCase()) continue;
    for (const c of ch.garment_colors || []) { const lc = lineColor(lines, c); if (lc) inkBy[lc.trim().toLowerCase()] = { [from]: to }; }
  }
  if (Object.keys(inkBy).length) im.inkBy = inkBy;
  return im;
}

/**
 * Groups that are the same logo on file at the same spots are ONE group with a color change (Oct 27, Nick on SO#73417:
 * the reader made a group per polo; #40195, the order he built, is "Left Chest" with all six polos in Oxford Blue and a
 * color change to Super White on the Navy and Black, and the quarter-zip's sleeve its own group). Merges groups whose
 * prints are all logos on file with the same method, spot and logo: the thread most garments get (else the brand's
 * light-goods thread) stays the print's, the others become Imprint.inkBy by garment color. Groups at other spots stay
 * apart. Returns the new list and, for each old group, the group it went into.
 */
export function mergeLogoGroups(groups: Group[], brands: Brand[] = []): { groups: Group[]; into: Map<Group, Group> } {
  const into = new Map<Group, Group>();
  const ck2 = (c: string) => (c || "").trim().toLowerCase();
  const isLogo = (g: Group) => g.imprints.length > 0 && g.imprints.every((im) => im.design_id && im.fromBrand);
  const sig = (g: Group) => g.imprints.map((im) => `${im.method}|${ck2(im.location)}|${im.design_id}`).sort().join("~");
  const bySig = new Map<string, Group[]>();
  for (const g of groups) if (isLogo(g)) { const k = sig(g); bySig.set(k, [...(bySig.get(k) || []), g]); }
  const out: Group[] = [];
  const done = new Set<Group>();
  let merged = false;
  for (const g of groups) {
    if (done.has(g)) continue;
    const set = isLogo(g) ? bySig.get(sig(g)) || [g] : [g];
    if (set.length < 2) { out.push(g); into.set(g, g); done.add(g); continue; }
    // one print at a time (matched by spot), each garment color's thread
    const keyOf = (im: Imprint) => `${im.method}|${ck2(im.location)}|${im.design_id}`;
    const base: Group = JSON.parse(JSON.stringify(g));
    let clash = false;
    for (const im of base.imprints) {
      const k = keyOf(im);
      const per: { color: string; inks: string; n: number }[] = [];
      for (const x of set) {
        const xi = x.imprints.find((y) => keyOf(y) === k);
        if (!xi) continue;
        for (const l of x.lines) {
          const own = Object.entries(xi.inkBy || {}).find(([c]) => ck2(c) === ck2(l.color))?.[1];
          const first = (xi.inks || "").split(/\s*,\s*/)[0] || "";
          const inks = own && first && own[first] ? (xi.inks || "").replace(first, own[first]) : xi.inks || "";
          per.push({ color: l.color, inks, n: 1 });
        }
      }
      // the same garment color can't get two threads in one group: leave these apart
      const seen = new Map<string, string>();
      for (const p of per) { const was = seen.get(ck2(p.color)); if (was != null && ck2(was) !== ck2(p.inks)) clash = true; seen.set(ck2(p.color), p.inks); }
      if (clash) break;
      const tally = new Map<string, number>();
      for (const p of per) tally.set(p.inks, (tally.get(p.inks) || 0) + p.n);
      const brand = brands.find((b) => b.name === im.fromBrand);
      const light = (brand?.embroidery?.light || [])[0] || "";
      const top = [...tally.entries()].sort((a, b) => b[1] - a[1] || Number(ck2(b[0]).includes(ck2(light)) && !!light) - Number(ck2(a[0]).includes(ck2(light)) && !!light));
      const main = top[0]?.[0] || im.inks || "";
      im.inks = main;
      im.colors = Math.max(1, main.split(/\s*,\s*/).filter(Boolean).length);
      const from = main.split(/\s*,\s*/);
      const inkBy: NonNullable<Imprint["inkBy"]> = {};
      for (const p of per) {
        if (ck2(p.inks) === ck2(main)) continue;
        const to = p.inks.split(/\s*,\s*/);
        const m: Record<string, string> = {};
        from.forEach((f, i) => { if (to[i] && ck2(to[i]) !== ck2(f)) m[f] = to[i]; });
        if (Object.keys(m).length) inkBy[ck2(p.color)] = m;
      }
      if (Object.keys(inkBy).length) im.inkBy = inkBy; else delete im.inkBy;
    }
    if (clash) { for (const x of set) if (!done.has(x)) { out.push(x); into.set(x, x); done.add(x); } continue; }
    base.lines = set.flatMap((x) => x.lines);
    base.finishing = [...new Set(set.flatMap((x) => x.finishing || []))];
    base.name = [...new Set(base.imprints.map((im) => im.location))].join(" + ");
    delete base.description;
    out.push(base); merged = true;
    for (const x of set) { into.set(x, base); done.add(x); }
  }
  // once merged, each logo group is named by its spot like the rest ("Left Chest", "Left Upper Arm")
  if (merged) for (const g of out) if (isLogo(g) && g.imprints.length === 1) g.name = g.imprints[0].location;
  return { groups: out, into };
}

