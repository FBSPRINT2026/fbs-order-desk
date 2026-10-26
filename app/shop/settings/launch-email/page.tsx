import { getViewer } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/email";
import { LAUNCH_SUBJECT, launchEmailHtml } from "@/lib/launchEmail";
import SendTest from "./SendTest";
import SettingsTabs, { SettingsHead } from "@/components/SettingsTabs";

/** Settings → Portal launch email (owner only): the "It's here" email, previewed as customers get it, with a test send. */
export default async function Page() {
  const v = await getViewer();
  if (!v.user || v.role !== "owner") return <><SettingsHead title="Shop" note="Name, contact, terms and the menu logo: shown in the portal, emails and invoices" /><SettingsTabs /><div className="empty">Only the owner can see this page.</div></>;
  const site = siteUrl();
  const html = launchEmailHtml({ site, portalUrl: `${site}/portal`, firstName: "Nichole" });
  return (
    <>
      {/* under Settings → Shop (Oct 26, Nick: "Where can I find that in the settings?") */}
      <SettingsHead title="Shop" note="Name, contact, terms and the menu logo: shown in the portal, emails and invoices" />
      <SettingsTabs />
      <section className="panel">
        <div className="panel-h"><h2>Portal launch email</h2><span className="faint">Subject: {LAUNCH_SUBJECT}. How customers see it, with their first name.</span></div>
        <div className="panel-b stack">
          <SendTest email={v.email} />
          <iframe title="Launch email preview" srcDoc={html} style={{ width: "100%", maxWidth: 680, height: 1500, border: "1px solid var(--line)", borderRadius: 10, background: "#EEF1F5" }} />
        </div>
      </section>
    </>
  );
}
