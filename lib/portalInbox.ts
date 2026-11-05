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
 * - matched: each tracking number becomes a shipment on that order's Goods (live tracking starts), goods go "on the way"
 *   and the order's goods conversation says so;
 * - not matched (or no tracking yet): an alert to whoever owns the account, with what it said.
 * Anything else in the inbox (replies to the launch email…) is left alone. Nothing is moved, marked or answered.
 */
const KEY = "portal_inbox";
type State = { seen?: string[]; log?: { at: string; subject: string; from: string; result: string }[]; last_run?: string; last_error?: string | null };

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

export async function checkPortalInbox(admin: SupabaseClient, opts: { days?: number; deadline?: number } = {}) {
  const a = await acct(admin);
  if (!a) return { skipped: "The portal's mailbox isn't connected (Settings → Site email)." };
  const st = await state(admin), seen = new Set(st.seen || []), log = [...(st.log || [])];
  const out = { looked: 0, added: 0, alerts: 0, errors: [] as string[] };
  const since = new Date(Date.now() - (opts.days || 4) * 864e5).toISOString().replace(/\.\d+Z$/, "Z");
  try {
    const x = await call(a, `<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="item:Subject"/><t:FieldURI FieldURI="message:From"/><t:FieldURI FieldURI="message:InternetMessageId"/><t:FieldURI FieldURI="item:DateTimeReceived"/><t:FieldURI FieldURI="item:HasAttachments"/></t:AdditionalProperties></m:ItemShape><m:IndexedPageItemView MaxEntriesReturned="100" Offset="0" BasePoint="Beginning"/><m:Restriction><t:IsGreaterThan><t:FieldURI FieldURI="item:DateTimeReceived"/><t:FieldURIOrConstant><t:Constant Value="${since}"/></t:FieldURIOrConstant></t:IsGreaterThan></m:Restriction><m:SortOrder><t:FieldOrder Order="Ascending"><t:FieldURI FieldURI="item:DateTimeReceived"/></t:FieldOrder></m:SortOrder><m:ParentFolderIds><t:DistinguishedFolderId Id="inbox"/></m:ParentFolderIds></m:FindItem>`);
    const items = all(x, "Message").map((m) => ({ id: attr(all(m.inner, "ItemId")[0]?.attrs || "", "Id"), subject: unesc(one(m.inner, "Subject")), from: unesc(one(one(m.inner, "From"), "EmailAddress")).toLowerCase(), mid: unesc(one(m.inner, "InternetMessageId")), att: one(m.inner, "HasAttachments") === "true" }));
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
        const r = await askClaude<{ is_goods: boolean; vendor: string; order_no: string; carrier: string; tracking: string[]; boxes: number | null; eta: string; what: string; order_id: string; why: string }>({
          task: "goods_paper_portal_inbox", model: ai.settings.assistant.ai.fastModel || ai.settings.assistant.ai.model, maxTokens: 700, admin, ctx: { by: "portal inbox" }, timeoutMs: 45_000, documents,
          tool: { name: "shipment", description: "What this email says about goods (blank garments, hats, bags…) a vendor is sending to FBS Print for a customer's order.", input_schema: { type: "object", required: ["is_goods", "vendor", "order_no", "carrier", "tracking", "boxes", "eta", "what", "order_id", "why"], properties: {
            is_goods: { type: "boolean", description: "True only when this is a vendor's order confirmation, shipping notice or tracking email for goods. False for anything else (a question, a reply, marketing, a print order request)." },
            vendor: { type: "string", description: "Who is selling or shipping the goods (Peter Millar, One Stop, a store…). Empty when not said." },
            order_no: { type: "string", description: "The vendor's order / confirmation number, or the PO on it. Empty when none." },
            carrier: { type: "string", description: "UPS, FedEx, USPS, DHL, a freight line… Empty when not said." },
            tracking: { type: "array", items: { type: "string" }, description: "Every tracking (or PRO) number, no spaces. Empty when none yet." },
            boxes: { type: ["integer", "null"], description: "How many boxes or cartons, when said." },
            eta: { type: "string", description: "Expected delivery date YYYY-MM-DD, or empty." },
            what: { type: "string", description: "What's in it in a few words: quantity, style, color." },
            order_id: { type: "string", description: "The id of the order below these goods are for, by its PO, name or garments. Empty when you can't tell." },
            why: { type: "string", description: "A few words on why that order. Empty when none." } } } },
          system: `Read an email that came to FBS Print's portal mailbox. Customers copy this address on their vendors' order confirmations and shipping emails so the shop knows goods are coming. Pull out only what it says; never invent numbers. The customer's open orders at the shop:\n${labels.join("\n") || "(none found)"}`,
          prompt: `Subject: ${it.subject}\nFrom: ${it.from}\n\n${body}`,
        });
        if (!r.ok) throw new Error(r.error || "Couldn't read it.");
        const d = r.data;
        if (!d.is_goods) { log.push({ at: new Date().toISOString(), subject: it.subject.slice(0, 120), from: it.from, result: "not goods paperwork" }); continue; }
        const order = list.find((o) => o.id === d.order_id) || (list.length === 1 ? list[0] : null);
        const tracking = [...new Set((d.tracking || []).map((t) => String(t).replace(/\s+/g, "")).filter(Boolean))].slice(0, 20);
        const from = [d.vendor, d.order_no && `order ${d.order_no}`].filter(Boolean).join(", ");
        const note = [from && `From ${from}`, d.what].filter(Boolean).join(": ").slice(0, 2000) || `From the email "${it.subject.slice(0, 120)}"`;
        if (order && tracking.length) {
          const { startTracker } = await import("@/lib/goodsTrack");
          const { data: have } = await admin.from("goods_shipments").select("tracking").eq("order_id", order.id).in("tracking", tracking);
          const known = new Set(((have || []) as { tracking: string }[]).map((x) => x.tracking));
          let n = 0;
          for (const t of tracking) {
            if (known.has(t)) continue;
            const carrier = (d.carrier || carrierOf(t)).slice(0, 40);
            const { data: row } = await admin.from("goods_shipments").insert({ order_id: order.id, carrier, tracking: t, boxes: d.boxes && d.boxes > 0 ? Math.min(9999, d.boxes) : null, eta: /^\d{4}-\d{2}-\d{2}$/.test(d.eta || "") ? d.eta : null, note, files: [], added_by: "staff", author_name: "Portal inbox" }).select("id").single();
            if (row) { const f = await startTracker(t, carrier).catch(() => null); if (f) await admin.from("goods_shipments").update(f).eq("id", row.id); }
            n++;
          }
          if (n) {
            const { data: gs } = await admin.from("order_goods").select("status").eq("order_id", order.id).maybeSingle();
            if (!gs || gs.status === "waiting") await admin.from("order_goods").upsert({ order_id: order.id, status: "on_way", updated_by: "portal inbox", updated_at: new Date().toISOString() });
            await admin.from("messages").insert({ order_id: order.id, topic: "goods", author_type: "staff", author_email: a.email, author_name: "FBS Print", body: `📦 ${from || "Your goods"} shipped: ${tracking.join(", ")}${d.eta ? ` · expected ${d.eta}` : ""}. We'll let you know when they're here.` });
            out.added += n;
          }
          log.push({ at: new Date().toISOString(), subject: it.subject.slice(0, 120), from: it.from, result: n ? `added ${n} tracking to #${order.number}` : `#${order.number}: tracking already on it` });
        } else {
          // the shop decides: which order, or no tracking yet (a confirmation)
          const { data: c } = custIds[0] ? await admin.from("customers").select("company, name").eq("id", order?.customer_id || custIds[0]).maybeSingle() : { data: null };
          const { data: own } = custIds[0] ? await admin.from("customer_private").select("account_owner").eq("customer_id", order?.customer_id || custIds[0]).maybeSingle() : { data: null };
          const { SHOP_NOTIFY_EMAIL } = await import("@/lib/config");
          const ownerName = String(own?.account_owner || "");
          const { data: staff } = ownerName ? await admin.from("staff").select("email").ilike("name", ownerName).maybeSingle() : { data: null };
          const who = String((staff as { email?: string } | null)?.email || SHOP_NOTIFY_EMAIL || "").toLowerCase();
          const what = order ? `#${order.number}: ${tracking.length ? "" : "no tracking yet"}` : custIds.length ? "which order is it for?" : "whose goods are these?";
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
    await save(admin, { seen: [...seen].slice(-600), log: log.slice(-60), last_run: new Date().toISOString(), last_error: out.errors.length ? out.errors.join("; ").slice(0, 300) : null });
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await save(admin, { ...st, seen: [...seen].slice(-600), log: log.slice(-60), last_run: new Date().toISOString(), last_error: msg.slice(0, 300) });
    return { ...out, error: msg };
  }
}
