"use client";
import { useCallback, useEffect, useState } from "react";
import { useRole } from "@/components/RoleContext";

/**
 * Screen printing or embroidery: the switch under Production in the menu (Oct 24, Nick: "underneath the word
 * production… a toggle between embroidery and screen printing… screen printing, that's Ink Room and their employees,
 * production, reorder details… embroidery, it's their employee section, thread, their reorder details"). One setting for
 * the whole shop side, remembered in this browser: the menu shows that side's tools, and Production, Employees and
 * Reorder Details show that side's machines, team and prints. Heat press goes with screen printing. Maria (the
 * embroidery role) is always on embroidery, with no switch.
 */
export type ProdSide = "screen" | "embroidery";
const OLD = "fbs:prod.side", EV = "fbs:prod-side";
/**
 * Each person's own side (Oct 24, Nick: "Jose would automatically go into screen printing. Maria would automatically go
 * into [embroidery]. And then for everybody else, it would just remember what you were on last time"). Kept per person
 * (by email), so two people on one computer don't share it. Production (Jose) starts every visit on screen printing:
 * a switch he makes lasts through refreshes in that tab, not to the next visit. Embroidery (Maria) is always embroidery.
 */
const keyFor = (email: string) => `fbs:prod.side.${(email || "me").toLowerCase()}`;
function store(role: string): Storage | null { try { return role === "production" ? sessionStorage : localStorage; } catch { return null; } }
function read(role: string, email: string): ProdSide {
  const st = store(role); if (!st) return "screen";
  try {
    let v = st.getItem(keyFor(email));
    if (v === null && role !== "production") v = localStorage.getItem(OLD); // the one shared setting from before
    return v === "\"embroidery\"" ? "embroidery" : "screen";
  } catch { return "screen"; }
}

export function useProdSide(): [ProdSide, (s: ProdSide) => void, boolean] {
  const { role, email = "" } = useRole();
  const locked = role === "embroidery";
  const who = role; // "View as" a role starts the way that role does
  const [side, setSide] = useState<ProdSide>("screen");
  useEffect(() => {
    setSide(read(who, email));
    const on = () => setSide(read(who, email));
    window.addEventListener(EV, on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener(EV, on); window.removeEventListener("storage", on); };
  }, [who, email]);
  const set = useCallback((s: ProdSide) => {
    try { store(who)?.setItem(keyFor(email), JSON.stringify(s)); } catch { /* private window */ }
    setSide(s);
    window.dispatchEvent(new Event(EV));
  }, [who, email]);
  return [locked ? "embroidery" : side, set, locked];
}
