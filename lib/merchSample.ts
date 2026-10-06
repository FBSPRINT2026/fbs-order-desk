import "server-only";
import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeSettings, type Garment } from "@/lib/pricing";
import { ssLookup, ssConfigured } from "@/lib/ss";
import { defaultUpcharges, makeProductionJob, suggestBasePrice, uniqueSlug } from "@/lib/merchServer";
import { orderTotals, r2, type Field, type ProductColor, type Store } from "@/lib/merch";

/**
 * A sample merch store on a test school ("Oak Hollow Elementary PTA"), so the whole flow can be seen end to end:
 * two pieces of sample art, a tee and a hoodie (adult + youth blanks from S&S) with mockups, 36 sample orders,
 * then the store is closed and turned into a production job (it shows in Ready To Schedule and in Goods & Receiving).
 * Everything is on a test account; the orders are "Test (no charge)".
 */
const SCHOOL = "Oak Hollow Elementary", CUSTOMER = "Oak Hollow Elementary PTA";
const GREEN = "#1F4D3A", GOLD = "#E3B23C";
const TEACHERS = ["Mrs. Alvarez", "Mr. Bennett", "Ms. Chen", "Mrs. Dawson", "Mr. Ellis", "Ms. Foster", "Mrs. Garcia", "Mr. Hughes"];
const GRADES = ["K", "1st", "2nd", "3rd", "4th", "5th", "Staff"];
const FIRST = ["Ava", "Liam", "Mia", "Noah", "Zoe", "Eli", "Isla", "Owen", "Ruby", "Leo", "Nora", "Jack", "Lucy", "Theo", "Ella", "Max", "Hazel", "Gabe", "Ivy", "Sam", "Lila", "Ben", "Maya", "Finn", "Jade", "Cole", "Aria", "Luke", "Rose", "Wes", "Cora", "Jude", "Tess", "Ezra", "June", "Reid"];
const LAST = ["Patel", "Nguyen", "Brooks", "Kim", "Rivera", "Okafor", "Lopez", "Schmidt", "Hart", "Silva", "Bauer", "Reyes", "Turner", "Price", "Ward", "Cruz", "Ellis", "Moss"];

/** typographic sample art (an arched school name over a big mascot word), as SVG */
function artSvg(kind: "crest" | "mono") {
  if (kind === "crest") return { w: 1200, h: 900, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900" width="1200" height="900"><defs><path id="a" d="M140 520 A460 460 0 0 1 1060 520"/></defs><text font-family="Georgia, serif" font-weight="700" font-size="118" letter-spacing="8" fill="#ffffff" text-anchor="middle"><textPath href="#a" startOffset="50%">OAK HOLLOW</textPath></text><text x="600" y="690" font-family="Impact, 'Arial Black', sans-serif" font-size="300" fill="${GOLD}" text-anchor="middle" stroke="#ffffff" stroke-width="10" paint-order="stroke">OWLS</text><text x="600" y="830" font-family="Georgia, serif" font-size="70" letter-spacing="14" fill="#ffffff" text-anchor="middle">ELEMENTARY</text></svg>` };
  return { w: 900, h: 900, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900" width="900" height="900"><circle cx="450" cy="450" r="420" fill="none" stroke="${GOLD}" stroke-width="34"/><circle cx="450" cy="450" r="350" fill="none" stroke="#ffffff" stroke-width="10"/><text x="450" y="560" font-family="Georgia, serif" font-weight="700" font-size="330" fill="#ffffff" text-anchor="middle">OH</text><text x="450" y="700" font-family="Georgia, serif" font-size="62" letter-spacing="12" fill="${GOLD}" text-anchor="middle">EST. 1998</text></svg>` };
}

async function garment(admin: SupabaseClient, style: string): Promise<Garment | null> {
  const { data: have } = await admin.from("garments").select("*").eq("supplier", "ss").ilike("style", style).limit(1);
  if (have?.[0] && (have[0] as Garment).color_images && Object.keys((have[0] as Garment).color_images || {}).length) return have[0] as Garment;
  if (!ssConfigured()) return (have?.[0] as Garment) || null;
  const g = await ssLookup(style).catch(() => null);
  if (!g) return (have?.[0] as Garment) || null;
  const row = { ...g, supplier: "ss", synced_at: new Date().toISOString() };
  const res = have?.[0] ? await admin.from("garments").update(row).eq("id", have[0].id).select("*").single() : await admin.from("garments").insert(row).select("*").single();
  return (res.data as Garment) || null;
}
const pickColor = (g: Garment, want: string) => (g.colors || []).find((c) => c.toLowerCase() === want.toLowerCase()) || (g.colors || []).find((c) => c.toLowerCase().includes(want.toLowerCase().split(" ")[0])) || "";

/** a mockup as an SVG: the blank's photo with the art on the chest (both embedded, so it works as a plain picture) */
async function mockupSvg(photoPath: string, art: { svg: string; w: number; h: number }) {
  const url = /^https?:/.test(photoPath) ? photoPath : `https://www.ssactivewear.com/${photoPath.replace(/^\//, "")}`;
  const r = await fetch(url).catch(() => null);
  if (!r || !r.ok) return null;
  const photo = Buffer.from(await r.arrayBuffer()).toString("base64");
  const type = r.headers.get("content-type") || "image/jpeg";
  const W = 1000, H = 1250, aw = 360, ah = (aw * art.h) / art.w;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/><image href="data:${type};base64,${photo}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid meet"/><image href="data:image/svg+xml;base64,${Buffer.from(art.svg).toString("base64")}" x="${(W - aw) / 2}" y="300" width="${aw}" height="${ah}"/></svg>`;
}

export async function makeSampleStore(admin: SupabaseClient) {
  const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const settings = mergeSettings(s?.data);
  // the test school
  let { data: cust } = await admin.from("customers").select("*").eq("company", CUSTOMER).maybeSingle();
  if (!cust) {
    const { data, error } = await admin.from("customers").insert({ company: CUSTOMER, name: "Sample PTA President", email: "oakhollowpta@example.com", phone: "", is_test: true, merch_client: true, price_type: "retail", notes: "Test account for the sample merch store." }).select("*").single();
    if (error) throw new Error(error.message);
    cust = data;
  } else await admin.from("customers").update({ is_test: true, merch_client: true }).eq("id", cust.id);

  // sample art, saved as the school's designs
  const designs: { id: string; art: { svg: string; w: number; h: number } }[] = [];
  for (const [kind, name] of [["crest", "Owls crest (white + gold)"], ["mono", "OH monogram badge"]] as const) {
    const art = artSvg(kind);
    const { data: had } = await admin.from("designs").select("id").eq("customer_id", cust.id).eq("name", name).maybeSingle();
    if (had) { designs.push({ id: had.id, art }); continue; }
    const path = `designs/${crypto.randomUUID()}/${kind}.svg`;
    const up = await admin.storage.from("proofs").upload(path, Buffer.from(art.svg), { contentType: "image/svg+xml" });
    if (up.error) throw new Error(up.error.message);
    const { data: d, error } = await admin.from("designs").insert({ customer_id: cust.id, name, file_path: path, file_name: `${kind}.svg`, file_type: "image/svg+xml", preview_path: path, width_px: art.w, height_px: art.h, method: "screen", colors: 2, inks: "White, Gold", created_by: "sample" }).select("id").single();
    if (error) throw new Error(error.message);
    designs.push({ id: d.id, art });
  }

  // the store
  const fields: Field[] = [
    { key: "student", label: "Student name", kind: "text", options: [], required: true, sort: 2 },
    { key: "grade", label: "Grade", kind: "select", options: GRADES, required: true, sort: 0 },
    { key: "teacher", label: "Homeroom teacher", kind: "select", options: TEACHERS, required: true, sort: 1 },
  ];
  const day = (n: number) => new Date(Date.now() + n * 86400000);
  const slug = await uniqueSlug(admin, "oak-hollow-spirit-wear");
  const { data: st0, error: se } = await admin.from("merch_stores").insert({
    customer_id: cust.id, name: "Fall Spirit Wear (Sample)", slug, status: "open", opens_at: day(-10).toISOString(), closes_at: day(-1).toISOString(), deliver_by: day(14).toISOString().slice(0, 10),
    brand: { school: SCHOOL, tagline: "Home of the Owls", primary: GREEN, accent: GOLD }, welcome: "Show your Owl pride! $5 from every shirt goes back to the Oak Hollow PTA.",
    delivery: { org: { on: true, label: SCHOOL, address: "100 Oak Hollow Dr, Richardson TX", note: "" }, pickup: { on: true, note: "" }, ship: { on: false, flat: 8 } },
    fields, giveback: { goal: 1000 }, tax_rate: 8.25, contact: { name: "Sample PTA President", email: "oakhollowpta@example.com", phone: "" },
    settings: { expected: 72, notify: false }, owner: "staff", created_by: "sample", notes: "Sample store (test account).",
    timeline: [{ status: "draft", at: day(-12).toISOString(), by: "sample", note: "created" }, { status: "open", at: day(-10).toISOString(), by: "sample" }],
  }).select("*").single();
  if (se) throw new Error(se.message);
  const st = st0 as Store;

  // products: a tee and a hoodie (adult + youth), with mockups
  const plan = [
    { name: "Owls Spirit Tee", adult: "5000", youth: "5000B", colors: ["Forest Green", "Black", "Sport Grey"], design: 0, give: 5, loc: "Full Front", width: 10 },
    { name: "Owls Hoodie", adult: "18500", youth: "18500B", colors: ["Forest Green", "Black"], design: 1, give: 6, loc: "Full Front", width: 9 },
  ];
  const made: { id: string; name: string; adult: Garment; youth: Garment | null; colors: string[]; sizes: string[]; base: number; give: number; ups: Record<string, number> }[] = [];
  for (const [i, p] of plan.entries()) {
    const g = await garment(admin, p.adult);
    if (!g) throw new Error(`Couldn't load S&S style ${p.adult}.`);
    const y = await garment(admin, p.youth);
    const colors = p.colors.map((c) => pickColor(g, c)).filter(Boolean);
    const ys = (y?.sizes || []).filter((z) => /^Y/.test(z));
    const sizes = [...ys, ...(g.sizes || []).filter((z) => ["S", "M", "L", "XL", "2XL", "3XL"].includes(z))];
    const pcolors: ProductColor[] = [];
    for (const c of colors) {
      const ci = g.color_images?.[c];
      let image = "";
      if (ci?.front) {
        const svg = await mockupSvg(ci.front, designs[p.design].art);
        if (svg) { const path = `stores/${st.id}/mockup-${crypto.randomUUID().slice(0, 12)}.svg`; const up = await admin.storage.from("proofs").upload(path, Buffer.from(svg), { contentType: "image/svg+xml" }); if (!up.error) image = path; }
      }
      const ycolor = y ? pickColor(y, c) : "";
      pcolors.push({ name: c, hex: ci?.hex || "#999999", image, photo: ci?.front ? `/api/ss/img?p=${encodeURIComponent(ci.front.replace(/^https?:\/\/[^/]+\//, ""))}` : "", sizes: sizes.filter((z) => !/^Y/.test(z) || !!ycolor) });
    }
    const base = suggestBasePrice(settings, { cost: +(g.size_costs?.M || g.cost || 3), color: colors[0], method: "screen", colors: 2, expected: 72 });
    const ups = defaultUpcharges(settings, sizes);
    const { data: prod, error } = await admin.from("merch_products").insert({
      store_id: st.id, position: i, name: p.name, description: i ? "Heavy blend hooded sweatshirt." : "Classic heavy cotton tee.", design_id: designs[p.design].id,
      imprint: { location: p.loc, width: p.width, colors: 2, method: "screen", inks: "White, Gold", youth: y ? { supplier: "ss", style: y.style, brand: y.brand, garment_id: y.id, sizes: ys, cost: y.size_costs || {} } : null },
      supplier: "ss", style: g.style, brand: g.brand, garment_id: g.id, colors: pcolors, sizes, cost: g.size_costs || {}, base_price: base, giveback: p.give, upcharges: ups, personalize: [], active: true,
    }).select("id").single();
    if (error) throw new Error(error.message);
    made.push({ id: prod.id, name: p.name, adult: g, youth: y, colors, sizes, base, give: p.give, ups });
  }

  // 36 sample orders: one bag per student, sorted for hand-out later
  let rnd = 7;
  const rand = (n: number) => { rnd = (rnd * 9301 + 49297) % 233280; return Math.floor((rnd / 233280) * n); };
  for (let i = 0; i < 36; i++) {
    const student = `${FIRST[i]} ${LAST[rand(LAST.length)]}`;
    const grade = GRADES[rand(6)], teacher = TEACHERS[rand(TEACHERS.length)];
    const n = 1 + rand(3) % 2 + (rand(5) === 0 ? 1 : 0);
    const items = Array.from({ length: n }, (_, k) => {
      const p = made[k === 0 ? 0 : rand(2)];
      const color = p.colors[rand(p.colors.length)];
      const youthPick = grade !== "Staff" && rand(10) < 8 && p.youth;
      const pool = p.sizes.filter((z) => (youthPick ? /^Y/.test(z) : !/^Y/.test(z) && !/^[3-5]XL$/.test(z)));
      const size = pool[rand(pool.length)] || "M";
      const up = +(p.ups[size] || 0);
      return { product_id: p.id, name: p.name, style: /^Y/.test(size) && p.youth ? p.youth.style : p.adult.style, color, size, qty: 1, unit_price: r2(p.base + p.give + up), base_price: r2(p.base + up), giveback: p.give, personalization: {} };
    });
    const t = orderTotals(items, { taxRate: 8.25, taxExempt: false, shipping: 0 });
    const parent = `${["Jen", "Mike", "Sara", "Dan", "Priya", "Luis", "Kate", "Tom"][rand(8)]} ${student.split(" ")[1]}`;
    const { data: num } = await admin.rpc("merch_next_number", { p_store: st.id });
    const { data: o, error } = await admin.from("merch_orders").insert({
      store_id: st.id, number: num as number, token: randomBytes(16).toString("hex"), shopper: { name: parent, email: `sample+${i + 1}@example.com` }, answers: { student, grade, teacher },
      delivery: rand(9) === 0 ? "pickup" : "org", subtotal: t.subtotal, tax: t.tax, shipping: 0, total: t.total, giveback: t.giveback, status: "paid",
      paid_at: day(-9 + (i % 9)).toISOString(), pay_method: "Test (no charge)", created_at: day(-9 + (i % 9)).toISOString(),
    }).select("id").single();
    if (error) throw new Error(error.message);
    await admin.from("merch_order_items").insert(items.map((it) => ({ ...it, order_id: o.id })));
  }

  // the store closed yesterday: close it and make the production job
  const closed = { ...st, status: "closed" as const, timeline: [...st.timeline, { status: "closed", at: day(-1).toISOString(), by: "auto", note: "closed on schedule" }] };
  await admin.from("merch_stores").update({ status: "closed", timeline: closed.timeline }).eq("id", st.id);
  const jobId = await makeProductionJob({ admin, staff: true, email: "sample", customerIds: [], settings }, closed as Store);
  const { data: job } = await admin.from("orders").select("number").eq("id", jobId).single();
  return { store: st.id, slug: st.slug, customer: cust.id, job: job?.number, products: made.map((m) => m.name) };
}
