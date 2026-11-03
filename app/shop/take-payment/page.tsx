import TakePaymentTool from "@/components/tools/TakePaymentTool";

/** Shop Tools → Take a Payment (Nick and Amanda; Settings → User Access "Take a Payment"). ?customer=…&order=… opens it on them. */
export default async function TakePaymentPage({ searchParams }: { searchParams: Promise<{ customer?: string; order?: string }> }) {
  const { customer, order } = await searchParams;
  return (
    <TakePaymentTool customerId={customer || ""} orderId={order || ""} staxToken={(process.env.STAX_WEB_PAYMENTS_TOKEN || "").trim()} />
  );
}
