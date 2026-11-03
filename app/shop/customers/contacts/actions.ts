"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allRows } from "@/lib/readAll";
import { fmtPhone } from "@/lib/phone";

/**
 * Update contacts (Nov 3, Nick: "build a update the contact tool… it shows the accounts… just the contacts first… help me
 * fill out that form if I haven't already"). Every customer, biggest first, with whether we have a contact for them, and
 * the people at that company found in the shop's mail (Nick's, Amanda's and Claudia's mailboxes: who wrote to us or who
 * we wrote to on messages that name the company or its web domain). Saving changes the customer here only; Printavo is
 * never written to. Owners and admins.
 */
async function me() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  if (!["owner", "admin"].includes(v.role)) throw new Error("Only an owner or admin can update contacts here.");
  return v;
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });
const okEmail = (e: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e);
const FREE = /^(gmail|yahoo|hotmail|outlook|aol|icloud|me|msn|live|att|sbcglobal|comcast|verizon|protonmail|ymail|mac)\./i;

/** missing: no email on file; check: an email we've never written to or heard from; done: checked here, or the email is in our mail */
export type ContactState = "missing" | "check" | "done";
export type ContactRow = { id: string; name: string; contact: string; email: string; owner: string; sales: number; rank: number; state: ContactState; checkedAt: string | null };

export async function contactList() {
  try {
    const v = await me();
    const admin = createAdminClient();
    const to = new Date(Date.now() + 864e5).toISOString().slice(0, 10), from = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    const [{ data: top }, { data: cs, error }, { data: pr }, { data: seen, error: se }, { data: st }] = await Promise.all([
      v.supabase.rpc("shop_top_customers", { p_from: from, p_to: to, p_limit: 5000 }),
      allRows((a, b) => admin.from("customers").select("id, company, name, email, is_test, contacts_checked_at").order("id").range(a, b)),
      allRows((a, b) => admin.from("customer_private").select("customer_id, account_owner").order("customer_id").range(a, b)),
      admin.rpc("customer_contact_seen"),
      admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    ]);
    if (error) throw new Error(error.message);
    if (se) throw new Error(se.message);
    const sales = new Map(((top || []) as { customer_id: string; sales: number }[]).filter((r) => r.customer_id).map((r) => [r.customer_id, +r.sales || 0]));
    const own = new Map(((pr || []) as { customer_id: string; account_owner: string | null }[]).map((p) => [p.customer_id, p.account_owner || ""]));
    const inMail = new Set(((seen || []) as { customer_id: string }[]).map((x) => x.customer_id));
    const rows = ((cs || []) as { id: string; company: string | null; name: string | null; email: string | null; is_test: boolean | null; contacts_checked_at: string | null }[])
      .filter((c) => !c.is_test)
      .map((c): ContactRow => {
        const email = String(c.email || "").trim().toLowerCase();
        const state: ContactState = c.contacts_checked_at ? "done" : !okEmail(email) ? "missing" : inMail.has(c.id) ? "done" : "check";
        return { id: c.id, name: String(c.company || "").trim() || String(c.name || "").trim() || "(no name)", contact: String(c.name || "").trim(), email: okEmail(email) ? email : "",
          owner: own.get(c.id) || "", sales: sales.get(c.id) || 0, rank: 0, state, checkedAt: c.contacts_checked_at };
      })
      .sort((a, b) => b.sales - a.sales || a.name.localeCompare(b.name));
    let n = 0; for (const r of rows) r.rank = r.sales > 0 ? ++n : 0;
    const owners = (((st?.data as { accountOwners?: { name: string }[] } | null)?.accountOwners) || []).map((o) => o.name).filter(Boolean);
    return { ok: true as const, rows, owners };
  } catch (e) { return fail(e); }
}

export type Person = { email: string; name: string; n: number; last: string; boxes: string[]; sameCompany: boolean };
export type Contact = { id: string; name: string; email: string; phone: string; isPrimary: boolean };
export type Detail = { id: string; company: string; name: string; email: string; phone: string; address: string; owner: string; printavoAs: string[]; contacts: Contact[]; found: Person[] };

/** one customer: what's on file, their contacts, and who we've been emailing with there */
export async function contactDetail(customerId: string) {
  try {
    await me();
    const admin = createAdminClient();
    const [{ data: c }, { data: cc }, { data: pv }, { data: pr }] = await Promise.all([
      admin.from("customers").select("id, company, name, email, phone, address").eq("id", customerId).maybeSingle(),
      admin.from("customer_contacts").select("id, name, email, phone, is_primary").eq("customer_id", customerId).is("removed_at", null).order("created_at"),
      admin.from("printavo_customers").select("data").eq("customer_id", customerId),
      admin.from("customer_private").select("account_owner").eq("customer_id", customerId).maybeSingle(),
    ]);
    if (!c) throw new Error("That customer isn't here.");
    const contacts = ((cc || []) as { id: string; name: string | null; email: string | null; phone: string | null; is_primary: boolean | null }[])
      .map((x) => ({ id: x.id, name: String(x.name || "").trim(), email: String(x.email || "").trim().toLowerCase(), phone: String(x.phone || "").trim(), isPrimary: !!x.is_primary }));
    const printavoAs = [...new Set(((pv || []) as { data: { companyName?: string } | null }[]).map((x) => String(x.data?.companyName || "").trim()).filter(Boolean))];
    const company = String(c.company || "").trim();
    // what to look for: the company's name (as written and run together), and the web domains of emails we already have
    const names = [company, ...printavoAs].filter((x) => x.length >= 4);
    const norm = (x: string) => x.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\b(inc|llc|ltd|co|corp|the)\b/g, " ").replace(/\s+/g, " ").trim();
    const compact = names.map((x) => norm(x).replace(/\s+/g, "")).filter((x) => x.length >= 5);
    const known = [String(c.email || ""), ...contacts.map((x) => x.email)].map((x) => x.trim().toLowerCase()).filter(okEmail);
    const domains = [...new Set(known.map((x) => x.split("@")[1]).filter((d) => d && !FREE.test(d)))];
    const terms = [...new Set([...names.map(norm).filter((x) => x.length >= 5 && x.includes(" ")), ...compact, ...domains.map((d) => "@" + d), ...known.filter((e) => FREE.test(e.split("@")[1] || "")).map((e) => e)])].slice(0, 8);
    let found: Person[] = [];
    if (terms.length) {
      const { data: rows, error } = await admin.rpc("contact_suggestions", { p_terms: terms });
      if (error) throw new Error(error.message);
      const by = new Map<string, Person>();
      for (const r of (rows || []) as { email: string; name: string | null; acct: string; n: number; last: string }[]) {
        const p = by.get(r.email) || { email: r.email, name: "", n: 0, last: "", boxes: [], sameCompany: false };
        p.n += +r.n || 0;
        if (r.name && !p.name) p.name = r.name;
        if (!p.last || r.last > p.last) p.last = r.last;
        const who = r.acct.split("@")[0]; if (!p.boxes.includes(who)) p.boxes.push(who);
        by.set(r.email, p);
      }
      const dom = (e: string) => (e.split("@")[1] || "").toLowerCase();
      for (const p of by.values()) {
        const d = dom(p.email), base = d.replace(/\.[a-z.]+$/, "").replace(/[^a-z0-9]/g, "");
        p.sameCompany = domains.includes(d) || compact.some((k) => base.length >= 4 && (base.includes(k) || k.includes(base)));
        if (!p.name) p.name = p.email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
      }
      // the company's own people first, then whoever we've traded the most mail with; one-off strangers on a thread are left out
      found = [...by.values()].filter((p) => p.sameCompany || p.n >= 3 || known.includes(p.email))
        .sort((a, b) => Number(b.sameCompany) - Number(a.sameCompany) || b.n - a.n).slice(0, 8);
    }
    return { ok: true as const, detail: { id: c.id as string, company, name: String(c.name || "").trim(), email: String(c.email || "").trim().toLowerCase(), phone: String(c.phone || "").trim(), address: String(c.address || "").trim(),
      owner: String((pr as { account_owner?: string | null } | null)?.account_owner || ""), printavoAs, contacts, found } as Detail };
  } catch (e) { return fail(e); }
}

/** save the main contact (and anyone added), and mark the customer's contacts checked */
export async function saveContacts(input: { id: string; company: string; name: string; email: string; phone: string; address: string; add: { name: string; email: string }[] }) {
  try {
    const v = await me();
    const admin = createAdminClient();
    const email = input.email.trim().toLowerCase();
    if (email && !okEmail(email)) throw new Error("That email doesn't look right.");
    const company = input.company.trim();
    if (!company && !input.name.trim()) throw new Error("Give it a company or a contact name.");
    const { error } = await admin.from("customers").update({
      company, name: input.name.trim(), email, phone: fmtPhone(input.phone.trim()), address: input.address.trim(),
      contacts_checked_at: new Date().toISOString(), contacts_checked_by: v.email || "",
    }).eq("id", input.id);
    if (error) throw new Error(error.message);
    // the main contact and everyone added are the company's contacts too (they can all sign in to its portal)
    const { data: have } = await admin.from("customer_contacts").select("id, email").eq("customer_id", input.id).is("removed_at", null);
    const got = new Map(((have || []) as { id: string; email: string | null }[]).map((x) => [String(x.email || "").trim().toLowerCase(), x.id]));
    const add = [...(email ? [{ name: input.name.trim(), email, main: true }] : []), ...input.add.map((x) => ({ name: x.name.trim(), email: x.email.trim().toLowerCase(), main: false }))]
      .filter((x) => okEmail(x.email) && !got.has(x.email));
    const seen = new Set<string>();
    const rows = add.filter((x) => (seen.has(x.email) ? false : (seen.add(x.email), true))).map((x) => ({ customer_id: input.id, name: x.name, email: x.email, is_primary: x.main }));
    if (rows.length) { const { error: ie } = await admin.from("customer_contacts").insert(rows); if (ie) throw new Error(ie.message); }
    // the main email is the one marked Main
    if (email) {
      await admin.from("customer_contacts").update({ is_primary: false }).eq("customer_id", input.id).neq("email", email);
      await admin.from("customer_contacts").update({ is_primary: true }).eq("customer_id", input.id).eq("email", email);
    }
    return { ok: true as const, added: rows.length };
  } catch (e) { return fail(e); }
}
