"use server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { newGroup } from "@/lib/pricing";

/**
 * The website's "Tell us what you need" form (app/site; Nov 5, Nick: "a basic contact us form that goes into… customer
 * request"). Anyone can send it, so: a hidden field and a minimum time catch bots, and each address and email can send a
 * few an hour. It finds the customer by email (any of an account's people) or adds them, makes an order request with
 * its number like one sent from the portal, puts what they wrote and their files on the order's messages, and tells the
 * shop (lib/shopNotice.ts).
 */
export type SiteReq = {
  name: string; company: string; email: string; phone: string; needs: string[]; qty: string; by: string; details: string;
  files: { path: string; name: string; mime: string; size: number }[];
  /** bots fill this */ website?: string; /** when the form was opened (ms) */ t0: number;
};
const fail = (error: string) => ({ ok: false as const, error });
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

async function ipOf() { const h = await headers(); return (h.get("x-forwarded-for") || h.get("x-real-ip") || "").split(",")[0].trim().slice(0, 64); }
/** too many from this address or email in the last hour */
async function tooMany(admin: ReturnType<typeof createAdminClient>, ip: string, email: string) {
  const since = new Date(Date.now() - 3600e3).toISOString();
  const [{ count: a }, { count: b }] = await Promise.all([
    ip ? admin.from("site_requests").select("id", { count: "exact", head: true }).eq("ip", ip).gte("created_at", since) : Promise.resolve({ count: 0 }),
    email ? admin.from("site_requests").select("id", { count: "exact", head: true }).eq("email", email).gte("created_at", since) : Promise.resolve({ count: 0 }),
  ]);
  return (a || 0) >= 6 || (b || 0) >= 4;
}

/** a place to upload one file before sending (their logo or art) */
export async function siteUploadUrl(fileName: string, size: number) {
  try {
    if (!(size > 0) || size > 50 * 1024 * 1024) return fail("Files can be up to 50 MB.");
    const admin = createAdminClient(), ip = await ipOf();
    if (await tooMany(admin, ip, "")) return fail("Too many requests from here. Call or email us instead.");
    const path = `site-requests/${crypto.randomUUID()}/${fileName.replace(/[^\w.\-]+/g, "_").slice(-120) || "file"}`;
    const { data, error } = await admin.storage.from("proofs").createSignedUploadUrl(path);
    if (error || !data) return fail("Uploads aren't working right now. Send it without the file and we'll ask for it.");
    return { ok: true as const, path, token: data.token };
  } catch { return fail("Uploads aren't working right now."); }
}

export async function sendSiteRequest(r: SiteReq) {
  try {
    const admin = createAdminClient(), ip = await ipOf();
    const t = (s: string, n = 200) => String(s || "").trim().slice(0, n);
    const email = t(r.email, 200).toLowerCase(), name = t(r.name, 120), company = t(r.company, 160), phone = t(r.phone, 40);
    const details = t(r.details, 5000), needs = (r.needs || []).map((x) => t(x, 40)).filter(Boolean).slice(0, 12);
    // a bot: filled the hidden field or sent it in under 3 seconds. It looks sent to them; nothing is made.
    if (r.website || Date.now() - (+r.t0 || 0) < 3000) {
      await admin.from("site_requests").insert({ email, ip, spam: true, detail: { name, company } });
      return { ok: true as const, number: 0 };
    }
    if (!name) return fail("Enter your name.");
    if (!EMAIL.test(email)) return fail("Enter an email we can reply to.");
    if (!details && !needs.length) return fail("Tell us a little about what you need.");
    if (await tooMany(admin, ip, email)) return fail("We've already got a few requests from you this hour. Call us at 972-487-7858 if it's urgent.");

    // who they are: any account's person with this email, else the account's own email, else a new customer
    const { data: ct } = await admin.from("customer_contacts").select("customer_id").ilike("email", email).is("removed_at", null).limit(1).maybeSingle();
    let cust: { id: string; price_type?: string | null; tax_exempt?: boolean | null } | null = null;
    if (ct?.customer_id) cust = (await admin.from("customers").select("id, price_type, tax_exempt").eq("id", ct.customer_id).maybeSingle()).data;
    if (!cust) cust = (await admin.from("customers").select("id, price_type, tax_exempt").ilike("email", email).limit(1).maybeSingle()).data;
    let isNew = false;
    if (!cust) {
      const { data, error } = await admin.from("customers").insert({ company: company || name, name, email, phone, price_type: "retail" }).select("id, price_type, tax_exempt").single();
      if (error || !data) return fail("Something went wrong sending this. Call us at 972-487-7858.");
      cust = data; isNew = true;
    }
    const c = cust as { id: string; price_type?: string | null; tax_exempt?: boolean | null };
    const by = /^\d{4}-\d{2}-\d{2}$/.test(r.by || "") ? r.by : null;
    const nick = [company || name, needs.slice(0, 2).join(" + ")].filter(Boolean).join(" · ").slice(0, 120);
    const notes = [`From the website (fbsprint.com)${isNew ? ", a new customer" : ""}.`, `${name}${company ? `, ${company}` : ""} · ${email}${phone ? ` · ${phone}` : ""}`,
      needs.length ? `Needs: ${needs.join(", ")}` : "", r.qty ? `About ${t(r.qty, 40)} pieces` : "", by ? `Needed by ${by}` : "", details].filter(Boolean).join("\n");
    const { data: o, error: oe } = await admin.from("orders").insert({
      customer_id: c.id, status: "request", type: "quote", source: "website", draft: true, nickname: nick, notes, due_date: by,
      price_type: c.price_type || "retail", tax_exempt: !!c.tax_exempt, groups: [newGroup()], total: 0,
    }).select("id").single();
    if (oe || !o) return fail("Something went wrong sending this. Call us at 972-487-7858.");
    const { data: num } = await admin.rpc("order_commit_server", { p_id: o.id });
    await admin.from("orders").update({ submitted_at: new Date().toISOString() }).eq("id", o.id);
    // what they wrote and their files, on the order's messages (the shop answers from there or by email)
    const files = (r.files || []).filter((f) => f.path.startsWith("site-requests/")).slice(0, 10);
    await admin.from("messages").insert({ order_id: o.id, author_type: "customer", author_email: email, author_name: name, body: notes, attachments: files });
    await admin.from("order_events").insert({ order_id: o.id, kind: "request_submitted", detail: `From the website${files.length ? ` · ${files.length} file${files.length === 1 ? "" : "s"}` : ""}`, actor: email });
    await admin.from("site_requests").insert({ email, ip, order_id: o.id, customer_id: c.id, detail: { name, company, needs } });
    const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    const { mergeSettings } = await import("@/lib/pricing");
    await (await import("@/lib/shopNotice")).notifyShopAbout(admin, o.id, { did: `sent a website request${isNew ? " (new customer)" : ""}`, head: `${company || name} sent a request from the website`, body: notes, shopName: mergeSettings(s?.data).shop.name, button: "Review it" }).catch(() => null);
    return { ok: true as const, number: Number(num) || 0 };
  } catch { return fail("Something went wrong sending this. Call us at 972-487-7858."); }
}
