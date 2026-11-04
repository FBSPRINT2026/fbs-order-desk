"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allRows } from "@/lib/readAll";
import { PAY_TERMS, type PayTerms } from "@/lib/pricing";

/**
 * Moving customers to the portal in bulk (Nov 3, Nick: "show me a list of all of our customers… quickly set their terms…
 * everybody in the top 30, if we haven't already transitioned them, we'll just automatically transition them… if they're
 * already in, you can gray them out"). Every customer, biggest first, with their terms, owner, email and whether they're
 * moved; terms set one at a time or for many at once, and the ticked ones moved together. Owner only.
 */
async function me() {
  const v = await getViewer();
  if (!v.user || !v.isStaff || v.role !== "owner") throw new Error("Only the owner can do this.");
  return v;
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });
const okEmail = (e: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e);

export type MoveRow = { id: string; name: string; contact: string; email: string; sales: number; orders: number; rank: number; terms: PayTerms; priceType: string; owner: string; movedAt: string | null; launchSent: string | null; /** moved without the launch email */ quiet: boolean;
  /** the personal note from Nick or Amanda: to whom, from which mailbox, not sent, sent */ personal: { to: string[]; from: string; skip: boolean; sentAt: string | null };
  /** works with us through ClickUp (has ClickUp tasks, or marked): gets the ClickUp version of the personal note */ clickup: boolean };

export async function moveList() {
  try {
    const v = await me();
    const admin = createAdminClient();
    const to = new Date(Date.now() + 864e5).toISOString().slice(0, 10), from = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    const [{ data: top, error }, { data: cs, error: ce }, { data: pr }, { data: sent }, { data: cu }] = await Promise.all([
      v.supabase.rpc("shop_top_customers", { p_from: from, p_to: to, p_limit: 5000 }),
      allRows((a, b) => admin.from("customers").select("id, company, name, email, payment_terms, price_type, moved_at, is_test, launch_quiet, personal_note_to, personal_note_from, personal_note_skip, personal_note_sent_at, clickup_client").order("id").range(a, b)),
      allRows((a, b) => admin.from("customer_private").select("customer_id, account_owner").order("customer_id").range(a, b)),
      allRows((a, b) => admin.from("launch_email_sends").select("customer_id, sent_at").eq("ok", true).order("sent_at", { ascending: false }).order("id").range(a, b)),
      clickupCustomers(admin),
    ]);
    const onCu = new Set(((cu || []) as string[]));
    if (error) throw new Error(error.message);
    if (ce) throw new Error(ce.message);
    const sales = new Map(((top || []) as { customer_id: string; sales: number; orders: number }[]).filter((r) => r.customer_id).map((r, i) => [r.customer_id, { sales: +r.sales || 0, orders: +r.orders || 0, rank: i + 1 }]));
    const own = new Map(((pr || []) as { customer_id: string; account_owner: string | null }[]).map((p) => [p.customer_id, p.account_owner || ""]));
    const last = new Map<string, string>();
    for (const r of (sent || []) as { customer_id: string | null; sent_at: string }[]) if (r.customer_id && !last.has(r.customer_id)) last.set(r.customer_id, r.sent_at);
    const rows = ((cs || []) as { id: string; company: string | null; name: string | null; email: string | null; payment_terms: PayTerms | null; price_type: string | null; moved_at: string | null; is_test: boolean | null; launch_quiet: boolean | null; personal_note_to: string[] | null; personal_note_from: string | null; personal_note_skip: boolean | null; personal_note_sent_at: string | null; clickup_client: boolean | null }[])
      .filter((c) => !c.is_test)
      .map((c): MoveRow => {
        const s = sales.get(c.id), email = String(c.email || "").trim().toLowerCase();
        return { id: c.id, name: String(c.company || "").trim() || String(c.name || "").trim() || "(no name)", contact: String(c.name || "").trim(), email: okEmail(email) ? email : "",
          sales: s?.sales || 0, orders: s?.orders || 0, rank: s?.rank || 0, terms: (c.payment_terms || "receipt") as PayTerms, priceType: c.price_type || "retail",
          owner: own.get(c.id) || "", movedAt: c.moved_at, launchSent: last.get(c.id) || null, quiet: !!c.launch_quiet,
          personal: { to: c.personal_note_to || [], from: c.personal_note_from || "", skip: !!c.personal_note_skip, sentAt: c.personal_note_sent_at },
          clickup: !!c.clickup_client || onCu.has(c.id) };
      })
      .sort((a, b) => (a.rank && b.rank ? a.rank - b.rank : a.rank ? -1 : b.rank ? 1 : a.name.localeCompare(b.name)));
    // their order: 1, 2, 3… for the ones with sales in the last 12 months
    let n = 0; for (const r of rows) r.rank = r.sales > 0 ? ++n : 0;
    return { ok: true as const, rows };
  } catch (e) { return fail(e); }
}

/** the customers who send us work through ClickUp: any order of theirs came from a ClickUp task (so a new ClickUp
 *  customer is picked up by itself), plus anyone marked clickup_client */
async function clickupCustomers(admin: ReturnType<typeof createAdminClient>) {
  const { data: t } = await allRows((a, b) => admin.from("clickup_tasks").select("id, order_id").not("order_id", "is", null).order("id").range(a, b));
  const oids = [...new Set(((t || []) as { order_id: string }[]).map((x) => x.order_id))];
  const ids = new Set<string>();
  for (let i = 0; i < oids.length; i += 200) {
    const { data: os } = await admin.from("orders").select("customer_id").in("id", oids.slice(i, i + 200));
    for (const o of (os || []) as { customer_id: string | null }[]) if (o.customer_id) ids.add(o.customer_id);
  }
  return { data: [...ids] };
}

/** set the payment terms of one or more customers */
export async function setTerms(ids: string[], terms: PayTerms) {
  try {
    await me();
    if (!(terms in PAY_TERMS)) throw new Error("Pick terms first.");
    const ok = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 1000);
    for (let i = 0; i < ok.length; i += 200) {
      const { error } = await createAdminClient().from("customers").update({ payment_terms: terms }).in("id", ok.slice(i, i + 200));
      if (error) throw new Error(error.message);
    }
    return { ok: true as const, saved: ok.length };
  } catch (e) { return fail(e); }
}

/** move these customers to the portal (the same mark the move checklist's last step makes: moved_at / moved_by).
 *  `quiet`: they're left off the launch email (Nov 3, Nick: "move to portal, but don't notify… a once a year client") */
export async function moveCustomers(ids: string[], quiet = false) {
  try {
    const v = await me();
    const admin = createAdminClient();
    const ok = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500);
    const at = new Date().toISOString();
    const { data, error } = await admin.from("customers").update({ moved_at: at, moved_by: v.user?.email || "", launch_quiet: quiet }).in("id", ok).is("moved_at", null).select("id");
    if (error) throw new Error(error.message);
    const moved = ((data || []) as { id: string }[]).map((x) => x.id);
    if (moved.length) await admin.from("activities").insert(moved.map((id) => ({ customer_id: id, kind: "note", direction: "none", subject: "Moved to the new system",
      body: `Moved from the customer list (Customers → Move to the portal)${quiet ? ", without the launch email" : ""}. New orders are 40,000-series; their portal is open.`, occurred_at: at })));
    return { ok: true as const, moved: moved.length, at };
  } catch (e) { return fail(e); }
}

/** leave these customers off the launch email, or put them back on it */
export async function setQuiet(ids: string[], quiet: boolean) {
  try {
    await me();
    const ok = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 1000);
    const { error } = await createAdminClient().from("customers").update({ launch_quiet: quiet }).in("id", ok);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** the owner's mailbox, from their name ("Amanda McCoy" → amanda@fbsprint.com) */
const boxOf = (owner: string) => (owner.trim().split(/\s+/)[0] || "nicholas").toLowerCase().replace(/[^a-z]/g, "") + "@fbsprint.com";

/** the personal intro email on or off for these customers: on goes to the main contact, from the account owner unless `from` says */
export async function setPersonal(ids: string[], on: boolean, from?: string) {
  try {
    await me();
    const admin = createAdminClient();
    const ok = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 1000);
    if (!on) { const { error } = await admin.from("customers").update({ personal_note_skip: true }).in("id", ok); if (error) throw new Error(error.message); return { ok: true as const }; }
    const [{ data: cs }, { data: pr }] = await Promise.all([
      admin.from("customers").select("id, email, personal_note_to, personal_note_from").in("id", ok),
      admin.from("customer_private").select("customer_id, account_owner").in("customer_id", ok),
    ]);
    const own = new Map(((pr || []) as { customer_id: string; account_owner: string | null }[]).map((p) => [p.customer_id, p.account_owner || ""]));
    for (const c of (cs || []) as { id: string; email: string | null; personal_note_to: string[] | null; personal_note_from: string | null }[]) {
      const main = String(c.email || "").trim().toLowerCase();
      const to = (c.personal_note_to || []).length ? c.personal_note_to! : okEmail(main) ? [main] : [];
      const sender = from && /^(nicholas|amanda)@fbsprint\.com$/.test(from) ? from : c.personal_note_from || boxOf(own.get(c.id) || "");
      const { error } = await admin.from("customers").update({ personal_note_skip: false, personal_note_to: to, personal_note_from: sender }).eq("id", c.id);
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/**
 * A test of the personal note from your own mailbox to Nick and Amanda (Nov 3, Nick: "send a copy of it from my email to
 * myself and to Amanda just to see what it looks like actually in our email"): exactly as a customer gets it, greeted
 * "Michael" as an example, with your Outlook signature. Nothing goes to a customer.
 */
export async function sendPersonalNoteTest() {
  try {
    const v = await me();
    const admin = createAdminClient();
    const { accountForUser, cfgOf } = await import("@/lib/mail/config");
    const box = await accountForUser(admin, v.user!.id);
    if (!box) throw new Error("Your mailbox isn't connected here (Email → Settings).");
    const { noteText, noteHtml, noteTextPlain } = await import("@/lib/personalNote");
    const { inlineImages } = await import("@/lib/mail/compose");
    const { siteUrl } = await import("@/lib/email");
    const b = box as typeof box & { signature_html?: string | null; signature_on?: boolean | null };
    const sig = b.signature_on !== false ? b.signature_html || "" : "";
    const { sendFromMailbox } = await import("@/lib/mail/send");
    const { ewsReady, ewsSaveSent } = await import("@/lib/mail/ewsBox");
    const ews = await ewsReady(admin, box).catch(() => false);
    const to = "nicholas@fbsprint.com, amanda@fbsprint.com";
    // both versions: the standard note and the one for ClickUp customers
    for (const [kind, tag] of [["standard", "[Test]"], ["clickup", "[Test – ClickUp customers]"]] as const) {
      const t = await noteText(admin, kind);
      const { html, attachments } = inlineImages(noteHtml(t, "Michael", siteUrl(), sig));
      await sendFromMailbox(cfgOf(box), { to, subject: `${tag} ${t.subject}`, text: noteTextPlain(t, "Michael"), html, attachments }, ews ? (raw) => ewsSaveSent(box, raw) : undefined);
    }
    return { ok: true as const, to, from: box.email };
  } catch (e) { return fail(e); }
}

/**
 * Both emails exactly as one customer will get them, sent to Nick and Amanda (Nov 4, Nick: "use Cedar Promos as an example…
 * resend me both the intro email… and the It's Here email… as you're going to send it to Cedar Promos"): the launch email
 * with their first name and company, and the personal note in their version (ClickUp or not), greeted by the person it
 * goes to. Nothing goes to the customer.
 */
export async function sendCustomerPreview(customerId: string) {
  try {
    const v = await me();
    const admin = createAdminClient();
    if (!/^[0-9a-f-]{36}$/i.test(customerId)) throw new Error("Pick a customer.");
    const { data: c } = await admin.from("customers").select("id, company, name, email, personal_note_to, personal_note_from, clickup_client").eq("id", customerId).maybeSingle();
    if (!c) throw new Error("Customer not found.");
    const company = String(c.company || "").trim(), to = "nicholas@fbsprint.com, amanda@fbsprint.com";
    const { siteUrl, sendEmailWhy } = await import("@/lib/email");
    const { LAUNCH_SUBJECT, launchEmailHtml } = await import("@/lib/launchEmail");
    const site = siteUrl();
    // 1. the launch email from portal@, as sendLaunchBatch makes it for them
    const launchFirst = String(c.name || "").trim().split(/\s+/)[0] || "";
    const lHtml = launchEmailHtml({ site, portalUrl: `${site}/portal`, firstName: launchFirst, company: company || undefined });
    for (const t of to.split(/\s*,\s*/)) {
      const r = await sendEmailWhy({ to: t, subject: `[Preview for ${company || "this customer"}] ${LAUNCH_SUBJECT}`, html: lHtml });
      if (!r.ok) throw new Error(`The launch email didn't go from ${r.from}. ${r.why || ""}`.trim());
    }
    // 2. the personal note: their version, greeted by the person it goes to (their name on file, else the account's)
    const { data: cu } = await clickupCustomers(admin);
    const kind = c.clickup_client || ((cu || []) as string[]).includes(c.id) ? "clickup" as const : "standard" as const;
    const { peopleOf } = await import("@/lib/customerEmailServer");
    const pp = await peopleOf(admin, c.id).catch(() => null);
    const toEmail = ((c.personal_note_to as string[] | null) || [])[0] || String(c.email || "");
    const person = pp?.people.find((p) => p.email.toLowerCase() === toEmail.toLowerCase());
    const noteFirst = String(person?.name || c.name || "").trim().split(/\s+/)[0] || "";
    const { accountForUser, cfgOf } = await import("@/lib/mail/config");
    const box = await accountForUser(admin, v.user!.id);
    if (!box) throw new Error("Your mailbox isn't connected here (Email → Settings).");
    const { noteText, noteHtml, noteTextPlain } = await import("@/lib/personalNote");
    const { inlineImages } = await import("@/lib/mail/compose");
    const t = await noteText(admin, kind);
    const b = box as typeof box & { signature_html?: string | null; signature_on?: boolean | null };
    const sig = b.signature_on !== false ? b.signature_html || "" : "";
    const { html, attachments } = inlineImages(noteHtml(t, noteFirst, site, sig));
    const { sendFromMailbox } = await import("@/lib/mail/send");
    const { ewsReady, ewsSaveSent } = await import("@/lib/mail/ewsBox");
    const ews = await ewsReady(admin, box).catch(() => false);
    const from = String(c.personal_note_from || "");
    await sendFromMailbox(cfgOf(box), { to, subject: `[Preview for ${company}${kind === "clickup" ? ", ClickUp version" : ""}${from && from !== box.email ? `, will come from ${from}` : ""}] ${t.subject}`, text: noteTextPlain(t, noteFirst), html, attachments }, ews ? (raw) => ewsSaveSent(box, raw) : undefined);
    return { ok: true as const, to, launchFirst, noteFirst, kind, noteTo: toEmail, from: from || box.email };
  } catch (e) { return fail(e); }
}
