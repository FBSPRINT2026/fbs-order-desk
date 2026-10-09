import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Settings } from "@/lib/pricing";
import { Qbo, QboError } from "@/lib/qbo/client";
import {
  customerCreateBody, customerDiff, fromPrintavo, hashOf, invoiceFingerprint, invoicePayload, isInvoiceStatus, matchPayment,
  ownedFromOurs, ownedFromQbo, paymentPayload, type OrderRow, type OurCustomer, type OurPayment, type Owned, type QboSettings,
} from "@/lib/qbo/map";

/**
 * Sends one queued change to QuickBooks (or, in preview, builds exactly what would be sent and keeps it on the queue
 * row). Linked records are always found by QuickBooks' Id (qbo_links), never by name.
 *
 *   customer  made in QuickBooks with its first invoice; after that only the fields we own are updated, and a field
 *             someone changed in QuickBooks since we last sent it is flagged for the owner instead of overwritten.
 *   invoice   #live_from_number and up: made / updated from our order (calcOrder), total checked against ours.
 *             #adopt_from_number up to live_from_number: Printavo made them; we only link to them (by number).
 *             Below adopt_from_number: never touched. Quotes are never sent.
 *   payment   applied to the order's QuickBooks invoice. One QuickBooks already has (Printavo's, or entered there)
 *             is linked, not made twice. Payments that came from Printavo are never made by us.
 */

export type QRow = { id: number; entity: "customer" | "invoice" | "payment"; local_id: string; op: "upsert" | "void" | "delete"; status: string; reason: string; attempts: number; request_key: string; resolution: Record<string, unknown> | null; result: Record<string, unknown> | null };
export type Outcome = {
  status: "done" | "skipped" | "needs_review" | "pending" | "error";
  reason: string;
  preview?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  /** pending / error: try again after this many minutes */
  retryMin?: number;
};
export type Link = { id: number; realm_id: string; entity: string; local_id: string; qbo_id: string; sync_token: string | null; is_primary: boolean; source: string; last_pushed_hash: string | null; last_sent: Record<string, unknown> | null; last_seen_qbo: Record<string, unknown> | null; qbo_owned_fields: string[] };
type Rec = Record<string, unknown> & { Id: string; SyncToken: string };

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const now = () => new Date().toISOString();
const r2 = (n: number) => Math.round((+n || 0) * 100) / 100;

export class Pusher {
  /** qbo: null when QuickBooks isn't connected (previews are still built). live: false = preview, nothing is sent. */
  constructor(private admin: SupabaseClient, private qs: QboSettings, private settings: Settings, private qbo: Qbo | null, private realm: string, private live: boolean) {}

  async process(row: QRow): Promise<Outcome> {
    if (row.entity === "customer") return this.customer(row);
    if (row.entity === "invoice") return row.op === "void" ? this.voidInvoice(row) : this.invoice(row);
    return row.op === "delete" ? this.deletePayment(row) : this.payment(row);
  }

  /* ---------- links ---------- */

  async link(entity: string, localId: string): Promise<Link | null> {
    if (!this.realm) return null;
    const { data } = await this.admin.from("qbo_links").select("*").eq("realm_id", this.realm).eq("entity", entity).eq("local_id", localId).eq("is_primary", true).maybeSingle();
    return (data as Link) || null;
  }
  async linkByQbo(entity: string, qboId: string): Promise<Link | null> {
    if (!this.realm) return null;
    const { data } = await this.admin.from("qbo_links").select("*").eq("realm_id", this.realm).eq("entity", entity).eq("qbo_id", qboId).maybeSingle();
    return (data as Link) || null;
  }
  async saveLink(x: { entity: string; local_id: string; qbo_id: string; source: string; rec?: Rec | null; last_sent?: unknown; hash?: string | null; pushed?: boolean; note?: string }) {
    const has = await this.link(x.entity, x.local_id);
    const row: Record<string, unknown> = {
      realm_id: this.realm, entity: x.entity, local_id: x.local_id, qbo_id: x.qbo_id, source: x.source, updated_at: now(),
      is_primary: !has || has.qbo_id === x.qbo_id,
      ...(x.rec ? { sync_token: x.rec.SyncToken, last_seen_qbo: x.rec, last_seen_at: now() } : {}),
      ...(x.last_sent !== undefined ? { last_sent: x.last_sent } : {}),
      ...(x.hash !== undefined ? { last_pushed_hash: x.hash } : {}),
      ...(x.pushed ? { last_pushed_at: now(), changed_in_qbo: null } : {}),
      ...(x.note !== undefined ? { note: x.note } : {}),
    };
    const exist = await this.linkByQbo(x.entity, x.qbo_id);
    if (exist) { delete row.source; delete row.is_primary; }
    const { error } = exist ? await this.admin.from("qbo_links").update(row).eq("id", exist.id) : await this.admin.from("qbo_links").insert(row);
    if (error) throw new Error(`Couldn't save the QuickBooks link: ${error.message}`);
  }
  private key(row: QRow, ...parts: string[]) {
    // the same queued change always sends the same request id, so a retried create can't make a second copy;
    // after QuickBooks refused one (salt), a fixed retry gets a new id
    const salt = String((row.result as { salt?: number } | null)?.salt || 0);
    return `fbs-${row.entity[0]}-${hashOf([row.request_key, salt, ...parts])}${hashOf([row.id, ...parts]).slice(0, 8)}`;
  }

  /* ---------- customers ---------- */

  private async ourCustomer(id: string): Promise<OurCustomer | null> {
    const { data } = await this.admin.from("customers").select("id, company, name, email, phone, address, ship_address, tax_exempt, payment_terms, is_test").eq("id", id).maybeSingle();
    return (data as OurCustomer) || null;
  }
  private async needsQboCustomer(customerId: string) {
    const { data } = await this.admin.from("orders").select("status").eq("customer_id", customerId).gte("number", this.qs.live_from_number).limit(200);
    return (data || []).some((o) => isInvoiceStatus(String(o.status)));
  }

  async customer(row: QRow, dependency = false): Promise<Outcome & { qboId?: string }> {
    const c = await this.ourCustomer(row.local_id);
    if (!c) return { status: "skipped", reason: "The customer was deleted." };
    if (c.is_test) return { status: "skipped", reason: "Test customer: never sent." };
    let link = await this.link("customer", c.id);
    const res = (row.resolution || {}) as { link_qbo_id?: string; force_fields?: string[] };

    if (!link) {
      const body = customerCreateBody(c, this.qs);
      if (!dependency && !(await this.needsQboCustomer(c.id))) return { status: "skipped", reason: "No invoice to send yet: the customer is added to QuickBooks with their first invoice (unless matching links them to one that's already there).", preview: { action: "none yet", wouldCreate: body } };
      const preview = { action: "create", body };
      if (!this.qbo) return { status: "pending", reason: "Not connected: would create this customer in QuickBooks.", preview };
      const same = await this.qbo.with({ entity: "customer", localId: c.id }).query<Rec & { DisplayName?: string; PrimaryEmailAddr?: { Address?: string }; Active?: boolean }>("Customer", `WHERE DisplayName = '${esc(String(body.DisplayName))}' AND Active IN (true, false)`);
      if (same.length) {
        const e = same[0], other = await this.linkByQbo("customer", e.Id);
        if (!other && res.link_qbo_id === e.Id) {
          await this.saveLink({ entity: "customer", local_id: c.id, qbo_id: e.Id, source: "manual", rec: e });
          link = await this.link("customer", c.id);
        } else {
          let otherName = "";
          if (other) { const { data: oc } = await this.admin.from("customers").select("company, name").eq("id", other.local_id).maybeSingle(); otherName = String(oc?.company || oc?.name || other.local_id); }
          return {
            status: "needs_review",
            reason: other
              ? `QuickBooks customer "${e.DisplayName}" (#${e.Id}) is already linked to another of our customers (${otherName}). QuickBooks names must be unique: rename one of them, or merge the two customers here.`
              : `QuickBooks already has a customer named "${e.DisplayName}" (#${e.Id}${e.Active === false ? ", inactive" : ""}) that isn't linked to anyone. If it's this customer, press "Link to it"; if not, rename ours.`,
            preview: { ...preview, existing: { Id: e.Id, DisplayName: e.DisplayName, email: e.PrimaryEmailAddr?.Address || "", active: e.Active !== false, linkedTo: otherName || null }, canLink: !other ? e.Id : null },
          };
        }
      } else {
        if (!this.live) return { status: "pending", reason: "Preview: would create this customer in QuickBooks.", preview };
        const made = await this.qbo.with({ entity: "customer", localId: c.id }).create<Rec>("Customer", body, this.key(row, "create"));
        await this.saveLink({ entity: "customer", local_id: c.id, qbo_id: made.Id, source: "created", rec: made, last_sent: ownedFromQbo(made), hash: hashOf(body), pushed: true });
        return { status: "done", reason: `Created QuickBooks customer #${made.Id}.`, result: { qboId: made.Id }, qboId: made.Id, preview };
      }
    }
    if (!link) return { status: "error", reason: "Link wasn't saved." };

    // linked: compare with QuickBooks as it is now, change only what we own and only what differs
    if (!this.qbo) return { status: "pending", reason: `Not connected: would compare with QuickBooks customer #${link.qbo_id} and send what changed.`, preview: { action: "update", qboId: link.qbo_id, ours: ownedFromOurs(c, this.qs) } };
    const q = this.qbo.with({ entity: "customer", localId: c.id, qboId: link.qbo_id });
    const cur = await q.read<Rec>("Customer", link.qbo_id);
    if (!cur) return { status: "needs_review", reason: `The linked QuickBooks customer #${link.qbo_id} is gone (deleted or merged in QuickBooks). Unlink it under Customer matching and link the right one.` };
    const d = customerDiff(c, cur, (link.last_sent as Owned) || null, this.qs, link.qbo_owned_fields || [], res.force_fields || []);
    const changes = d.change.map((f) => ({ field: f, from: d.now[f] || "", to: d.ours[f] || "" }));
    if (d.conflicts.length) {
      return {
        status: "needs_review",
        reason: "Changed in QuickBooks since we last sent it: " + d.conflicts.map((x) => `${x.label} (QuickBooks: "${x.qbo}", ours: "${x.ours}")`).join("; ") + ". Pick which one wins.",
        preview: { action: "update", qboId: link.qbo_id, conflicts: d.conflicts, changes, body: d.body },
      };
    }
    if (!d.body) {
      await this.saveLink({ entity: "customer", local_id: c.id, qbo_id: link.qbo_id, source: link.source, rec: cur, ...(link.last_sent ? {} : { last_sent: ownedFromQbo(cur) }) });
      return { status: "done", reason: "Already the same in QuickBooks.", qboId: link.qbo_id, preview: { action: "none", qboId: link.qbo_id } };
    }
    const body = { ...d.body, Id: link.qbo_id, SyncToken: cur.SyncToken, sparse: true };
    const preview = { action: "update", qboId: link.qbo_id, rename: d.rename ? { from: d.now.DisplayName, to: d.ours.DisplayName } : null, changes, body };
    if (!this.live) return { status: "pending", reason: d.rename ? `Preview: would rename QuickBooks customer #${link.qbo_id} "${d.now.DisplayName}" → "${d.ours.DisplayName}".` : `Preview: would update ${changes.map((x) => x.field).join(", ")}.`, preview, qboId: link.qbo_id };
    const upd = await q.sparseUpdate<Rec>("Customer", link.qbo_id, cur.SyncToken, d.body);
    await this.saveLink({ entity: "customer", local_id: c.id, qbo_id: link.qbo_id, source: link.source, rec: upd, last_sent: ownedFromQbo(upd), hash: hashOf(d.body), pushed: true });
    return { status: "done", reason: d.rename ? `Renamed QuickBooks customer #${link.qbo_id} to "${d.ours.DisplayName}".` : `Updated ${changes.map((x) => x.field).join(", ")}.`, result: { qboId: link.qbo_id, changes }, qboId: link.qbo_id, preview };
  }

  /* ---------- invoices ---------- */

  private async order(id: string): Promise<OrderRow | null> {
    const { data } = await this.admin.from("orders").select("*").eq("id", id).maybeSingle();
    return (data as OrderRow) || null;
  }

  async invoice(row: QRow): Promise<Outcome & { qboId?: string }> {
    const o = await this.order(row.local_id);
    if (!o) return { status: "skipped", reason: "The order was deleted." };
    const n = +o.number;
    if (n < this.qs.adopt_from_number) return { status: "skipped", reason: `#${n} is from Printavo's time (below #${this.qs.adopt_from_number}): never touched.` };
    const cust = o.customer_id ? await this.ourCustomer(o.customer_id) : null;
    if (cust?.is_test) return { status: "skipped", reason: "Test customer: never sent." };
    const link = await this.link("invoice", o.id);
    const res = (row.resolution || {}) as { force?: boolean; void?: boolean };

    if (!isInvoiceStatus(o.status)) {
      if (link && link.source === "created") {
        if (res.void) return this.voidInvoice(row);
        return { status: "needs_review", reason: `#${n} went back to a quote after it was sent to QuickBooks (invoice #${link.qbo_id}). Press "Void in QuickBooks" if it's cancelled, or Skip to leave it.`, preview: { action: "void?", qboId: link.qbo_id } };
      }
      return { status: "skipped", reason: "Quote: quotes aren't sent to QuickBooks." };
    }
    if (n < this.qs.live_from_number) return this.adopt(row, o, link);

    if (!o.customer_id) return { status: "needs_review", reason: "The order has no customer." };
    let custLink = await this.link("customer", o.customer_id);
    if (!custLink && this.qbo) {
      // the customer goes first (made with its first invoice)
      const co = await this.customer({ ...row, entity: "customer", local_id: o.customer_id, resolution: null }, true);
      if (co.status === "done") custLink = await this.link("customer", o.customer_id);
      else if (this.live) {
        await this.admin.rpc("qbo_enqueue", { p_entity: "customer", p_local_id: o.customer_id, p_op: "upsert", p_reason: `for invoice #${n}` });
        if (row.attempts >= 12) return { status: "needs_review", reason: `Waiting for the customer to be added to QuickBooks: ${co.reason}` };
        return { status: "pending", reason: `Waiting for the customer: ${co.reason}`, retryMin: 10 };
      }
    }
    const build = invoicePayload({ order: o, customer: cust, customerRef: custLink ? { value: custLink.qbo_id } : null, settings: this.settings, qs: this.qs });
    const preview: Record<string, unknown> = { action: link ? "update" : "create", qboId: link?.qbo_id || null, total: build.total, storedTotal: build.storedTotal, summary: build.summary, warnings: build.warnings, problems: build.problems, body: build.body };
    const localProblems = build.problems.filter((p) => !/isn't in QuickBooks yet/.test(p));
    if (!this.qbo) return { status: "pending", reason: `Not connected: would ${link ? "update" : "create"} QuickBooks invoice #${n} for ${build.total.toFixed(2)}.`, preview };

    let lk = link;
    if (!lk) {
      // already in QuickBooks under this number? link to it rather than make a second one
      const ex = await this.qbo.with({ entity: "invoice", localId: o.id }).query<Rec & { DocNumber?: string; CustomerRef?: { value: string; name?: string }; TotalAmt?: number }>("Invoice", `WHERE DocNumber = '${n}'`);
      if (ex.length) {
        const e = ex[0], owner = await this.linkByQbo("customer", String(e.CustomerRef?.value || ""));
        if (owner?.local_id === o.customer_id) { await this.saveLink({ entity: "invoice", local_id: o.id, qbo_id: e.Id, source: "adopted_docnumber", rec: e }); lk = await this.link("invoice", o.id); }
        else return { status: "needs_review", reason: `QuickBooks already has invoice #${n} (QuickBooks #${e.Id}, for ${e.CustomerRef?.name || "another customer"}, ${r2(+(e.TotalAmt || 0)).toFixed(2)}). Not sent, so it isn't duplicated.`, preview };
      }
    }
    if (!this.live) return { status: "pending", reason: `Preview: would ${lk ? "update" : "create"} QuickBooks invoice #${n} for ${build.total.toFixed(2)}.`, preview };
    if (localProblems.length || !custLink) return { status: "needs_review", reason: [...localProblems, ...(!custLink ? ["The customer isn't in QuickBooks yet."] : [])].join(" "), preview };

    const q = this.qbo.with({ entity: "invoice", localId: o.id, qboId: lk?.qbo_id });
    let rec: Rec & { TotalAmt?: number };
    if (!lk) {
      rec = await q.create("Invoice", build.body, this.key(row, "create"));
      await this.saveLink({ entity: "invoice", local_id: o.id, qbo_id: rec.Id, source: "created", rec, last_sent: { fingerprint: invoiceFingerprint(rec) }, hash: hashOf(build.body), pushed: true });
    } else {
      const cur = await q.read<Rec & { TotalAmt?: number; PrivateNote?: string }>("Invoice", lk.qbo_id);
      if (!cur) return { status: "needs_review", reason: `QuickBooks invoice #${lk.qbo_id} is gone (deleted in QuickBooks).`, preview };
      const base = (lk.last_sent as { fingerprint?: string } | null)?.fingerprint || (lk.last_seen_qbo ? invoiceFingerprint(lk.last_seen_qbo) : "");
      const fp = invoiceFingerprint(cur);
      if (base && fp !== base && !res.force) {
        return { status: "needs_review", reason: `QuickBooks invoice #${n} was changed in QuickBooks since we last sent it (its total there is ${r2(+(cur.TotalAmt || 0)).toFixed(2)}, ours is ${build.total.toFixed(2)}). Press "Send ours anyway" to replace it with ours, or Skip to leave QuickBooks' version.`, preview: { ...preview, qboTotal: cur.TotalAmt } };
      }
      if (lk.last_pushed_hash === hashOf(build.body) && fp === base) return { status: "done", reason: "No changes since it was last sent.", qboId: lk.qbo_id, preview };
      rec = await q.sparseUpdate("Invoice", lk.qbo_id, cur.SyncToken, build.body);
      await this.saveLink({ entity: "invoice", local_id: o.id, qbo_id: lk.qbo_id, source: lk.source, rec, last_sent: { fingerprint: invoiceFingerprint(rec) }, hash: hashOf(build.body), pushed: true });
    }
    const diff = r2(+(rec.TotalAmt || 0) - build.total);
    if (Math.abs(diff) >= 0.01) return { status: "needs_review", reason: `Sent, but QuickBooks' total for #${n} is ${r2(+(rec.TotalAmt || 0)).toFixed(2)} and ours is ${build.total.toFixed(2)} (difference ${diff.toFixed(2)}). Usually the sales tax setting: check it, then Retry.`, preview, result: { qboId: rec.Id, qboTotal: rec.TotalAmt } };
    return { status: "done", reason: `${link ? "Updated" : "Created"} QuickBooks invoice #${n} (${build.total.toFixed(2)}).`, preview, result: { qboId: rec.Id, total: rec.TotalAmt }, qboId: rec.Id };
  }

  /** #40000-#49999: Printavo made the QuickBooks invoice; we link to it by its number and never make our own. */
  private async adopt(row: QRow, o: OrderRow, link: Link | null): Promise<Outcome & { qboId?: string }> {
    const n = +o.number;
    if (link) return { status: "done", reason: `Linked to Printavo's QuickBooks invoice (#${link.qbo_id}); not changed.`, qboId: link.qbo_id };
    const nums = [...new Set([String(n), String(o.printavo_visual_id || "").trim()].filter(Boolean))];
    // our own version of the invoice, for comparing with Printavo's (Printavo adds its card surcharge on its copy)
    const cust = o.customer_id ? await this.ourCustomer(o.customer_id) : null;
    const ours = invoicePayload({ order: o, customer: cust, customerRef: null, settings: this.settings, qs: this.qs });
    const preview = { action: "adopt", lookFor: nums, note: `#${n} is a transition order: Printavo sends it to QuickBooks; we only link to it (payments recorded here after the cutover go on it).`, total: ours.total, storedTotal: ours.storedTotal, summary: ours.summary, warnings: ours.warnings };
    if (!this.qbo) return { status: "pending", reason: `Not connected: would look for QuickBooks invoice ${nums.map((x) => "#" + x).join(" / ")} (made by Printavo) and link to it.`, preview };
    const found = await this.qbo.with({ entity: "invoice", localId: o.id }).query<Rec & { DocNumber?: string; CustomerRef?: { value: string; name?: string }; TotalAmt?: number }>("Invoice", `WHERE DocNumber IN (${nums.map((x) => `'${esc(x)}'`).join(", ")})`);
    if (!found.length) {
      if (row.attempts < 6) return { status: "error", reason: `No QuickBooks invoice #${nums.join(" / ")} yet (Printavo sends it). Will look again.`, retryMin: 60 * Math.max(1, row.attempts), preview };
      return { status: "needs_review", reason: `No QuickBooks invoice #${nums.join(" / ")} found. Printavo should have sent it; check Printavo's QuickBooks sync, or Skip.`, preview };
    }
    let pick = found[0];
    for (const f of found) { const owner = await this.linkByQbo("customer", String(f.CustomerRef?.value || "")); if (owner?.local_id === o.customer_id) { pick = f; break; } }
    await this.saveLink({ entity: "invoice", local_id: o.id, qbo_id: pick.Id, source: "adopted_docnumber", rec: pick });
    const owner = await this.linkByQbo("customer", String(pick.CustomerRef?.value || ""));
    const note = owner && owner.local_id !== o.customer_id ? " Its QuickBooks customer is linked to a different customer of ours: check the matching." : !owner ? ` Its QuickBooks customer (${pick.CustomerRef?.name || pick.CustomerRef?.value}) isn't linked yet: run Customer matching.` : "";
    return { status: "done", reason: `Linked to Printavo's QuickBooks invoice #${pick.DocNumber} (QuickBooks #${pick.Id}, ${r2(+(pick.TotalAmt || 0)).toFixed(2)}).${note}`, result: { qboId: pick.Id, qboTotal: pick.TotalAmt }, qboId: pick.Id, preview };
  }

  async voidInvoice(row: QRow): Promise<Outcome> {
    const link = await this.link("invoice", row.local_id);
    if (!link) return { status: "skipped", reason: "Never in QuickBooks: nothing to void." };
    if (link.source !== "created") return { status: "needs_review", reason: `QuickBooks invoice #${link.qbo_id} was made by Printavo, so it isn't voided automatically. Void it in QuickBooks if the order is cancelled, then Skip.` };
    const preview = { action: "void", qboId: link.qbo_id };
    if (!this.qbo) return { status: "pending", reason: `Not connected: would void QuickBooks invoice #${link.qbo_id}.`, preview };
    if (!this.live) return { status: "pending", reason: `Preview: would void QuickBooks invoice #${link.qbo_id}.`, preview };
    const q = this.qbo.with({ entity: "invoice", localId: row.local_id, qboId: link.qbo_id });
    const cur = await q.read<Rec>("Invoice", link.qbo_id);
    if (!cur) return { status: "done", reason: "Already gone from QuickBooks." };
    const v = await q.voidInvoice(link.qbo_id, cur.SyncToken);
    await this.saveLink({ entity: "invoice", local_id: row.local_id, qbo_id: link.qbo_id, source: link.source, rec: v as Rec, note: "voided" });
    return { status: "done", reason: `Voided QuickBooks invoice #${link.qbo_id}.`, preview };
  }

  /* ---------- payments ---------- */

  async payment(row: QRow): Promise<Outcome> {
    const { data: pd } = await this.admin.from("payments").select("*").eq("id", row.local_id).maybeSingle();
    const p = pd as OurPayment | null;
    if (!p) return { status: "skipped", reason: "The payment was deleted." };
    const o = await this.order(p.order_id);
    if (!o) return { status: "skipped", reason: "Its order was deleted." };
    const n = +o.number;
    if (n < this.qs.adopt_from_number) return { status: "skipped", reason: `Payment on #${n}, from Printavo's time: never touched.` };
    const cust = o.customer_id ? await this.ourCustomer(o.customer_id) : null;
    if (cust?.is_test) return { status: "skipped", reason: "Test customer: never sent." };
    const link = await this.link("payment", p.id);

    if (link && link.source !== "created") {
      const qa = r2(+((link.last_seen_qbo as { TotalAmt?: number } | null)?.TotalAmt || 0));
      if (qa && qa !== r2(+p.amount)) return { status: "needs_review", reason: `Our payment is now ${r2(+p.amount).toFixed(2)}, but its QuickBooks copy (#${link.qbo_id}, made by Printavo or in QuickBooks) is ${qa.toFixed(2)}. Fix it in QuickBooks, then Skip.` };
      return { status: "done", reason: `Matched to QuickBooks payment #${link.qbo_id}; not changed.` };
    }
    if (r2(+p.amount) <= 0 && !link) return { status: "needs_review", reason: paymentPayload({ payment: p, orderNumber: n, invoiceId: "", customerRef: "", qs: this.qs }).problems.join(" ") };

    let inv = await this.link("invoice", o.id);
    if (!inv && this.qbo) {
      const io = await this.invoice({ ...row, entity: "invoice", local_id: o.id, op: "upsert", resolution: null });
      if (io.status === "done") inv = await this.link("invoice", o.id);
    }
    if (!inv) {
      if (fromPrintavo(p)) {
        const why = `Came from Printavo, which sends its own payments to QuickBooks: once invoice #${n} is linked it's matched to Printavo's copy, never made by us.`;
        if (!this.qbo || !this.live) return { status: "pending", reason: `${this.qbo ? "Preview" : "Not connected"}: ${why}`, preview: { action: "match only", amount: r2(+p.amount), paid_on: p.paid_on } };
        if (row.attempts >= 12) return { status: "skipped", reason: why };
        return { status: "pending", reason: `Waiting for invoice #${n} to be linked. ${why}`, retryMin: 60 };
      }
      const preview = { action: "create", body: paymentPayload({ payment: p, orderNumber: n, invoiceId: "(invoice #" + n + ")", customerRef: "(the invoice's customer)", qs: this.qs }).body };
      if (!this.qbo || !this.live) return { status: "pending", reason: `${this.qbo ? "Preview" : "Not connected"}: would apply ${r2(+p.amount).toFixed(2)} to QuickBooks invoice #${n} once it's there.`, preview };
      await this.admin.rpc("qbo_enqueue", { p_entity: "invoice", p_local_id: o.id, p_op: "upsert", p_reason: "for a payment" });
      if (row.attempts >= 12) return { status: "needs_review", reason: `Invoice #${n} isn't in QuickBooks yet, so the payment can't be applied. See the invoice's row.`, preview };
      return { status: "pending", reason: `Waiting for invoice #${n} to be in QuickBooks.`, retryMin: 15, preview };
    }

    // the invoice's own QuickBooks customer (for merged customers it can be one of the other linked ones)
    let invRec = inv.last_seen_qbo as (Rec & { CustomerRef?: { value: string }; LinkedTxn?: { TxnId: string; TxnType: string }[] }) | null;
    if (this.qbo) invRec = (await this.qbo.with({ entity: "invoice", localId: o.id, qboId: inv.qbo_id }).read<Rec & { CustomerRef?: { value: string }; LinkedTxn?: { TxnId: string; TxnType: string }[] }>("Invoice", inv.qbo_id)) || invRec;
    const customerRef = String(invRec?.CustomerRef?.value || (o.customer_id ? (await this.link("customer", o.customer_id))?.qbo_id : "") || "");
    const build = paymentPayload({ payment: p, orderNumber: n, invoiceId: inv.qbo_id, customerRef, qs: this.qs });

    if (link) {
      // ours, already sent: update it if it changed here
      const h = hashOf(build.body);
      if (h === link.last_pushed_hash) return { status: "done", reason: "No changes since it was last sent." };
      const preview = { action: "update", qboId: link.qbo_id, body: build.body };
      if (build.problems.length) return { status: "needs_review", reason: build.problems.join(" "), preview };
      if (!this.qbo) return { status: "pending", reason: `Not connected: would update QuickBooks payment #${link.qbo_id}.`, preview };
      if (!this.live) return { status: "pending", reason: `Preview: would update QuickBooks payment #${link.qbo_id}.`, preview };
      const q = this.qbo.with({ entity: "payment", localId: p.id, qboId: link.qbo_id });
      const cur = await q.read<Rec>("Payment", link.qbo_id);
      if (!cur) return { status: "needs_review", reason: `QuickBooks payment #${link.qbo_id} is gone (deleted in QuickBooks).`, preview };
      const upd = await q.sparseUpdate<Rec>("Payment", link.qbo_id, cur.SyncToken, build.body);
      await this.saveLink({ entity: "payment", local_id: p.id, qbo_id: link.qbo_id, source: link.source, rec: upd, hash: h, pushed: true });
      return { status: "done", reason: `Updated QuickBooks payment #${link.qbo_id}.`, preview };
    }

    // already in QuickBooks? (Printavo sent it, or someone entered it there): same amount within 3 days, on this invoice
    if (this.qbo && invRec) {
      const ids = (invRec.LinkedTxn || []).filter((t) => t.TxnType === "Payment").map((t) => t.TxnId).slice(0, 25);
      if (ids.length) {
        const q = this.qbo.with({ entity: "payment", localId: p.id });
        const cands = await q.query<Rec & { TotalAmt?: number; TxnDate?: string }>("Payment", `WHERE Id IN (${ids.map((x) => `'${esc(x)}'`).join(", ")})`);
        const { data: taken } = await this.admin.from("qbo_links").select("qbo_id").eq("realm_id", this.realm).eq("entity", "payment").in("qbo_id", ids);
        const m = matchPayment(p, cands, new Set((taken || []).map((t) => String(t.qbo_id))));
        if (m) {
          await this.saveLink({ entity: "payment", local_id: p.id, qbo_id: m.Id, source: "matched_payment", rec: m as Rec });
          return { status: "done", reason: `Already in QuickBooks: matched to payment #${m.Id} (${r2(+(m.TotalAmt || 0)).toFixed(2)} on ${m.TxnDate}).` };
        }
      }
    }
    if (fromPrintavo(p)) return { status: "skipped", reason: `Came from Printavo, which sends its own payments to QuickBooks${this.qbo ? `; no matching payment found on QuickBooks invoice #${n}` : ""}. Never made by us.` };

    const preview = { action: "create", invoiceQboId: inv.qbo_id, body: build.body };
    if (build.problems.length) return { status: "needs_review", reason: build.problems.join(" "), preview };
    if (!customerRef) return { status: "needs_review", reason: "Couldn't tell which QuickBooks customer the invoice is under.", preview };
    if (!this.qbo) return { status: "pending", reason: `Not connected: would apply ${build.amount.toFixed(2)} to QuickBooks invoice #${n}.`, preview };
    if (!this.live) return { status: "pending", reason: `Preview: would apply ${build.amount.toFixed(2)} to QuickBooks invoice #${n}.`, preview };
    const made = await this.qbo.with({ entity: "payment", localId: p.id }).create<Rec>("Payment", build.body, this.key(row, "create"));
    await this.saveLink({ entity: "payment", local_id: p.id, qbo_id: made.Id, source: "created", rec: made, hash: hashOf(build.body), pushed: true });
    return { status: "done", reason: `Applied ${build.amount.toFixed(2)} to QuickBooks invoice #${n} (payment #${made.Id}).`, preview, result: { qboId: made.Id } };
  }

  async deletePayment(row: QRow): Promise<Outcome> {
    const link = await this.link("payment", row.local_id);
    if (!link) return { status: "skipped", reason: "Never in QuickBooks: nothing to delete." };
    if (link.source !== "created") return { status: "needs_review", reason: `Deleted here, but QuickBooks payment #${link.qbo_id} was made by Printavo (or in QuickBooks), so it isn't deleted automatically. Delete it there if it should go, then Skip.` };
    const preview = { action: "delete", qboId: link.qbo_id };
    if (!this.qbo) return { status: "pending", reason: `Not connected: would delete QuickBooks payment #${link.qbo_id}.`, preview };
    if (!this.live) return { status: "pending", reason: `Preview: would delete QuickBooks payment #${link.qbo_id}.`, preview };
    const q = this.qbo.with({ entity: "payment", localId: row.local_id, qboId: link.qbo_id });
    const cur = await q.read<Rec>("Payment", link.qbo_id);
    if (cur) await q.deleteEntity("Payment", link.qbo_id, cur.SyncToken);
    await this.saveLink({ entity: "payment", local_id: row.local_id, qbo_id: link.qbo_id, source: link.source, note: "deleted in QuickBooks" });
    return { status: "done", reason: `Deleted QuickBooks payment #${link.qbo_id}.`, preview };
  }
}

/** A QuickBooks refusal in plain words (duplicate name, stale object…), for needs_review. */
export function explainQboError(e: QboError): string {
  if (e.code === "6240") return `QuickBooks says the name is already used by another customer, vendor or employee: ${e.detail || e.message}. Rename ours (or link to that one).`;
  if (e.code === "6000" && /business validation/i.test(e.message)) return `QuickBooks refused it: ${e.detail || e.message}`;
  return `QuickBooks refused it: ${e.message}`;
}
