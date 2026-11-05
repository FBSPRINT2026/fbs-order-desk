"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allRows } from "@/lib/readAll";
import { fmtPhone } from "@/lib/phone";
import { aiState } from "@/lib/ai/claude";
import { lookUpCompany } from "@/lib/ai/companyLookup";

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
/** words in a name that don't tell one customer from another */
const GENERIC = /^(church|school|schools|high|elementary|middle|academy|isd|pta|pto|club|team|teams|foundation|group|company|brands?|brewing|brewery|designs?|print|printing|prints|apparel|promo|promos|promotions|solutions|marketing|services|products|creative|studio|studios|shop|store|sports|athletics|booster|boosters|association|church|ministries|united|first|north|south|east|west|dallas|texas|plano|frisco|richardson)$/;
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
    // whose list opens first: the person looking, when they own accounts (Nov 3, Nick: "Amanda can do hers and I can do mine")
    const meOwner = owners.find((o) => o.toLowerCase().split(/\s+/)[0] === String(v.email || "").split("@")[0].toLowerCase().replace(/[^a-z]/g, "")) || "";
    return { ok: true as const, rows, owners, meOwner };
  } catch (e) { return fail(e); }
}

export type Person = { email: string; name: string; n: number; last: string; boxes: string[]; sameCompany: boolean; /** from their email signature */ phone: string; /** from someone's phone contacts, and whose */ cell?: string; cellFrom?: string };
const ROLES = ["Orders", "Art", "Billing"];
const TERMS = ["prepay", "receipt", "deposit", "net30"];
export type Contact = { id: string; name: string; email: string; phone: string; isPrimary: boolean; portal: boolean; roles: string[]; /** the phone in their email signature, when none is on file */ foundPhone?: string; /** from someone's phone contacts, and whose */ cell?: string; cellFrom?: string };
export type Detail = { id: string; company: string; name: string; email: string; phone: string; address: string; owner: string; printavoAs: string[]; contacts: Contact[]; found: Person[];
  /** the rest of the move questionnaire (components/CustomerMove.tsx) */ taxExempt: boolean; terms: string; priceType: string; notes: string; movedAt: string | null;
  /** ship-to, and any other address with its own name (Nov 3, Nick: "billing, delivery, and admin office") */ shipAddress: string; others: Addr[] };
export type Addr = { id: string; label: string; address: string };

/** one customer: what's on file, their contacts, and who we've been emailing with there */
export async function contactDetail(customerId: string) {
  try {
    await me();
    const admin = createAdminClient();
    const [{ data: c }, { data: cc }, { data: pv }, { data: pr }] = await Promise.all([
      admin.from("customers").select("id, company, name, email, phone, address, ship_address, other_addresses, tax_exempt, payment_terms, price_type, moved_at").eq("id", customerId).maybeSingle(),
      admin.from("customer_contacts").select("id, name, email, phone, is_primary, portal_access, roles").eq("customer_id", customerId).is("removed_at", null).order("created_at"),
      admin.from("printavo_customers").select("data").eq("customer_id", customerId),
      admin.from("customer_private").select("account_owner, notes").eq("customer_id", customerId).maybeSingle(),
    ]);
    if (!c) throw new Error("That customer isn't here.");
    const contacts = ((cc || []) as { id: string; name: string | null; email: string | null; phone: string | null; is_primary: boolean | null; portal_access: boolean | null; roles: string[] | null }[])
      .map((x): Contact => ({ id: x.id, name: String(x.name || "").trim(), email: String(x.email || "").trim().toLowerCase(), phone: String(x.phone || "").trim(), isPrimary: !!x.is_primary, portal: x.portal_access !== false, roles: x.roles || [] }));
    const printavoAs = [...new Set(((pv || []) as { data: { companyName?: string } | null }[]).map((x) => String(x.data?.companyName || "").trim()).filter(Boolean))];
    const company = String(c.company || "").trim();
    // what to look for: the company's name (as written and run together), and the web domains of emails we already have
    const names = [company, ...printavoAs].filter((x) => x.length >= 4);
    const norm = (x: string) => x.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\b(inc|llc|ltd|co|corp|the)\b/g, " ").replace(/\s+/g, " ").trim();
    const compact = names.map((x) => norm(x).replace(/\s+/g, "")).filter((x) => x.length >= 5);
    const known = [String(c.email || ""), ...contacts.map((x) => x.email)].map((x) => x.trim().toLowerCase()).filter(okEmail);
    const domains = [...new Set(known.map((x) => x.split("@")[1]).filter((d) => d && !FREE.test(d)))];
    // their web domain from a word of their name (Nov 3, Nick: "Gateway is gatewaystaff.com… you should have gotten that
    // somehow"): domains in our mail holding the name's own words (not "church", "school"…), the ones holding the most
    // words first, then the busiest; the top two count as the company's own
    const words = [...new Set(names.flatMap((x) => norm(x).split(" ")).filter((w) => w.length >= 4 && !GENERIC.test(w)))].slice(0, 4);
    if (words.length) {
      const { data: ds } = await admin.rpc("contact_domains", { p_words: words });
      const scored = ((ds || []) as { domain: string; n: number }[]).filter((x) => x.domain && !FREE.test(x.domain) && !domains.includes(x.domain)
          // a company's own domain, not a service's sub-domain for them (gatewaystaff.coupahost.com)
          && x.domain.split(".").length <= (/\.(com|net|org|co|edu|gov)\.[a-z]{2}$/.test(x.domain) ? 3 : 2))
        .map((x) => ({ ...x, hits: words.filter((w) => x.domain.includes(w)).length }));
      const best = Math.max(0, ...scored.map((x) => x.hits));
      for (const x of scored.filter((y) => y.hits === best).sort((a, b) => b.n - a.n).slice(0, 2)) domains.push(x.domain);
    }
    const terms = [...new Set([...names.map(norm).filter((x) => x.length >= 5 && x.includes(" ")), ...compact, ...domains.map((d) => "@" + d), ...known.filter((e) => FREE.test(e.split("@")[1] || "")).map((e) => e)])].slice(0, 8);
    let found: Person[] = [];
    if (terms.length) {
      const { data: rows, error } = await admin.rpc("contact_suggestions", { p_terms: terms });
      if (error) throw new Error(error.message);
      const by = new Map<string, Person>();
      for (const r of (rows || []) as { email: string; name: string | null; acct: string; n: number; last: string }[]) {
        const p = by.get(r.email) || { email: r.email, name: "", n: 0, last: "", boxes: [], sameCompany: false, phone: "" };
        p.n += +r.n || 0;
        // "Holly Ries | Brandegroup" → "Holly Ries"
        const nm = (r.name || "").replace(/\s*\|.*$/, "").replace(/\s+/g, " ").trim();
        if (nm && !p.name) p.name = nm;
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
      // everyone at the company (their web domain), then whoever else we've traded real mail with on those threads
      found = [...by.values()].filter((p) => !/do.?not.?reply|^(info|news|newsletter|marketing|support|hello)@.*\.(shop|xyz)$/i.test(p.email) && (p.sameCompany || p.n >= 3 || known.includes(p.email)))
        .sort((a, b) => Number(b.sameCompany) - Number(a.sameCompany) || b.n - a.n).slice(0, 40);
      // their phone from their own email signature (recent mail only), never our own number
      const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
      const ours = [String((st?.data as { shop?: { phone?: string } } | null)?.shop?.phone || ""), "972 487 7858"].map((x) => x.replace(/\D/g, "")).filter((x) => x.length >= 10);
      const ask = [...found.map((p) => p.email), ...contacts.map((x) => x.email)].filter(Boolean);
      if (ask.length) {
        const { data: ph } = await admin.rpc("contact_phones", { p_emails: ask, p_skip: ours });
        const m = new Map(((ph || []) as { email: string; phone: string }[]).map((x) => [x.email, fmtPhone(x.phone)]));
        for (const p of found) p.phone = m.get(p.email) || "";
        for (const x of contacts) if (!x.phone) x.foundPhone = m.get(x.email) || "";
      }
    }
    // staff's phone contacts (phone_contacts, from a vCard): the same people get their mobile numbers; people at the
    // company who aren't in our mail yet are added (Nov 3, Nick: "pull from my phone contacts")
    {
      const { data: pcs } = await admin.from("phone_contacts").select("owner_email, name, org, title, emails, phones").is("removed_at", null).order("id").limit(1000);
      const flat = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
      const nm = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();
      const coKeys = names.map(flat).filter((k) => k.length >= 4);
      const orgHit = (o: string) => { const k = flat(o); return k.length >= 3 && coKeys.some((c) => c.includes(k) || k.includes(c)); };
      for (const r of (pcs || []) as { owner_email: string; name: string; org: string; title: string; emails: string[]; phones: string[] }[]) {
        const emails = (r.emails || []).map((e) => e.toLowerCase());
        const phone = fmtPhone((r.phones || [])[0] || "");
        const atCo = orgHit(r.org || "");
        const whose = `${r.owner_email.split("@")[0].replace(/^\w/, (m) => m.toUpperCase())}'s phone`;
        const people: { name: string; email: string; phone: string; isFound?: boolean }[] = [...contacts, ...found.map((p) => ({ ...p, isFound: true }))];
        let hit = people.find((p) => p.email && emails.includes(p.email)) || (r.name.includes(" ") ? people.find((p) => nm(p.name) === nm(r.name)) : undefined);
        // "Scott" at Creative Apparel is Scott Gray there
        if (!hit && atCo && !r.name.includes(" ")) { const same = people.filter((p) => nm(p.name).split(" ")[0] === nm(r.name)); if (same.length === 1) hit = same[0]; }
        if (hit) {
          const target = hit.isFound ? found.find((p) => p.email === hit!.email && p.name === hit!.name) : contacts.find((c) => c.email === hit!.email && c.name === hit!.name);
          // offered next to the signature's number, never put in for them (Nov 3, Nick: "signature and then from my phone… I can select which one is right")
          if (target && phone && !target.cell) { target.cell = phone; target.cellFrom = whose; }
          continue;
        }
        if (!atCo) continue;
        found.push({ email: emails[0] || "", name: r.name, n: 0, last: "", boxes: [whose], sameCompany: true, phone: "", cell: phone, cellFrom: whose });
      }
    }
    return { ok: true as const, detail: { id: c.id as string, company, name: String(c.name || "").trim(), email: String(c.email || "").trim().toLowerCase(), phone: String(c.phone || "").trim(), address: String(c.address || "").trim(),
      owner: String((pr as { account_owner?: string | null } | null)?.account_owner || ""), printavoAs, contacts, found,
      taxExempt: !!c.tax_exempt, terms: String(c.payment_terms || "receipt"), priceType: String(c.price_type || "retail"), notes: String((pr as { notes?: string | null } | null)?.notes || ""), movedAt: (c.moved_at as string | null) || null,
      shipAddress: String(c.ship_address || "").trim(), others: ((c.other_addresses || []) as Addr[]).filter((a) => a && (a.label || a.address)) } as Detail };
  } catch (e) { return fail(e); }
}

export type PersonSave = { contactId?: string; name: string; email: string; phone: string; contact: boolean; portal: boolean; main: boolean; roles: string[] };

/** save the account: the company's details, and each person (kept, added, or taken off the account), and mark it checked */
export async function saveContacts(input: { id: string; company: string; phone: string; address: string; people: PersonSave[];
  taxExempt: boolean; terms: string; priceType: string; notes: string; shipAddress: string; others: Addr[]; /** and move them to our system (the move checklist done) */ move?: boolean }) {
  try {
    const v = await me();
    const admin = createAdminClient();
    const company = input.company.trim();
    const people = input.people.map((p) => ({ ...p, name: p.name.trim(), email: p.email.trim().toLowerCase(), phone: fmtPhone(p.phone.trim()), roles: p.roles.filter((r) => ROLES.includes(r)) }));
    const keep = people.filter((p) => p.contact);
    for (const p of keep) if (p.email && !okEmail(p.email)) throw new Error(`${p.name || p.email}: that email doesn't look right.`);
    const main = keep.find((p) => p.main) || keep.find((p) => okEmail(p.email));
    if (!company && !main?.name) throw new Error("Give it a company or a contact name.");
    const { data: cur } = await admin.from("customers").select("name, email, phone").eq("id", input.id).maybeSingle();
    const { error } = await admin.from("customers").update({
      company, address: input.address.trim(),
      name: main?.name || String(cur?.name || ""), email: main?.email || String(cur?.email || ""),
      phone: fmtPhone(input.phone.trim()) || main?.phone || String(cur?.phone || ""),
      contacts_checked_at: new Date().toISOString(), contacts_checked_by: v.email || "",
      ship_address: input.shipAddress.trim(),
      other_addresses: input.others.map((a) => ({ id: String(a.id || Math.random().toString(36).slice(2, 9)).slice(0, 20), label: a.label.trim().slice(0, 60), address: a.address.trim().slice(0, 600) })).filter((a) => a.address || a.label),
      tax_exempt: !!input.taxExempt, ...(TERMS.includes(input.terms) ? { payment_terms: input.terms } : {}), ...(["retail", "wholesale"].includes(input.priceType) ? { price_type: input.priceType } : {}),
    }).eq("id", input.id);
    if (error) throw new Error(error.message);
    // the shop-only notes (seen on every order)
    const { data: priv } = await admin.from("customer_private").select("customer_id, notes").eq("customer_id", input.id).maybeSingle();
    if ((priv?.notes || "") !== input.notes.trim()) {
      const { error: ne } = priv ? await admin.from("customer_private").update({ notes: input.notes.trim(), updated_at: new Date().toISOString() }).eq("customer_id", input.id)
        : await admin.from("customer_private").insert({ customer_id: input.id, notes: input.notes.trim() });
      if (ne) throw new Error(ne.message);
    }
    const { data: have } = await admin.from("customer_contacts").select("id, email").eq("customer_id", input.id).is("removed_at", null);
    const byEmail = new Map(((have || []) as { id: string; email: string | null }[]).filter((x) => x.email).map((x) => [String(x.email).trim().toLowerCase(), x.id]));
    let added = 0, removed = 0;
    for (const p of people) {
      const id = p.contactId || (p.email ? byEmail.get(p.email) : undefined);
      const row = { name: p.name, email: p.email || "", phone: p.phone || "", portal_access: p.contact && p.portal, is_primary: !!main && p === main, roles: p.roles };
      if (p.contact) {
        if (id) { const { error: ue } = await admin.from("customer_contacts").update(row).eq("id", id); if (ue) throw new Error(ue.message); }
        else if (p.email || p.name) { const { error: ie } = await admin.from("customer_contacts").insert({ customer_id: input.id, ...row }); if (ie) throw new Error(ie.message); added++; if (p.email) byEmail.set(p.email, "new"); }
      } else if (id && p.contactId) {
        // taken off the account: kept on file, just not a contact any more (and no portal sign-in)
        const { error: re } = await admin.from("customer_contacts").update({ portal_access: false, is_primary: false, removed_at: new Date().toISOString(), removed_by: v.email || "staff" }).eq("id", id);
        if (re) throw new Error(re.message);
        removed++;
      }
    }
    // moved to our system: the same as finishing the move checklist (components/CustomerMove.tsx)
    let moved = false;
    if (input.move) {
      const at = new Date().toISOString();
      const { data: mv } = await admin.from("customers").update({ moved_at: at, moved_by: v.email || "", move_checklist: { name: true, contacts: true, type: true, pricing: true, address: true } }).eq("id", input.id).is("moved_at", null).select("id");
      moved = !!mv?.length;
      if (moved) await admin.from("activities").insert({ customer_id: input.id, kind: "note", direction: "none", subject: "Moved to the new system", body: "Moved from Update contacts. New orders are 40,000-series; their portal is open.", occurred_at: at });
    }
    return { ok: true as const, added, removed, moved };
  } catch (e) { return fail(e); }
}

/** the company's address and phone from their own listing online (lib/ai/companyLookup.ts); nothing is saved */
export async function lookUpOnline(customerId: string) {
  try {
    const v = await me();
    const admin = createAdminClient();
    const st = await aiState(admin);
    if (!st.ready) throw new Error(st.reason);
    const [{ data: c }, { data: cc }, { data: pv }] = await Promise.all([
      admin.from("customers").select("company, name, email, phone, address").eq("id", customerId).maybeSingle(),
      admin.from("customer_contacts").select("email").eq("customer_id", customerId).is("removed_at", null),
      admin.from("printavo_customers").select("data").eq("customer_id", customerId),
    ]);
    if (!c) throw new Error("That customer isn't here.");
    const emails = [String(c.email || ""), ...((cc || []) as { email: string | null }[]).map((x) => String(x.email || ""))].map((x) => x.trim().toLowerCase()).filter(okEmail);
    const domains = [...new Set(emails.map((e) => e.split("@")[1]).filter((d) => d && !FREE.test(d)))];
    const pvName = ((pv || []) as { data: { companyName?: string } | null }[]).map((x) => String(x.data?.companyName || "").trim()).find(Boolean) || "";
    const known = [c.address && `address ${String(c.address).replace(/\s+/g, " ")}`, c.phone && `phone ${c.phone}`, pvName && pvName !== c.company && `also called ${pvName}`].filter(Boolean).join("; ");
    const r = await lookUpCompany({ model: st.settings.assistant.ai.model, admin, by: v.email || "", customerId, name: String(c.company || c.name || "").trim(), domains, known });
    if (!r.ok) throw new Error(r.error);
    return { ok: true as const, found: r.found };
  } catch (e) { return fail(e); }
}

/**
 * The portal's "It's here" launch email to one contact (Nov 5, Nick: "when we add somebody to an account… a button…
 * save and send email… it would send them the it's here login portal thing"). Staff; the contact needs portal access and
 * the customer has to be moved to the new system. Each person gets it once.
 */
export async function sendPortalEmailTo(contactId: string) {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
    const admin = createAdminClient();
    const { data: cc } = await admin.from("customer_contacts").select("customer_id, name, email, portal_access, removed_at").eq("id", contactId).maybeSingle();
    if (!cc || cc.removed_at) throw new Error("That contact isn't on file.");
    if (!cc.portal_access) throw new Error("Turn on Portal for them first.");
    const { data: c } = await admin.from("customers").select("moved_at").eq("id", cc.customer_id).maybeSingle();
    if (!c?.moved_at) throw new Error("This customer isn't moved to the new system yet: move them first (Portal customers).");
    const { sendLaunchToPeople } = await import("@/lib/launchSend");
    const r = await sendLaunchToPeople(admin, [{ customer_id: cc.customer_id, email: cc.email, name: cc.name }], v.email || "staff");
    if (r.skipped.length) return { ok: true as const, already: true };
    if (r.failed.length) throw new Error(r.failed[0].why);
    return { ok: true as const, already: false };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." }; }
}
