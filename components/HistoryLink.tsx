"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * "Mewjira history · 7 orders · 3 emails ›": the way into a design's running history (app/shop/history), on an
 * email (the design named in its subject / summary) and on a reorder. Shows only when something was found.
 */
export default function HistoryLink({ customer, q, text, text2, className = "" }: { customer: string | null | undefined; q?: string; text?: string; /** looked at only when `text` names nothing */ text2?: string; className?: string }) {
  const [c, setC] = useState<{ words: string[]; counts: { orders: number; emails: number } } | null>(null);
  useEffect(() => {
    if (!customer) return;
    let live = true;
    const p = new URLSearchParams({ customer, count: "1", ...(q ? { q } : { text: text || "", text2: text2 || "" }) });
    fetch(`/api/history?${p}`).then((r) => r.json()).then((r) => { if (live && r.words?.length && r.counts) setC(r); }).catch(() => null);
    return () => { live = false; };
  }, [customer, q, text, text2]);
  if (!customer || !c || !(c.counts.orders + c.counts.emails)) return null;
  const name = c.words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  const bits = [c.counts.orders ? `${c.counts.orders} order${c.counts.orders === 1 ? "" : "s"}` : "", c.counts.emails ? `${c.counts.emails} email${c.counts.emails === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
  return (
    <Link className={"hist-link " + className} href={`/shop/history?${new URLSearchParams({ customer, q: c.words.join(" ") })}`} title="Every order and email about this design, oldest first">
      <svg viewBox="0 0 24 24" aria-hidden><path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2" /></svg>
      <span><b>{name} history</b> · {bits}</span><span aria-hidden>›</span>
    </Link>
  );
}
