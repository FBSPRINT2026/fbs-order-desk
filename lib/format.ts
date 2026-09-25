const fmt$ = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const money = (n: number | string | null | undefined) => fmt$.format(+(n ?? 0) || 0);

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
