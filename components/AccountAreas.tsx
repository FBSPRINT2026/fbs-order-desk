"use client";
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ST, designLabel, type Design } from "@/lib/pricing";
import { fmtDateLong, money } from "@/lib/format";
import { designMatches } from "@/components/DesignSearch";

export type AOrder = { id: string; number: number; nickname: string; status: string; type: string; total: number; paid: number; balance: number; due_date: string | null; created_at: string; qty: number; price_type?: string };
export type APayment = { id: string; order_id: string; number: number; amount: number; method: string; paid_on: string | null; created_at: string };
export type AMockup = { id: string; title: string; url: string; thumb: string; number: number | null; order_id: string | null; created_at: string };
export type AMessage = { id: string; order_id: string | null; number: number | null; author_type: string; author_name: string; body: string; created_at: string };
export type Area = "overview" | "quotes" | "orders" | "invoices" | "payments" | "artwork" | "messages" | "receive";

const IN_WORK = ["approved", "art", "blanks", "production", "ready"];
const WAITING = ["approved", "art", "blanks"];
const has = (q: string, ...xs: (string | number | null | undefined)[]) => { const t = q.trim().toLowerCase().replace(/^#/, ""); return !t || xs.some((x) => String(x ?? "").toLowerCase().includes(t)); };
const when = (d?: string | null) => (d ? fmtDateLong(d.slice(0, 10)) : "");

/**
 * A customer's account split into areas (quotes, orders, invoices, payments, artwork, messages…), each searchable.
 * Used on the shop's customer page (mode "shop") and in the customer's portal (mode "portal").
 */
export default function AccountAreas({ mode, orders, payments, designs, designUrls, mockups, messages, overview, hrefBase, hrefQuery = "", onSend, onStar, canAct = true }: {
  mode: "shop" | "portal";
  orders: AOrder[]; payments: APayment[]; designs: Design[]; designUrls: Record<string, string>; mockups: AMockup[]; messages: AMessage[];
  overview: ReactNode;
  /** order links: hrefBase + id + hrefQuery (e.g. "/portal/orders/" + id + "?as=…") */
  hrefBase: string; hrefQuery?: string;
  onSend?: (body: string) => Promise<{ ok: boolean; error?: string; emailed?: boolean }>;
  onStar?: (designId: string, starred: boolean) => Promise<{ ok: boolean; error?: string }>;
  /** false in the staff preview of a portal (read-only) */
  canAct?: boolean;
}) {
  const router = useRouter(), path = usePathname(), sp = useSearchParams();
  const orderHref = (id: string, hash?: string) => `${hrefBase}${id}${hrefQuery}${hash ? "#" + hash : ""}`;
  const area = (sp.get("area") as Area) || "overview";
  const go = (a: Area) => { const p = new URLSearchParams(sp.toString()); if (a === "overview") p.delete("area"); else p.set("area", a); router.replace(`${path}${p.size ? "?" + p : ""}`, { scroll: false }); };
  const [q, setQ] = useState("");
  const [stars, setStars] = useState<Record<string, boolean>>({});
  const ds = useMemo(() => designs.map((d) => (d.id in stars ? { ...d, starred: stars[d.id] } : d)), [designs, stars]);

  const quotes = orders.filter((o) => o.type === "quote" && (mode === "shop" || o.status !== "quote"));
  const inWork = orders.filter((o) => o.type === "invoice" && IN_WORK.includes(o.status));
  const invoices = orders.filter((o) => o.type === "invoice");
  const receive = orders.filter((o) => o.price_type === "wholesale" && o.type === "invoice" && WAITING.includes(o.status));
  const owed = invoices.reduce((a, o) => a + Math.max(0, o.balance), 0);

  const AREAS: { id: Area; label: string; n?: number; show?: boolean }[] = [
    { id: "overview", label: mode === "shop" ? "Account" : "Home" },
    { id: "quotes", label: "Quotes", n: quotes.length },
    { id: "orders", label: mode === "shop" ? "Orders in progress" : "Orders", n: inWork.length },
    { id: "invoices", label: "Invoices", n: invoices.length },
    { id: "payments", label: "Payments", n: payments.length },
    { id: "artwork", label: "Artwork", n: designs.length + mockups.length },
    { id: "messages", label: "Messages", n: messages.length },
    { id: "receive", label: mode === "shop" ? "Waiting to receive" : "Garments to send us", n: receive.length, show: receive.length > 0 || mode === "shop" },
  ];

  const search = (ph: string) => <input type="search" className="aa-search" placeholder={ph} value={q} onChange={(e) => setQ(e.target.value)} />;
  const orderRows = (list: AOrder[], cols: "quote" | "work" | "invoice") => {
    const rows = list.filter((o) => has(q, o.number, o.nickname, ST[o.status]?.label, ST[o.status]?.portal));
    if (!list.length) return <div className="aa-empty">Nothing here yet.</div>;
    return (
      <div className="tbl-wrap">
        <table className="tbl aa-tbl">
          <thead><tr><th>#</th><th>Job</th><th>Status</th><th>{cols === "quote" ? "Created" : "Due"}</th>{cols === "invoice" && <th className="r">Paid</th>}{cols === "invoice" && <th className="r">Balance</th>}<th className="r">Total</th></tr></thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} onClick={() => router.push(orderHref(o.id))}>
                <td><Link href={orderHref(o.id)} className="ordno" onClick={(e) => e.stopPropagation()}>{o.number}</Link></td>
                <td>{o.nickname || (cols === "quote" ? "Quote" : "Order")}<span className="faint"> · {o.qty} pcs</span></td>
                <td><span className="aa-pill" style={{ ["--sc" as string]: ST[o.status]?.c }}>{mode === "shop" ? ST[o.status]?.label : ST[o.status]?.portal}</span></td>
                <td>{cols === "quote" ? when(o.created_at) : when(o.due_date)}</td>
                {cols === "invoice" && <td className="r num">{money(o.paid)}</td>}
                {cols === "invoice" && <td className={"r num" + (o.balance > 0.004 ? " aa-due" : "")}>{money(Math.max(0, o.balance))}</td>}
                <td className="r num">{money(o.total)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7}><div className="aa-empty">No matches for “{q}”.</div></td></tr>}
          </tbody>
        </table>
      </div>
    );
  };

  let body: ReactNode = null;
  if (area === "overview") body = overview;
  else if (area === "quotes") body = <>{search("Search quotes by number, name or status")}{orderRows(quotes, "quote")}</>;
  else if (area === "orders") body = <>{search("Search orders by number, name or status")}{orderRows(inWork, "work")}</>;
  else if (area === "invoices") body = <>
    <div className="aa-sum"><span>{invoices.length} invoice{invoices.length === 1 ? "" : "s"}</span><span>Invoiced <b>{money(invoices.reduce((a, o) => a + o.total, 0))}</b></span><span className={owed > 0.004 ? "aa-due" : ""}>Balance <b>{money(owed)}</b></span></div>
    {search("Search invoices by number, name or status")}{orderRows(invoices, "invoice")}</>;
  else if (area === "payments") {
    const rows = payments.filter((p) => has(q, p.number, p.method, money(p.amount), p.paid_on));
    body = <>{search("Search payments by order number, method or amount")}
      {payments.length ? (
        <div className="tbl-wrap"><table className="tbl aa-tbl">
          <thead><tr><th>Date</th><th>Order</th><th>Method</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {rows.map((p) => <tr key={p.id} onClick={() => router.push(orderHref(p.order_id))}><td>{when(p.paid_on || p.created_at)}</td><td><span className="ordno">{p.number}</span></td><td>{p.method || "—"}</td><td className="r num">{money(p.amount)}</td></tr>)}
            {!rows.length && <tr><td colSpan={4}><div className="aa-empty">No matches for “{q}”.</div></td></tr>}
          </tbody>
        </table></div>
      ) : <div className="aa-empty">No payments yet.</div>}</>;
  } else if (area === "artwork") {
    const dRows = ds.filter((d) => designMatches(d, q)).sort((a, b) => Number(!!b.starred) - Number(!!a.starred) || b.number - a.number);
    const mRows = mockups.filter((m) => has(q, m.title, m.number));
    body = <>{search("Search artwork by design number (D-10004), name, ink or order")}
      <div className="aa-h"><h3>Designs</h3><span className="faint">{mode === "shop" ? "Star the logos this customer uses most. Starred designs come up first when picking art." : "Star your favorites so they come up first."}</span></div>
      {dRows.length ? (
        <div className="design-grid">
          {dRows.map((d) => (
            <div key={d.id} className="design-card">
              <div className="dc-img">{designUrls[d.id] ? <img src={designUrls[d.id]} alt={d.name} /> : <span>{(d.file_name.split(".").pop() || "file").toUpperCase()}</span>}
                {onStar && <button type="button" className={"dc-star" + (d.starred ? " on" : "")} disabled={!canAct} title={d.starred ? "Unstar" : "Star as a favorite"} aria-label={d.starred ? "Unstar" : "Star"}
                  onClick={async () => { setStars((s) => ({ ...s, [d.id]: !d.starred })); const r = await onStar(d.id, !d.starred); if (!r.ok) setStars((s) => ({ ...s, [d.id]: !!d.starred })); }}>{d.starred ? "★" : "☆"}</button>}
              </div>
              <div className="dc-b">{mode === "shop" ? <Link href={`/shop/artwork/${d.id}`}><b>D-{d.number}</b></Link> : <b>D-{d.number}</b>}<span>{d.name || "Design"}</span>{d.inks && <span className="faint">{d.inks}</span>}</div>
            </div>
          ))}
        </div>
      ) : <div className="aa-empty">{designs.length ? `No designs match “${q}”.` : "No designs on file yet."}</div>}
      <div className="aa-h"><h3>Mockups</h3></div>
      {mRows.length ? (
        <div className="design-grid">
          {mRows.map((m) => (
            <a key={m.id} className="design-card" href={m.url} target="_blank" rel="noreferrer">
              <div className="dc-img mock">{m.thumb ? <img src={m.thumb} alt={m.title} /> : null}</div>
              <div className="dc-b"><b>{m.title}</b><span className="faint">{m.number ? `Order #${m.number} · ` : ""}{when(m.created_at)}</span></div>
            </a>
          ))}
        </div>
      ) : <div className="aa-empty">{mockups.length ? `No mockups match “${q}”.` : "No mockups yet."}</div>}
    </>;
  } else if (area === "messages") {
    const rows = messages.filter((m) => has(q, m.body, m.author_name, m.number)).slice().reverse();
    body = <>
      {onSend && <SendBox canAct={canAct} mode={mode} onSend={onSend} />}
      {search("Search messages")}
      <div className="aa-msgs">
        {rows.map((m) => (
          <div key={m.id} className={"aa-msg " + (m.author_type === "staff" ? "shop" : "cust")}>
            <div className="aa-msg-h"><b>{m.author_name}</b><span className="faint">{new Date(m.created_at).toLocaleString()}</span>{m.order_id && m.number ? <Link href={orderHref(m.order_id, "messages")} className="aa-ord">Order #{m.number}</Link> : <span className="aa-ord gen">General</span>}</div>
            <div className="aa-msg-b">{m.body}</div>
          </div>
        ))}
        {!rows.length && <div className="aa-empty">{messages.length ? `No messages match “${q}”.` : "No messages yet."}</div>}
      </div>
    </>;
  } else if (area === "receive") {
    body = <>
      <p className="faint" style={{ marginTop: 0 }}>{mode === "shop" ? "Customer-supplied garments we still need before these jobs can print." : "These orders print on garments you supply. Please drop off or ship them to us."}</p>
      {search("Search by order number or name")}{orderRows(receive, "work")}</>;
  }

  return (
    <div className="aa">
      <nav className="aa-nav" aria-label="Account areas">
        {AREAS.filter((a) => a.show !== false).map((a) => (
          <button key={a.id} type="button" className={"aa-tab" + (area === a.id ? " on" : "")} onClick={() => { go(a.id); setQ(""); }}>
            <span>{a.label}</span>{a.n ? <span className="aa-n">{a.n}</span> : null}
          </button>
        ))}
      </nav>
      <section className="aa-body">{body}</section>
    </div>
  );
}

function SendBox({ onSend, canAct, mode }: { onSend: (b: string) => Promise<{ ok: boolean; error?: string; emailed?: boolean }>; canAct: boolean; mode: "shop" | "portal" }) {
  const [t, setT] = useState(""), [busy, setBusy] = useState(false), [note, setNote] = useState("");
  const router = useRouter();
  return (
    <div className="panel aa-send"><div className="panel-b stack">
      <label className="lbl" htmlFor="aa-msg">{mode === "shop" ? "SEND A MESSAGE TO THIS CUSTOMER" : "SEND US A MESSAGE"}</label>
      <textarea id="aa-msg" rows={3} placeholder={mode === "shop" ? "Not about one order? Write it here. They'll see it in their portal and get an email." : "Questions about anything? Write us here. For a specific order, message on that order."} value={t} onChange={(e) => setT(e.target.value)} disabled={!canAct} />
      <div className="row"><span className="faint" style={{ fontSize: 12 }}>{note || (!canAct ? "Turned off in the preview." : "")}</span><span className="spacer" />
        <button type="button" className="btn primary" disabled={!canAct || busy || !t.trim()} onClick={async () => { setBusy(true); const r = await onSend(t); setBusy(false); if (r.ok) { setT(""); setNote(r.emailed ? "Sent and emailed." : "Sent."); router.refresh(); } else setNote(r.error || "Couldn't send."); }}>{busy ? "Sending…" : "Send"}</button>
      </div>
    </div></div>
  );
}
