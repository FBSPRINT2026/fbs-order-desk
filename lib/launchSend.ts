import type { SupabaseClient } from "@supabase/supabase-js";
import { allRows } from "@/lib/readAll";

/**
 * Sending the portal launch emails (Nov 4, Nick: "schedule it for 7 a.m. and then a 7:05 follow-up email from our
 * personal email address"). One place for both, used by the owner's buttons and by the scheduled send
 * (app/api/cron/launch-send/route.ts):
 * - the launch email, from the site's address, to each moved customer's main email (not "quiet", not a test, not sent);
 * - the personal note, from the mailbox picked for that customer (Nick's or Amanda's), with that mailbox's signature,
 *   in its ClickUp or standard version, greeted by the person it goes to; marked sent so it never goes twice.
 */

const okEmail = (e: string) => /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(e);

/** customers with a ClickUp job on one of their orders (they get the ClickUp version of the note) */
export async function clickupCustomers(admin: SupabaseClient) {
  const { data: t } = await allRows((a, b) => admin.from("clickup_tasks").select("id, order_id").not("order_id", "is", null).order("id").range(a, b));
  const oids = [...new Set(((t || []) as { order_id: string }[]).map((x) => x.order_id))];
  const ids = new Set<string>();
  for (let i = 0; i < oids.length; i += 200) {
    const { data: os } = await admin.from("orders").select("customer_id").in("id", oids.slice(i, i + 200));
    for (const o of (os || []) as { customer_id: string | null }[]) if (o.customer_id) ids.add(o.customer_id);
  }
  return { data: [...ids] };
}

/** the launch email to these customers (each once: a customer it already went to is skipped) */
export async function sendLaunchTo(admin: SupabaseClient, ids: string[], by: string) {
  const { sendEmail, siteUrl } = await import("@/lib/email");
  const { LAUNCH_SUBJECT, launchEmailHtml } = await import("@/lib/launchEmail");
  const site = siteUrl();
  let sent = 0; const failed: { email: string; why: string }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const [{ data }, { data: done }] = await Promise.all([
      admin.from("customers").select("id, company, name, email, is_test").in("id", part),
      admin.from("launch_email_sends").select("customer_id").eq("ok", true).in("customer_id", part),
    ]);
    const already = new Set(((done || []) as { customer_id: string }[]).map((x) => x.customer_id));
    for (const c of (data || []) as { id: string; company: string | null; name: string | null; email: string | null; is_test: boolean | null }[]) {
      const to = String(c.email || "").trim().toLowerCase();
      if (!okEmail(to) || c.is_test || already.has(c.id)) continue;
      const first = String(c.name || "").trim().split(/\s+/)[0] || "";
      const company = String(c.company || "").trim();
      const html = launchEmailHtml({ site, portalUrl: `${site}/portal`, firstName: first, company: company || undefined });
      let ok = false, why = "";
      try { ok = await sendEmail({ to, subject: LAUNCH_SUBJECT, html }); if (!ok) why = "The email service didn't take it."; } catch (e) { why = e instanceof Error ? e.message : String(e); }
      await admin.from("launch_email_sends").insert({ customer_id: c.id, email: to, company: company || null, ok, error: ok ? null : why.slice(0, 300), sent_by: by });
      if (ok) sent++; else failed.push({ email: to, why });
    }
  }
  return { sent, failed };
}

/** who the launch email is waiting on: moved, not quiet, not a test, a good email, not sent yet */
export async function launchWaiting(admin: SupabaseClient) {
  const { data: cs } = await allRows((a, b) => admin.from("customers").select("id, email, moved_at, launch_quiet, is_test").not("moved_at", "is", null).order("id").range(a, b));
  const list = ((cs || []) as { id: string; email: string | null; launch_quiet: boolean | null; is_test: boolean | null }[]).filter((c) => !c.launch_quiet && !c.is_test && okEmail(String(c.email || "").trim()));
  const { data: done } = await allRows((a, b) => admin.from("launch_email_sends").select("id, customer_id").eq("ok", true).order("id").range(a, b));
  const already = new Set(((done || []) as { customer_id: string }[]).map((x) => x.customer_id));
  return list.filter((c) => !already.has(c.id)).map((c) => c.id);
}

/** who the personal note is waiting on: on, with someone to send to, not sent yet */
export async function personalWaiting(admin: SupabaseClient) {
  const { data } = await allRows((a, b) => admin.from("customers").select("id, personal_note_to, is_test").eq("personal_note_skip", false).is("personal_note_sent_at", null).order("id").range(a, b));
  return ((data || []) as { id: string; personal_note_to: string[] | null; is_test: boolean | null }[]).filter((c) => !c.is_test && (c.personal_note_to || []).some(okEmail)).map((c) => c.id);
}

/** the personal note to one customer, from their picked mailbox; marked sent. `testTo` sends their copy to us instead. */
export async function sendPersonalNote(admin: SupabaseClient, customerId: string, opts: { by: string; testTo?: string; clickup?: Set<string> }) {
  const { data: c } = await admin.from("customers").select("id, company, name, email, personal_note_to, personal_note_from, personal_note_sent_at, clickup_client").eq("id", customerId).maybeSingle();
  if (!c) throw new Error("Customer not found.");
  if (!opts.testTo && c.personal_note_sent_at) return { skipped: "already sent" as const };
  const to = ((c.personal_note_to as string[] | null) || []).map((x) => String(x).trim().toLowerCase()).filter(okEmail);
  if (!to.length) throw new Error(`${c.company || "This customer"} has no address for the personal note.`);
  const fromAddr = String(c.personal_note_from || "nicholas@fbsprint.com").toLowerCase();
  const { data: boxRow } = await admin.from("mail_accounts").select("*").ilike("email", fromAddr).maybeSingle();
  if (!boxRow) throw new Error(`The mailbox ${fromAddr} isn't connected here.`);
  const box = boxRow as import("@/lib/mail/config").MailAccount & { signature_html?: string | null; signature_on?: boolean | null };
  const cu = opts.clickup || new Set((await clickupCustomers(admin)).data);
  const kind = c.clickup_client || cu.has(c.id) ? ("clickup" as const) : ("standard" as const);
  const { peopleOf } = await import("@/lib/customerEmailServer");
  const pp = await peopleOf(admin, c.id).catch(() => null);
  const person = pp?.people.find((p) => p.email.toLowerCase() === to[0]);
  const first = String(person?.name || c.name || "").trim().split(/\s+/)[0] || "";
  const { noteText, noteHtml, noteTextPlain } = await import("@/lib/personalNote");
  const { inlineImages } = await import("@/lib/mail/compose");
  const { siteUrl } = await import("@/lib/email");
  const { cfgOf } = await import("@/lib/mail/config");
  const { sendFromMailbox } = await import("@/lib/mail/send");
  const { ewsReady, ewsSaveSent } = await import("@/lib/mail/ewsBox");
  const t = await noteText(admin, kind);
  const sig = box.signature_on !== false ? box.signature_html || "" : "";
  const { html, attachments } = inlineImages(noteHtml(t, first, siteUrl(), sig));
  const ews = await ewsReady(admin, box).catch(() => false);
  const subject = opts.testTo ? `[Preview for ${c.company || "customer"}${kind === "clickup" ? ", ClickUp version" : ""}] ${t.subject}` : t.subject;
  await sendFromMailbox(cfgOf(box), { to: opts.testTo || to.join(", "), subject, text: noteTextPlain(t, first), html, attachments }, ews ? (raw) => ewsSaveSent(box, raw) : undefined);
  if (!opts.testTo) {
    const at = new Date().toISOString();
    await admin.from("customers").update({ personal_note_sent_at: at }).eq("id", c.id);
    await admin.from("activities").insert({ customer_id: c.id, kind: "email", direction: "out", subject: t.subject, body: `Personal note about the new portal, from ${box.email} to ${to.join(", ")} (${kind} version, sent by ${opts.by}).`, occurred_at: at });
  }
  return { to, from: box.email, kind, first };
}
