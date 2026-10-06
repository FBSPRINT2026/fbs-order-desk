import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/supabase/server";
import { publicStore } from "@/lib/merchServer";
import Storefront from "@/components/merch/Storefront";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { slug } = await params;
  const got = await publicStore(slug).catch(() => null);
  if (!got) return { title: "Store not found" };
  const s = got.store;
  return { title: `${s.name}${s.brand?.school ? ` · ${s.brand.school}` : ""}`, description: `Order ${s.brand?.school || s.name} gear online. This is a pre-order: printed after the store closes.` };
}

/** The public merch store (no sign-in). Staff see a preview of stores that aren't open and can place test orders. */
export default async function StorePage({ params }: P) {
  const { slug } = await params;
  const pass = (await cookies()).get(`sp_${slug}`)?.value || "";
  const got = await publicStore(slug, pass);
  if (!got) notFound();
  const { isStaff } = await getViewer().catch(() => ({ isStaff: false }));
  return <Storefront store={got.store} products={got.products} preview={isStaff} staxToken={process.env.STAX_WEB_PAYMENTS_TOKEN || ""} />;
}
