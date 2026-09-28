import { NextResponse } from "next/server";
import { customerOrderIds, getCustomer, type PvCustomer } from "@/lib/printavo";
import type { PvAddress } from "@/lib/archive";
import { fail, staffOnly } from "../guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const addr = (a: PvAddress) => !a ? "" : [a.address1, a.address2, [[a.city, a.state].filter(Boolean).join(", "), a.zipCode].filter(Boolean).join(" ")].map((x) => (x || "").trim()).filter(Boolean).join("\n");
const terms = (t: PvCustomer["defaultPaymentTerm"]) => !t ? "receipt" : /prepa|up ?front|in advance|before/i.test(t.name) ? "prepay" : t.days >= 15 || /net/i.test(t.name) ? "net30" : "receipt";

/**
 * Step 1: bring over the customer (or link one we already have with the same email) and list their Printavo orders.
 * An existing customer's details are never overwritten; blanks are filled in.
 */
export async function POST(req: Request) {
  const g = await staffOnly();
  if ("error" in g) return g.error;
  const { printavoId } = await req.json().catch(() => ({}));
  if (!printavoId) return NextResponse.json({ error: "Which Printavo customer?" }, { status: 400 });
  try {
    const pc = await getCustomer(String(printavoId));
    const p = pc.primaryContact;
    const email = (p?.email || "").trim().toLowerCase();
    const others = pc.contacts.filter((c) => c.id !== p?.id && (c.fullName || c.email));
    const second = others[0];
    const fields = {
      company: (pc.companyName || "").trim(), name: (p?.fullName || "").trim(), email, phone: (p?.phone || "").trim(),
      address: addr(pc.billingAddress), ship_address: addr(pc.shippingAddress) === addr(pc.billingAddress) ? "" : addr(pc.shippingAddress),
      contact2_name: (second?.fullName || "").trim(), contact2_email: (second?.email || "").trim().toLowerCase(), contact2_phone: (second?.phone || "").trim(),
      tax_exempt: !!pc.taxExempt, payment_terms: terms(pc.defaultPaymentTerm),
    };

    const { data: linked } = await g.sb.from("printavo_customers").select("customer_id").eq("printavo_id", pc.id).maybeSingle();
    let customerId: string | null = linked?.customer_id || null, how = "already imported";
    if (!customerId && email) {
      const { data: same } = await g.sb.from("customers").select("id").ilike("email", email).limit(1);
      if (same?.[0]) { customerId = same[0].id; how = "matched by email"; }
    }
    if (customerId) {
      const { data: cur } = await g.sb.from("customers").select("*").eq("id", customerId).single();
      const fill: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) if (typeof v === "string" && v && !(cur as Record<string, unknown>)?.[k]) fill[k] = v;
      if (Object.keys(fill).length) await g.sb.from("customers").update(fill).eq("id", customerId);
    } else {
      const { data: made, error } = await g.sb.from("customers").insert({ ...fields, price_type: "retail" }).select("id").single();
      if (error || !made) throw new Error("Couldn't create the customer: " + (error?.message || "unknown"));
      customerId = made.id; how = "new customer";
    }

    // Printavo's internal note goes to the staff-only notes; extra contacts are kept with the Printavo record
    if (pc.internalNote?.trim()) {
      const { data: priv } = await g.sb.from("customer_private").select("notes").eq("customer_id", customerId).maybeSingle();
      const note = `From Printavo: ${pc.internalNote.trim()}`;
      if (!(priv?.notes || "").includes(note)) await g.sb.from("customer_private").upsert({ customer_id: customerId, notes: [priv?.notes, note].filter(Boolean).join("\n\n") });
    }
    await g.sb.from("printavo_customers").upsert({ printavo_id: pc.id, customer_id: customerId, data: { ...pc, extraContacts: others }, imported_at: new Date().toISOString() });

    const orders = await customerOrderIds(pc.id);
    const { data: have } = orders.length ? await g.sb.from("archived_orders").select("printavo_id").in("printavo_id", orders.map((o) => o.id)) : { data: [] };
    return NextResponse.json({ customerId, how, company: fields.company || fields.name, orders, imported: ((have || []) as { printavo_id: string }[]).map((x) => x.printavo_id) });
  } catch (e) { return fail(e); }
}
