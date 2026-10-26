"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { daysUntil, fmtDate, fmtStamp, money } from "@/lib/format";
import { useShopData } from "@/lib/shopData";
import SearchInput from "@/components/SearchInput";
import { useSticky } from "@/lib/useSticky";
import { fmtPhone } from "@/lib/phone";

export default function CustomersPage() {
  const router = useRouter();
  const { orders, customers, loading } = useShopData();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  // starred customers go to the top (Oct 21, Nick: "a little star so that we can favor the clients")
  // each person's own stars (Oct 26, Nick: "Amanda should have her own favorites, not my favorites"): customer_favorites
  const [favs, setFavs] = useState<Record<string, boolean>>({});
  useEffect(() => { void createClient().from("customer_favorites").select("customer_id").then(({ data }) => setFavs(Object.fromEntries(((data || []) as { customer_id: string }[]).map((r) => [r.customer_id, true])))); }, []);
  const isFav = (c: { id: string }) => !!favs[c.id];
  async function star(c: { id: string }) {
    const v = !isFav(c);
    setFavs((f) => ({ ...f, [c.id]: v }));
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    const me = (user?.email || "").toLowerCase();
    const { error } = v
      ? await sb.from("customer_favorites").upsert({ staff_email: me, customer_id: c.id })
      : await sb.from("customer_favorites").delete().eq("staff_email", me).eq("customer_id", c.id);
    if (error) { setFavs((f) => ({ ...f, [c.id]: !v })); alert(error.message); }
  }
  const [tag, setTag] = useSticky("customers.filter", "");
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

  // test companies are off (Oct 21, Nick: "we're past that point… might come back to it later"): kept, not listed
  const list = Object.values(customers).filter((c) => !c.is_test)
    .filter((c) => !q.trim() || [c.name, c.company, c.email, c.phone, ...(c.tags || [])].join(" ").toLowerCase().includes(q.trim().toLowerCase()))
    .filter((c) => !tag || (tag === "__fu" ? !!c.next_follow_up && (daysUntil(c.next_follow_up) ?? 1) <= 0 : (c.tags || []).includes(tag)))
    .sort((a, b) => Number(isFav(b)) - Number(isFav(a)) || (a.company || a.name || "").localeCompare(b.company || b.name || ""));
  /** the letter a customer files under on the phone list: A–Z, # for numbers and the rest */
  const letter = (c: { company: string; name: string }) => { const ch = (c.company || c.name || "").trim().charAt(0).toUpperCase(); return /[A-Z]/.test(ch) ? ch : "#"; };

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
        <div><div className="eyebrow">{Object.values(customers).filter((c) => !c.is_test).length} on file</div><h1>Customers</h1></div>
        <div className="row"><Link className="btn" href="/shop/customers/owners">Account owners</Link><Link className="btn" href="/shop/customers/import">Import from Printavo</Link>
        <button className="btn primary" type="button" onClick={add} disabled={busy}>+ New customer</button></div>
      </div>
      <div className="toolbar">
        <SearchInput placeholder="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Filter" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All customers</option>
          <option value="__fu">Follow-up due</option>
          {allTags.length > 0 && <optgroup label="Tags">{allTags.map((t) => <option key={t} value={t}>{t}</option>)}</optgroup>}
        </select>
      </div>
      {/* phones (Oct 21, Nick: "can't tell what a customer is or whether the next line is"): one card per customer */}
      <div className="cu-cards" role="list">
        {loading ? <div className="empty">Loading…</div> : list.length ? list.map((c, i) => {
          const name = c.company || c.name || "Unnamed";
          const fav = isFav(c), sec = fav ? "★ Favorites" : letter(c);
          const prev = i > 0 ? (isFav(list[i - 1]) ? "★ Favorites" : letter(list[i - 1])) : "";
          const who = [c.company && c.name ? c.name : "", c.email || fmtPhone(c.phone) || ""].filter(Boolean).join(" · ");
          return [
            sec !== prev ? <div key={"h" + c.id} className={"cu-let" + (fav ? " fav" : "")} role="presentation">{sec}</div> : null,
            <div key={c.id} role="listitem" className="cu-card">
              <button type="button" className={"cu-star" + (fav ? " on" : "")} onClick={() => void star(c)} aria-pressed={fav} aria-label={fav ? `Unstar ${name}` : `Star ${name}`}>{fav ? "★" : "☆"}</button>
              <button type="button" className="cu-go" onClick={() => router.push(`/shop/customers/${c.id}`)}>
                <span className="cu-mid">
                  <span className="cu-n"><b>{name}</b>{c.price_type === "wholesale" && <span className="tag i">Wholesale</span>}</span>
                  {who && <span className="cu-s">{who}</span>}
                </span>
                <span className="cu-r"><span className="cu-chev" aria-hidden>›</span></span>
              </button>
            </div>,
          ];
        }) : <div className="empty">{Object.keys(customers).length ? "No customers match." : "No customers yet."}</div>}
      </div>
      <div className="tbl-wrap cu-tblw">
        <table className="tbl">
          <thead><tr><th>Customer</th><th>Contact</th><th>Follow-up</th><th className="r">Orders</th><th className="r">Lifetime</th><th className="r">Owes</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6}><div className="empty">Loading…</div></td></tr> : list.length ? list.map((c, i, all) => {
              const s = stats[c.id] || { n: 0, spent: 0, owed: 0 };
              // starred customers in their own section on top, then everyone else under "All customers" (Oct 24, Nick:
              // "it's a favorites and then put the favorites underneath… and then the other customers go underneath that")
              const fav = isFav(c), anyFav = isFav(all[0]);
              const head = !anyFav ? "" : i === 0 ? "fav" : !fav && isFav(all[i - 1]) ? "all" : "";
              return [
                head ? <tr key={"h" + c.id} className={"cu-grp" + (head === "fav" ? " fav" : " rest")}><td colSpan={6}>{head === "fav" ? <><span className="cu-grp-star" aria-hidden>★</span>Favorites</> : "All customers"}</td></tr> : null,
                <tr key={c.id} tabIndex={0} className={fav ? "cu-favrow" : undefined} onClick={() => router.push(`/shop/customers/${c.id}`)} onKeyDown={(e) => e.key === "Enter" && router.push(`/shop/customers/${c.id}`)}>
                  <td className="cu-td"><div><button type="button" className={"cu-star sm" + (isFav(c) ? " on" : "")} onClick={(e) => { e.stopPropagation(); void star(c); }} aria-pressed={isFav(c)} aria-label={isFav(c) ? "Unstar" : "Star"} title={isFav(c) ? "Starred: at the top of the list" : "Star: keep at the top of the list"}>{isFav(c) ? "★" : "☆"}</button><b>{c.company || c.name || "Unnamed"}</b>{c.is_test && <span className="ta-tag">Test</span>}{c.price_type === "wholesale" && <span className="tag i" style={{ marginLeft: 6 }}>Wholesale</span>}</div><div className="sub">{c.company ? c.name : ""}{(c.tags || []).length ? <>{c.company && c.name ? " · " : ""}{(c.tags || []).join(", ")}</> : null}</div></td>
                  <td><div className="cu-em" title={c.email || undefined}>{c.email}</div><div className="sub">{fmtPhone(c.phone)}</div></td>
                  <td>{c.next_follow_up ? <span className={(daysUntil(c.next_follow_up) ?? 1) <= 0 ? "due-late" : ""}>{fmtDate(c.next_follow_up)}</span> : <span className="faint">—</span>}<div className="sub">{c.last_contact_at ? `Last ${fmtStamp(c.last_contact_at).split(",")[0]}` : ""}</div></td>
                  <td className="r">{s.n}</td>
                  <td className="r">{money(s.spent)}</td>
                  <td className="r">{s.owed > 0.004 ? <span className="bal">{money(s.owed)}</span> : <span className="faint">None</span>}</td>
                </tr>,
              ];
            }) : <tr><td colSpan={6}><div className="empty">{Object.keys(customers).length ? "No customers match." : "No customers yet."}</div></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
