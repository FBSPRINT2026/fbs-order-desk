"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { daysUntil, fmtDate, fmtStamp, money } from "@/lib/format";
import { useShopData } from "@/lib/shopData";
import SearchInput from "@/components/SearchInput";

export default function CustomersPage() {
  const router = useRouter();
  const { orders, customers, loading } = useShopData();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [tag, setTag] = useState("");
  const allTags = useMemo(() => [...new Set(Object.values(customers).flatMap((c) => c.tags || []))].sort((a, b) => a.localeCompare(b)), [customers]);

  const stats = useMemo(() => {
    const m: Record<string, { n: number; spent: number; owed: number }> = {};
    orders.forEach((o) => {
      if (!o.customer_id) return;
      const s = (m[o.customer_id] = m[o.customer_id] || { n: 0, spent: 0, owed: 0 });
      s.n++;
      if (o.type === "invoice") { s.spent += o.total; s.owed += Math.max(0, o.balance); }
    });
    return m;
  }, [orders]);

  const list = Object.values(customers)
    .filter((c) => !q.trim() || [c.name, c.company, c.email, c.phone, ...(c.tags || [])].join(" ").toLowerCase().includes(q.trim().toLowerCase()))
    .filter((c) => !tag || (tag === "__fu" ? !!c.next_follow_up && (daysUntil(c.next_follow_up) ?? 1) <= 0 : (c.tags || []).includes(tag)))
    .sort((a, b) => (a.company || a.name).localeCompare(b.company || b.name));

  async function add() {
    setBusy(true);
    const { data, error } = await createClient().from("customers").insert({}).select("id").single();
    setBusy(false);
    if (data) router.push(`/shop/customers/${data.id}?new=1`);
    else if (error) alert(error.message);
  }

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">{Object.keys(customers).length} on file</div><h1>Customers</h1></div>
        <div className="row"><Link className="btn" href="/shop/customers/import">Import from Printavo</Link>
        <button className="btn primary" type="button" onClick={add} disabled={busy}>+ New customer</button></div>
      </div>
      <div className="toolbar">
        <SearchInput placeholder="Search name, company, email, tag…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Filter" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All customers</option>
          <option value="__fu">Follow-up due</option>
          {allTags.length > 0 && <optgroup label="Tags">{allTags.map((t) => <option key={t} value={t}>{t}</option>)}</optgroup>}
        </select>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Customer</th><th>Contact</th><th>Follow-up</th><th className="r">Orders</th><th className="r">Lifetime</th><th className="r">Owes</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6}><div className="empty">Loading…</div></td></tr> : list.length ? list.map((c) => {
              const s = stats[c.id] || { n: 0, spent: 0, owed: 0 };
              return (
                <tr key={c.id} tabIndex={0} onClick={() => router.push(`/shop/customers/${c.id}`)} onKeyDown={(e) => e.key === "Enter" && router.push(`/shop/customers/${c.id}`)}>
                  <td><div><b>{c.company || c.name || "Unnamed"}</b>{c.price_type === "wholesale" && <span className="tag i" style={{ marginLeft: 6 }}>Wholesale</span>}</div><div className="sub">{c.company ? c.name : ""}{(c.tags || []).length ? <>{c.company && c.name ? " · " : ""}{(c.tags || []).join(", ")}</> : null}</div></td>
                  <td><div>{c.email}</div><div className="sub">{c.phone}</div></td>
                  <td>{c.next_follow_up ? <span className={(daysUntil(c.next_follow_up) ?? 1) <= 0 ? "due-late" : ""}>{fmtDate(c.next_follow_up)}</span> : <span className="faint">—</span>}<div className="sub">{c.last_contact_at ? `Last ${fmtStamp(c.last_contact_at).split(",")[0]}` : ""}</div></td>
                  <td className="r">{s.n}</td>
                  <td className="r">{money(s.spent)}</td>
                  <td className="r">{s.owed > 0.004 ? <span className="bal">{money(s.owed)}</span> : <span className="faint">None</span>}</td>
                </tr>
              );
            }) : <tr><td colSpan={6}><div className="empty">{Object.keys(customers).length ? "No customers match." : "No customers yet."}</div></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
