import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readDst } from "@/lib/dst";
import type { Brand, Colorway, SewFile } from "@/lib/brands";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Peter's brands loaded once (Oct 27, Nick: "build the brand standards for Peter… MEI… and start ShipStation… 1743, and
 * then white"). Cedar Promos gets MEI (the five logos cut from MEI_REBRAND_LOGO_GUIDANCE.pdf, each with its colorways),
 * ShipStation / WWEX (one logo, sew file E1 from Printavo #33145's DST, named D{number}E1 for the Tajima) and Embark
 * (empty for now). Run from the database with the sync token; running it again adds nothing twice.
 */
const MEI_LOGOS: { slug: string; name: string; cws: [string, string, string[]][] }[] = [
  { slug: "primary", name: "MEI Primary (horizontal)", cws: [["Maroon / Black", "primary-maroon-black", ["PMS 492 C", "Black"]], ["Maroon / Off White", "primary-maroon-offwhite", ["PMS 492 C", "PMS Warm Gray 1 C"]], ["All Black", "primary-black", ["Black"]], ["All White", "primary-white", ["White"]]] },
  { slug: "stacked", name: "MEI Secondary (stacked)", cws: [["Maroon / Black", "stacked-maroon-black", ["PMS 492 C", "Black"]], ["Maroon / Off White", "stacked-maroon-offwhite", ["PMS 492 C", "PMS Warm Gray 1 C"]], ["All Black", "stacked-black", ["Black"]], ["All White", "stacked-white", ["White"]]] },
  { slug: "icon", name: "MEI Icon only", cws: [["Maroon", "icon-maroon", ["PMS 492 C"]], ["White", "icon-white", ["White"]], ["Black", "icon-black", ["Black"]]] },
  { slug: "smm", name: "MEI SMM (horizontal)", cws: [["Maroon / Black", "smm-maroon-black", ["PMS 492 C", "Black"]], ["Maroon / Off White", "smm-maroon-offwhite", ["PMS 492 C", "PMS Warm Gray 1 C"]], ["All Black", "smm-black", ["Black"]], ["All White", "smm-white", ["White"]]] },
  { slug: "smmstack", name: "MEI SMM (stacked)", cws: [["Maroon / Black", "smmstack-maroon-black", ["PMS 492 C", "Black"]], ["Maroon / Off White", "smmstack-maroon-offwhite", ["PMS 492 C", "PMS Warm Gray 1 C"]], ["All Black", "smmstack-black", ["Black"]], ["All White", "smmstack-white", ["White"]]] },
];
const SHIP_DST = "printavo/048dab17-ede6-449f-bb3e-38663d03824e/mumpp4wx2-SHIPSTATION_GLOBAL-1.DST";
const SHIP_EMB = "printavo/048dab17-ede6-449f-bb3e-38663d03824e/mumpp54d3-SHIPSTATION_GLOBAL-1.EMB";
const SHIP_PDF = "printavo/048dab17-ede6-449f-bb3e-38663d03824e/mumpp5cz4-SHIPSTATION_GLOBAL-1.pdf";

const pngSize = (b: Uint8Array) => ({ w: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], h: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] });

export async function POST(req: Request) {
  const admin = createAdminClient();
  const { data: s } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (!s || req.headers.get("x-sync-token") !== s.token) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { customer_id?: string; only?: "mei" | "ship" };
  const cid = String(b.customer_id || "");
  if (!cid) return NextResponse.json({ error: "Which customer?" }, { status: 400 });
  const origin = new URL(req.url).origin;
  const log: string[] = [];
  const get = async (p: string) => { const r = await fetch(`${origin}/seed/brands/${p}`); if (!r.ok) throw new Error(`${p}: ${r.status}`); return new Uint8Array(await r.arrayBuffer()); };
  const put = async (path: string, body: Uint8Array, type: string) => { const u = await admin.storage.from("proofs").upload(path, Buffer.from(body), { contentType: type, upsert: true }); if (u.error) throw new Error(`${path}: ${u.error.message}`); return path; };

  async function brand(name: string, row: Partial<Brand>, sort: number): Promise<string> {
    const { data: have } = await admin.from("brands").select("id").eq("customer_id", cid).eq("name", name).is("archived_at", null).maybeSingle();
    if (have) { log.push(`${name}: already there`); return have.id as string; }
    const { data, error } = await admin.from("brands").insert({ customer_id: cid, name, sort, colors: row.colors || [], rules: row.rules || {}, embroidery: row.embroidery || {}, notes: row.notes || "" }).select("id").single();
    if (error) throw new Error(error.message);
    log.push(`${name}: made`);
    return data.id as string;
  }
  const exists = async (brandId: string, name: string) => !!(await admin.from("designs").select("id").eq("brand_id", brandId).eq("name", name).is("archived_at", null).maybeSingle()).data;

  try {
    const mei = await brand("MEI", {
      colors: [{ name: "Maroon", pms: "PMS 492 C", hex: "#8B2E35" }, { name: "Off White", pms: "PMS Warm Gray 1 C", hex: "#FAF6EC" }, { name: "Black", hex: "#101821" }, { name: "White", hex: "#FFFFFF" }],
      rules: { light: "Maroon / Black", dark: "Maroon / Off White", one_light: "All Black", one_dark: "All White" },
      notes: "From MEI_REBRAND_LOGO_GUIDANCE.pdf (Cedar Promo). The icon also comes in Dunkel Orange and A&A Red, named in the guide with no art yet: ask Peter.",
    }, 1);
    const ship = await brand("ShipStation / WWEX", {
      colors: [{ name: "Oxford Blue", hex: "#2F375C", thread: "Madeira 1743 Oxford Blue" }, { name: "White", hex: "#FFFFFF", thread: "Madeira 1801 Super White" }],
      rules: { light: "Oxford Blue", dark: "White" },
      embroidery: { light: ["Madeira 1743 Oxford Blue"], dark: ["Madeira 1801 Super White"] },
      notes: "Polo left chest: SHIPSTATION GLOBAL-1 (3.24\" × 0.80\", 2,645 stitches). Oxford Blue on light goods, Super White on dark.",
    }, 2);
    await brand("Embark", {}, 3);

    if (b.only !== "ship") for (const L of MEI_LOGOS) {
      if (await exists(mei, L.name)) { log.push(`${L.name}: already there`); continue; }
      const key = crypto.randomUUID();
      const main = L.cws[0][1];
      const file = await put(`designs/${key}/${main}.pdf`, await get(`mei/${main}.pdf`), "application/pdf");
      const colorways: Colorway[] = [];
      let size = { w: 0, h: 0 };
      for (const [name, slug, inks] of L.cws) {
        const png = await get(`mei/${slug}.png`);
        if (slug === main) size = pngSize(png);
        colorways.push({ name, inks, preview: await put(`designs/${key}/${slug}.png`, png, "image/png") });
      }
      const { error } = await admin.from("designs").insert({ saved: true,
        customer_id: cid, brand_id: mei, name: L.name, file_path: file, file_name: `${main}.pdf`, file_type: "application/pdf",
        preview_path: colorways[0].preview, width_px: size.w || null, height_px: size.h || null, method: "screen",
        colors: colorways[0].inks.length, inks: colorways[0].inks.join(", "), notes: "", created_by: "Brand standards (MEI guide)", draft: false,
        specs: { colorways },
      });
      if (error) throw new Error(`${L.name}: ${error.message}`);
      log.push(`${L.name}: added with ${colorways.length} colorways`);
    }

    if (b.only !== "mei") {
      const NAME = "ShipStation Global";
      if (await exists(ship, NAME)) log.push(`${NAME}: already there`);
      else {
        const key = crypto.randomUUID();
        const light = await get("ship/ship-light.png"), dark = await get("ship/ship-dark.png");
        const pl = await put(`designs/${key}/shipstation-oxford-blue.png`, light, "image/png");
        const pd = await put(`designs/${key}/shipstation-white.png`, dark, "image/png");
        const sz = pngSize(light);
        const { data: d, error } = await admin.from("designs").insert({ saved: true,
          customer_id: cid, brand_id: ship, name: NAME, file_path: pl, file_name: "shipstation-oxford-blue.png", file_type: "image/png",
          preview_path: pl, width_px: sz.w || null, height_px: sz.h || null, method: "embroidery", colors: 1, inks: "Madeira 1743 Oxford Blue",
          notes: "", created_by: "Brand standards (ShipStation)", draft: false,
          specs: { colorways: [{ name: "Oxford Blue", inks: ["Madeira 1743 Oxford Blue"], preview: pl }, { name: "White", inks: ["Madeira 1801 Super White"], preview: pd }] },
        }).select("id, number, specs").single();
        if (error || !d) throw new Error(`${NAME}: ${error?.message}`);
        // the sew file, named for the Tajima: D{number}E1 in the file name and the DST's LA header
        const code = `D${d.number}E1`;
        const { data: dst } = await admin.storage.from("proofs").download(SHIP_DST);
        if (!dst) throw new Error("The ShipStation DST isn't in storage.");
        const buf = new Uint8Array(await dst.arrayBuffer());
        const info = readDst(buf.buffer.slice(0));
        const la = new TextEncoder().encode(code.padEnd(16, " ").slice(0, 16));
        if (String.fromCharCode(buf[0], buf[1], buf[2]) === "LA:") buf.set(la, 3);
        const dir = `embroidery/${d.id}/${Date.now()}`;
        const pDst = await put(`${dir}-${code}.DST`, buf, "application/octet-stream");
        const cp = async (from: string, to: string, type: string) => { const { data: x } = await admin.storage.from("proofs").download(from); return x ? put(to, new Uint8Array(await x.arrayBuffer()), type) : null; };
        const pEmb = await cp(SHIP_EMB, `${dir}-${code}.EMB`, "application/octet-stream");
        const pPdf = await cp(SHIP_PDF, `${dir}-${code} worksheet.pdf`, "application/pdf");
        const sew: SewFile = {
          code: "E1", kind: "flat", placement: "Left chest (polo)", path: pDst, name: `${code}.DST`, stitches: info.stitches, colors: 1, wIn: info.wIn, hIn: info.hIn,
          at: new Date().toISOString(), ...(pEmb ? { emb: { path: pEmb, name: `${code}.EMB` } } : {}), ...(pPdf ? { sheet: { path: pPdf, name: `${code} worksheet.pdf` } } : {}),
          threads: { light: ["Madeira 1743 Oxford Blue"], dark: ["Madeira 1801 Super White"] },
        };
        await admin.from("designs").update({ specs: { ...((d.specs || {}) as object), embroidery: { files: [sew] } } }).eq("id", d.id);
        log.push(`${NAME}: added as D-${d.number}, sew file ${code} (${info.wIn}" × ${info.hIn}", ${info.stitches} stitches)`);
      }
    }
    return NextResponse.json({ ok: true, log });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), log }, { status: 500 });
  }
}
