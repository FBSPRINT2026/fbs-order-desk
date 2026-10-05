"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { useRole } from "@/components/RoleContext";
import { crewBlocked, ROLES, seesMoney } from "@/lib/roles";
import { setViewAs } from "@/app/shop/view-as-actions";

/**
 * Crew (production, receiving, shipping) can't open the sales and settings pages: they're sent to the dashboard.
 * When the owner is viewing as someone, a strip across the top says so, with the way back.
 */
export default function CrewGuard() {
  const { role, realRole, viewAs, viewName } = useRole();
  const path = usePathname(), router = useRouter();
  const [busy, go] = useTransition();
  const blocked = !seesMoney(role) && crewBlocked(path);
  useEffect(() => { if (blocked && !viewAs) router.replace("/shop"); }, [blocked, viewAs, router]);
  const label = ROLES.find((r) => r.v === role)?.label || role;
  return (
    <>
      {viewAs && realRole === "owner" && (
        <div className="viewas-bar" data-notranslate>
          <span>Viewing as <b>{viewName}</b>{viewAs.includes("@") ? ` (${label})` : ""}{!seesMoney(role) ? " · no prices or totals" : ""}</span>
          <span className="spacer" />
          <button type="button" className="btn sm" disabled={busy} onClick={() => go(async () => { await setViewAs(""); window.location.reload(); })}>Back to my view</button>
        </div>
      )}
      {blocked && (viewAs
        ? <div className="empty" style={{ marginTop: 24 }}><b>{viewName} can&apos;t open this page.</b> Sales, customers and settings are for owners and admins. <Link href="/shop">Their dashboard →</Link></div>
        : null)}
      {blocked && <style>{`.main > :not(.top-r):not(.viewas-bar):not(.empty){display:none!important}`}</style>}
    </>
  );
}
