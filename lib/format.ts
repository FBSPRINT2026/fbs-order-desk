const fmt$ = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
/**
 * Crew (production, receiving, shipping) see no money: every amount shows as "—". Set by the shop layout from the
 * staff role (only ever in the browser, so one person's view can't leak into another's server render).
 */
let hideMoney = false;
export const setHideMoney = (b: boolean) => { hideMoney = b; };
export const moneyHidden = () => hideMoney && typeof window !== "undefined";
export const money = (n: number | string | null | undefined) => (moneyHidden() ? "—" : fmt$.format(+(n ?? 0) || 0));
/** pay rates and labor cost: shown to whoever may see pay (the "pay" permission), whether or not they see prices */
export const payMoney = (n: number | string | null | undefined) => fmt$.format(+(n ?? 0) || 0);

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function parseDate(s?: string | null) {
  if (!s) return null;
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function daysUntil(s?: string | null) {
  const d = parseDate(s);
  if (!d) return null;
  const t = parseDate(todayISO())!;
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}
export const fmtDate = (s?: string | null) => {
  const d = parseDate(s);
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
};
export const fmtDateLong = (s?: string | null) => {
  const d = parseDate(s);
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
};
export const fmtStamp = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};
export function custLabel(c?: { company?: string; name?: string } | null) {
  if (!c) return "No customer";
  return c.company || c.name || "Unnamed";
}
