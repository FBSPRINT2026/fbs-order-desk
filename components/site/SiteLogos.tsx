"use client";
import { useEffect, useRef } from "react";

/**
 * The website's strip of client logos, moving on its own (lib/siteContent.ts CLIENTS). Each visit starts it at a random
 * point in the loop, so people don't land on the same few logos every time (Nov 5, Nick). The order stays as set, so the
 * national names stay spread out, and it moves at the same pace however many logos there are.
 */
export default function SiteLogos({ clients }: { clients: { name: string; img?: string }[] }) {
  const trk = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = trk.current;
    if (!el) return;
    const secs = clients.length * 3; // the same easy pace however many logos there are
    el.style.animationDuration = `${secs}s`;
    el.style.animationDelay = `-${(Math.random() * secs).toFixed(2)}s`;
  }, [clients.length]);
  return (
    <div className="fws-mq" aria-label="Brands we work with">
      <div className="fws-mq-trk" ref={trk}>{[0, 1].map((k) => clients.map((c) => (
        <div key={`${k}${c.name}`} className="fws-mq-lg" aria-hidden={k ? true : undefined}>{c.img ? <img src={c.img} alt={k ? "" : c.name} loading={k ? "lazy" : undefined} /> : <span className="fws-d">{c.name}</span>}</div>
      )))}</div>
    </div>
  );
}
