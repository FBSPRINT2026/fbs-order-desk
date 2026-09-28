"use client";
import { useRouter } from "next/navigation";
import GoodsBoard from "@/components/GoodsBoard";
import { createClient } from "@/lib/supabase/client";
import { addTracking } from "@/app/portal/goods-actions";
import { portalAttachUrl, portalSend } from "@/app/portal/message-actions";
import type { GoodsItem } from "@/lib/goods";

/** The customer's goods area (wholesale). `hub`: a Messages hub is on the same page, so "Message" opens it there. */
export default function PortalGoods({ items, canAct, qs, compact, hub, empty }: { items: GoodsItem[]; canAct: boolean; qs: string; compact?: boolean; hub?: boolean; empty?: string }) {
  const router = useRouter();
  const chatHref = (id: string) => `/portal${qs ? qs + "&" : "?"}area=messages&c=${id}:goods`;
  return (
    <GoodsBoard mode="portal" items={items} canAct={canAct} compact={compact} empty={empty}
      act={{
        addTracking, changed: () => router.refresh(), chatHref,
        message: (id, body) => portalSend(id, body, [], "goods"),
        openChat: hub ? (id) => window.dispatchEvent(new CustomEvent("mh:open", { detail: `${id}:goods` })) : undefined,
        upload: async (f) => {
          const t = await portalAttachUrl(f.name);
          if (!t.ok || !t.path || !t.token) throw new Error(t.error || "Upload failed");
          const up = await createClient().storage.from("proofs").uploadToSignedUrl(t.path, t.token, f, { contentType: f.type || undefined });
          if (up.error) throw new Error(up.error.message);
          return { path: t.path, name: f.name, mime: f.type || "application/octet-stream", size: f.size };
        },
      }} />
  );
}
