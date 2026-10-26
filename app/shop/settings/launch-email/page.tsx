import { getViewer } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/email";
import { LAUNCH_SUBJECT, launchEmailHtml } from "@/lib/launchEmail";
import SendTest from "./SendTest";
import SettingsTabs, { SettingsHead } from "@/components/SettingsTabs";

/** Settings → Portal launch email (owner only): the "It's here" email, previewed as customers get it, with a test send. */
export default async function Page({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const company = String((await searchParams).company || "").trim().slice(0, 42);
  const v = await getViewer();
  if (!v.user || v.role !== "owner") return <><SettingsHead title="Shop" note="Name, contact, terms and the menu logo: shown in the portal, emails and invoices" /><SettingsTabs /><div className="empty">Only the owner can see this page.</div></>;
  const site = siteUrl();
  const html = launchEmailHtml({ site, portalUrl: `${site}/portal`, firstName: "Nichole", company: company || undefined });
  return (
    <>
      {/* under Settings → Shop (Oct 26, Nick: "Where can I find that in the settings?") */}
      <SettingsHead title="Shop" note="Name, contact, terms and the menu logo: shown in the portal, emails and invoices" />
      <SettingsTabs />
      <section className="panel">
        <div className="panel-h"><h2>Portal launch email</h2><span className="faint">Subject: {LAUNCH_SUBJECT}. How customers see it, with their first name.</span></div>
        <div className="panel-b stack">
          {/* each customer's email shows their own company name in the portal picture (Oct 26, Nick) */}
          <form className="row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="field"><label htmlFor="le-co">Preview for a company</label><input id="le-co" name="company" type="text" defaultValue={company} placeholder="On Your Left" style={{ width: 240 }} /></div>
            <button type="submit" className="btn">Show it</button>
            <span className="faint" style={{ fontSize: 12.5, paddingBottom: 9 }}>Each customer&apos;s copy shows their company name where this says {company ? `"${company}"` : "Your Company"}.</span>
          </form>
          <SendTest email={v.email} company={company} />
          <iframe title="Launch email preview" srcDoc={html} style={{ width: "100%", maxWidth: 680, height: 1500, border: "1px solid var(--line)", borderRadius: 10, background: "#EEF1F5" }} />
        </div>
      </section>
    </>
  );
}
