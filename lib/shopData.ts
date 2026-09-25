"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mergeSettings, type Customer, type Order, type Settings } from "@/lib/pricing";

export type OrderRow = Pick<Order, "id" | "number" | "nickname" | "status" | "type" | "due_date" | "total" | "qty" | "customer_id" | "lines" | "created_at"> & {
  paid: number;
  balance: number;
  unread: number;
};

/** Loads the list-level data the shop pages share. */
export function useShopData() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [settings, setSettings] = useState<Settings>(mergeSettings({}));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const sb = createClient();
    const [o, c, p, m, s] = await Promise.all([
      sb.from("orders").select("id,number,nickname,status,type,due_date,total,qty,customer_id,lines,created_at").order("number", { ascending: false }),
      sb.from("customers").select("*"),
      sb.from("payments").select("order_id,amount"),
      sb.from("messages").select("order_id").eq("author_type", "customer").is("read_at", null),
      sb.from("settings").select("data").eq("id", 1).maybeSingle(),
    ]);
    const err = o.error || c.error || p.error;
    if (err) setError(err.message);
    const paid: Record<string, number> = {};
    (p.data || []).forEach((x) => { paid[x.order_id] = (paid[x.order_id] || 0) + (+x.amount || 0); });
    const unread: Record<string, number> = {};
    (m.data || []).forEach((x) => { unread[x.order_id] = (unread[x.order_id] || 0) + 1; });
    setOrders((o.data || []).map((x) => ({ ...(x as Order), total: +x.total || 0, paid: paid[x.id] || 0, balance: Math.round(((+x.total || 0) - (paid[x.id] || 0)) * 100) / 100, unread: unread[x.id] || 0 })));
    setCustomers(Object.fromEntries((c.data || []).map((x) => [x.id, x as Customer])));
    setSettings(mergeSettings(s.data?.data));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  return { orders, setOrders, customers, settings, loading, error, reload: load };
}

export function summaryLine(o: Pick<Order, "lines">) {
  const ls = (o.lines || []).filter((l) => l.garment || l.style);
  return ls.slice(0, 2).map((l) => [l.style || l.garment, l.color].filter(Boolean).join(" ")).join(", ") + (ls.length > 2 ? " +more" : "");
}
