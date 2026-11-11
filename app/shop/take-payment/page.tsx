import { redirect } from "next/navigation";

/** The old address of Receive a Payment (links in emails and to-dos still use it): opens the new tool on the same customer / order. */
export default async function TakePaymentPage({ searchParams }: { searchParams: Promise<{ customer?: string; order?: string }> }) {
  const { customer, order } = await searchParams;
  const q = new URLSearchParams({ ...(customer ? { customer } : {}), ...(order ? { order } : {}) }).toString();
  redirect(`/shop/receive-payment${q ? `?${q}` : ""}`);
}
