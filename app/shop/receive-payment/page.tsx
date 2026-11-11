import ReceivePaymentTool from "@/components/tools/ReceivePaymentTool";

/** Shop Tools → Receive a Payment (Settings → User Access "Take payments"). ?customer=…&order=… opens it on them. */
export default async function ReceivePaymentPage({ searchParams }: { searchParams: Promise<{ customer?: string; order?: string }> }) {
  const { customer, order } = await searchParams;
  return <ReceivePaymentTool customerId={customer || ""} orderId={order || ""} staxToken={(process.env.STAX_WEB_PAYMENTS_TOKEN || "").trim()} />;
}
