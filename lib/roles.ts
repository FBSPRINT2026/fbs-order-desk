/**
 * Who sees what. Each staff member has a role (owner, admin, production, receiving, shipping) that sets their
 * starting permissions; Settings → User Access turns single permissions on or off per person (like Printavo's user
 * settings). Owners always have everything (so nobody can lock the shop out).
 * Crew (no "money" permission) see the work (orders, quantities, what's ordered, art, separations, the schedule) but
 * no prices, totals, payments, balances or sales — like Printavo's employee view of an invoice.
 */
export type Role = "owner" | "admin" | "production" | "receiving" | "shipping";
export const ROLES: { v: Role; label: string; note: string }[] = [
  { v: "owner", label: "Owner", note: "everything" },
  { v: "admin", label: "Admin", note: "everything" },
  { v: "production", label: "Production", note: "production, separations, shop tools; no money" },
  { v: "receiving", label: "Receiving", note: "goods, receiving, shop tools; no money" },
  { v: "shipping", label: "Shipping", note: "shipping, shop tools; no money" },
];

/** every permission, in the order Settings → User Access lists them */
export const PERMS = [
  { k: "money", group: "Money", label: "Can see prices, totals, payments, balances and sales numbers" },
  { k: "payments", group: "Money", label: "Can record and remove payments" },
  { k: "quotes", group: "Sales", label: "Can create new quotes" },
  { k: "customers", group: "Sales", label: "Can open Customers" },
  { k: "incoming", group: "Sales", label: "Can open Incoming Orders" },
  { k: "projects", group: "Sales", label: "Can open Projects" },
  { k: "assistant", group: "Sales", label: "Can open the Assistant (follow-ups)" },
  { k: "artwork", group: "Production", label: "Can open Artwork" },
  { k: "separations", group: "Production", label: "Can open Separations" },
  { k: "approveSeps", group: "Production", label: "Can approve separations" },
  { k: "coach", group: "Production", label: "Can use the separation coach (Make Separations Better)" },
  { k: "schedule", group: "Production", label: "Can open the Production calendar" },
  { k: "pressDefaults", group: "Production", label: "Can change press defaults and equipment status" },
  { k: "employees", group: "Production", label: "Can open Employees" },
  { k: "shipping", group: "Shop tools", label: "Can open the Shipping Center" },
  { k: "receiving", group: "Shop tools", label: "Can open Goods & Receiving" },
  { k: "timeclock", group: "Shop tools", label: "Can open the Time Clock" },
  { k: "settings", group: "Admin", label: "Can open Settings (pricing, garments, staff, user access)" },
] as const;
export type PermKey = (typeof PERMS)[number]["k"];
export type Perms = Record<PermKey, boolean>;
/** per person (by email): only the permissions changed from their role's defaults */
export type AccessOverrides = Record<string, Partial<Perms>>;

const ALL = Object.fromEntries(PERMS.map((p) => [p.k, true])) as Perms;
const CREW: Perms = { ...ALL, money: false, payments: false, quotes: false, customers: false, incoming: false, projects: false, assistant: false, settings: false };
/** what each role starts with */
export const roleDefaults = (role?: string | null): Perms => {
  if (!role || role === "owner" || role === "admin") return { ...ALL };
  if (role === "production") return { ...CREW };
  // receiving / shipping: the shop tools, no separation approvals, coach or press changes
  return { ...CREW, approveSeps: false, coach: false, pressDefaults: false };
};
/** a person's permissions: their role's defaults with their own changes (owners: everything, always) */
export const permsFor = (role?: string | null, own?: Partial<Perms> | null): Perms => (role === "owner" ? { ...ALL } : { ...roleDefaults(role), ...(own || {}) });
/** the per-person changes kept in settings.data.access, by email */
export const accessOf = (settingsData: unknown): AccessOverrides => {
  const a = (settingsData as { access?: unknown } | null)?.access;
  return a && typeof a === "object" ? (a as AccessOverrides) : {};
};
export const seesMoney = (role?: string | null, own?: Partial<Perms> | null) => permsFor(role, own).money;

/** pages and the permission that opens them (anything else, like Orders and the dashboard, everyone opens) */
export const PAGE_PERMS: [string, PermKey][] = [
  ["/shop/customers", "customers"], ["/shop/incoming", "incoming"], ["/shop/projects", "projects"], ["/shop/assistant", "assistant"],
  ["/shop/settings", "settings"], ["/shop/catalog", "settings"], ["/shop/artwork", "artwork"], ["/shop/separations", "separations"],
  ["/shop/board", "schedule"], ["/shop/calendar", "schedule"], ["/shop/employees", "employees"], ["/shop/shipping", "shipping"],
  ["/shop/receiving", "receiving"], ["/shop/time", "timeclock"],
];
export const permForPath = (path: string): PermKey | null => PAGE_PERMS.find(([p]) => path === p || path.startsWith(p + "/"))?.[1] ?? null;
export const canOpen = (path: string, perms: Perms) => { const k = permForPath(path); return !k || perms[k]; };
