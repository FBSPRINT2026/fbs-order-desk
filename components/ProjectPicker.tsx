"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/** Staff: which of the customer's projects an order belongs to. Saves right away. */
export default function ProjectPicker({ orderId, customerId, value }: { orderId: string; customerId: string | null; value: string | null }) {
  const [list, setList] = useState<{ id: string; name: string }[]>([]);
  const [v, setV] = useState(value || "");
  useEffect(() => setV(value || ""), [value]);
  useEffect(() => { if (customerId) createClient().from("projects").select("id, name").eq("customer_id", customerId).in("status", ["planning", "active", "delivered"]).order("event_date").then(({ data }) => setList((data || []) as never)); }, [customerId]);
  if (!customerId || (!list.length && !value)) return null;
  return (
    <div className="field"><label htmlFor="o-proj">Project {v && <Link href={`/shop/projects/${v}`} style={{ fontWeight: 500 }}>open</Link>}</label>
      <select id="o-proj" value={v} onChange={async (e) => { const nv = e.target.value; setV(nv); await createClient().from("orders").update({ project_id: nv || null }).eq("id", orderId); }}>
        <option value="">None</option>{list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
  );
}
