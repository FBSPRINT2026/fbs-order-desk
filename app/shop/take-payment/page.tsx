import TakePaymentTool from "@/components/tools/TakePaymentTool";

/** Shop Tools → Take a Payment (Nick and Amanda; Settings → User Access "Take a Payment"). ?customer=…&order=… opens it on them. */
export default async function TakePaymentPage({ searchParams }: { searchParams: Promise<{ customer?: string; order?: string }> }) {
  const { customer, order } = await searchParams;
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Take a Payment</h1><div className="eyebrow">Run a customer&apos;s card for their open invoices: one charge, or one per invoice</div></div></div>
      <TakePaymentTool customerId={customer || ""} orderId={order || ""} staxToken={(process.env.STAX_WEB_PAYMENTS_TOKEN || "").trim()} />
    </div>
  );
}
