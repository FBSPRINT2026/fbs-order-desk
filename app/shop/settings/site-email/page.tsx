import { getViewer } from "@/lib/supabase/server";
import SettingsTabs, { SettingsHead } from "@/components/SettingsTabs";
import { siteEmail, siteFrom } from "@/lib/siteEmail";
import SiteEmailForm from "./SiteEmailForm";

export const dynamic = "force-dynamic";

/** Settings → Connections → Site email (owner only): the address the portal sends from, and where replies go (Oct 26, Nick). */
export default async function Page() {
  const v = await getViewer();
  const head = <><SettingsHead title="Connections" note="QuickBooks, Canva, Dropbox, texts, Printavo, and whether each outside service is working" /><SettingsTabs /></>;
  if (v.role !== "owner") return <>{head}<div className="empty">Only the owner can change the site email.</div></>;
  const [s, from] = await Promise.all([siteEmail(), siteFrom()]);
  return (
    <>
      {head}
      <div className="stack">
        <SiteEmailForm initial={s} current={from} />
        <section className="panel">
          <div className="panel-h"><h2>Setting up a new address</h2><span className="faint">For portal@fbsprint.com, once the mailbox exists</span></div>
          <div className="panel-b">
            <ol className="se-steps">
              <li><b>Make the mailbox</b> in Microsoft 365 (portal@fbsprint.com), so replies have somewhere to land.</li>
              <li><b>Connect it above</b> under Send through the portal mailbox: its address and password (you type the password; it&apos;s checked with the mail server and kept encrypted). If it says the mailbox isn&apos;t allowed to send from other apps, turn on SMTP for it in HostPilot (Services → Exchange → the portal mailbox → Advanced Settings).</li>
              <li><b>Fill in the From name and addresses</b>, Save, and Send a test to me.</li>
              <li><b>Sign-in codes</b> are sent by Supabase: set the same sender in Supabase → Authentication → Emails (SMTP settings).</li>
            </ol>
            <p className="faint" style={{ fontSize: 12.5, margin: "8px 0 0" }}>The launch email&apos;s test still sends from your own mailbox for now.</p>
          </div>
        </section>
      </div>
    </>
  );
}
