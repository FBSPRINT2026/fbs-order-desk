import { getViewer } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/email";
import { LAUNCH_SUBJECT, launchEmailHtml } from "@/lib/launchEmail";
import SendTest from "./SendTest";

/** Settings → Portal launch email (owner only): the "It's here" email, previewed as customers get it, with a test send. */
export default async function Page() {
  const v = await getViewer();
  if (!v.user || v.role !== "owner") return <div className="panel"><div className="panel-b">Only the owner can see this page.</div></div>;
  const site = siteUrl();
  const html = launchEmailHtml({ site, portalUrl: `${site}/portal`, firstName: "Nichole" });
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Portal launch email</h1>
          <div className="eyebrow">Subject: {LAUNCH_SUBJECT}</div>
        </div>
      </div>
      <section className="panel">
        <div className="panel-h"><h2>Preview</h2><span className="faint">How customers see it (with their first name)</span></div>
        <div className="panel-b stack">
          <SendTest email={v.email} />
          <iframe title="Launch email preview" srcDoc={html} style={{ width: "100%", maxWidth: 680, height: 1500, border: "1px solid var(--line)", borderRadius: 10, background: "#EEF1F5" }} />
        </div>
      </section>
    </>
  );
}
