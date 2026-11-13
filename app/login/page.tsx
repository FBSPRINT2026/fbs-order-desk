import { createAdminClient } from "@/lib/supabase/admin";
import { mergeSettings } from "@/lib/pricing";
import LoginForm from "./LoginForm";
import { shopNetwork } from "@/lib/shopNetwork";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  let shopName = "FBS Print";
  let logoUrl = "", sideLogoUrl = "";
  // the employee and shop computer sign-ins show only on the shop's network (Nick, Nov 13 2026: "I don't want our
  // customers to see that"); a crew QR or /crew still opens the employee sign-in directly
  const onShop = await shopNetwork(createAdminClient()).then((n) => n.on).catch(() => false);
  try {
    const { data } = await createAdminClient().from("settings").select("data").eq("id", 1).maybeSingle();
    const s = mergeSettings(data?.data);
    shopName = s.shop.name || shopName;
    logoUrl = s.shop.logoUrl || "";
    sideLogoUrl = s.brand.sideLogoUrl || "";
  } catch {}
  return (
    <div className="auth-wrap">
      <LoginForm shopName={shopName} logoUrl={logoUrl} sideLogoUrl={sideLogoUrl} next={sp.next || "/"} linkError={sp.error === "link"} onShop={onShop} />
    </div>
  );
}
