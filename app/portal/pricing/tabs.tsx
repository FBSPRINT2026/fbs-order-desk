"use client";
import type { ReactNode } from "react";
import { useSticky } from "@/lib/useSticky";

/** Screen printing / Embroidery / DTF heat transfers, in the site's tab bar (Oct 24, Nick: "a tab at the top… break it up that way") */
export default function PricingTabs({ tabs }: { tabs: { k: string; label: string; body: ReactNode }[] }) {
  const [tab, setTab] = useSticky("portal.pricingTab", tabs[0]?.k || "");
  const cur = tabs.find((t) => t.k === tab) || tabs[0];
  return (
    <>
      <div className="toolbar aa-otabs pl-tabs" data-toolbar>
        <div className="chips" role="tablist" aria-label="Decoration">
          {tabs.map((t) => <button key={t.k} type="button" role="tab" aria-selected={cur?.k === t.k} className={"chip" + (cur?.k === t.k ? " on" : "")} onClick={() => setTab(t.k)}>{t.label}</button>)}
        </div>
      </div>
      <div role="tabpanel">{cur?.body}</div>
    </>
  );
}
