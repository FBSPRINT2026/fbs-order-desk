"use client";
import { createClient } from "@/lib/supabase/client";

/**
 * A new quote and a new customer, the one way every button makes them (Nov 1, Nick: "+Q" and "+C" in the menu, beside
 * the version; the Orders page's "+ New quote" and the Customers page's "+ New customer" do the same). A quote starts as
 * a draft (no number, in no list) until it's saved; a customer opens on its page to fill in.
 */
export async function newQuote(go: (href: string) => void) {
  const { data, error } = await createClient().from("orders").insert({ lines: [], status: "quote", type: "quote", draft: true }).select("id").single();
  if (!error && data) go(`/shop/orders/${data.id}?new=1`);
  else throw new Error("Couldn't create the quote: " + (error?.message || ""));
}
export async function newCustomer(go: (href: string) => void) {
  const { data, error } = await createClient().from("customers").insert({}).select("id").single();
  if (data) go(`/shop/customers/${data.id}?new=1`);
  else throw new Error(error?.message || "Couldn't create the customer.");
}
