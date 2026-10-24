import Link from "next/link";
import { getPortalCtx } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import PortalSettings from "@/components/PortalSettings";

/** The customer's Settings (Oct 24, Nick): their contacts, addresses and company logo. The company name is ours to set. */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const { as } = await searchParams;
  const ctx = await getPortalCtx(as, "/portal/settings");
  const qs = ctx.preview ? `?as=${ctx.preview.id}` : "";
  const c = ctx.customers[0] as unknown as Record<string, string | null> | undefined;
  if (!c) return <main className="p-main"><p>We couldn&apos;t find your account.</p></main>;
  const logoUrl = c.brand_logo ? (await createAdminClient().storage.from("proofs").createSignedUrl(String(c.brand_logo), 3600)).data?.signedUrl || "" : "";
  return (
    <>
      {ctx.preview && <div className="preview-bar">Preview of {ctx.preview.company || ctx.preview.name}&apos;s settings. Saving is turned off in preview.</div>}
      <main className="p-main ps">
        <Link href={`/portal${qs}`} className="back">← Dashboard</Link>
        <div className="page-head"><div><h1>Settings</h1><div className="eyebrow" data-notranslate>{c.company || c.name || "Your company"}</div></div></div>
        <PortalSettings staxToken={(process.env.STAX_WEB_PAYMENTS_TOKEN || "").trim()} mailOn={(c as unknown as { message_email?: boolean }).message_email !== false} preview={!!ctx.preview} customerId={String(c.id)} logoUrl={logoUrl} shopName={ctx.settings.shop.name} c={{ address: c.address || "", ship_address: c.ship_address || "" }} />
      </main>
    </>
  );
}
