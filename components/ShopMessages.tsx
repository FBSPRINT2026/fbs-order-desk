"use client";
import { useCallback, useEffect, useState } from "react";
import MessageHub from "@/components/MessageHub";
import { createClient } from "@/lib/supabase/client";
import { shopMarkRead, shopMessages, staffCustomerMessage, staffMessage } from "@/app/shop/actions";
import type { HubMsg, HubOrder } from "@/lib/messages";

/** The shop's side of the Messages hub on a customer's page: every conversation with them, with files. */
export default function ShopMessages({ customerId, customerName, orders, projects, only, shopName, start, height }: { customerId: string; customerName: string; orders: HubOrder[]; projects?: { id: string; name: string; href?: string }[]; only?: string; shopName: string; start?: string | null; height?: number }) {
  const [initial, setInitial] = useState<HubMsg[] | null>(null);
  const load = useCallback(async () => { const r = await shopMessages(customerId); return r.ok ? r.messages || [] : null; }, [customerId]);
  useEffect(() => { load().then((m) => setInitial(m || [])); }, [load]);
  if (!initial) return <div className="mh mh-loading">Loading messages…</div>;
  return (
    <MessageHub mode="shop" initial={initial} orders={orders} projects={projects} only={only} shopName={shopName} customerName={customerName} start={start} height={height}
      load={load}
      send={(orderId, body, files, topic, projectId) => (orderId ? staffMessage(orderId, body, files, topic) : staffCustomerMessage(customerId, body, files, projectId || null))}
      markRead={(orderId, topic, projectId) => shopMarkRead(customerId, orderId, topic, projectId)}
      upload={async (f) => {
        const path = `messages/${customerId}/${crypto.randomUUID()}/${f.name.replace(/[^\w.\-]+/g, "_").slice(-120) || "file"}`;
        const up = await createClient().storage.from("proofs").upload(path, f, { contentType: f.type || undefined });
        if (up.error) throw new Error(up.error.message);
        return { path, name: f.name, mime: f.type || "application/octet-stream", size: f.size };
      }} />
  );
}
