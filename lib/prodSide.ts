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
const KEY = "fbs:prod.side", EV = "fbs:prod-side";
const read = (): ProdSide => { try { return localStorage.getItem(KEY) === "\"embroidery\"" ? "embroidery" : "screen"; } catch { return "screen"; } };

export function useProdSide(): [ProdSide, (s: ProdSide) => void, boolean] {
  const { role } = useRole();
  const locked = role === "embroidery";
  const [side, setSide] = useState<ProdSide>("screen");
  useEffect(() => {
    setSide(read());
    const on = () => setSide(read());
    window.addEventListener(EV, on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener(EV, on); window.removeEventListener("storage", on); };
  }, []);
  const set = useCallback((s: ProdSide) => {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window */ }
    setSide(s);
    window.dispatchEvent(new Event(EV));
  }, []);
  return [locked ? "embroidery" : side, set, locked];
}
