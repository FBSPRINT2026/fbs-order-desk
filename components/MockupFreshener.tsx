"use client";
import { useEffect } from "react";
import { remakeMockup } from "@/lib/mockupFresh";
import { staleMockupGroups } from "@/app/shop/mockup-fresh-actions";

/**
 * Out-of-date mockup pictures drawn again quietly from any shop page (Oct 29, Nick: "the little box is wrong again
 * somewhere else… on the invoice"). Before, only opening the order redrew them, so the invoice, the proof, the portal and
 * the lists showed the old picture until someone did. Now any open shop page finds the stale ones (the order page's own
 * rule, lib/mockupFresh.ts) and redraws them one at a time out of sight, a few at a time, again every 10 minutes. One tab
 * does it at once; never inside the Mockup Creator's own hidden frame; each picture is tried once a session.
 */
export default function MockupFreshener() {
  useEffect(() => {
    if (window.self !== window.top) return;
    let stop = false, busy = false;
    const run = async () => {
      if (stop || busy || document.hidden || /^\/shop\/artwork\/mockup/.test(location.pathname)) return;
      // one tab at a time across the browser
      try { const t = +(localStorage.getItem("fbs:freshener") || 0); if (Date.now() - t < 5 * 60_000) return; localStorage.setItem("fbs:freshener", String(Date.now())); } catch { /* */ }
      busy = true;
      try {
        const r = await staleMockupGroups();
        for (const g of r.groups || []) {
          if (stop) break;
          const k = `fbs:redrawn:${g.groupId}:${g.mockupAt}`;
          try { if (sessionStorage.getItem(k)) continue; sessionStorage.setItem(k, "1"); } catch { /* */ }
          await remakeMockup(g.orderId, { id: g.groupId, mockupKind: g.mockupKind });
        }
      } finally {
        busy = false;
        try { localStorage.removeItem("fbs:freshener"); } catch { /* */ }
      }
    };
    const first = setTimeout(() => void run(), 20_000);
    const every = setInterval(() => void run(), 10 * 60_000);
    return () => { stop = true; clearTimeout(first); clearInterval(every); };
  }, []);
  return null;
}
