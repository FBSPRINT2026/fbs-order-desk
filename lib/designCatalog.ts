import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PvGroup } from "@/lib/archive";
import { allRows } from "@/lib/readAll";

/**
 * A customer's designs catalog (Oct 20, Nick, about Dear Heart Designs: "they order a lot of different designs and it
 * just repeats over and over… I'd like to group orders by design… a master design and then all the different ways
 * it's printed… In Every Season, you should have the way we did it forever, then the original version, the second
 * one… The Lord Is My Shepherd we did first on sweatshirts, then t-shirts, then a different garment, then youth").
 *
 * Worked out from the customer's orders every time (Printavo history and orders here), nothing stored but staff's
 * changes (customer_designs.rules):
 *  - a job's design is its name without garment words, colors, "(…)", "reprints", "rush", "sample for"…;
 *    names that are the same words in another order ("Makes a Way" / "He Makes a Way") are one design;
 *  - a design's versions are the garments it's been printed on (style + color), in the order they first appeared:
 *    the Original, then the 2nd, the 3rd…; each lists every order that printed it.
 * Pricing has nothing to do with it (Dear Heart is plain wholesale).
 */

export type CatalogRules = {
  /** design key → the name to show */ names?: Record<string, string>;
  /** design key → the design it's part of (merged) */ merge?: Record<string, string>;
  /** job ref ("p:<archived id>" / "o:<order id>") → design key (moved by hand); "" = not a design (left out) */ jobs?: Record<string, string>;
  /** design keys not shown */ hidden?: string[];
  /** design key → its cover picture in storage (chosen in the browser from the mockups; "-" = none of them would do) */ covers?: Record<string, string>;
  /** AI suggestions staff turned down ("they're different" / "keep together"): never suggested again, and told to the AI */
  aiNo?: { sig: string; text: string }[];
  /** the last AI review's suggestions still waiting on staff */ review?: AiReview;
};
/**
 * AI review of a catalog (Oct 20, Nick, Peticolas: "use AI to look at this and see when orders should be combined…
 * look at the mockups and see how they compare on each order… a couple different versions of the koozies, so they
 * have to be busted out"). Nothing changes until staff taps Merge or Split.
 */
export type AiMerge = { sig: string; keys: string[]; into: string; name: string; why: string };
export type AiSplit = { sig: string; key: string; groups: { name: string; refs: string[]; why: string }[] };
export type AiReview = { at: string; by: string; merges: AiMerge[]; splits: AiSplit[] };
export const mergeSig = (keys: string[]) => `m:${[...keys].sort().join("+")}`;
/** a split is answered per design: "keep together" holds until staff asks again */
export const splitSig = (key: string) => `s:${key}`;

/** what a garment is, for the catalog's tabs (Oct 20, Nick: "a tab for t-shirts, koozies, hats, other items") */
export type Kind = "tees" | "sweats" | "hats" | "drink" | "other";
export const KINDS: { k: Kind; label: string }[] = [
  { k: "tees", label: "T-shirts" }, { k: "sweats", label: "Sweatshirts & jackets" }, { k: "hats", label: "Hats" }, { k: "drink", label: "Koozies & cups" }, { k: "other", label: "Other items" },
];
export function kindOf(text: string): Kind | "" {
  const t = ` ${String(text || "").toLowerCase()} `;
  if (/koozie|cooler|\bcups?\b|tumbler|bottle|\bmugs?\b|\bglass(es|ware)?\b|\bstein\b|drinkware|\bcusc|\bjit\d/.test(t)) return "drink";
  if (/\bhats?\b|\bcaps?\b|beanie|snapback|trucker|visor|richardson|\b112\b|flexfit|\beza\b/.test(t)) return "hats";
  if (/hood|sweat|fleece|pullover|quarter.?zip|1\/[24].?zip|jacket|soft ?shell|windbreaker|\bvests?\b|\bpc90h?\b|\b3719\b|\b3901\b|\b18500\b|\b18000\b/.test(t)) return "sweats";
  if (/t-?shirts?|\btees?\b|\bshirts?\b|ringer|\btanks?\b|jersey|long ?sleeve|\bcvc\b|onesie|bodysuit|\bpolos?\b|\b6210|\b3001|\b3413|\b64000|\b5000\b|\bpc54|\bpc61|\bdm130|\b6010|\b245\b|\b246\b|\b293\b|\b6937\b|\b3480/.test(t)) return "tees";
  if (/banner|tin tacker|\bsigns?\b|sticker|decal|frisbee|flying disc|towel|\btotes?\b|\bbags?\b|poster|\bflags?\b|patch|magnet|\bpins?\b|coaster|apron/.test(t)) return "other";
  return "";
}
export type CatalogJob = { ref: string; src: "printavo" | "portal"; id: string; number: string; date: string; title: string; qty: number; status: string;
  /** a split order (one order, several designs): the other designs on it */ split?: string[];
  /** the order's art picture (signed: the print's mockup, else its first garment mockup or file), to compare by eye */ pic?: string; kind?: Kind | "" };
export type CatalogVersion = {
  key: string; n: number; label: string; style: string; brand: string; garment: string; color: string;
  first: string; last: string; times: number; pieces: number; prints: string[];
  /** small picture (signed link) and the full mockup to open */ thumb: string; full: string;
  jobs: (CatalogJob & { pieces: number })[];
};
export type CatalogDesign = {
  key: string; name: string; names: string[]; first: string; last: string; orders: number; pieces: number;
  thumb: string; versions: CatalogVersion[]; jobs: CatalogJob[];
  /** the cover was chosen and saved; else `pics` are the files to choose it from (signed, newest first) */ coverSet: boolean; pics: string[];
  /** what it's been printed on (T-shirts, hats…), most pieces first */ kinds: Kind[];
};
export type Catalog = { designs: CatalogDesign[]; other: CatalogJob[]; rules: CatalogRules; customer: string;
  /** designs staff deleted (only the grouping: the orders are untouched), to bring back */ hidden: { key: string; name: string; orders: number }[] };

const COLORS = "maroon|mauve|sand|black|white|navy|grey|gray|heather|natural|cream|ivory|pink|blue|red|green|olive|forest|royal|kelly|burgundy|berry|brown|tan|khaki|charcoal|ash|oatmeal|pepper|sage|butter|banana|ivory|chalky|mint|lavender|orchid|purple|violet|yellow|gold|orange|rust|teal|denim|espresso|bay|moss|seafoam|watermelon|crimson|flo|neon|light|dark|washed|vintage|comfort colors";
const GARMENT = "t-?shirts?|tees?|shirts?|sweat-?shirts?|crew-?necks?|crews?|hood(ies|y)|hoodie|pull-?overs?|pulls?|long-?sleeves?|ls|youth|toddler|kids?|adult|tanks?|hats?|caps?|beanies?|totes?|bags?|sweats|joggers?|shorts";
// a color only goes when it's the garment's ("Maroon Sweatshirts"), so a design named for a color keeps it
const COLOR_GARMENT = new RegExp(`\\b(${COLORS})(\\s+(${COLORS}))*\\s+(${GARMENT}|samples?)(\\s+for)?\\b`, "gi");
const FLUFF = new RegExp(`\\b(re-?prints?|re-?orders?|restock|rush|reprint|sample(s)? for|samples?|no (apparel|neck) (tags?|labels?)|new tag art|no tags?|deliver.*|bucee'?s|buc-ee'?s|wholesale|ws|bc|dh|${GARMENT})\\b`, "gi");
/** a job's design name, cleaned of everything that isn't the design ("The Lord is My Shepherd Maroon Sweatshirts" → "The Lord is My Shepherd") */
export function designName(title: string) {
  return String(title || "").replace(/\(.*?\)/g, " ").replace(/[-_:]+/g, " ").replace(/&/g, " and ").replace(COLOR_GARMENT, " ").replace(FLUFF, " ")
    .replace(/(\s|[–—+,/.]|\band\b|\bplus\b)+$/i, "").replace(/^(\s|[–—+,/.]|\band\b)+/i, "").replace(/\s+/g, " ").trim();
}
const SPELL: Record<string, string> = { shepard: "shepherd", szn: "season", seasons: "season", every_season: "every season" };
export const designKey = (title: string) => designName(title).toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").map((w) => SPELL[w] || w).filter(Boolean).join(" ");
const TITLE_SMALL = new Set(["a", "an", "and", "the", "of", "to", "in", "for", "on", "at", "or"]);
const titleCase = (s: string) => s.toLowerCase().split(" ").map((w, i) => (i > 0 && TITLE_SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");

type Raw = { job: CatalogJob; lines: { style: string; brand: string; garment: string; color: string; pieces: number; thumb: string; full: string }[]; prints: string[]; /** the print's own mockup (Printavo imprint mockups: the art, never a purchase order) */ cover?: { thumb: string; full: string };
  /** every full-size picture or PDF on the job (mockups, photos, and sometimes the purchase order) */ pics: string[];
  /** each line's own words (a Printavo line's description, "In Every Season" / "TYJ Pullover"), to find the designs
   *  of a split order; `at` is the line's place in `lines` (-1: a line without a garment, counted only) */ named?: { text: string; pieces: number; at: number }[] };
const isPic = (p: string) => /\.(png|jpe?g|webp|gif|pdf)$/i.test(p);

export async function buildCatalog(admin: SupabaseClient, customerId: string): Promise<Catalog> {
  const [{ data: arch }, { data: ords }, { data: cust }, { data: rr }] = await Promise.all([
    allRows((r0, r1) => admin.from("archived_orders").select("id, visual_id, nickname, order_date, qty, status_name, data, files").eq("customer_id", customerId).order("order_date").order("id").range(r0, r1), 1500),
    admin.from("orders").select("id, number, nickname, created_at, status, groups").eq("customer_id", customerId).neq("status", "void").order("created_at").limit(1000),
    admin.from("customers").select("company, name").eq("id", customerId).maybeSingle(),
    admin.from("customer_designs").select("rules").eq("customer_id", customerId).maybeSingle(),
  ]);
  const rules = ((rr?.rules || {}) as CatalogRules);
  const raws: Raw[] = [];
  for (const a of (arch || []) as { id: string; visual_id: string; nickname: string; order_date: string; qty: number; status_name: string; data: { groups?: PvGroup[] }; files: Record<string, string> | null }[]) {
    const files = a.files || {};
    const groups = a.data?.groups || [];
    const kept = groups.flatMap((g) => g.lines || []).filter((l) => (String(l.itemNumber || "").trim() || String(l.color || "").trim()) && ((l.items || 0) > 0 || l.itemNumber));
    raws.push({
      named: groups.flatMap((g) => g.lines || []).filter((l) => (l.items || 0) > 0 && String(l.description || "").trim()).map((l) => ({ text: String(l.description || ""), pieces: +l.items || 0, at: kept.indexOf(l) })),
      job: { ref: `p:${a.id}`, src: "printavo", id: a.id, number: String(a.visual_id), date: String(a.order_date || ""), title: String(a.nickname || "").trim(), qty: +a.qty || 0, status: a.status_name || "" },
      lines: kept.map((l) => {
        const m = (l.mockups || [])[0];
        return { style: String(l.itemNumber || "").trim().toUpperCase(), brand: String(l.brand || "").trim(), garment: String(l.description || "").replace(/^[^-]+-\s*/, "").trim(), color: String(l.color || "").trim(), pieces: +l.items || 0, thumb: (m && files[m.thumb]) || "", full: (m && files[m.full]) || "" };
      }),
      prints: groups.flatMap((g) => (g.imprints || []).map((im) => `${String(im.details || "").replace(/\s+/g, " ").trim()}`)).filter(Boolean).slice(0, 4),
      cover: (() => { const m = groups.flatMap((g) => (g.imprints || []).flatMap((im) => im.mockups || [])).find((x) => files[x.thumb]); return m ? { thumb: files[m.thumb], full: files[m.full] || files[m.thumb] } : undefined; })(),
      pics: [...new Set(groups.flatMap((g) => [...(g.imprints || []).flatMap((im) => im.mockups || []), ...(g.lines || []).flatMap((l) => l.mockups || [])]).map((m) => files[m.full] || "").filter((x) => x && isPic(x)))],
    });
  }
  for (const o of (ords || []) as { id: string; number: number; nickname: string; created_at: string; status: string; groups: { name?: string; lines?: { style?: string; brand?: string; garment?: string; color?: string; sizes?: Record<string, number> }[]; imprints?: { location?: string; size?: string; inks?: string; method?: string }[]; mockupThumbs?: string[] }[] }[]) {
    const groups = o.groups || [];
    // an order with several groups can be several designs: each group is its own job when it has its own name
    const split = groups.length > 1 && groups.every((g) => (g.name || "").trim() && !/^group \d+$/i.test(g.name || ""));
    const parts = split ? groups.map((g) => ({ title: String(g.name), gs: [g] })) : [{ title: String(o.nickname || ""), gs: groups }];
    for (const [pi, p] of parts.entries()) {
      raws.push({
        job: { ref: `o:${o.id}${split ? `:${pi}` : ""}`, src: "portal", id: o.id, number: String(o.number), date: String(o.created_at).slice(0, 10), title: p.title.trim(), status: o.status,
          qty: p.gs.reduce((n, g) => n + (g.lines || []).reduce((m, l) => m + Object.values(l.sizes || {}).reduce((x, y) => x + (+y || 0), 0), 0), 0) },
        lines: p.gs.flatMap((g) => {
          const shown = (g.lines || []).filter((l) => l.style || l.color);
          return shown.map((l, li) => ({ style: String(l.style || "").trim().toUpperCase(), brand: String(l.brand || "").trim(), garment: String(l.garment || "").trim(), color: String(l.color || "").trim(),
            pieces: Object.values(l.sizes || {}).reduce((x, y) => x + (+y || 0), 0), thumb: (g.mockupThumbs || [])[li] || "", full: ((g.mockupThumbs || [])[li] || "").replace(/-thumb\.png$/, ".png") }));
        }),
        prints: p.gs.flatMap((g) => (g.imprints || []).map((im) => [im.location, im.size, im.inks].filter(Boolean).join(" · "))).filter(Boolean).slice(0, 4),
        // our own mockups (full size) are the best cover there is
        pics: p.gs.flatMap((g) => (g.mockupThumbs || []).map((t) => t.replace(/-thumb\.png$/, ".png"))),
      });
    }
  }

  // each job's design: by hand first, then its name
  const keyOfJob = (r: Raw) => (rules.jobs && r.job.ref in rules.jobs ? rules.jobs[r.job.ref] : designKey(r.job.title));
  const merged = (k: string) => { let x = k; for (let i = 0; i < 6 && rules.merge?.[x]; i++) x = rules.merge[x]; return x; };
  const byKey = new Map<string, Raw[]>();
  const otherRaws: Raw[] = [];
  for (const r of raws) {
    const k = merged(keyOfJob(r));
    if (!k || k.split(" ").every((w) => w.length < 2)) { otherRaws.push(r); continue; }
    byKey.set(k, [...(byKey.get(k) || []), r]);
  }
  // the same design under a longer or shorter name ("makes a way" / "he makes a way"): the shorter one joins the
  // longer, when it's at least two words and every word of it is in the other (not when staff set it apart)
  const keys = [...byKey.keys()].sort((a, b) => b.split(" ").length - a.split(" ").length);
  for (const short of [...keys].reverse()) {
    const sw = short.split(" ");
    if (sw.length < 2 || !byKey.has(short) || rules.names?.[short]) continue;
    const into = keys.find((k) => k !== short && byKey.has(k) && sw.every((w) => k.split(" ").includes(w)) && k.split(" ").length - sw.length <= 2);
    if (into) { byKey.set(into, [...(byKey.get(into) || []), ...(byKey.get(short) || [])]); byKey.delete(short); }
  }

  // split orders (Oct 20, Nick: #32838 "Bucee's RUSH" is In Every Season, Jesus Changes Everything and TYJ Pullovers
  // on one order): a line whose own words name a design ("In Every Season", "TYJ Pullover" = Thank You Jesus by its
  // initials) puts that part of the order on that design too, marked as a split
  const known = [...byKey.keys()];
  const initials = new Map(known.filter((k) => k.split(" ").length >= 3).map((k) => [k.split(" ").map((w) => w[0]).join(""), k] as const));
  const lineKey = (text: string) => {
    const lk = designKey(text); if (!lk) return "";
    const m = merged(lk); if (byKey.has(m)) return m;
    const ws = lk.split(" ");
    for (const w of ws) if (w.length >= 3 && initials.has(w)) return initials.get(w)!;
    return known.filter((k) => byKey.has(k) && k.split(" ").length >= 2 && k.split(" ").every((w) => ws.includes(w))).sort((a, b) => b.length - a.length)[0] || "";
  };
  const placed: { r: Raw; from: string }[] = [...[...byKey.entries()].flatMap(([k, rs]) => rs.map((r) => ({ r, from: k }))), ...otherRaws.map((r) => ({ r, from: "" }))];
  for (const { r, from } of placed) {
    if (!r.named?.length || r.job.ref.includes("#")) continue;
    const parts = new Map<string, { at: Set<number>; pieces: number }>();
    for (const n of r.named) { const k = lineKey(n.text); if (!k) continue; const p = parts.get(k) || { at: new Set<number>(), pieces: 0 }; if (n.at >= 0) p.at.add(n.at); p.pieces += n.pieces; parts.set(k, p); }
    const others = [...parts.keys()].filter((k) => k !== from);
    if (!others.length) continue;
    if (!from && parts.size === 1) {
      // no design in the order's name, one in its lines: the whole order is that design
      const k = others[0]; byKey.set(k, [...(byKey.get(k) || []), r]); otherRaws.splice(otherRaws.indexOf(r), 1); continue;
    }
    // a split: one part per design (the order's own design keeps the lines no other design took)
    const taken = new Set(others.flatMap((k) => [...parts.get(k)!.at]));
    const all = [...(from ? [from] : []), ...others];
    const out: { k: string; r: Raw }[] = all.map((k) => {
      const own = k === from;
      const lines = r.lines.filter((_, i) => (own ? !taken.has(i) : parts.get(k)!.at.has(i)));
      const qty = own ? Math.max(0, r.job.qty - others.reduce((n, o) => n + parts.get(o)!.pieces, 0)) || lines.reduce((n, l) => n + l.pieces, 0) : parts.get(k)!.pieces;
      const ref = `${r.job.ref}#${k}`;
      const to = rules.jobs && ref in rules.jobs ? merged(rules.jobs[ref]) : k;
      return { k: to, r: { ...r, job: { ...r.job, ref, qty, split: all.filter((x) => x !== k) }, lines, named: undefined } };
    });
    if (from) byKey.set(from, (byKey.get(from) || []).filter((x) => x !== r)); else otherRaws.splice(otherRaws.indexOf(r), 1);
    for (const { k, r: pr } of out) { if (!k) otherRaws.push(pr); else byKey.set(k, [...(byKey.get(k) || []), pr]); }
  }
  for (const [k, rs] of byKey) if (!rs.length) byKey.delete(k);
  const other = otherRaws.map((r) => r.job);

  // pictures: one signing call for everything
  const covers = rules.covers || {};
  const paths = [...new Set([...raws.flatMap((r) => [...r.lines.flatMap((l) => [l.thumb, l.full]), r.cover?.thumb || "", r.cover?.full || "", ...r.pics]), ...Object.values(covers).filter((c) => c && c !== "-")].filter(Boolean))];
  const signed = new Map<string, string>();
  for (let i = 0; i < paths.length; i += 500) {
    const part = paths.slice(i, i + 500);
    const { data } = await admin.storage.from("proofs").createSignedUrls(part, 3600);
    (data || []).forEach((d, j) => { if (d.signedUrl) signed.set(part[j], d.signedUrl); });
  }

  // each order's own picture and kind (for the AI review and the tabs)
  for (const r of [...[...byKey.values()].flat(), ...otherRaws]) {
    const p = r.cover?.full || r.cover?.thumb || r.lines.find((l) => l.full || l.thumb)?.full || r.lines.find((l) => l.thumb)?.thumb || r.pics[0] || "";
    r.job.pic = (p && signed.get(p)) || undefined;
    r.job.kind = r.lines.map((l) => kindOf(`${l.style} ${l.brand} ${l.garment}`)).find(Boolean) || kindOf(r.job.title) || (r.named || []).map((n) => kindOf(n.text)).find(Boolean) || "";
  }

  const designs: CatalogDesign[] = [];
  const hidden: Catalog["hidden"] = [];
  for (const [key, rs] of byKey) {
    if (rules.hidden?.includes(key)) { hidden.push({ key, name: rules.names?.[key] || titleCase(designName(rs[0].job.title) || key), orders: rs.length }); continue; }
    rs.sort((a, b) => a.job.date.localeCompare(b.job.date));
    const vmap = new Map<string, CatalogVersion>();
    for (const r of rs) {
      for (const l of r.lines) {
        const vk = `${l.style}|${l.color.toLowerCase()}`;
        let v = vmap.get(vk);
        if (!v) {
          v = { key: vk, n: vmap.size + 1, label: "", style: l.style, brand: l.brand, garment: l.garment, color: l.color, first: r.job.date, last: r.job.date, times: 0, pieces: 0, prints: [], thumb: "", full: "", jobs: [] };
          vmap.set(vk, v);
        }
        if (!v.jobs.some((j) => j.ref === r.job.ref)) { v.jobs.push({ ...r.job, pieces: 0 }); v.times++; }
        const j = v.jobs.find((x) => x.ref === r.job.ref)!; j.pieces += l.pieces;
        v.pieces += l.pieces; v.last = r.job.date;
        if (r.prints.length) v.prints = r.prints;
        // the full picture when it is one (Printavo's thumbnails are 100 px); a PDF is drawn in the browser
        if (l.thumb && signed.get(l.thumb)) { v.full = signed.get(l.full) || signed.get(l.thumb)!; v.thumb = /\.(png|jpe?g|webp|gif)$/i.test(l.full) && signed.get(l.full) ? signed.get(l.full)! : signed.get(l.thumb)!; }
        if (!v.brand && l.brand) v.brand = l.brand;
        if (!v.garment && l.garment) v.garment = l.garment;
      }
    }
    const versions = [...vmap.values()];
    versions.forEach((v, i) => { v.label = i === 0 ? "Original" : `${ordinal(i + 1)} version`; });
    // the name: staff's, else the most used of its jobs' names (cleaned), in title case
    const counts = new Map<string, number>();
    for (const r of rs) { const n = designName(r.job.title); if (n) counts.set(n.toLowerCase(), (counts.get(n.toLowerCase()) || 0) + 1); }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || key;
    // the cover: the newest print mockup (a Printavo imprint mockup is the art itself; a line's can be a purchase order
    // screenshot), else the newest version's picture
    const latestPic = [...rs].reverse().map((r) => (r.cover ? signed.get(r.cover.thumb) : "")).find(Boolean) || [...versions].sort((a, b) => b.last.localeCompare(a.last)).find((v) => v.thumb)?.thumb || "";
    // the cover picked in the browser from the jobs' full-size files (newest job first)
    const saved = covers[key];
    const pics = [...new Set([...rs].reverse().flatMap((r) => r.pics).map((p) => signed.get(p) || "").filter(Boolean))].slice(0, 40);
    designs.push({
      key, name: rules.names?.[key] || titleCase(best), names: [...new Set(rs.map((r) => r.job.title.trim()))],
      first: rs[0].job.date, last: rs[rs.length - 1].job.date, orders: rs.length, pieces: rs.reduce((n, r) => n + (r.lines.reduce((m, l) => m + l.pieces, 0) || r.job.qty), 0),
      thumb: saved ? (saved === "-" ? "" : signed.get(saved) || latestPic) : latestPic, versions, jobs: rs.map((r) => r.job).reverse(),
      coverSet: !!saved && (saved === "-" || signed.has(saved)), pics,
      kinds: (() => {
        const by = new Map<Kind, number>();
        for (const r of rs) { const k = (r.job.kind || "other") as Kind; by.set(k, (by.get(k) || 0) + (r.job.qty || 1)); }
        return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
      })(),
    });
  }
  designs.sort((a, b) => b.last.localeCompare(a.last) || b.orders - a.orders);
  // a split order names the other designs on it
  const nameOf = new Map(designs.map((d) => [d.key, d.name] as const));
  for (const d of designs) for (const j of [...d.jobs, ...d.versions.flatMap((v) => v.jobs)]) if (j.split) j.split = j.split.map((k) => nameOf.get(k) || titleCase(k));
  return { designs, other: other.sort((a, b) => b.date.localeCompare(a.date)), rules, customer: cust?.company || cust?.name || "", hidden: hidden.sort((a, b) => a.name.localeCompare(b.name)) };
}
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
