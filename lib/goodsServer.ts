import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ST } from "@/lib/pricing";
import { NO_GOODS, type GoodsItem, type GoodsState, type Shipment } from "@/lib/goods";
import type { Attachment } from "@/lib/messages";

type O = { id: string; number: number; nickname: string | null; status: string; due_date: string | null; qty: number };

/**
 * Everything the goods area shows for these orders: goods status, shipments (with signed links to
 * packing slips and photos) and the latest message in each order's goods conversation.
 * `admin` must be the server client; callers check the viewer may see these orders first.
 */
export async function loadGoodsItems(admin: SupabaseClient, orders: O[], viewer: "customer" | "staff", href: (id: string) => string, portal = viewer === "customer"): Promise<GoodsItem[]> {
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const [g, s, m] = await Promise.all([
    admin.from("order_goods").select("*").in("order_id", ids),
    admin.from("goods_shipments").select("*").in("order_id", ids).order("created_at"),
    admin.from("messages").select("order_id, author_type, author_name, body, created_at, read_at").in("order_id", ids).eq("topic", "goods").order("created_at"),
  ]);
  const goods = new Map(((g.data || []) as (GoodsState & { order_id: string })[]).map((x) => [x.order_id, x]));
  const ships = (s.data || []) as (Omit<Shipment, "files"> & { order_id: string; files: Attachment[] })[];
  const paths = ships.flatMap((x) => (x.files || []).map((f) => f.path));
  const signed = paths.length ? (await admin.storage.from("proofs").createSignedUrls(paths, 3600)).data || [] : [];
  const url = new Map(paths.map((p, i) => [p, signed[i]?.signedUrl || ""]));
  const msgs = (m.data || []) as { order_id: string; author_type: string; author_name: string; body: string; created_at: string; read_at: string | null }[];
  const mineType = viewer === "customer" ? "customer" : "staff";
  return orders.map((o) => {
    const gm = msgs.filter((x) => x.order_id === o.id);
    const last = gm[gm.length - 1];
    const st = goods.get(o.id);
    return {
      order: { id: o.id, number: o.number, nickname: o.nickname || "", status: o.status, statusLabel: (portal ? ST[o.status as keyof typeof ST]?.portal : ST[o.status as keyof typeof ST]?.label) || o.status, due_date: o.due_date, qty: o.qty, href: href(o.id) },
      goods: st ? { status: st.status, issue_type: st.issue_type, issue_note: st.issue_note, expected: st.expected, updated_at: st.updated_at } : NO_GOODS,
      shipments: ships.filter((x) => x.order_id === o.id).map((x) => ({ id: x.id, carrier: x.carrier, tracking: x.tracking, boxes: x.boxes, eta: x.eta, note: x.note, added_by: x.added_by, author_name: x.author_name, created_at: x.created_at,
        files: (x.files || []).map((f) => ({ name: f.name, mime: f.mime, size: f.size, url: url.get(f.path) || "" })) })),
      last: last ? { body: last.body, at: last.created_at, mine: last.author_type === mineType, who: last.author_name } : null,
      unread: gm.filter((x) => x.author_type !== mineType && !x.read_at).length,
    };
  });
}
