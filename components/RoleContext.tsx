"use client";
import { createContext, useContext, useLayoutEffect } from "react";
import { seesMoney } from "@/lib/roles";
import { setHideMoney } from "@/lib/format";

/**
 * The signed-in staff member's role, for the pages to show the right things. `role` is what the pages follow;
 * `realRole` is who's actually signed in (an owner using "View as" sees the shop the way that role does, but stays
 * the owner underneath: the database and the server still treat them as the owner).
 */
type Ctx = { role: string; realRole: string; viewAs: string; viewName: string };
const RoleCtx = createContext<Ctx>({ role: "", realRole: "", viewAs: "", viewName: "" });

export function RoleProvider({ value, children }: { value: Ctx; children: React.ReactNode }) {
  const hide = !seesMoney(value.role);
  // set before the pages under it render (money() reads it), and on the page for the CSS that hides money blocks
  if (typeof window !== "undefined") setHideMoney(hide);
  useLayoutEffect(() => {
    setHideMoney(hide);
    if (hide) document.documentElement.setAttribute("data-nomoney", ""); else document.documentElement.removeAttribute("data-nomoney");
  }, [hide]);
  return <RoleCtx.Provider value={value}>{children}</RoleCtx.Provider>;
}
export const useRole = () => useContext(RoleCtx);
/** owners and admins (or the owner's own view) see prices, totals, payments and sales */
export const useSeesMoney = () => seesMoney(useContext(RoleCtx).role);
