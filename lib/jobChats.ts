import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allRows } from "@/lib/readAll";
import { accountOwners } from "@/lib/accountOwners";

/**
 * Customer messages in the Job Center (Nov 2, Nick: "customer messages need to be part of the job center… when we log in,
 * there's a notification… 3 new messages… this client, this is the job, it's on hold… the messages are going to be really
 * short… approved, not approved, looks good, where's my tracking"). One conversation per order (its goods talk apart),
 * plus each customer's general one; only conversations the customer has written in, newest first, unread on top.
 */
export type ChatSummary = {
  key: string; orderId: string | null; topic: string; customerId: string | null; projectId: string | null;
  number: number | null; nickname: string; customer: string; status: string;
  last: { body: string; from: "customer" | "staff"; who: string; at: string };
  unread: number; /** the customer wrote last: waiting on us */ waiting: boolean; owner: string;
};
export type ChatMsg = { id: string; from: "customer" | "staff"; who: string; body: string; at: string; files: { name: string; url: string }[] };

type Row = { id: string; order_id: string | null; customer_id: string | null; project_id: string | null; topic: string | null; author_type: string; author_name: string | null; body: string | null; created_at: string; read_at: string | null; attachments: unknown[] | null };

export const chatKey = (r: { order_id: string | null; topic?: string | null; customer_id: string | null }) =>
  r.order_id ? `o:${r.order_id}:${r.topic === "goods" ? "goods" : ""}` : `c:${r.customer_id || ""}`;
export function parseKey(key: string): { orderId: string | null; topic: string; customerId: string | null } {
  const [k, a, b] = key.split(":");
  return k === "o" ? { orderId: a || null, topic: b === "goods" ? "goods" : "", customerId: null } : { orderId: null, topic: "", customerId: a || null };
}

/** the conversations of the last 60 days the customer wrote in */
export async function loadChats(admin: SupabaseClient): Promise<ChatSummary[]> {
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  const { data } = await allRows<Row>((r0, r1) => admin.from("messages").select("id, order_id, customer_id, project_id, topic, author_type, author_name, body, created_at, read_at, attachments").is("hidden_at", null)
    .gte("created_at", since).order("created_at").order("id").range(r0, r1), 20000);
  const rows = (data || []) as Row[];
  const by = new Map<string, Row[]>();
  for (const r of rows) { const k = chatKey(r); if (!by.has(k)) by.set(k, []); by.get(k)!.push(r); }
  const keys = [...by.keys()].filter((k) => by.get(k)!.some((r) => r.author_type === "customer"));
  const oids = [...new Set(keys.map((k) => parseKey(k).orderId).filter(Boolean))] as string[];
  const orders = new Map<string, { id: string; number: number; nickname: string | null; status: string; customer_id: string | null }>();
  for (let i = 0; i < oids.length; i += 200) {
    const { data: os } = await admin.from("orders").select("id, number, nickname, status, customer_id").in("id", oids.slice(i, i + 200));
    for (const o of (os || []) as { id: string; number: number; nickname: string | null; status: string; customer_id: string | null }[]) orders.set(o.id, o);
  }
  const cids = [...new Set(keys.map((k) => { const p = parseKey(k); return p.orderId ? orders.get(p.orderId)?.customer_id || null : p.customerId; }).filter(Boolean))] as string[];
  const custs = new Map<string, string>();
  for (let i = 0; i < cids.length; i += 200) {
    const { data: cs } = await admin.from("customers").select("id, company, name").in("id", cids.slice(i, i + 200));
    for (const c of (cs || []) as { id: string; company: string | null; name: string | null }[]) custs.set(c.id, c.company || c.name || "");
  }
  const owners = await accountOwners(admin, cids);
  const out: ChatSummary[] = [];
  for (const k of keys) {
    const ms = by.get(k)!;
    const p = parseKey(k);
    const o = p.orderId ? orders.get(p.orderId) : null;
    if (p.orderId && !o) continue; // an order that's gone
    const cid = o?.customer_id || p.customerId;
    const last = ms[ms.length - 1];
    out.push({
      key: k, orderId: p.orderId, topic: p.topic, customerId: cid || null, projectId: last.project_id || null,
      number: o?.number ?? null, nickname: o?.nickname || "", customer: cid ? custs.get(cid) || "" : "", status: o?.status || "",
      last: { body: String(last.body || (last.attachments?.length ? "Sent a file" : "")).slice(0, 160), from: last.author_type === "customer" ? "customer" : "staff", who: last.author_name || "", at: last.created_at },
      unread: ms.filter((r) => r.author_type === "customer" && !r.read_at).length,
      waiting: last.author_type === "customer", owner: cid ? owners.get(cid) || "" : "",
    });
  }
  return out.sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0) || b.last.at.localeCompare(a.last.at));
}

/** one conversation, oldest first */
export async function loadThread(admin: SupabaseClient, key: string): Promise<ChatMsg[]> {
  const p = parseKey(key);
  const base = () => { const q = admin.from("messages").select("id, author_type, author_name, body, created_at, attachments").is("hidden_at", null); return p.orderId ? q.eq("order_id", p.orderId).eq("topic", p.topic) : q.is("order_id", null).eq("customer_id", p.customerId || ""); };
  const { data } = await allRows((r0, r1) => base().order("created_at").order("id").range(r0, r1), 2000);
  const rows = (data || []) as { id: string; author_type: string; author_name: string | null; body: string | null; created_at: string; attachments: { path?: string; name?: string }[] | null }[];
  const paths = rows.flatMap((m) => (m.attachments || []).map((a) => a.path || "").filter(Boolean));
  const signed = paths.length ? (await admin.storage.from("proofs").createSignedUrls(paths, 3600)).data || [] : [];
  const url = new Map(paths.map((pp, i) => [pp, signed[i]?.signedUrl || ""]));
  return rows.map((m) => ({ id: m.id, from: m.author_type === "customer" ? "customer" as const : "staff" as const, who: m.author_name || "", body: m.body || "", at: m.created_at,
    files: (m.attachments || []).map((a) => ({ name: a.name || "file", url: url.get(a.path || "") || "" })) }));
}

/** staff opened it: the customer's messages in it are read */
export async function markThreadRead(admin: SupabaseClient, key: string) {
  const p = parseKey(key);
  let q = admin.from("messages").update({ read_at: new Date().toISOString() }).eq("author_type", "customer").is("read_at", null);
  q = p.orderId ? q.eq("order_id", p.orderId).eq("topic", p.topic) : q.is("order_id", null).eq("customer_id", p.customerId || "");
  await q;
}
