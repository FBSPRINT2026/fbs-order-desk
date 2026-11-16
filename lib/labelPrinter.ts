/**
 * Which Zebra this computer prints labels on (Nick, Nov 16 2026: "each computer has its own label printer"). Every shop
 * computer with a Zebra runs its own print relay (Shipping Center → Settings → Label printer → + Another computer, done
 * on that computer, which picks it here by itself); a label is sent to the relay this browser picked, never another
 * computer's. Kept in this browser for good (a device setting, not a toggle), so a phone can pick one too.
 */
const KEY = "fbs:labelPrinter";
export function myPrinter(): string {
  try { return localStorage.getItem(KEY) || ""; } catch { return ""; }
}
export function setMyPrinter(id: string) {
  try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* private window */ }
  try { window.dispatchEvent(new Event("fbs:labelPrinter")); } catch { /* server */ }
}
export type PrinterRow = { id: string; name: string; live: boolean };
