import { redirect } from "next/navigation";

/** The price list is a tab in the portal now (Oct 24, Nick: "it still needs to stay within the construct of the portal") */
export default async function PricingPage({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const { as } = await searchParams;
  redirect(`/portal?area=pricing${as ? `&as=${encodeURIComponent(as)}` : ""}`);
}
