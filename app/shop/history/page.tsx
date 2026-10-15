"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import BackLink from "@/components/BackLink";

/**
 * Design history (Oct 14, Nick: "how my customers reorder: search Printavo for the same-name product, search the email
 * for it, put it all together in date order"). One design of one customer, oldest first: each order (old Printavo
 * jobs and portal orders, with the garments, prints, total and mockups), each email about it, and what production
 * confirmed. The data comes from /api/history.
 */
type Item =
  | { kind: "order"; src: "printavo" | "portal"; date: string; id: string; number: string; title: string; qty: number; total: number; garments: string[]; prints: string[]; thumbs: string[]; status?: string }
  | { kind: "email"; date: string; from: string; incoming: boolean; subject: string; text: string; on?: string; pics?: string[] }
  | { kind: "confirmed"; date: string; by: string; order: string; spec: string };

const day = (d: string) => (d ? new Date(d.length === 10 ? d + "T12:00" : d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function DesignHistoryPage() {
  const sp = useSearchParams();
  const customer = sp.get("customer") || "";
  const [q, setQ] = useState(sp.get("q") || ""), [input, setInput] = useState(sp.get("q") || "");
  const [data, setData] = useState<{ words: string[]; items: Item[]; customer: string } | null>(null), [err, setErr] = useState("");
  const [show, setShow] = useState<"all" | "orders" | "emails">("all");
  const [open, setOpen] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!customer) { setErr("Open this from an email or an order."); return; }
    setData(null); setErr("");
    const p = new URLSearchParams({ customer, ...(q ? { q } : { text: sp.get("text") || "" }) });
    fetch(`/api/history?${p}`).then((r) => r.json()).then((r) => {
      if (r.error) setErr(r.error); else { setData(r); if (!q && r.words?.length) setInput(r.words.join(" ")); }
    }).catch(() => setErr("Couldn't load the history."));
  }, [customer, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = (data?.items || []).filter((i) => show === "all" || (show === "orders" ? i.kind !== "email" : i.kind === "email"));
  const orders = (data?.items || []).filter((i) => i.kind === "order").length, emails = (data?.items || []).filter((i) => i.kind === "email").length;
  const name = (data?.words || []).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

  return (
    <>
      <div className="page-head">
        <div>
          <BackLink href="/shop/inbox" label="Inbox" />
          <div className="eyebrow">{data?.customer || "Design history"}</div>
          <h1>{name ? `${name} history` : "Design history"}</h1>
          <p className="muted dh-intro">Every order and email about this design, oldest first.</p>
        </div>
      </div>
      <form className="dh-bar" onSubmit={(e) => { e.preventDefault(); setQ(input.trim()); }}>
        <input type="search" value={input} onChange={(e) => setInput(e.target.value)} placeholder="The design's name, e.g. Mewjira" aria-label="Design name" />
        <button type="submit" className="btn sm">Search</button>
        <div className="aa-sub dh-tabs" role="tablist">
          {(["all", "orders", "emails"] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={show === k} className={show === k ? "on" : ""} onClick={() => setShow(k)}>{k === "all" ? "Everything" : k === "orders" ? `Orders ${orders}` : `Emails ${emails}`}</button>)}
        </div>
      </form>
      {err && <div className="err">{err}</div>}
      {!data && !err && <div className="empty">Searching the old Printavo jobs, the orders and the email…</div>}
      {data && !items.length && <div className="empty">Nothing found for “{input}”. Try the name the customer uses for the design.</div>}
      {data && items.length > 0 && (
        <ol className="dh-list">
          {items.map((it, i) => (
            <li key={i} className={"dh-item " + it.kind + (it.kind === "email" ? (it.incoming ? " in" : " out") : "")}>
              <div className="dh-date">{day(it.date)}</div>
              <span className="dh-dot" aria-hidden />
              <div className="dh-card">
                {it.kind === "order" && <>
                  <div className="dh-h">
                    <span className="dh-k">{it.src === "printavo" ? "Order (Printavo)" : "Order"}</span>
                    <Link href={it.src === "printavo" ? `/shop/archive/${it.id}` : `/shop/orders/${it.id}`} className="dh-num">#{it.number}</Link>
                    <b>{it.title}</b>
                    <span className="spacer" />
                    {it.qty > 0 && <span className="faint">{it.qty} pcs</span>}
                    {it.total > 0 && <span className="dh-total">{money(it.total)}</span>}
                  </div>
                  <div className="dh-o">
                    {it.thumbs.length > 0 && <div className="dh-thumbs">{it.thumbs.map((t, k) => <a key={k} href={t} target="_blank" rel="noreferrer"><img src={t} alt="" /></a>)}</div>}
                    <div className="dh-od">
                      {it.garments.map((g, k) => <div key={k}>{g}</div>)}
                      {it.prints.map((p, k) => <div key={k} className="dh-print">{p}</div>)}
                    </div>
                  </div>
                </>}
                {it.kind === "email" && <>
                  <div className="dh-h">
                    <span className="dh-k">{it.incoming ? "Email from" : "Email from us"}</span>
                    <b>{it.incoming ? it.from : it.from || "FBS"}</b>
                    {it.on && <span className="faint">· on {it.on}</span>}
                  </div>
                  {it.subject && <div className="dh-subj">{it.subject}</div>}
                  <div className={"dh-text" + (open[i] ? " open" : "")}>{it.text}</div>
                  {it.text.length > 280 && <button type="button" className="linkbtn" onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>{open[i] ? "Show less" : "Show all"}</button>}
                  {(it.pics || []).length > 0 && <div className="dh-thumbs">{it.pics!.map((t, k) => <a key={k} href={t} target="_blank" rel="noreferrer"><img src={t} alt="" /></a>)}</div>}
                </>}
                {it.kind === "confirmed" && <div className="dh-h"><span className="dh-k ok">✓ Production confirmed</span><b>{it.spec}</b><span className="faint">· {it.by} on {it.order}</span></div>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {data && <p className="faint dh-foot">Text messages will show here once your Mac is linked. The portal&apos;s copy of the mailbox starts Aug 28, 2026; older emails come from the Printavo jobs.</p>}
    </>
  );
}
