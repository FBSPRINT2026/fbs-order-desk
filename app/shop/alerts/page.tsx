import AlertsView from "@/components/AlertsView";

export const metadata = { title: "Alerts & Away · FBS" };

/** Alerts & Away mode (Oct 12): Away mode, phone alerts on this device, job reminders, and what was sent */
export default function AlertsPage() {
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Your phone</div><h1>Alerts &amp; Away</h1></div></div>
      <AlertsView />
    </>
  );
}
