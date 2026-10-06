import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { orderByToken } from "@/lib/merchServer";
import { orderCode } from "@/lib/merch";
import OrderStatus from "@/components/merch/OrderStatus";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ slug: string; token: string }>; searchParams: Promise<{ new?: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { token } = await params;
  const got = await orderByToken(token).catch(() => null);
  return { title: got ? `Order ${orderCode(got.store, got.order.number)} · ${got.store.name}` : "Order", robots: { index: false } };
}

/** A shopper's order: where it is, what's in it, and changes (private link from their email; no sign-in). */
export default async function OrderPage({ params, searchParams }: P) {
  const { slug, token } = await params;
  const got = await orderByToken(token);
  if (!got || got.store.slug !== slug) notFound();
  return <OrderStatus store={got.store} order={got.order} products={got.products} canChange={got.canChange} isNew={(await searchParams).new === "1"} />;
}
