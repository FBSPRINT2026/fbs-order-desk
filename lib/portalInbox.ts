import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_MAIL_HOST, type MailAccount } from "@/lib/mail/config";
import { all, attr, call, esc, ewsAttachment, one, unesc } from "@/lib/mail/ews";
import { carrierOf } from "@/lib/goods";

/**
 * Vendor order confirmations and shipping emails sent to the portal's own address (Nov 5, Nick: "portal@fbsprint.com is
 * your email address. Customers are going to put you on the order confirmation… you can be checking them and add them
 * into the goods section… automatically"; Peter Millar telling Cedar Promos "your order shipped"). The hourly goods pass
 * reads the last few days of portal@'s inbox once each email:
 * - goods paperwork (any vendor) is read for the vendor, its order #, carrier, tracking, boxes and what's in it;
 * - the customer is found by the addresses on it (from / to / cc, the forwarder) and the order by its PO, name or
 *   garments among their open orders;
 * - the job: the one the email names by number ("FBS #50090"), else read by its PO, name or garments;
 * - with tracking it's a manifest like S&S's and SanMar's (Nov 19, Nick): saved as the vendor's shipment
 *   (supplier_manifest_lines, the vendor's name as supplier, live tracking), put on its job's Goods when the job is
 *   known, else listed on Goods & Receiving under Other vendors to link, and matched again by the hourly pass;
 * - no tracking yet (a confirmation): an alert to whoever owns the account, with what it said.
 * Anything else in the inbox (replies to the launch email…) is left alone. Nothing is moved, marked or answered.
 */
const KEY = "portal_inbox";
type State = { /** a one-time longer look back (days) until it has read everything that far back (Nick, Nov 19 2026) */ back?: number; seen?: string[]; log?: { at: string; subject: string; from: string; result: string }[]; last_run?: string; last_error?: string | null };

async function state(admin: SupabaseClient): Promise<State> {
  const { data } = await admin.from("app_keys").select("value").eq("name", KEY).maybeSingle();
  return (data?.value as State | null) || {};
}
const save = (admin: SupabaseClient, s: State) => admin.from("app_keys").upsert({ name: KEY, value: s }, { onConflict: "name" });

async function acct(admin: SupabaseClient): Promise<MailAccount | null> {
  const { data } = await admin.from("site_mailbox").select("email, smtp_host, enc_password").eq("id", 1).maybeSingle();
  if (!data?.enc_password || !data.email) return null;
  const host = String(data.smtp_host || DEFAULT_MAIL_HOST);
  return {
    id: "portal-inbox", user_id: "", email: String(data.email), name: "Portal", imap_host: host, smtp_host: host, enc_password: String(data.enc_password), enabled: true,
    inbox_validity: null, inbox_uid: null, sent_folder: null, sent_validity: null, sent_uid: null, last_run_at: null, last_ok_at: null, last_error: null, last_error_at: null, stats: {},
  } as unknown as MailAccount;
}

const OUR = /@fbsprint\.com$/i;
const SKIP_SUBJECT = /^(re|aw|antw):\s/i; // a reply to us is a conversation, not vendor paperwork (a forwarded "Fwd:" is read)
const emailsIn = (s: string) => [...new Set((s.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []))];

/** the customers these addresses belong to: a contact or main email, else the same company domain (not free mail) */
async function customersFor(admin: SupabaseClient, emails: string[]) {
  const ids = new Set<string>();
  const ext = emails.filter((e) => !OUR.test(e));
  if (!ext.length) return [];
  const [{ data: cc }, { data: cs }] = await Promise.all([
    admin.from("customer_contacts").select("customer_id").in("email", ext).is("removed_at", null),
    admin.from("customers").select("id").in("email", ext),
  ]);
  for (const r of (cc || []) as { customer_id: string }[]) ids.add(r.customer_id);
  for (const r of (cs || []) as { id: string }[]) ids.add(r.id);
  if (!ids.size) {
    const free = /@(gmail|yahoo|hotmail|outlook|aol|icloud|me|live|msn|comcast|att|sbcglobal)\./i;
    for (const d of [...new Set(ext.filter((e) => !free.test(e)).map((e) => e.split("@")[1]))].slice(0, 5)) {
      const { data } = await admin.from("customer_contacts").select("customer_id").ilike("email", `%@${d}`).is("removed_at", null).limit(20);
      for (const r of (data || []) as { customer_id: string }[]) ids.add(r.customer_id);
    }
  }
  return [...ids];
}

/**
 * The job an email names by its number ("FBS #50090", "Job 40199", "#40482"): one of ours, open, and the customer's
 * when we know the customer. Not a PO or a vendor's order number: only a number that is one of our jobs.
 */
async function namedOrder(admin: SupabaseClient, text: string, custIds: string[]) {
  const nums = [...new Set([...text.matchAll(/(?:\bFBS\s*(?:#|no\.?|job)?\s*|\b(?:job|order|invoice)\s*#?\s*|#\s*)(\d{5})\b/gi)].map((m) => +m[1]))].filter((n) => n >= 30000 && n < 60000).slice(0, 10);
  if (!nums.length) return null;
  const { data } = await admin.from("orders").select("id, number, customer_id, status").in("number", nums).is("discarded_at", null);
  const hits = ((data || []) as { id: string; number: number; customer_id: string; status: string }[]).filter((o) => o.status !== "void" && (!custIds.length || custIds.includes(o.customer_id)));
  return hits.length === 1 ? hits[0] : null;
}

export async function checkPortalInbox(admin: SupabaseClient, opts: { days?: number; deadline?: number } = {}) {
  const a = await acct(admin);
  if (!a) return { skipped: "The portal's mailbox isn't connected (Settings → Site email)." };
  const st = await state(admin), seen = new Set(st.seen || []), log = [...(st.log || [])];
  const out = { looked: 0, added: 0, alerts: 0, errors: [] as string[] };
  const since = new Date(Date.now() - (opts.days || st.back || 4) * 864e5).toISOString().replace(/\.\d+Z$/, "Z");
  try {
    // every page of what came in since then, oldest first (100 a page; a long look back is more than one)
    type It = { id: string; subject: string; from: string; mid: string; att: boolean };
    const items: It[] = [];
    for (let off = 0; off < 2000; off += 100) {
      const x = await call(a, `<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="item:Subject"/><t:FieldURI FieldURI="message:From"/><t:FieldURI FieldURI="message:InternetMessageId"/><t:FieldURI FieldURI="item:DateTimeReceived"/><t:FieldURI FieldURI="item:HasAttachments"/></t:AdditionalProperties></m:ItemShape><m:IndexedPageItemView MaxEntriesReturned="100" Offset="${off}" BasePoint="Beginning"/><m:Restriction><t:IsGreaterThan><t:FieldURI FieldURI="item:DateTimeReceived"/><t:FieldURIOrConstant><t:Constant Value="${since}"/></t:FieldURIOrConstant></t:IsGreaterThan></m:Restriction><m:SortOrder><t:FieldOrder Order="Ascending"><t:FieldURI FieldURI="item:DateTimeReceived"/></t:FieldOrder></m:SortOrder><m:ParentFolderIds><t:DistinguishedFolderId Id="inbox"/></m:ParentFolderIds></m:FindItem>`);
      const page: It[] = all(x, "Message").map((m) => ({ id: attr(all(m.inner, "ItemId")[0]?.attrs || "", "Id"), subject: unesc(one(m.inner, "Subject")), from: unesc(one(one(m.inner, "From"), "EmailAddress")).toLowerCase(), mid: unesc(one(m.inner, "InternetMessageId")), att: one(m.inner, "HasAttachments") === "true" }));
      items.push(...page);
      if (page.length < 100) break;
    }
    const { aiState, askClaude } = await import("@/lib/ai/claude");
    const ai = await aiState(admin);
    if (!ai.ready) return { ...out, skipped: "AI is off." };
    for (const it of items) {
      if (opts.deadline && Date.now() > opts.deadline) break;
      const key = it.mid || it.id;
      if (!it.id || seen.has(key)) continue;
      seen.add(key);
      if (SKIP_SUBJECT.test(it.subject)) continue;
      out.looked++;
      try {
        const g = await call(a, `<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:BodyType>Text</t:BodyType><t:AdditionalProperties><t:FieldURI FieldURI="item:Body"/><t:FieldURI FieldURI="message:ToRecipients"/><t:FieldURI FieldURI="message:CcRecipients"/><t:FieldURI FieldURI="item:Attachments"/></t:AdditionalProperties></m:ItemShape><m:ItemIds><t:ItemId Id="${esc(it.id)}"/></m:ItemIds></m:GetItem>`);
        const body = unesc(one(g, "Body")).slice(0, 12000);
        const heads = [it.from, ...all(one(g, "ToRecipients"), "EmailAddress").map((e) => unesc(e.inner)), ...all(one(g, "CcRecipients"), "EmailAddress").map((e) => unesc(e.inner))].join(" ");
        // a forwarded email names the customer in its body too ("From: Peter Sleiman <peter@cedarpromo.com>")
        const custIds = await customersFor(admin, emailsIn(heads + " " + body.slice(0, 4000)));
        const { data: ords } = custIds.length
          ? await admin.from("orders").select("id, number, nickname, po_number, customer_id, groups").in("customer_id", custIds).not("status", "in", "(completed,void)").is("discarded_at", null).order("created_at", { ascending: false }).limit(60)
          : { data: [] };
        const list = ((ords || []) as { id: string; number: number; nickname: string | null; po_number: string | null; customer_id: string; groups: { lines?: { style?: string; color?: string; garment?: string }[] }[] | null }[]);
        const labels = list.map((o) => `${o.id} = #${o.number} ${o.nickname || ""}${o.po_number ? ` · PO ${o.po_number}` : ""} · ${(o.groups || []).flatMap((gg) => (gg.lines || []).map((l) => [l.style, l.color].filter(Boolean).join(" "))).slice(0, 6).join(", ")}`);
        // a PDF confirmation attached: read it too
        const documents: { data: string }[] = [];
        if (it.att) for (const f of all(g, "FileAttachment").slice(0, 3)) {
          const name = unesc(one(f.inner, "Name"));
          if (!/\.pdf$/i.test(name)) continue;
          const file = await ewsAttachment(a, attr(all(f.inner, "AttachmentId")[0]?.attrs || "", "Id")).catch(() => null);
          if (file && file.content.length < 8 * 1024 * 1024) documents.push({ data: file.content.toString("base64") });
        }
        const ask = (docs: { data: string }[]) => askClaude<{ is_goods: boolean; vendor: string; order_no: string; carrier: string; tracking: string[]; boxes: number | null; eta: string; what: string; pieces: number | null; po: string; order_id: string; why: string }>({
          task: "goods_paper_portal_inbox", model: ai.settings.assistant.ai.fastModel || ai.settings.assistant.ai.model, maxTokens: 700, admin, ctx: { by: "portal inbox" }, timeoutMs: 45_000, documents: docs,
          tool: { name: "shipment", description: "What this email says about goods (blank garments, hats, bags…) a vendor is sending to FBS Print for a customer's order.", input_schema: { type: "object", required: ["is_goods", "vendor", "order_no", "carrier", "tracking", "boxes", "eta", "what", "pieces", "po", "order_id", "why"], properties: {
            is_goods: { type: "boolean", description: "True only when this is a vendor's order confirmation, shipping notice or tracking email for goods. False for anything else (a question, a reply, marketing, a print order request)." },
            vendor: { type: "string", description: "Who is selling or shipping the goods (Peter Millar, One Stop, a store…). Empty when not said." },
            order_no: { type: "string", description: "The vendor's order / confirmation number, or the PO on it. Empty when none." },
            carrier: { type: "string", description: "UPS, FedEx, USPS, DHL, a freight line… Empty when not said." },
            tracking: { type: "array", items: { type: "string" }, description: "Every tracking (or PRO) number, no spaces. Empty when none yet." },
            boxes: { type: ["integer", "null"], description: "How many boxes or cartons, when said." },
            eta: { type: "string", description: "Expected delivery date YYYY-MM-DD, or empty." },
            what: { type: "string", description: "What's in it in a few words: quantity, style, color." },
            pieces: { type: ["integer", "null"], description: "How many pieces in all, when said." },
            po: { type: "string", description: "The customer's PO for these goods when the email gives one (\"PO PETERFMNET73552\"), else empty." },
            order_id: { type: "string", description: "The id of the order below these goods are for, by its PO, name or garments. Empty when you can't tell." },
            why: { type: "string", description: "A few words on why that order. Empty when none." } } } },
          system: `Read an email that came to FBS Print's portal mailbox. Customers copy this address on their vendors' order confirmations and shipping emails so the shop knows goods are coming. Pull out only what it says; never invent numbers. The customer's open orders at the shop:\n${labels.join("\n") || "(none found)"}`,
          prompt: `Subject: ${it.subject}\nFrom: ${it.from}\n\n${body}`,
        });
        // a PDF too long to read (a 187-package fulfillment list, Nov 13: retried every hour): read the email without it
        let r = await ask(documents);
        if (!r.ok && documents.length && /pdf|pages|too large|maximum/i.test(r.error || "")) r = await ask([]);
        if (!r.ok) throw new Error(r.error || "Couldn't read it.");
        const d = r.data;
        if (!d.is_goods) { log.push({ at: new Date().toISOString(), subject: it.subject.slice(0, 120), from: it.from, result: "not goods paperwork" }); continue; }
        const tracking = [...new Set((d.tracking || []).map((t) => String(t).replace(/\s+/g, "")).filter(Boolean))].slice(0, 20);
        const from = [d.vendor, d.order_no && `order ${d.order_no}`].filter(Boolean).join(", ");
        const note = [from && `From ${from}`, d.what].filter(Boolean).join(": ").slice(0, 2000) || `From the email "${it.subject.slice(0, 120)}"`;
        // the job: the one the email names ("Inbound blanks: FBS #50090 | PO …", Nov 19: five of Cedar's went unmatched
        // though each named its job), else the AI's pick by PO, name or garments, else the customer's only open job
        const named = await namedOrder(admin, `${it.subject}\n${body.slice(0, 6000)}`, custIds);
        const order = named || list.find((o) => o.id === d.order_id) || (list.length === 1 ? list[0] : null);
        if (tracking.length) {
          // a vendor's shipment is a manifest like S&S's and SanMar's (Nov 19, Nick: "treat those just like S&S and SanMar
          // manifests"): Goods & Receiving lists it under Other vendors with live tracking; on its job's Goods when the job
          // is known, else there to be linked (and matched again by the hourly pass as jobs and POs come in)
          const cust = order?.customer_id || (custIds.length === 1 ? custIds[0] : null);
          const { data: c } = cust ? await admin.from("customers").select("company, name").eq("id", cust).maybeSingle() : { data: null };
          const vendor = (d.vendor || "Vendor").replace(/\s+/g, " ").trim().slice(0, 60);
          const pcs = d.pieces && d.pieces > 0 ? Math.min(99999, d.pieces) : 0;
          const lines = tracking.map((t, i) => ({
            ship_date: new Date().toISOString().slice(0, 10), customer_name: String(c?.company || c?.name || ""), customer_account: "", customer_po: String(d.po || "").slice(0, 80), invoice: "",
            box: String(i + 1), warehouse: "", method: (d.carrier || carrierOf(t) || "").slice(0, 40), tracking: t, weight: null, sku: "", mill: vendor, style: String(d.what || "").slice(0, 80), color: "", size: "",
            qty_ordered: i === 0 ? pcs : 0, qty_shipped: i === 0 ? pcs : 0, supplier_order: String(d.order_no || d.po || it.subject).slice(0, 80),
          }));
          const { importManifest } = await import("@/lib/manifest");
          const res = await importManifest(admin, vendor, lines, `Email: ${it.subject}`.slice(0, 200), { customerId: cust, orderId: order?.id || null, how: named ? "the email names the job" : order ? `read from the email${d.why ? `: ${d.why}` : ""}` : "" });
          out.added += res.new;
          log.push({ at: new Date().toISOString(), subject: it.subject.slice(0, 120), from: it.from, result: order ? `${tracking.length} tracking on #${order.number} (${vendor})` : res.suggested ? `${tracking.length} tracking from ${vendor}: a job suggested, waiting for an OK on Goods & Receiving` : `${tracking.length} tracking from ${vendor}: on Goods & Receiving to link` });
          continue;
        }
        {
          // no tracking yet (an order confirmation): whoever owns the account hears what's coming and for which job
          const { data: c } = custIds[0] ? await admin.from("customers").select("company, name").eq("id", order?.customer_id || custIds[0]).maybeSingle() : { data: null };
          const { data: own } = custIds[0] ? await admin.from("customer_private").select("account_owner").eq("customer_id", order?.customer_id || custIds[0]).maybeSingle() : { data: null };
          const { SHOP_NOTIFY_EMAIL } = await import("@/lib/config");
          const ownerName = String(own?.account_owner || "");
          const { data: staff } = ownerName ? await admin.from("staff").select("email").ilike("name", ownerName).maybeSingle() : { data: null };
          const who = String((staff as { email?: string } | null)?.email || SHOP_NOTIFY_EMAIL || "").toLowerCase();
          const what = order ? `#${order.number}: no tracking yet` : custIds.length ? "no tracking yet, which order is it for?" : "whose goods are these?";
          if (who) await admin.from("alerts").insert({ owner: who, kind: "goods", title: `${d.vendor || "Vendor"} email${c ? ` for ${c.company || c.name}` : ""}: ${what}`.slice(0, 120), body: `${note}${tracking.length ? ` · tracking ${tracking.join(", ")}` : ""} · "${it.subject.slice(0, 100)}" in portal@`.slice(0, 400), url: order ? `/shop/orders/${order.id}` : "/shop/receiving", dedupe_key: `portal-inbox:${key}`, order_id: order?.id || null });
          out.alerts++;
          log.push({ at: new Date().toISOString(), subject: it.subject.slice(0, 120), from: it.from, result: `alert: ${what}` });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        out.errors.push(msg); seen.delete(key);
        log.push({ at: new Date().toISOString(), subject: it.subject.slice(0, 120), from: it.from, result: `error: ${msg.slice(0, 150)}` });
      }
    }
    // the long look back is done once a run gets through everything (no deadline cut it short)
    const back = st.back && opts.deadline && Date.now() > opts.deadline ? st.back : undefined;
    await save(admin, { ...(back ? { back } : {}), seen: [...seen].slice(-1500), log: log.slice(-60), last_run: new Date().toISOString(), last_error: out.errors.length ? out.errors.join("; ").slice(0, 300) : null });
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await save(admin, { ...st, seen: [...seen].slice(-1500), log: log.slice(-60), last_run: new Date().toISOString(), last_error: msg.slice(0, 300) });
    return { ...out, error: msg };
  }
}
