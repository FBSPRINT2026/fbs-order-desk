"use client";
import { useEffect, useState } from "react";
import { payUnlocked, setPayUntil } from "@/lib/format";

/**
 * Pay figures are hidden until the person at the screen types their own PIN (Nick, Nov 16 2026: "leave our login open on
 * an employee's computer… people get really weird if they see what other people make"). Every pay rate, paycheck and
 * labor cost goes through `payMoney` (lib/format.ts), which shows "$•••" while locked, or sits inside `<PayCover>`
 * (components/PayLock.tsx). Shown, it stays shown in this tab (a refresh too) until 10 minutes pass with no mouse or keys,
 * or Hide pay is pressed. The PIN is checked on the server (app/shop/pay-lock-actions.ts).
 */
const KEY = "fbs:payShown", IDLE = 10 * 60_000;
let until = 0;
const subs = new Set<() => void>();
const tell = () => subs.forEach((f) => f());
const save = () => { setPayUntil(until); try { if (until) sessionStorage.setItem(KEY, String(until)); else sessionStorage.removeItem(KEY); } catch { /* private window */ } };

if (typeof window !== "undefined") {
  try { const v = +(sessionStorage.getItem(KEY) || 0); if (v > Date.now()) { until = v; setPayUntil(v); } } catch { /* none */ }
  let last = 0;
  const poke = () => { const n = Date.now(); if (!until || n - last < 15_000) return; last = n; if (until > n) { until = n + IDLE; save(); } };
  for (const ev of ["pointerdown", "keydown", "wheel", "pointermove"]) window.addEventListener(ev, poke, { passive: true });
  setInterval(() => { if (until && until <= Date.now()) { until = 0; save(); tell(); } }, 5_000);
}

export const payShown = payUnlocked;
export function showPay() { until = Date.now() + IDLE; save(); tell(); }
export function hidePay() { until = 0; save(); tell(); }

/** re-draws the component when pay is shown or hidden */
export function usePayShown() {
  const [on, setOn] = useState(false);
  useEffect(() => { const f = () => setOn(payShown()); f(); subs.add(f); return () => { subs.delete(f); }; }, []);
  return on;
}
