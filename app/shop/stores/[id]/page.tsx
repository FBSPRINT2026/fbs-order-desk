import StoreEditor from "@/components/merch/StoreEditor";

export const dynamic = "force-dynamic";

/** One merch store (Sales → Merch Stores → a store) */
export default async function StorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StoreEditor id={id} base="/shop/stores" />;
}
