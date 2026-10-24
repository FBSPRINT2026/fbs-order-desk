import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildCatalog, type AiReview, type CatalogRules } from "@/lib/designCatalog";
import { safeUrl } from "@/lib/safeUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A customer's designs catalog (lib/designCatalog.ts): GET ?customer=<id>. POST changes how it's grouped:
 *  { customer, op: "rename", key, name } · { op: "merge", key, into } · { op: "move", ref, into } (a job to another
 *  design; into "" = not a design) · { op: "hide" | "show", key } · { op: "reset", key } (undo staff's changes to it).
 * The AI review's answers (app/api/designs/ai): { op: "review", review } saves the suggestions; { op: "mergeMany", keys,
 *  into, name, sig } · { op: "split", key, groups: [{ name, refs }], sig } apply one; { op: "aiNo", sig, text } turns one down.
 */
export async function GET(req: Request) {
  const v = await getViewer();
  const sp = new URL(req.url).searchParams, cid = sp.get("customer") || "";
  if (!cid) return NextResponse.json({ error: "Which customer?" }, { status: 400 });
  // the customer themselves, read-only, when staff turned it on for their portal (Oct 24, Nick: Dear Hearts); their own
  // account only (row security), and only the designs: no staff grouping notes, deleted groupings or loose orders
  if (v.user && !v.isStaff) {
    const { data: me } = await v.supabase.from("customers").select("id, design_catalog, design_catalog_portal").eq("id", cid).maybeSingle();
    if (!me || !me.design_catalog || !me.design_catalog_portal || sp.get("site")) return NextResponse.json({ error: "Not available." }, { status: 403 });
    try {
      const c = await buildCatalog(createAdminClient(), cid);
      return NextResponse.json({ ...c, rules: { names: {}, merge: {}, jobs: {}, hidden: [] }, hidden: [], other: [], designs: c.designs.map((d) => ({ ...d, pics: [] })) });
    } catch { return NextResponse.json({ error: "Couldn't load your designs." }, { status: 500 }); }
  }
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
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
  const b = (await req.json().catch(() => ({}))) as { customer?: string; op?: string; key?: string; name?: string; into?: string; ref?: string; data?: string; src?: string; site?: string;
    keys?: string[]; groups?: { name?: string; refs?: string[] }[]; sig?: string; text?: string; review?: AiReview };
  const cid = String(b.customer || "");
  if (!cid) return NextResponse.json({ error: "Which customer?" }, { status: 400 });
  const admin = createAdminClient();
  const { data: row } = await admin.from("customer_designs").select("rules").eq("customer_id", cid).maybeSingle();
  const r: CatalogRules = { names: {}, merge: {}, jobs: {}, hidden: [], ...((row?.rules || {}) as CatalogRules) };
  const key = String(b.key || "").slice(0, 200), into = String(b.into ?? "").slice(0, 200);
  const sig = String(b.sig || "").slice(0, 4000);
  /** a suggestion answered (applied or turned down) leaves the review */
  const answered = () => { if (r.review && sig) r.review = { ...r.review, merges: r.review.merges.filter((m) => m.sig !== sig), splits: r.review.splits.filter((x) => x.sig !== sig) }; };
  switch (b.op) {
    case "review": {
      const rv = b.review;
      if (!rv || !Array.isArray(rv.merges) || !Array.isArray(rv.splits)) return NextResponse.json({ error: "No review to save." }, { status: 400 });
      const saved: AiReview = { at: new Date().toISOString(), by: v.email || "", merges: rv.merges.slice(0, 200), splits: rv.splits.slice(0, 200) };
      if (JSON.stringify(saved).length > 400_000) return NextResponse.json({ error: "That review is too big to save." }, { status: 400 });
      r.review = saved; break;
    }
    case "mergeMany": {
      // the AI's "same design": every key into `into`, under the name staff kept
      const ks = (Array.isArray(b.keys) ? b.keys : []).map((k) => String(k).slice(0, 200)).filter(Boolean);
      if (!into || ks.length < 2 || !ks.includes(into)) return NextResponse.json({ error: "Which designs?" }, { status: 400 });
      for (const k of ks) if (k !== into) r.merge![k] = into;
      if (r.merge![into] && ks.includes(r.merge![into])) delete r.merge![into]; // never a loop
      if ((b.name || "").trim()) r.names![into] = String(b.name).trim().slice(0, 120);
      answered(); break;
    }
    case "split": {
      // the AI's "these are different designs": the biggest group stays the design, each other group becomes its own
      // (a new key; its orders moved to it by hand, so they stay there)
      const gs = (Array.isArray(b.groups) ? b.groups : []).map((g) => ({ name: String(g.name || "").trim().slice(0, 120), refs: (Array.isArray(g.refs) ? g.refs : []).map((x) => String(x).slice(0, 160)).filter(Boolean) })).filter((g) => g.refs.length);
      if (!key || gs.length < 2) return NextResponse.json({ error: "Nothing to split." }, { status: 400 });
      const stay = gs.reduce((a, g) => (g.refs.length > a.refs.length ? g : a), gs[0]);
      if (stay.name) r.names![key] = stay.name;
      gs.filter((g) => g !== stay).forEach((g, i) => {
        const nk = `d${Date.now().toString(36)}${i}`;
        for (const ref of g.refs) r.jobs![ref] = nk;
        r.names![nk] = g.name || "New design";
      });
      // its own orders that were moved here by hand stay with the group the AI put them in
      for (const ref of stay.refs) if (r.jobs![ref] && r.jobs![ref] !== key) r.jobs![ref] = key;
      answered(); break;
    }
    case "aiNo": {
      if (!sig) break;
      r.aiNo = [...(r.aiNo || []).filter((x) => x.sig !== sig), { sig, text: String(b.text || "").slice(0, 600) }].slice(-300);
      answered(); break;
    }
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
