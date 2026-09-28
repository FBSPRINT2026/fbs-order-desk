import { NextResponse } from "next/server";
import { pv } from "@/lib/printavo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORARY: how Printavo stores one company's contacts (record counts and company names only). Removed after use.
export async function GET() {
  const d = await pv<{ contacts: { nodes: { id: string; customer: { id: string; companyName: string | null; orderCount: number; contacts: { totalNodes: number } } | null }[] } }>(
    `query{ contacts(query:"McKenna", first:25){ nodes{ id customer{ id companyName orderCount contacts(first:1){ totalNodes } } } } }`);
  const byCustomer = new Map<string, { company: string; orders: number; contactsOnRecord: number; matchedContacts: number }>();
  for (const c of d.contacts.nodes) {
    if (!c.customer) continue;
    const k = c.customer.id, cur = byCustomer.get(k);
    if (cur) cur.matchedContacts++;
    else byCustomer.set(k, { company: c.customer.companyName || "", orders: c.customer.orderCount, contactsOnRecord: c.customer.contacts?.totalNodes ?? -1, matchedContacts: 1 });
  }
  const c2 = await pv<{ customers: { nodes: { companyName: string | null }[] } }>(`query{ customers(first:25){ nodes{ companyName } } }`);
  return NextResponse.json({ contactsFound: d.contacts.nodes.length, customerRecords: [...byCustomer.values()], sampleCompanyNames: c2.customers.nodes.map((x) => x.companyName) });
}
