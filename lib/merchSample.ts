import "server-only";
import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeSettings, type Garment, type Settings } from "@/lib/pricing";
import { ssLookup, ssConfigured } from "@/lib/ss";
import { defaultUpcharges, makeProductionJob, suggestBasePrice, uniqueSlug } from "@/lib/merchServer";
import { isYouthSize, orderTotals, r2, type Field, type ProductColor, type Store } from "@/lib/merch";
import { SAMPLE_ART } from "@/lib/merchSampleArt";

/**
 * The sample school, "Oak Hollow Elementary" (a test account), so the whole merch-store flow can be seen end to end:
 *  - "Owls Spirit Shop": an OPEN store with five products (tee, hoodie with a name on the back, long sleeve, crewneck,
 *    staff tee), real S&S blanks with mockups, and sample orders, so you can shop it like a parent.
 *  - "Fall Spirit Wear": a CLOSED store whose orders became a production job (schedule, goods, receiving, packing).
 * Everything is on a test account; the orders are "Test (no charge)". All art is original sample art.
 */
const SCHOOL = "Oak Hollow Elementary", CUSTOMER = "Oak Hollow Elementary PTA";
const GREEN = "#1F4D3A", GOLD = "#E3B23C";
const CONTACT = { name: "Jen Patel, PTA President", email: "oakhollowpta@example.com", phone: "" };
const TEACHERS = ["Mrs. Alvarez", "Mr. Bennett", "Ms. Chen", "Mrs. Dawson", "Mr. Ellis", "Ms. Foster", "Mrs. Garcia", "Mr. Hughes"];
const GRADES = ["K", "1st", "2nd", "3rd", "4th", "5th", "Staff"];
const FIRST = ["Ava", "Liam", "Mia", "Noah", "Zoe", "Eli", "Isla", "Owen", "Ruby", "Leo", "Nora", "Jack", "Lucy", "Theo", "Ella", "Max", "Hazel", "Gabe", "Ivy", "Sam", "Lila", "Ben", "Maya", "Finn", "Jade", "Cole", "Aria", "Luke", "Rose", "Wes", "Cora", "Jude", "Tess", "Ezra", "June", "Reid"];
const LAST = ["Patel", "Nguyen", "Brooks", "Kim", "Rivera", "Okafor", "Lopez", "Schmidt", "Hart", "Silva", "Bauer", "Reyes", "Turner", "Price", "Ward", "Cruz", "Ellis", "Moss"];
const FIELDS: Field[] = [
  { key: "student", label: "Student name", kind: "text", options: [], required: true, sort: 2 },
  { key: "grade", label: "Grade", kind: "select", options: GRADES, required: true, sort: 0 },
  { key: "teacher", label: "Homeroom teacher", kind: "select", options: TEACHERS, required: true, sort: 1 },
];
const day = (n: number) => new Date(Date.now() + n * 86400000);

/* ------------------------------------------------------------ art + mockups */

type ArtKey = "varsity" | "crest" | "mono" | "staff" | "nameback";
const ART_INFO: Record<ArtKey, { name: string; inks: string; colors: number }> = {
  varsity: { name: "Owls varsity arch", inks: "White, Gold (Green on light shirts)", colors: 2 },
  crest: { name: "Owl crest badge", inks: "White, Gold (Green on light shirts)", colors: 2 },
  mono: { name: "OH monogram", inks: "Gold, White (Green on light shirts)", colors: 2 },
  staff: { name: "Staff tee lettering", inks: "Gold, White (Green on light shirts)", colors: 2 },
  nameback: { name: "Name on back (personalized)", inks: "White, Gold", colors: 2 },
};
const artSvg = (k: ArtKey, dark: boolean) => SAMPLE_ART[`${k}_${dark ? "dark" : "light"}`];
const artSize = (svg: string) => { const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/); return m ? { w: +m[1], h: +m[2] } : { w: 1000, h: 1000 }; };
/** dark shirts get the white/gold art, light ones the green/gold art */
function isDark(hex: string) {
  const m = (hex || "").replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return true;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.24;
}

type Kind = "tee" | "hoodie";
/**
 * Where the art goes on the S&S photo (1000×1250, 34 px per inch, collar at y≈128 front / 100 back: the same numbers
 * the Mockup Creator uses). Hoodies print lower, under the hood.
 */
function place(kind: Kind, view: "front" | "back", wIn: number, art: { w: number; h: number }) {
  const w = wIn * 34, h = (w * art.h) / art.w;
  const top = view === "back" ? 100 + 3 * 34 : kind === "hoodie" ? 372 : 128 + 4 * 34;
  return { x: 499 - w / 2, y: top, w, h };
}

async function photoData(path: string) {
  const url = /^https?:/.test(path) ? path : `https://www.ssactivewear.com/${path.replace(/^\//, "")}`;
  const r = await fetch(url).catch(() => null);
  if (!r || !r.ok) return null;
  return `data:${r.headers.get("content-type") || "image/jpeg"};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
}
/** a mockup as an SVG picture: the blank's photo with the art printed on it (both embedded, so it works anywhere) */
async function mockup(photoPath: string, art: string, kind: Kind, view: "front" | "back", wIn: number) {
  const photo = await photoData(photoPath);
  if (!photo) return null;
  const p = place(kind, view, wIn, artSize(art));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1250" width="1000" height="1250"><rect width="1000" height="1250" fill="#fff"/><image href="${photo}" x="0" y="0" width="1000" height="1250" preserveAspectRatio="xMidYMid meet"/><image href="data:image/svg+xml;base64,${Buffer.from(art).toString("base64")}" x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" width="${p.w.toFixed(1)}" height="${p.h.toFixed(1)}" opacity="0.97"/></svg>`;
}
async function upload(admin: SupabaseClient, path: string, svg: string) {
  const up = await admin.storage.from("proofs").upload(path, Buffer.from(svg), { contentType: "image/svg+xml", upsert: true });
  if (up.error) throw new Error(up.error.message);
  return path;
}

/* ------------------------------------------------------------ the school, its art, its blanks */

async function school(admin: SupabaseClient) {
  let { data: cust } = await admin.from("customers").select("*").eq("company", CUSTOMER).maybeSingle();
  if (!cust) {
    const { data, error } = await admin.from("customers").insert({ company: CUSTOMER, name: "Jen Patel", email: CONTACT.email, phone: "", is_test: true, merch_client: true, price_type: "retail", notes: "Test account for the sample merch stores." }).select("*").single();
    if (error) throw new Error(error.message);
    cust = data;
  } else await admin.from("customers").update({ is_test: true, merch_client: true }).eq("id", cust.id);
  return cust as { id: string };
}

/** the school's designs (Artwork → designs), one per piece of art; earlier sample designs are renamed and re-filed */
async function designs(admin: SupabaseClient, customerId: string) {
  const out = {} as Record<ArtKey, string>;
  const old: Record<string, ArtKey> = { "Owls crest (white + gold)": "varsity", "OH monogram badge": "crest" };
  for (const k of Object.keys(ART_INFO) as ArtKey[]) {
    const info = ART_INFO[k], svg = artSvg(k, true), sz = artSize(svg);
    const legacy = Object.entries(old).find(([, v]) => v === k)?.[0];
    const { data: had } = await admin.from("designs").select("id").eq("customer_id", customerId).in("name", [info.name, ...(legacy ? [legacy] : [])]).limit(1).maybeSingle();
    const path = await upload(admin, `designs/oak-hollow-sample/${k}.svg`, svg);
    const row = { name: info.name, file_path: path, file_name: `${k}.svg`, file_type: "image/svg+xml", preview_path: path, width_px: Math.round(sz.w), height_px: Math.round(sz.h), method: "screen", colors: info.colors, inks: info.inks };
    if (had) { await admin.from("designs").update(row).eq("id", had.id); out[k] = had.id; continue; }
    const { data: d, error } = await admin.from("designs").insert({ ...row, customer_id: customerId, created_by: "sample" }).select("id").single();
    if (error) throw new Error(error.message);
    out[k] = d.id;
  }
  return out;
}

async function garment(admin: SupabaseClient, style: string, brand: string): Promise<Garment | null> {
  const { data: have } = await admin.from("garments").select("*").eq("supplier", "ss").ilike("style", style).ilike("brand", brand).limit(1);
  if (have?.[0] && Object.keys((have[0] as Garment).color_images || {}).length) return have[0] as Garment;
  if (!ssConfigured()) return (have?.[0] as Garment) || null;
  const g = await ssLookup(`${brand} ${style}`).catch(() => null) || await ssLookup(style).catch(() => null);
  if (!g || g.style.toLowerCase() !== style.toLowerCase() || !g.brand.toLowerCase().includes(brand.toLowerCase().split(" ")[0])) return (have?.[0] as Garment) || null;
  const row = { ...g, supplier: "ss", synced_at: new Date().toISOString() };
  const res = have?.[0] ? await admin.from("garments").update(row).eq("id", have[0].id).select("*").single() : await admin.from("garments").insert(row).select("*").single();
  return (res.data as Garment) || null;
}
const pickColor = (g: Garment, want: string) => (g.colors || []).find((c) => c.toLowerCase() === want.toLowerCase()) || (g.colors || []).find((c) => c.toLowerCase().startsWith(want.toLowerCase().split(" ")[0])) || "";

/* ------------------------------------------------------------ products */

type Plan = { name: string; description: string; adult: [string, string]; youth?: [string, string]; colors: string[]; art: ArtKey; kind: Kind; width: number; give: number; back?: ArtKey; personalize?: { label: string; price: number; max: number }[]; extra?: number; adultSizes?: string[] };
type Made = { id: string; name: string; adult: Garment; youth: Garment | null; colors: string[]; sizes: string[]; base: number; give: number; ups: Record<string, number>; personalize: boolean };

/** a product's colors with mockups (front, and back when the item prints on the back) */
async function colorsFor(admin: SupabaseClient, st: Store, p: Plan, g: Garment, y: Garment | null, sizes: string[]) {
  const out: ProductColor[] = [];
  for (const want of p.colors) {
    const c = pickColor(g, want);
    if (!c || out.some((x) => x.name === c)) continue;
    const ci = g.color_images?.[c];
    const dark = isDark(ci?.hex || "#000");
    let image = "", back = "";
    if (ci?.front) {
      const svg = await mockup(ci.front, artSvg(p.art, dark), p.kind, "front", p.width);
      if (svg) image = await upload(admin, `stores/${st.id}/m-${p.art}-${c.replace(/\W+/g, "")}-${randomBytes(3).toString("hex")}.svg`, svg);
    }
    if (p.back && ci?.back) {
      const svg = await mockup(ci.back, artSvg(p.back, dark), p.kind, "back", 11);
      if (svg) back = await upload(admin, `stores/${st.id}/m-${p.back}-${c.replace(/\W+/g, "")}-${randomBytes(3).toString("hex")}.svg`, svg);
    }
    const ycolor = y ? pickColor(y, c) : "";
    out.push({ name: c, hex: ci?.hex || "#999999", image, photo: ci?.front ? `/api/ss/img?p=${encodeURIComponent(ci.front.replace(/^https?:\/\/[^/]+\//, ""))}` : "", ...(back ? { back } : {}), sizes: sizes.filter((z) => !isYouthSize(z) || !!ycolor) });
  }
  return out;
}

async function makeProducts(admin: SupabaseClient, settings: Settings, st: Store, plans: Plan[], art: Record<ArtKey, string>) {
  const made: Made[] = [];
  for (const [i, p] of plans.entries()) {
    const g = await garment(admin, p.adult[1], p.adult[0]);
    if (!g) continue;
    const y = p.youth ? await garment(admin, p.youth[1], p.youth[0]) : null;
    const ys = (y?.sizes || []).filter((z) => /^Y/.test(z));
    const sizes = [...ys, ...(g.sizes || []).filter((z) => (p.adultSizes || ["S", "M", "L", "XL", "2XL", "3XL"]).includes(z))];
    const colors = await colorsFor(admin, st, p, g, y, sizes);
    if (!colors.length) continue;
    const base = r2(suggestBasePrice(settings, { cost: +(g.size_costs?.M || g.cost || 3), color: colors[0].name, method: "screen", colors: 2, expected: 96, locations: p.back ? 2 : 1 }) + (p.extra || 0));
    const ups = defaultUpcharges(settings, sizes);
    const { data: prod, error } = await admin.from("merch_products").insert({
      store_id: st.id, position: i, name: p.name, description: p.description, design_id: art[p.art],
      imprint: { location: "Full Front", width: p.width, colors: 2, method: "screen", inks: ART_INFO[p.art].inks, ...(p.back ? { back_design_id: art[p.back], back_location: "Upper Back" } : {}), youth: y ? { supplier: "ss", style: y.style, brand: y.brand, garment_id: y.id, sizes: ys, cost: y.size_costs || {} } : null },
      supplier: "ss", style: g.style, brand: g.brand, garment_id: g.id, colors, sizes, cost: g.size_costs || {}, base_price: base, giveback: p.give, upcharges: ups, personalize: p.personalize || [], active: true,
    }).select("id").single();
    if (error) throw new Error(error.message);
    made.push({ id: prod.id, name: p.name, adult: g, youth: y, colors: colors.map((c) => c.name), sizes, base, give: p.give, ups, personalize: !!p.personalize?.length });
  }
  return made;
}

/** sample orders: one bag per student, a few brothers-and-sisters checkouts, spread over the days the store's been open */
async function makeOrders(admin: SupabaseClient, st: Store, made: Made[], n: number, daysOpen: number, seed: number) {
  let rnd = seed;
  const rand = (k: number) => { rnd = (rnd * 9301 + 49297) % 233280; return Math.floor((rnd / 233280) * k); };
  let i = 0, placed = 0;
  while (placed < n) {
    const family = LAST[rand(LAST.length)];
    const kids = rand(5) === 0 ? 2 : 1;
    const checkout = kids > 1 ? crypto.randomUUID() : null;
    const when = day(-daysOpen + (placed % Math.max(1, daysOpen)) + rand(10) / 10).toISOString();
    const parent = `${["Jen", "Mike", "Sara", "Dan", "Priya", "Luis", "Kate", "Tom", "Ana", "Chris"][rand(10)]} ${family}`;
    for (let k = 0; k < kids && placed < n; k++, placed++) {
      const student = `${FIRST[i++ % FIRST.length]} ${family}`;
      const staff = rand(14) === 0;
      const grade = staff ? "Staff" : GRADES[rand(6)], teacher = TEACHERS[rand(TEACHERS.length)];
      const count = 1 + (rand(3) === 0 ? 1 : 0) + (rand(6) === 0 ? 1 : 0);
      const items = Array.from({ length: count }, (_, j) => {
        const pool = made.filter((m) => (staff ? true : m.youth || rand(4) === 0));
        const p = pool[j === 0 ? 0 : rand(pool.length)] || made[0];
        const color = p.colors[rand(p.colors.length)];
        const youth = !staff && !!p.youth && rand(10) < 8;
        const sz = p.sizes.filter((z) => (youth ? isYouthSize(z) : !isYouthSize(z) && !/^[3-5]XL$/.test(z)));
        const size = sz[rand(sz.length)] || p.sizes[0];
        const name = p.personalize && rand(2) === 0 ? student.split(" ")[0].toUpperCase() : "";
        const extra = name ? 5 : 0;
        const up = +(p.ups[size] || 0);
        return { product_id: p.id, name: p.name, style: isYouthSize(size) && p.youth ? p.youth.style : p.adult.style, color, size, qty: 1, unit_price: r2(p.base + p.give + up + extra), base_price: r2(p.base + up + extra), giveback: p.give, personalization: name ? { "Name on back": name } : {} };
      });
      const t = orderTotals(items, { taxRate: st.tax_rate, taxExempt: false, shipping: 0 });
      const { data: num } = await admin.rpc("merch_next_number", { p_store: st.id });
      const { data: o, error } = await admin.from("merch_orders").insert({
        store_id: st.id, number: num as number, token: randomBytes(16).toString("hex"), shopper: { name: parent, email: `sample+${family.toLowerCase()}${i}@example.com` }, answers: { student, grade, teacher },
        delivery: rand(12) === 0 ? "pickup" : "org", subtotal: t.subtotal, tax: t.tax, shipping: 0, total: t.total, giveback: t.giveback, status: "paid", checkout_id: checkout,
        paid_at: when, pay_method: "Test (no charge)", created_at: when,
      }).select("id").single();
      if (error) throw new Error(error.message);
      await admin.from("merch_order_items").insert(items.map((it) => ({ ...it, order_id: o.id })));
    }
  }
}

/* ------------------------------------------------------------ the stores */

const OPEN_PLAN: Plan[] = [
  { name: "Owls Varsity Tee", description: "Our classic spirit tee: soft, sturdy 100% cotton. The Owls varsity arch in white and gold (green and gold on Sport Grey).", adult: ["Gildan", "5000"], youth: ["Gildan", "5000B"], colors: ["Forest Green", "Black", "Sport Grey"], art: "varsity", kind: "tee", width: 10.5, give: 5 },
  { name: "Owl Crest Hoodie", description: "Warm heavy-blend hoodie with the Owl crest on the front. Add a name across the back (optional).", adult: ["Gildan", "18500"], youth: ["Gildan", "18500B"], colors: ["Forest", "Black", "Sport Grey"], art: "crest", kind: "hoodie", width: 9.5, give: 6, back: "nameback", personalize: [{ label: "Name on back", price: 5, max: 12 }] },
  { name: "OH Monogram Long Sleeve", description: "Cotton long-sleeve tee with the big OH monogram. Great for cool mornings at recess.", adult: ["Gildan", "5400"], youth: ["Gildan", "5400B"], colors: ["Forest Green", "Sport Grey"], art: "mono", kind: "tee", width: 8.5, give: 5 },
  { name: "Owls Crewneck Sweatshirt", description: "Cozy heavy-blend crewneck with the Owls varsity arch.", adult: ["Gildan", "18000"], youth: ["Gildan", "18000B"], colors: ["Sport Grey", "Forest Green"], art: "varsity", kind: "tee", width: 10.5, give: 6 },
  { name: "Staff Tee", description: "For Oak Hollow teachers and staff: garment-dyed Comfort Colors, the softest tee we print.", adult: ["Comfort Colors", "1717"], colors: ["Moss", "Pepper", "Ivory"], art: "staff", kind: "tee", width: 10, give: 5, adultSizes: ["S", "M", "L", "XL", "2XL", "3XL"] },
];
const FALL_PLAN: Plan[] = [
  { name: "Owls Spirit Tee", description: "Classic heavy cotton tee with the Owls varsity arch.", adult: ["Gildan", "5000"], youth: ["Gildan", "5000B"], colors: ["Forest Green", "Black", "Sport Grey"], art: "varsity", kind: "tee", width: 10.5, give: 5 },
  { name: "Owls Hoodie", description: "Heavy blend hooded sweatshirt with the Owl crest.", adult: ["Gildan", "18500"], youth: ["Gildan", "18500B"], colors: ["Forest", "Black"], art: "crest", kind: "hoodie", width: 9.5, give: 6 },
];
const BRAND = (logo: string) => ({ school: SCHOOL, tagline: "Home of the Owls", primary: GREEN, accent: GOLD, mascot: "Owls", city: "Richardson, TX", logo });
const DELIVERY = { org: { on: true, label: SCHOOL, address: "100 Oak Hollow Dr, Richardson TX", note: "" }, pickup: { on: true, note: "" }, ship: { on: false, flat: 8 } };

async function logo(admin: SupabaseClient, storeId: string) {
  return upload(admin, `stores/${storeId}/logo.svg`, SAMPLE_ART.logo);
}

/** the open store to shop like a parent (made once; run again to refresh its pictures and products) */
async function openStore(admin: SupabaseClient, settings: Settings, customerId: string, art: Record<ArtKey, string>) {
  const { data: had } = await admin.from("merch_stores").select("*").eq("customer_id", customerId).eq("name", "Owls Spirit Shop").maybeSingle();
  let st = had as Store | null;
  const fresh = !st;
  if (!st) {
    const slug = await uniqueSlug(admin, "oak-hollow-spirit-shop");
    const { data, error } = await admin.from("merch_stores").insert({
      customer_id: customerId, name: "Owls Spirit Shop", slug, status: "open", opens_at: day(-6).toISOString(), closes_at: new Date(day(10).toISOString().slice(0, 10) + "T04:59:00Z").toISOString(), deliver_by: day(26).toISOString().slice(0, 10),
      brand: BRAND(""), welcome: "Show your Owl pride! Every shirt sends $5 (hoodies and crewnecks $6) back to the Oak Hollow PTA for field trips and new library books. Ordering for more than one Owl? Add them all at checkout and each gets their own bag.",
      delivery: DELIVERY, fields: FIELDS, giveback: { goal: 1500 }, tax_rate: 8.25, contact: CONTACT,
      settings: { expected: 96, notify: false }, owner: "staff", created_by: "sample", notes: "Sample store (test account). Shop it like a parent; staff can place test orders.",
      timeline: [{ status: "draft", at: day(-8).toISOString(), by: "sample", note: "created" }, { status: "open", at: day(-6).toISOString(), by: "sample" }],
    }).select("*").single();
    if (error) throw new Error(error.message);
    st = data as Store;
  }
  const lg = await logo(admin, st.id);
  await admin.from("merch_stores").update({ brand: BRAND(lg), contact: CONTACT, fields: FIELDS, updated_at: new Date().toISOString() }).eq("id", st.id);
  // products: rebuilt each run (the old ones are hidden, never deleted, so past orders keep their items)
  await admin.from("merch_products").update({ active: false }).eq("store_id", st.id);
  const made = await makeProducts(admin, settings, st, OPEN_PLAN, art);
  if (fresh) await makeOrders(admin, st, made, 64, 6, 11);
  return { slug: st.slug, products: made.map((m) => m.name) };
}

/** the closed Fall store (production job #…): new logo, pictures and art; orders and the job stay as they are */
async function refreshFall(admin: SupabaseClient, settings: Settings, customerId: string, art: Record<ArtKey, string>) {
  const { data: stores } = await admin.from("merch_stores").select("*").eq("customer_id", customerId).ilike("name", "Fall Spirit Wear%");
  const out: string[] = [];
  for (const st of (stores || []) as Store[]) {
    const lg = await logo(admin, st.id);
    await admin.from("merch_stores").update({ brand: BRAND(lg), contact: CONTACT, welcome: "Show your Owl pride! $5 from every shirt goes back to the Oak Hollow PTA.", updated_at: new Date().toISOString() }).eq("id", st.id);
    const { data: ps } = await admin.from("merch_products").select("id, name, style, brand, imprint").eq("store_id", st.id);
    for (const p of (ps || []) as { id: string; name: string; style: string; brand: string; imprint: { youth?: { style: string; brand: string } | null } }[]) {
      const plan = FALL_PLAN.find((x) => x.name === p.name);
      if (!plan) continue;
      const g = await garment(admin, p.style, p.brand || "Gildan");
      if (!g) continue;
      const y = p.imprint?.youth ? await garment(admin, p.imprint.youth.style, p.imprint.youth.brand || "Gildan") : null;
      const { data: cur } = await admin.from("merch_products").select("sizes").eq("id", p.id).single();
      const colors = await colorsFor(admin, st, plan, g, y, (cur?.sizes as string[]) || []);
      if (colors.length) await admin.from("merch_products").update({ colors, description: plan.description, design_id: art[plan.art] }).eq("id", p.id);
    }
    out.push(st.slug);
  }
  return out;
}

/** Build (or refresh) the Oak Hollow sample stores. */
export async function polishSampleStores(admin: SupabaseClient) {
  const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const settings = mergeSettings(s?.data);
  const cust = await school(admin);
  const art = await designs(admin, cust.id);
  const open = await openStore(admin, settings, cust.id, art);
  const fall = await refreshFall(admin, settings, cust.id, art);
  return { customer: cust.id, open, fall };
}

/** A second closed sample store whose orders become a production job (to see the schedule and receiving). */
export async function makeSampleStore(admin: SupabaseClient) {
  const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const settings = mergeSettings(s?.data);
  const cust = await school(admin);
  const art = await designs(admin, cust.id);
  const slug = await uniqueSlug(admin, "oak-hollow-spirit-wear");
  const { data: st0, error: se } = await admin.from("merch_stores").insert({
    customer_id: cust.id, name: "Fall Spirit Wear (Sample)", slug, status: "open", opens_at: day(-10).toISOString(), closes_at: day(-1).toISOString(), deliver_by: day(14).toISOString().slice(0, 10),
    brand: BRAND(""), welcome: "Show your Owl pride! $5 from every shirt goes back to the Oak Hollow PTA.", delivery: DELIVERY, fields: FIELDS, giveback: { goal: 1000 }, tax_rate: 8.25, contact: CONTACT,
    settings: { expected: 72, notify: false }, owner: "staff", created_by: "sample", notes: "Sample store (test account).",
    timeline: [{ status: "draft", at: day(-12).toISOString(), by: "sample", note: "created" }, { status: "open", at: day(-10).toISOString(), by: "sample" }],
  }).select("*").single();
  if (se) throw new Error(se.message);
  const st = st0 as Store;
  await admin.from("merch_stores").update({ brand: BRAND(await logo(admin, st.id)) }).eq("id", st.id);
  const made = await makeProducts(admin, settings, st, FALL_PLAN, art);
  await makeOrders(admin, st, made, 36, 9, 7);
  const timeline = [...st.timeline, { status: "closed", at: day(-1).toISOString(), by: "auto", note: "closed on schedule" }];
  await admin.from("merch_stores").update({ status: "closed", timeline }).eq("id", st.id);
  const jobId = await makeProductionJob({ admin, staff: true, email: "sample", customerIds: [], settings }, { ...st, status: "closed", timeline } as Store);
  const { data: job } = await admin.from("orders").select("number").eq("id", jobId).single();
  return { store: st.id, slug: st.slug, customer: cust.id, job: job?.number, products: made.map((m) => m.name) };
}
