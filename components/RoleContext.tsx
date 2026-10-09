"use client";
import { createContext, useContext, useLayoutEffect } from "react";
import { permsFor, type PermKey, type Perms } from "@/lib/roles";
import { setHideMoney } from "@/lib/format";

/**
 * The signed-in staff member's role and permissions (role defaults + their own changes from Settings → User Access),
 * for the pages to show the right things. `role` / `perms` are what the pages follow; `realRole` is who's actually
 * signed in (an owner using "View as" sees the shop the way that person or role does, but stays the owner underneath:
 * the database and the server still treat them as the owner).
 * `email` / `staffName` are the person really signed in (from the layout), so pages don't each ask the server again.
 */
type Ctx = { role: string; realRole: string; viewAs: string; viewName: string; perms: Perms; email?: string; staffName?: string };
const RoleCtx = createContext<Ctx>({ role: "", realRole: "", viewAs: "", viewName: "", perms: permsFor(""), email: "", staffName: "" });

export function RoleProvider({ value, children }: { value: Ctx; children: React.ReactNode }) {
  const hide = !value.perms.money;
  // set before the pages under it render (money() reads it), and on the page for the CSS that hides money blocks
  if (typeof window !== "undefined") setHideMoney(hide);
  useLayoutEffect(() => {
    setHideMoney(hide);
    if (hide) document.documentElement.setAttribute("data-nomoney", ""); else document.documentElement.removeAttribute("data-nomoney");
  }, [hide]);
  return <RoleCtx.Provider value={value}>{children}</RoleCtx.Provider>;
}
export const useRole = () => useContext(RoleCtx);
/** may this person do / see that (Settings → User Access) */
export const useCan = (k: PermKey) => useContext(RoleCtx).perms[k];
/** prices, totals, payments and sales */
export const useSeesMoney = () => useContext(RoleCtx).perms.money;
