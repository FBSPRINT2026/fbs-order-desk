import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildCatalog, type CatalogRules } from "@/lib/designCatalog";
import { safeUrl } from "@/lib/safeUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A customer's designs catalog (lib/designCatalog.ts): GET ?customer=<id>. POST changes how it's grouped:
 *  { customer, op: "rename", key, name } · { op: "merge", key, into } · { op: "move", ref, into } (a job to another
 *  design; into "" = not a design) · { op: "hide" | "show", key } · { op: "reset", key } (undo staff's changes to it).
 */
export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const sp = new URL(req.url).searchParams, cid = sp.get("customer") || "";
  if (!cid) return NextResponse.json({ error: "Which customer?" }, { status: 400 });
  // just their website (the customer's settings): the one saved, and the one their email suggests
  if (sp.get("site")) {
    const admin = createAdminClient();
    const [{ data: c }, { data: row }] = await Promise.all([
      admin.from("customers").select("email, contact2_email").eq("id", cid).maybeSingle(),
      admin.from("customer_designs").select("rules").eq("customer_id", cid).maybeSingle(),
    ]);
    const FREE = /^(gmail|yahoo|hotmail|outlook|icloud|aol|live|msn|me|comcast|att|sbcglobal|ymail|proton|protonmail)\./i;
    const dom = [c?.email, c?.contact2_email].map((e) => String(e || "").split("@")[1] || "").find((d) => d && !FREE.test(d)) || "";
    return NextResponse.json({ site: ((row?.rules || {}) as { site?: string }).site || "", guess: dom ? `https://www.${dom.replace(/^www\./, "")}` : "" });
  }
  try { return NextResponse.json(await buildCatalog(createAdminClient(), cid)); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { customer?: string; op?: string; key?: string; name?: string; into?: string; ref?: string; data?: string; src?: string; site?: string };
  const cid = String(b.customer || "");
  if (!cid) return NextResponse.json({ error: "Which customer?" }, { status: 400 });
  const admin = createAdminClient();
  const { data: row } = await admin.from("customer_designs").select("rules").eq("customer_id", cid).maybeSingle();
  const r: CatalogRules = { names: {}, merge: {}, jobs: {}, hidden: [], ...((row?.rules || {}) as CatalogRules) };
  const key = String(b.key || "").slice(0, 200), into = String(b.into ?? "").slice(0, 200);
  switch (b.op) {
    case "rename": if (!key) break; if ((b.name || "").trim()) r.names![key] = String(b.name).trim().slice(0, 120); else delete r.names![key]; break;
    case "merge": if (!key || !into || key === into) break; r.merge![key] = into; break;
    case "move": if (!b.ref) break; r.jobs![String(b.ref).slice(0, 120)] = into; break;
    case "hide": if (key && !r.hidden!.includes(key)) r.hidden!.push(key); break;
    case "show": r.hidden = r.hidden!.filter((k) => k !== key); break;
    case "cover": {
      // the cover picked in the browser (a JPEG of the best mockup), or "none of them would do"; answered without
      // rebuilding the catalog (it takes seconds)
      if (!key) return NextResponse.json({ error: "Which design?" }, { status: 400 });
      let path = "-";
      let pic: { buf: Buffer; type: string } | null = null;
      const m = /^data:image\/jpeg;base64,(.+)$/.exec(String(b.data || ""));
      if (m) pic = { buf: Buffer.from(m[1], "base64"), type: "image/jpeg" };
      else if (b.src) {
        // a picture on the customer's website (Find on their website): copied here so it stays
        const u = safeUrl(String(b.src));
        if (!u) return NextResponse.json({ error: "That picture's address isn't usable." }, { status: 400 });
        const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 12000);
        const res = await fetch(u.href, { signal: ac.signal }).catch(() => null); clearTimeout(t);
        const type = (res?.headers.get("content-type") || "").split(";")[0];
        if (!res?.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return NextResponse.json({ error: "That picture couldn't be copied from their site." }, { status: 400 });
        pic = { buf: Buffer.from(await res.arrayBuffer()), type };
      }
      if (pic) {
        if (pic.buf.length > 8_000_000) return NextResponse.json({ error: "That picture is too big." }, { status: 400 });
        const ext = pic.type === "image/png" ? "png" : pic.type === "image/webp" ? "webp" : pic.type === "image/gif" ? "gif" : "jpg";
        path = `designs/${cid}/${key.replace(/[^a-z0-9]+/g, "-").slice(0, 60)}-${Date.now()}.${ext}`;
        const up = await admin.storage.from("proofs").upload(path, pic.buf, { contentType: pic.type, upsert: true });
        if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
      }
      // read again just before saving: several covers are saved one after another
      const { data: now } = await admin.from("customer_designs").select("rules").eq("customer_id", cid).maybeSingle();
      const r2: CatalogRules = { ...((now?.rules || {}) as CatalogRules) };
      r2.covers = { ...(r2.covers || {}), [key]: path };
      const { error } = await admin.from("customer_designs").upsert({ customer_id: cid, rules: r2, updated_at: new Date().toISOString(), updated_by: v.email || "" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const { data: su } = path === "-" ? { data: null } : await admin.storage.from("proofs").createSignedUrl(path, 3600);
      return NextResponse.json({ ok: true, url: su?.signedUrl || "" });
    }
    case "site": {
      // the customer's website, for Find on their website
      const u = b.site ? safeUrl(String(b.site).match(/^https?:/i) ? String(b.site) : `https://${b.site}`) : null;
      const { data: now } = await admin.from("customer_designs").select("rules").eq("customer_id", cid).maybeSingle();
      const r2 = { ...((now?.rules || {}) as CatalogRules & { site?: string }) };
      if (u) r2.site = u.origin; else delete r2.site;
      const { error } = await admin.from("customer_designs").upsert({ customer_id: cid, rules: r2, updated_at: new Date().toISOString(), updated_by: v.email || "" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, site: r2.site || "" });
    }
    case "reset": if (r.covers) delete r.covers[key]; delete r.names![key]; delete r.merge![key]; for (const [k, t] of Object.entries(r.merge!)) if (t === key) delete r.merge![k]; r.hidden = r.hidden!.filter((k) => k !== key); break;
    default: return NextResponse.json({ error: "What change?" }, { status: 400 });
  }
  const { error } = await admin.from("customer_designs").upsert({ customer_id: cid, rules: r, updated_at: new Date().toISOString(), updated_by: v.email || "" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(await buildCatalog(admin, cid));
}
