/**
 * Who sees what. Owners and admins see everything. Everyone else on staff (production, receiving, shipping) is
 * "crew": they see the work (orders, quantities, what's ordered, art, separations, the schedule) but no money (no
 * prices, totals, payments, balances, sales) — like Printavo's employee view of an invoice.
 */
export type Role = "owner" | "admin" | "production" | "receiving" | "shipping";
export const ROLES: { v: Role; label: string; note: string }[] = [
  { v: "owner", label: "Owner", note: "everything" },
  { v: "admin", label: "Admin", note: "everything" },
  { v: "production", label: "Production", note: "production, separations, shop tools; no money" },
  { v: "receiving", label: "Receiving", note: "goods, receiving, shop tools; no money" },
  { v: "shipping", label: "Shipping", note: "shipping, shop tools; no money" },
];
export const seesMoney = (role?: string | null) => role === "owner" || role === "admin" || !role;
/** pages crew can't open (sales and settings); they're sent to the dashboard */
export const CREW_BLOCKED = ["/shop/incoming", "/shop/projects", "/shop/customers", "/shop/settings", "/shop/catalog", "/shop/assistant"];
export const crewBlocked = (path: string) => CREW_BLOCKED.some((p) => path === p || path.startsWith(p + "/"));
