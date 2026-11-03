"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPortalView } from "@/app/portal/settings-actions";

/**
 * Simple or Full, as a small switch at the foot of every portal page (Nov 3, Nick: "I want my customers to be able to
 * toggle between advanced and simple view… shouldn't be obvious… but it should be on their portal"). The same setting
 * as Settings → Portal layout (customers.portal_view); staff in a preview switch it for that customer.
 */
export default function PortalViewSwitch({ view, customerId }: { view: "simple" | "advanced"; customerId: string }) {
  const router = useRouter();
  const [v, setV] = useState(view);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const pick = (k: "simple" | "advanced") => {
    if (k === v || pending) return;
    const was = v; setV(k); setErr("");
    start(async () => { const r = await setPortalView(k, customerId); if (!r.ok) { setV(was); setErr(r.error || "Couldn't switch."); } else router.refresh(); });
  };
  return (
    <div className="pvs" role="radiogroup" aria-label="Portal view">
      <span>View</span>
      <button type="button" role="radio" aria-checked={v === "simple"} className={v === "simple" ? "on" : ""} onClick={() => pick("simple")}>Simple</button>
      <button type="button" role="radio" aria-checked={v === "advanced"} className={v === "advanced" ? "on" : ""} onClick={() => pick("advanced")}>Full</button>
      {err && <em>{err}</em>}
    </div>
  );
}
