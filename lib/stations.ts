/**
 * Shop computers (Nick, Nov 13 2026: "a simplified login that just shows what they need to see… FBS-REC, FBS-SHIP, FBS-PO
 * and FBS-PRESS… a simple PIN"). Each is a real staff login of its own (station emails below, the role's permissions,
 * no money), signed in with its name and the shop computer PIN on the shop's network only, and opening on its own page.
 * Being a real login, each one also gets the portal's search and the Orders list (look up a customer, a job that isn't
 * scheduled), limited by its role. Change what one sees on Settings → User Access, like any person.
 */
export type Station = { key: "rec" | "press" | "ship" | "po"; name: string; label: string; role: "receiving" | "production" | "shipping"; home: string; note: string };
export const STATIONS: Station[] = [
  { key: "rec", name: "FBS-REC", label: "Receiving", role: "receiving", home: "/shop/receiving", note: "Goods & Receiving: count-in list and trucks" },
  { key: "press", name: "FBS-PRESS", label: "Press", role: "production", home: "/crew", note: "Each press's schedule; a job opens its mockup, inks, setup and work order" },
  { key: "ship", name: "FBS-SHIP", label: "Shipping", role: "shipping", home: "/shop/outbound", note: "The door: who's picking up, box labels, shipping" },
  { key: "po", name: "FBS-PO", label: "Work orders", role: "production", home: "/shop/work-orders", note: "The color printer: print today's work orders" },
];
export const STATION_DOMAIN = "station.fbsprint.com";
export const stationEmail = (s: Pick<Station, "key">) => `${s.key}@${STATION_DOMAIN}`;
export const isStationEmail = (email: string | null | undefined) => String(email || "").toLowerCase().endsWith("@" + STATION_DOMAIN);
export const stationOf = (email: string | null | undefined) => STATIONS.find((s) => stationEmail(s) === String(email || "").toLowerCase()) || null;
/** "FBS-REC", "fbs rec", "rec", "receiving" → the station */
export function stationByName(t: string): Station | null {
  const k = String(t || "").toLowerCase().replace(/[^a-z]/g, "").replace(/^fbs/, "");
  return STATIONS.find((s) => s.key === k || s.name.toLowerCase().replace(/[^a-z]/g, "").replace(/^fbs/, "") === k || s.label.toLowerCase().replace(/[^a-z]/g, "") === k) || null;
}
