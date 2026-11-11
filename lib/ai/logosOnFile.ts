import type { SupabaseClient } from "@supabase/supabase-js";
import { applyColorwayChange, brandDark, colorwayFor, colorwaysOf, goodsColorway, sewFilesOf, sewForPrint, sewKindOf, sewThreads, type Brand } from "@/lib/brands";
import type { Design, GLine, Group, Imprint } from "@/lib/pricing";

/**
 * The customer's logos on file and their brand standards, for the order reader (Oct 27, Nick on Cedar Promos' ShipStation
 * SO#73417: "I see the customer… I see their logo on file, I see he has polos… I know the brand standards, it's navy on
 * one and white on another. There's no reason you shouldn't be able to get there from that PDF"). The reader names the
 * logo by its D-number (prints[].logo_on_file); code then fills the print from the logo itself: its sew file (size,
 * stitches, digitized), the brand's thread or colorway, and a color change for the garments the files show in another.
 */
export type LogosOnFile = { designs: (Design & { brand_id?: string | null })[]; brands: Brand[]; text: string; pictures: { path: string; label: string }[] };

/** does this job name the brand: its name, or its initials ("All My Sons" = AMS, "New City Moving" = NCM) */
export function namesBrand(b: Pick<Brand, "name">, jobText: string): boolean {
  const t = ` ${(jobText || "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const n = (b.name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!n) return false;
  const ws = n.split(" ").filter((w) => !/^(the|of|and|inc|llc|co)$/.test(w));
  const ini = ws.map((w) => w[0]).join("");
  // the whole name, its initials (3+ letters), or its one distinctive word ("Armstrong" for "Armstrong Relocation")
  return t.includes(` ${n} `) || (ini.length >= 3 && t.includes(` ${ini} `)) || (ws[0]?.length >= 5 && t.includes(` ${ws[0]} `));
}

/**
 * jobText: the job (its name, PO, files): a reseller orders for many end clients, each a brand; a job for one of them is
 * shown only that brand's logos and standards (plus logos with no brand), and a job for none of them only the logos
 * with no brand (Nov 10, Nick: "anytime I use the order helper and it detects Nine18, it thinks everything is All My Sons")
 */
export async function logosOnFile(admin: SupabaseClient, customerId: string, jobText?: string): Promise<LogosOnFile | null> {
  const [{ data: bs }, { data: ds }] = await Promise.all([
    admin.from("brands").select("*").eq("customer_id", customerId).is("archived_at", null).order("sort"),
    admin.from("designs").select("*").eq("customer_id", customerId).is("archived_at", null).eq("draft", false)
      .order("starred", { ascending: false }).order("number", { ascending: false }).limit(60),
  ]);
  const all = (bs || []) as Brand[];
  const brands = jobText == null || all.length < 2 ? all : all.filter((b) => namesBrand(b, jobText)); // one brand: it's just theirs
  const keep = new Set(brands.map((b) => b.id));
  // the brands' logos first, then their others (starred, newest)
  const designs = ((ds || []) as (Design & { brand_id?: string | null })[]).filter((d) => jobText == null || !d.brand_id || keep.has(d.brand_id)).sort((a, b) => Number(!!b.brand_id) - Number(!!a.brand_id)).slice(0, 40);
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
    return `- Brand "${b.name}"${rule ? `: ${rule}` : ""}${b.notes ? `. Standards: ${b.notes.slice(0, 1500)}` : ""}`;
  });
  const text = [brands.length ? `THIS CUSTOMER'S BRANDS (they order for these companies; each has its standards):\n${brandLines.join("\n")}` : "",
    `THEIR LOGOS ON FILE (rule 4g: when the files show one of these, name it in logo_on_file):\n${lines.join("\n")}`].filter(Boolean).join("\n\n");
  // the brands' logos as pictures, so a logo in their photos can be matched by how it looks (a few, small)
  // (a vector logo's picture is an SVG, which can't be shown to the reader: its first colorway's picture is used instead)
  const picOf = (d: Design) => { if (d.preview_path && !/\.svg$/i.test(d.preview_path)) return d.preview_path; const cw = ((d.specs as { colorways?: { preview?: string }[] } | null)?.colorways || []).find((c) => c.preview && !/\.svg$/i.test(c.preview)); return cw?.preview || ""; };
  const pictures = designs.filter((d) => d.brand_id && picOf(d)).slice(0, 4).map((d) => ({ path: picOf(d), label: `Logo on file D-${d.number} "${d.name}" (${bName(d.brand_id)}):` }));
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
    // the colorway's own sew file when the brand links one (light goods first, as the print's base), else the best fit
    const own = goodsColorway(d, brand, lines);
    const sew = sewForPrint(d, brand, lines.length > 0 && lines.every((l) => brandDark(brand, l)), sewKindOf(lines), undefined, own);
    if (own && !sew) im.colorway = own.name;
    if (sew) {
      // the colorway that sews this file, by name on the print (a standard mockup is matched by it)
      { const cw = colorwaysOf(d).find((c) => c.sew && c.sew === sew.code); if (cw) im.colorway = cw.name; }
      im.size = `${sew.wIn}" × ${sew.hIn}"`;
      im.stitches = sew.stitches;
      im.digitized = true;
      im.emb = { ...(im.emb || {}), file: sew, stitchesFrom: "file" };
      if (sew.wIn) im.artRatio = Math.round((sew.hIn / sew.wIn) * 1000) / 1000;
      im.sizeFrom = "brand";
    }
    // the threads the file sews (the file is what runs; Oct 31, #40332: "Carmine, Black" was read for a file that sews
    // Carmine + Cream), else what was read, else the brand's thread for light goods
    if (sewThreads(sew).length) im.inks = sewThreads(sew).join(", ");
    else if (!(im.inks || "").trim()) im.inks = (brand?.embroidery?.light || []).join(", ");
  } else {
    // a heat transfer or screen print of the logo: its version for these goods by name (a standard mockup is matched by
    // it; Oct 31, #40328's transfer had none and missed M-1138), its inks when the reading named none
    const k = (s?: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const named = (im.inks || "").trim() ? colorwaysOf(d).find((c) => k(c.inks.join(",")) === k(im.inks)) : null;
    const dark = lines.length > 0 && lines.every((l) => brandDark(brand, l));
    // a brand with light and dark versions decides by the goods, not by inks the reading guessed (Oct 31, #40332: a black
    // tee's transfer read as "PMS 492 C, Black", the light-goods version); a version the paperwork names is put on after
    // (lib/ai/sourceCheckRun.ts applyColorwayFixes)
    const ruled = !!(brand?.rules?.light && brand?.rules?.dark);
    const cw = goodsColorway(d, brand, lines) || (ruled ? colorwayFor(d, brand, dark) : null) || named || colorwayFor(d, brand, dark);
    if (cw && !im.colorway) im.colorway = cw.name;
    if (cw && (ruled || !(im.inks || "").trim())) im.inks = cw.inks.join(", ");
    else if (!(im.inks || "").trim() && d.inks) im.inks = d.inks;
  }
  im.colors = Math.max(1, (im.inks || "").split(/\s*,\s*/).filter(Boolean).length || im.colors || 1);
  // the garments in another thread or ink: one color change per garment color (Imprint.inkBy)
  const from = (im.inks || "").split(/\s*,\s*/)[0] || "";
  const inkBy: NonNullable<Imprint["inkBy"]> = {};
  const cwBy: Record<string, string> = {};
  // a change that is one of the logo's versions (All White's one thread for a two-thread Full Color): that whole version
  // on those garments (Imprint.colorwayBy), never one thread swapped and the other left (Oct 31, #40329: "White + Cream")
  const kk = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const files = sewFilesOf(d, brand);
  const versionOf = (to: string) => colorwaysOf(d).find((c) => { const f = c.sew ? files.find((x) => x.code === c.sew) : null; const th = f ? sewThreads(f) : c.inks; return th.length > 0 && th.map(kk).join("|") === to.split(/\s*,\s*/).map(kk).join("|"); });
  for (const ch of o.changes || []) {
    const to = String(ch.inks || "").trim();
    if (!to || !from || to.toLowerCase() === from.toLowerCase()) continue;
    const v = versionOf(to);
    const nFrom = (im.inks || "").split(/\s*,\s*/).filter(Boolean).length, nTo = to.split(/\s*,\s*/).filter(Boolean).length;
    for (const c of ch.garment_colors || []) {
      const lc = lineColor(lines, c); if (!lc) continue;
      if (v) cwBy[lc.trim().toLowerCase()] = v.name;
      else if (nFrom === nTo || nFrom === 1) inkBy[lc.trim().toLowerCase()] = { [from]: to };
    }
  }
  // goods of both kinds in one group (Oct 31, #40332: black polos with a Stone shirt, all "Full Color"): the print is one
  // of the brand's light / dark versions; a garment color on the other side, or with a version of its own, gets its
  // version as a colorway change (like brandPrint does when a logo is added by hand)
  const base = colorwaysOf(d).find((c) => (im.colorway || "").toLowerCase().replace(/[^a-z0-9]/g, "") === c.name.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const pairNames = [brand?.rules?.light, brand?.rules?.dark].map((x) => kk(x || ""));
  if (base && pairNames.every(Boolean) && pairNames.includes(kk(base.name))) {
    for (const l of lines) {
      const lc = (l.color || "").trim().toLowerCase();
      if (!lc || cwBy[lc]) continue;
      const want = goodsColorway(d, brand, [l]) || colorwayFor(d, brand, brandDark(brand, l));
      if (want && kk(want.name) !== kk(base.name)) { cwBy[lc] = want.name; delete inkBy[lc]; }
    }
  }
  if (Object.keys(inkBy).length) im.inkBy = inkBy;
  if (Object.keys(cwBy).length) Object.assign(im, applyColorwayChange(im, d, { ...(im.colorwayBy || {}), ...cwBy }));
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
  // caps and bags sew their own files in their own hoops: never one group with shirts (Oct 31, #40332: a knit skull cap
  // went in with the left-chest polos)
  const kindOf = (g: Group) => { const k = sewKindOf(g.lines || []); return k === "cap" || k === "bag" ? k : ""; };
  const sig = (g: Group) => g.imprints.map((im) => `${im.method}|${ck2(im.location)}|${im.design_id}|${im.method === "embroidery" ? kindOf(g) : ""}`).sort().join("~");
  const bySig = new Map<string, Group[]>();
  for (const g of groups) if (isLogo(g)) { const k = sig(g); bySig.set(k, [...(bySig.get(k) || []), g]); }
  const out: Group[] = [];
  const done = new Set<Group>();
  let merged = false;
  // a group of one garment named for it ("Perth Performance Quarter-Zip - Navy") keeps that name on its line once the
  // group is renamed for its spot (the line's garment, so a quarter-zip's sleeve goes to its upper arm)
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const g of groups) if (isLogo(g) && g.lines.length === 1 && !(g.lines[0].garment || "").trim() && (g.name || "").trim()) {
    const l = g.lines[0];
    g.lines[0] = { ...l, garment: g.name!.replace(new RegExp(`\\s*[-–—·,]\\s*${esc(l.color || "")}\\s*$`, "i"), "").replace(new RegExp(`^${esc(l.brand || "")}\\s+`, "i"), "").trim().slice(0, 120) };
  }
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
      // two versions of the logo by name (Full Color and All White: Oct 31, MEI #40329) are two groups, never a thread
      // swapped inside one: a cart that names the version per garment groups by it
      const cws = new Set(set.map((x) => ck2(x.imprints.find((y) => keyOf(y) === k)?.colorway || "")).filter(Boolean));
      if (cws.size > 1) { clash = true; break; }
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
      // a color change swaps thread for thread: a version with another number of threads (two-color vs one) isn't one
      const nOf = (x: string) => x.split(/\s*,\s*/).filter(Boolean).length;
      if (per.some((p) => nOf(p.inks) !== nOf(main))) { clash = true; break; }
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

