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
  // a bill's Pay link sent before bills opened the order's own page (/portal?area=payments&pay=<order>): pay it without
  // signing in, or sign in (Nick, Nov 19 2026: Stephanie's bill asked her to sign in)
  let payLink: { href: string; label: string } | null = null;
  const pm = /^\/portal\?(?:.*&)?pay=([0-9a-f-]{36})(?:&|$)/i.exec(sp.next || "");
  if (pm) {
    try {
      const admin = createAdminClient();
      const { data: o } = await admin.from("orders").select("id, number, type").eq("id", pm[1]).is("discarded_at", null).maybeSingle();
      if (o && o.type === "invoice") {
        const { proofLinkFor, proofUrl } = await import("@/lib/proofLinks");
        payLink = { href: proofUrl(await proofLinkFor(admin, { kind: "order", orderId: o.id as string })), label: `#${o.number}` };
      }
    } catch { /* the sign-in still works */ }
  }
  return (
    <div className="auth-wrap">
      <LoginForm shopName={shopName} logoUrl={logoUrl} sideLogoUrl={sideLogoUrl} next={sp.next || "/"} linkError={sp.error === "link"} onShop={onShop} payLink={payLink} />
    </div>
  );
}
