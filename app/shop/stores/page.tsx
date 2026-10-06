import StoreList from "@/components/merch/StoreList";

export const dynamic = "force-dynamic";

/** Sales → Merch Stores */
export default function StoresPage() {
  return <StoreList base="/shop/stores" />;
}
