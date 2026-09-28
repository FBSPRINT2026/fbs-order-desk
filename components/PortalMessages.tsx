"use client";
import { useCallback } from "react";
import MessageHub from "@/components/MessageHub";
import { createClient } from "@/lib/supabase/client";
import { portalAttachUrl, portalMarkRead, portalMessages, portalSend } from "@/app/portal/message-actions";
import type { HubMsg, HubOrder } from "@/lib/messages";

/** The customer's side of the Messages hub. In a staff preview (`as`) it's read-only. */
export default function PortalMessages({ initial, orders, projects, only, shopName, as, canAct, start, height }: { initial: HubMsg[]; orders: HubOrder[]; projects?: { id: string; name: string; href?: string }[]; only?: string; shopName: string; as?: string; canAct: boolean; start?: string | null; height?: number }) {
  const load = useCallback(async () => { const r = await portalMessages(as); return r.ok ? r.messages || [] : null; }, [as]);
  return (
    <MessageHub mode="portal" initial={initial} orders={orders} projects={projects} only={only} shopName={shopName} canAct={canAct} start={start} height={height}
      load={load}
      send={(orderId, body, files, topic, projectId) => portalSend(orderId, body, files, topic, projectId)}
      markRead={(orderId, topic, projectId) => portalMarkRead(orderId, topic, projectId)}
      upload={async (f) => {
        const t = await portalAttachUrl(f.name);
        if (!t.ok || !t.path || !t.token) throw new Error(t.error || "Upload failed");
        const up = await createClient().storage.from("proofs").uploadToSignedUrl(t.path, t.token, f, { contentType: f.type || undefined });
        if (up.error) throw new Error(up.error.message);
        return { path: t.path, name: f.name, mime: f.type || "application/octet-stream", size: f.size };
      }} />
  );
}
