import { createAdminClient } from "@/lib/supabase/admin";
import { mergeSettings } from "@/lib/pricing";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  let shopName = "FBS Print";
  let logoUrl = "", sideLogoUrl = "";
  try {
    const { data } = await createAdminClient().from("settings").select("data").eq("id", 1).maybeSingle();
    const s = mergeSettings(data?.data);
    shopName = s.shop.name || shopName;
    logoUrl = s.shop.logoUrl || "";
    sideLogoUrl = s.brand.sideLogoUrl || "";
  } catch {}
  return (
    <div className="auth-wrap">
      <LoginForm shopName={shopName} logoUrl={logoUrl} sideLogoUrl={sideLogoUrl} next={sp.next || "/"} linkError={sp.error === "link"} />
    </div>
  );
}
