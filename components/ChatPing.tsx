"use client";
import { useEffect, useRef, useState } from "react";
import { chatPing } from "@/app/shop/chat-ping-actions";
import { useCan } from "@/components/RoleContext";

type Item = { id: string; key: string; who: string; number: number | null; nickname: string; body: string };

/**
 * The live pop-up on every shop page (Nov 2, Nick: "if a customer's in there and we're in there at the time… a little blurb
 * on the bottom right corner should pop up… Logan Todd is sending you a message. Would you like to chat with him?").
 * Every 20 seconds it asks for customer messages since the last look; each new one slides in at the bottom right with
 * Open chat (the Job Center, on that conversation) and Later. Messages from before the page opened never pop.
 */
export default function ChatPing() {
  // only the people who answer customers (the "chatPings" permission: owner and admins; Nov 11, Nick)
  const on = useCan("chatPings");
  const [list, setList] = useState<Item[]>([]);
  const since = useRef(new Date().toISOString());
  useEffect(() => {
    if (!on) return;
    let live = true;
    const tick = async () => {
      if (document.hidden) return;
      const r = await chatPing(since.current).catch(() => null);
      if (!live || !r || !r.ok) return;
      since.current = r.at;
      if (r.items.length) setList((l) => [...l, ...r.items.filter((x) => !l.some((y) => y.id === x.id))].slice(-3));
    };
    const t = setInterval(() => void tick(), 20_000);
    return () => { live = false; clearInterval(t); };
  }, [on]);
  if (!on || !list.length) return null;
  const drop = (id: string) => setList((l) => l.filter((x) => x.id !== id));
  return (
    <div className="cpg" role="status" aria-live="polite">
      {list.map((x) => (
        <div key={x.id} className="cpg-card">
          <div className="cpg-t"><b>{x.who}</b> is messaging you{x.number ? <> on <span className="ordno">#{x.number}</span>{x.nickname ? ` ${x.nickname}` : ""}</> : ""}</div>
          {x.body && <div className="cpg-q">“{x.body}”</div>}
          <div className="cpg-a">
            <a className="btn sm primary" href={`/shop/jobs?chat=${encodeURIComponent(x.key)}`} onClick={() => drop(x.id)}>Open chat</a>
            <button type="button" className="btn sm" onClick={() => drop(x.id)}>Later</button>
          </div>
        </div>
      ))}
    </div>
  );
}
