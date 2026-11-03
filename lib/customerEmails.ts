/**
 * The emails a customer gets, and who at the customer gets each (Nov 3, Nick: "I don't want our customers to get too
 * barraged with emails… in the customer settings, they should have an email section… a list by everybody… proofs and
 * approvals can't be [off]… at least somebody's got to get it… on Cedar promos, they might say only Peter gets proofs").
 *
 * Kept on the customer (customers.email_prefs): for each kind, whether it's sent at all and to which of their people
 * (by email). Not set yet: the default (sent or not) to the account's main email. The defaults (Nov 3, Nick): proofs and
 * approvals, on hold, shipped with tracking, ready for pickup, delivered and payment receipts; the rest off until they
 * turn them on. Approvals and On hold always go to
 * at least one person. UPS delivered and delivery problems are off until the customer turns them on (Nick: "by default
 * once we ship it, you send the tracking… if they want… send me an email once the UPS delivers… or… a delivery issue").
 *
 * One list for the portal's Settings and the shop's customer page (components/EmailPrefs.tsx), and for every send
 * (lib/customerEmailServer.ts recipients).
 */
export type EmailKind = "approvals" | "hold" | "received" | "shipped" | "ready" | "delivered" | "carrier_delivered" | "ship_issue" | "receipts" | "invoices" | "messages";
export type EmailKindDef = { k: EmailKind; label: string; sub: string; /** can't be turned off; at least one person gets it */ locked?: boolean; /** on when the customer hasn't chosen */ def: boolean;
  /** sent by itself when something happens (held back until the shop turns automatic customer emails on) */ auto?: boolean };

export const EMAIL_KINDS: EmailKindDef[] = [
  { k: "approvals", label: "Proofs and approvals", sub: "Quotes, proofs, sew-outs and final invoices to approve", locked: true, def: true },
  { k: "hold", label: "Order on hold", sub: "When an order is on hold and why", locked: true, def: true, auto: true },
  { k: "received", label: "Order received", sub: "We got your order or reorder", def: false, auto: true },
  { k: "shipped", label: "Shipped", sub: "With tracking", def: true, auto: true },
  { k: "ready", label: "Ready for pickup", sub: "Packed and waiting for you", def: true, auto: true },
  { k: "delivered", label: "Delivered by FBS", sub: "When we drop it off", def: true, auto: true },
  { k: "carrier_delivered", label: "UPS / FedEx delivered", sub: "When the carrier says it's delivered", def: false, auto: true },
  { k: "ship_issue", label: "Delivery problems", sub: "A delay or exception from the carrier", def: false, auto: true },
  { k: "receipts", label: "Payment receipts", sub: "Each payment made online", def: true },
  { k: "invoices", label: "Invoices and statements", sub: "Balances due and statements", def: false },
  { k: "messages", label: "Messages from FBS", sub: "Our replies on an order", def: false },
];
export const EMAIL_KIND: Record<EmailKind, EmailKindDef> = Object.fromEntries(EMAIL_KINDS.map((x) => [x.k, x])) as Record<EmailKind, EmailKindDef>;

export type EmailPref = { on?: boolean; to?: string[] };
export type EmailPrefs = Partial<Record<EmailKind, EmailPref>>;
export type EmailPerson = { email: string; name: string; main?: boolean };

const ok = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const low = (e: string) => e.trim().toLowerCase();

/** is this kind sent at all for the customer */
export const kindOn = (prefs: EmailPrefs | null | undefined, k: EmailKind) => EMAIL_KIND[k].locked || (prefs?.[k]?.on ?? EMAIL_KIND[k].def);

/** who gets this kind: the people ticked (still on the account), else the main email; [] when it's off */
export function recipientsOf(prefs: EmailPrefs | null | undefined, k: EmailKind, people: EmailPerson[]): string[] {
  if (!kindOn(prefs, k)) return [];
  const have = new Set(people.map((p) => low(p.email)).filter(ok));
  const main = people.find((p) => p.main && ok(p.email)) || people.find((p) => ok(p.email));
  const picked = (prefs?.[k]?.to || []).map(low).filter((e) => have.has(e));
  if (picked.length) return [...new Set(picked)];
  return main ? [low(main.email)] : [];
}

/** a clean copy to save: known kinds, real emails, locked kinds always on with someone */
export function cleanPrefs(p: EmailPrefs, people: EmailPerson[]): EmailPrefs {
  const have = new Set(people.map((x) => low(x.email)).filter(ok));
  const out: EmailPrefs = {};
  for (const d of EMAIL_KINDS) {
    const x = p?.[d.k];
    if (!x) continue;
    const to = [...new Set((x.to || []).map(low).filter((e) => have.has(e)))];
    out[d.k] = { on: d.locked ? true : x.on ?? d.def, to };
  }
  return out;
}
