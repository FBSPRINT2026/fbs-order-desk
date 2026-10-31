import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EODraft } from "@/lib/emailOrderShared";

/**
 * A garment named by its product name but no style number (Oct 31, Nick on MEI's cart orders: "Nike Dri-FIT Micro Pique
 * 2.0 Polo", "Carhartt Force Short Sleeve Pocket T-Shirt", no SanMar number) gets its style from what the shop already
 * put that product on before: this customer's own past orders (here and in Printavo), then our garment catalog.
 *
 * The product name has to match closely, word for word (brand, ® and ™ left out), and a women's, youth or tall garment
 * only ever matches the same kind, so a "Women's Sunnyvale Polo" never takes the men's style. When two styles match
 * equally, the one used most often wins. Nothing matched: the line stays as it was and Create order asks, as before.
 */
const NOISE = new Set(["the", "and", "with", "w", "a", "of", "for", "mens", "men", "unisex", "adult", "new", "shirt"]);
const KINDS = new Set(["women", "youth", "tall"]);
const KIND = (ws: Set<string>) => [ws.has("women") ? "w" : "", ws.has("youth") ? "y" : "", ws.has("tall") ? "t" : ""].join("");
function words(s: string, brand = ""): Set<string> {
  const b = new Set(norm(brand).split(" ").filter(Boolean));
  return new Set(norm(s).split(" ").filter((w) => w && !NOISE.has(w) && !b.has(w)));
}
function norm(s: string) {
  return (s || "").toLowerCase().replace(/[®™’]/g, (c) => (c === "’" ? "'" : " ")).replace(/\bladies\b|\bwomen'?s\b|\bwomens\b|\bwoman's\b/g, "women").replace(/\bmen'?s\b/g, "men")
    .replace(/'s\b/g, "").replace(/\b(\d)\/(\d)\b/g, "$1$2")
    // the same thing said two ways: a Backpack is SanMar's "Pack", a Tee a T-Shirt, a Quarter-Zip a 1/4-Zip
    .replace(/\bback ?packs?\b/g, "pack").replace(/\btees?\b/g, "t").replace(/\bquarter\b/g, "14").replace(/\bhalf\b/g, "12")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

type Known = { style: string; brand: string; name: Set<string>; kind: string; n: number };

export async function stylesFromHistory(admin: SupabaseClient, customerId: string, draft: EODraft): Promise<string[]> {
  const todo = draft.groups.flatMap((g) => g.lines).filter((l) => !(l.style || "").trim() && ((l as { called?: string }).called || l.garment || "").trim());
  if (!todo.length) return [];
  const [{ data: pv }, { data: os }] = await Promise.all([
    admin.from("archived_orders").select("data").eq("customer_id", customerId).order("order_date", { ascending: false }).limit(600),
    admin.from("orders").select("groups").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(300),
  ]);
  const seen = new Map<string, Known>();
  const add = (style: string, brand: string, desc: string) => {
    const st = (style || "").trim().toUpperCase();
    if (!st || !/\d/.test(st) || st.length > 20 || !(desc || "").trim()) return;
    // a Printavo description repeats the brand and ends with the style: "Nike - Nike Dri-FIT Micro Pique 2.0 Polo NKDC1963"
    const first = String(desc).split(/\r?\n/)[0].replace(new RegExp(`\\b${st.replace(/[^A-Z0-9]/g, "")}\\b`, "i"), " ").replace(/^[^-]+ - /, "");
    const name = words(first, brand);
    if (name.size < 2) return;
    const k = `${st}|${[...name].sort().join(" ")}`;
    const was = seen.get(k);
    if (was) was.n++; else seen.set(k, { style: st, brand: (brand || "").trim(), name, kind: KIND(name), n: 1 });
  };
  for (const r of (pv || []) as { data?: { groups?: { lines?: { itemNumber?: string; brand?: string; description?: string }[] }[] } }[])
    for (const g of r.data?.groups || []) for (const l of g.lines || []) add(l.itemNumber || "", l.brand || "", l.description || "");
  for (const r of (os || []) as { groups?: { lines?: { style?: string; brand?: string; garment?: string }[] }[] }[])
    for (const g of r.groups || []) for (const l of g.lines || []) add(l.style || "", l.brand || "", l.garment || "");
  const known = [...seen.values()];
  // brand names come off both sides: "Nike Sport Cover-Up" is the product "Sport Cover-Up" by Nike
  const brandWords = new Set([...known.map((k) => k.brand), "Nike", "Carhartt", "TravisMathew", "Travis Mathew", "Port Authority", "Port & Co", "Sport-Tek", "OGIO", "Eddie Bauer", "The North Face", "Next Level", "Next Level Apparel", "Gildan", "Bella Canvas", "Richardson", "Brooks Brothers", "CornerStone", "Columbia", "Peter Millar", "Cutter & Buck", "Tommy Bahama", "District", "Flexfit", "Red Kap", "Comfort Colors", "Hanes", "Champion", "Under Armour", "adidas"]
    .flatMap((b) => norm(b).split(" ")).filter((w) => w.length > 1 && w !== "the"));
  const strip = (ws: Set<string>) => new Set([...ws].filter((w) => !brandWords.has(w)));
  for (const k of known) k.name = strip(k.name);
  // the catalog last: only when their own history has nothing
  const catalog = new Map<string, Known[]>();
  const done: string[] = [];
  for (const l of todo) {
    const said = ((l as { called?: string }).called || l.garment || "").trim();
    const want = strip(words(said, l.brand || ""));
    // a style number written in the name ("Richardson® 112 - Adjustable Snapback Trucker Cap") is the style
    const named = known.filter((c) => want.has(c.style.toLowerCase())).sort((a, b) => b.n - a.n)[0];
    if (want.size < 2) continue;
    const kind = KIND(want);
    const pick = (list: Known[]) => {
      let best: Known | null = null, bestScore = 0, bestExtra = 0, second = 0;
      for (const c of list) {
        if (c.kind !== kind) continue;
        // women's, youth and tall only decide the kind (above): they never count as a matching word
        const core = [...want].filter((w) => !KINDS.has(w)), cn = [...c.name].filter((w) => !KINDS.has(w)).length;
        // a number they wrote (3/4 sleeve, 1/4 zip, 28L) names the variant: the product must have it too
        if (core.some((w) => /\d/.test(w) && !c.name.has(w))) continue;
        const hit = core.filter((w) => c.name.has(w)).length;
        // nearly every word they wrote is in the product's name, and the product's name has little they didn't write
        const score = core.length ? hit / core.length : 0, extra = cn - hit;
        if (hit < 2 || score < (hit >= 3 ? 0.75 : 0.99) || extra > 2) continue;
        const s = score * 10 - extra + Math.min(c.n, 50) / 100;
        if (s > bestScore) { if (best && best.style !== c.style) second = bestScore; best = c; bestScore = s; bestExtra = extra; }
        else if (best && best.style !== c.style && s > second) second = s;
      }
      // a short name that fits several products about as well ("Dad's Cap": a corduroy dad cap, a twill one…) is a
      // guess, not a match: it stays for Create order to ask. An exact name always wins.
      if (best && bestExtra > 0 && second >= bestScore - 1) return null;
      return best;
    };
    let hit: Known | null = named || pick(known), from = "their past orders";
    if (!hit) {
      // our garment list and SanMar's whole style list (its titles end with the style: "… 1/2-Zip NKDX6720"), searched
      // for this name's two longest words: a list read whole stops at 1,000 rows, so most of it was never looked at
      const key = [...want].filter((w) => !KINDS.has(w) && /^[a-z]{4,}$/.test(w)).sort((a, b) => b.length - a.length).slice(0, 2);
      if (!key.length) continue;
      const ck = key.join(" ");
      if (!catalog.has(ck)) {
        const [{ data }, { data: sm }] = await Promise.all([
          admin.from("garments").select("style, brand, description").or(key.map((w) => `description.ilike.%${w}%`).join(",")).limit(500),
          admin.from("sanmar_styles").select("style, brand, title").eq("sellable", true).or(key.map((w) => `title.ilike.%${w}%`).join(",")).limit(500),
        ]);
        const rows = [...((data || []) as { style: string; brand: string; description: string }[]),
          ...((sm || []) as { style: string; brand: string; title: string }[]).map((r) => ({ style: r.style, brand: r.brand, description: (r.title || "").replace(new RegExp(`\\.?\\s*${(r.style || "").replace(/[^A-Za-z0-9]/g, "")}\\s*$`, "i"), "") }))];
        catalog.set(ck, rows.map((g) => { const name = strip(words(g.description || "", g.brand || "")); return { style: (g.style || "").toUpperCase(), brand: g.brand || "", name, kind: KIND(name), n: 1 }; }).filter((g) => g.style && g.name.size >= 2));
      }
      hit = pick(catalog.get(ck) || []); from = "our garment catalog";
    }
    if (!hit) continue;
    l.style = hit.style;
    if (!(l.brand || "").trim()) l.brand = hit.brand;
    if (!(l.garment || "").trim() || l.garment === (l as { called?: string }).called) l.garment = said;
    delete (l as { called?: string }).called;
    done.push(`${said} = ${hit.style} (${from})`);
  }
  return done;
}

/**
 * A garment's description checked against its own style (Oct 31: a cart read "J325 · MEI Embroidery - Stacked Full
 * Color", the logo's option name where the shirt's name goes, and "DG446W" with no name at all). When a line has a style
 * and the style's product name is known (the customer's past orders, our garment list, SanMar's style list), a blank
 * description gets that name, and a description that shares no word with it (it names a logo, a location, a person, not
 * this garment) is replaced by it. A description that does describe the product ("Women's Gilliam Jacket") is kept.
 */
export async function describeFromStyles(admin: SupabaseClient, customerId: string | null, draft: EODraft): Promise<string[]> {
  const lines = draft.groups.flatMap((g) => g.lines).filter((l) => (l.style || "").trim());
  if (!lines.length) return [];
  const styles = [...new Set(lines.map((l) => l.style!.trim().toUpperCase()))].slice(0, 60);
  const [{ data: gs }, { data: sm }] = await Promise.all([
    admin.from("garments").select("style, brand, description").in("style", styles).limit(200),
    admin.from("sanmar_styles").select("style, brand, title").in("style", styles).limit(200),
  ]);
  const nameOf = new Map<string, { name: string; brand: string }>();
  for (const r of (sm || []) as { style: string; brand: string; title: string }[])
    nameOf.set(r.style.toUpperCase(), { name: (r.title || "").replace(new RegExp(`\\.?\\s*${r.style.replace(/[^A-Za-z0-9]/g, "")}\\s*$`, "i"), "").replace(new RegExp(`^${(r.brand || "").replace(/[^\w\s&-]/g, "")}\\s+`, "i"), "").trim(), brand: r.brand || "" });
  // our own garment list wins over SanMar's wording
  for (const r of (gs || []) as { style: string; brand: string; description: string }[]) if ((r.description || "").trim()) nameOf.set(r.style.toUpperCase(), { name: r.description.split(/\r?\n/)[0].trim(), brand: r.brand || "" });
  // what the shop called it on this customer's past orders, when neither list has it
  if (customerId && lines.some((l) => !nameOf.has(l.style!.trim().toUpperCase()))) {
    const { data: pv } = await admin.from("archived_orders").select("data").eq("customer_id", customerId).order("order_date", { ascending: false }).limit(300);
    for (const r of (pv || []) as { data?: { groups?: { lines?: { itemNumber?: string; brand?: string; description?: string }[] }[] } }[])
      for (const g of r.data?.groups || []) for (const x of g.lines || []) {
        const st = (x.itemNumber || "").trim().toUpperCase();
        if (st && styles.includes(st) && !nameOf.has(st) && (x.description || "").trim())
          nameOf.set(st, { name: x.description!.split(/\r?\n/)[0].replace(new RegExp(`\\b${st.replace(/[^A-Z0-9]/g, "")}\\b`, "i"), " ").replace(/^[^-]+ - /, "").replace(/\s+/g, " ").trim(), brand: x.brand || "" });
      }
  }
  const done: string[] = [];
  for (const l of lines) {
    const st = l.style!.trim().toUpperCase(), known = nameOf.get(st);
    if (!known?.name) continue;
    const said = (l.garment || "").trim();
    const mine = [...words(said, l.brand || known.brand)].filter((w) => !KINDS.has(w));
    const theirs = words(known.name, known.brand);
    if (said && mine.some((w) => theirs.has(w))) continue;
    l.garment = known.name;
    done.push(said ? `${st}: "${said}" → "${known.name}"` : `${st}: ${known.name}`);
  }
  return done;
}
