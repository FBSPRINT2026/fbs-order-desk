"use client";
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ST, type Design } from "@/lib/pricing";
import { fmtDateLong, money } from "@/lib/format";
import { designMatches } from "@/components/DesignSearch";

export type AOrder = { id: string; number: number; nickname: string; status: string; type: string; total: number; paid: number; balance: number; due_date: string | null; created_at: string; qty: number; price_type?: string };
export type APayment = { id: string; order_id: string; number: number; amount: number; method: string; paid_on: string | null; created_at: string };
export type AMockup = { id: string; title: string; url: string; thumb: string; number: number | null; order_id: string | null; created_at: string; starred?: boolean };
export type AMessage = { id: string; order_id: string | null; number: number | null; author_type: string; author_name: string; body: string; created_at: string };
/** Things waiting on someone: shown in the "Requires your attention" panel. */
export type AAttn = { kind: "quote" | "art" | "pay" | "receive"; order_id: string; number: number; date: string; hash?: string };
export type Area = "home" | "quotes" | "orders" | "invoices" | "payments" | "artwork" | "messages" | "receive" | "details";

const IN_WORK = ["approved", "art", "blanks", "production", "ready"];
const WAITING = ["approved", "art", "blanks"];
const has = (q: string, ...xs: (string | number | null | undefined)[]) => { const t = q.trim().toLowerCase().replace(/^#/, ""); return !t || xs.some((x) => String(x ?? "").toLowerCase().includes(t)); };
const when = (d?: string | null) => (d ? fmtDateLong(d.slice(0, 10)) : "");
const today = () => new Date().toISOString().slice(0, 10);

/* small line icons for the top menu and stat cards */
const I = {
  home: "M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z",
  quotes: "M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7",
  orders: "M4 7h16v13H4zM8 7V4h8v3M4 12h16",
  invoices: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4",
  payments: "M3 6h18v12H3zM3 10h18M7 15h3",
  artwork: "M4 4h16v16H4zM4 16l5-5 4 4 3-3 4 4M15 9a1.5 1.5 0 1 0 0-.01",
  messages: "M4 5h16v11H9l-5 4z",
  receive: "M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8",
  details: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6",
  due: "M12 7v5l3 3M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z",
  dollar: "M12 3v18M16 7c0-1.7-1.8-3-4-3s-4 1.3-4 3 1.8 2.6 4 3 4 1.3 4 3-1.8 3-4 3-4-1.3-4-3",
  arrow: "M5 12h14M13 6l6 6-6 6",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  archive: "M3 4h18v4H3zM5 8v12h14V8M10 12h4",
};
export const Ico = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

/**
 * A customer's account split into areas (quotes, orders, invoices, payments, artwork, messages…), each searchable.
 * Used on the shop's customer page (mode "shop") and in the customer's portal (mode "portal").
 */
export default function AccountAreas({ mode, orders, payments, designs, designUrls, mockups, messages, attention, details, hrefBase, hrefQuery = "", onSend, onStar, usedIds = [], onDelete, onArchive, onStarMockup, canAct = true }: {
  mode: "shop" | "portal";
  orders: AOrder[]; payments: APayment[]; designs: Design[]; designUrls: Record<string, string>; mockups: AMockup[]; messages: AMessage[];
  attention: AAttn[];
  /** staff only: the customer details form */
  details?: ReactNode;
  /** order links: hrefBase + id + hrefQuery (e.g. "/portal/orders/" + id + "?as=…") */
  hrefBase: string; hrefQuery?: string;
  onSend?: (body: string) => Promise<{ ok: boolean; error?: string; emailed?: boolean }>;
  onStar?: (designId: string, starred: boolean) => Promise<{ ok: boolean; error?: string }>;
  /** logos on a mockup or order: archive only, no delete */
  usedIds?: string[];
  onDelete?: (designId: string) => Promise<{ ok: boolean; error?: string }>;
  onStarMockup?: (mockupId: string, starred: boolean) => Promise<{ ok: boolean; error?: string }>;
  onArchive?: (designId: string, archived: boolean) => Promise<{ ok: boolean; error?: string }>;
  /** false in the staff preview of a portal: sending is turned off */
  canAct?: boolean;
}) {
  const router = useRouter(), path = usePathname(), sp = useSearchParams();
  const orderHref = (id: string, hash?: string) => `${hrefBase}${id}${hrefQuery}${hash ? "#" + hash : ""}`;
  const area = (sp.get("area") as Area) || "home";
  const go = (a: Area) => { const p = new URLSearchParams(sp.toString()); if (a === "home") p.delete("area"); else p.set("area", a); router.replace(`${path}${p.size ? "?" + p : ""}`, { scroll: false }); };
  const [q, setQ] = useState("");
  const [homeTab, setHomeTab] = useState<"quotes" | "orders">("orders");
  const [stars, setStars] = useState<Record<string, boolean>>({});
  const [starErr, setStarErr] = useState("");
  const [gone, setGone] = useState<Record<string, boolean>>({});
  const [mStars, setMStars] = useState<Record<string, boolean>>({});
  const [arch, setArch] = useState<Record<string, string | null>>({});
  const [armedDel, setArmedDel] = useState("");
  const [showArch, setShowArch] = useState(false);
  // artwork shows 6 at a time (two rows of three), with pages underneath
  const [pg, setPg] = useState<Record<string, number>>({});
  const PER = 6;
  const pageOf = <T,>(key: string, list: T[]) => { const n = Math.max(1, Math.ceil(list.length / PER)), p = Math.min(pg[key] || 0, n - 1); const items = list.slice(p * PER, p * PER + PER); return { items, p, n, pad: n > 1 ? PER - items.length : 0 }; };
  // empty places keep a short last page the same height, so the page buttons don't move
  const slots = (k: number) => Array.from({ length: k }, (_, i) => <div key={"slot" + i} className="design-card aa-slot" aria-hidden="true" />);
  const pager = (key: string, total: number, p: number, n: number) => n <= 1 ? null : (
    <div className="aa-pager">
      <span className="faint">Showing {p * PER + 1}–{Math.min(total, p * PER + PER)} of {total}</span>
      <span className="spacer" />
      <button type="button" className="aa-pg" disabled={p === 0} aria-label="Previous page" onClick={() => setPg((x) => ({ ...x, [key]: p - 1 }))}>‹</button>
      {Array.from({ length: n }, (_, i) => i).filter((i) => n <= 7 || i === 0 || i === n - 1 || Math.abs(i - p) <= 1).map((i, k, arr) => (
        <span key={i} className="row" style={{ gap: 4 }}>{k > 0 && i - arr[k - 1] > 1 && <span className="faint">…</span>}
          <button type="button" className={"aa-pg" + (i === p ? " on" : "")} aria-current={i === p ? "page" : undefined} onClick={() => setPg((x) => ({ ...x, [key]: i }))}>{i + 1}</button></span>
      ))}
      <button type="button" className="aa-pg" disabled={p >= n - 1} aria-label="Next page" onClick={() => setPg((x) => ({ ...x, [key]: p + 1 }))}>›</button>
    </div>
  );
  const ds = useMemo(() => designs.map((d) => (d.id in stars ? { ...d, starred: stars[d.id] } : d)), [designs, stars]);

  const quotes = orders.filter((o) => o.type === "quote" && (mode === "shop" || o.status !== "quote"));
  const inWork = orders.filter((o) => o.type === "invoice" && IN_WORK.includes(o.status));
  const invoices = orders.filter((o) => o.type === "invoice");
  const receive = orders.filter((o) => o.price_type === "wholesale" && o.type === "invoice" && WAITING.includes(o.status));
  const due = invoices.reduce((a, o) => a + Math.max(0, o.balance), 0);
  const overdue = invoices.filter((o) => o.due_date && o.due_date < today()).reduce((a, o) => a + Math.max(0, o.balance), 0);
  const openQuotes = quotes.filter((o) => o.status === "quote_sent").reduce((a, o) => a + o.total, 0);

  const AREAS: { id: Area; label: string; icon: string; n?: number; show?: boolean }[] = [
    { id: "home", label: "Dashboard", icon: I.home },
    { id: "quotes", label: "Quotes", icon: I.quotes, n: quotes.length },
    { id: "orders", label: "Orders", icon: I.orders, n: inWork.length },
    { id: "invoices", label: "Invoices", icon: I.invoices },
    { id: "payments", label: "Payments", icon: I.payments },
    { id: "artwork", label: "Artwork", icon: I.artwork },
    { id: "messages", label: "Messages", icon: I.messages, n: messages.length },
    { id: "receive", label: mode === "shop" ? "To receive" : "Garments to send", icon: I.receive, n: receive.length, show: receive.length > 0 },
    // staff reach Details from the "Customer details" button in the page header
  ];

  const search = (ph: string) => (
    <label className="aa-search"><Ico d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM21 21l-4.3-4.3" size={16} /><input type="search" placeholder={ph} value={q} onChange={(e) => { setQ(e.target.value); setPg({}); }} /></label>
  );
  const orderTable = (list: AOrder[], cols: "quote" | "work" | "invoice") => {
    const rows = list.filter((o) => has(q, o.number, o.nickname, ST[o.status]?.label, ST[o.status]?.portal));
    return (
      <div className="aa-card aa-tblcard">
        <table className="aa-tbl">
          <thead><tr><th>#</th><th>{cols === "quote" ? "Quote" : "Order"}</th><th>Status</th><th>{cols === "quote" ? "Created" : "In-hands date"}</th>{cols !== "quote" && <th className="r">Paid</th>}{cols !== "quote" && <th className="r">Balance</th>}<th className="r">Total</th></tr></thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className={o.balance > 0.004 && o.due_date && o.due_date < today() && cols !== "quote" ? "late" : ""} onClick={() => router.push(orderHref(o.id))}>
                <td className="num"><Link href={orderHref(o.id)} onClick={(e) => e.stopPropagation()}>{o.number}</Link></td>
                <td><div className="aa-t">{o.nickname || (cols === "quote" ? "Quote" : "Order")}</div><div className="aa-s">{o.qty} pcs</div></td>
                <td><span className="aa-pill" style={{ ["--sc" as string]: ST[o.status]?.c }}>{mode === "shop" ? ST[o.status]?.label : ST[o.status]?.portal}</span></td>
                <td>{cols === "quote" ? when(o.created_at) : when(o.due_date) || "—"}</td>
                {cols !== "quote" && <td className="r num">{money(o.paid)}</td>}
                {cols !== "quote" && <td className={"r num" + (o.balance > 0.004 ? " aa-due" : "")}>{money(Math.max(0, o.balance))}</td>}
                <td className="r num b">{money(o.total)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7}><div className="aa-empty">{list.length ? `No matches for “${q}”.` : "Nothing here yet."}</div></td></tr>}
          </tbody>
        </table>
      </div>
    );
  };
  const tableHead = (title: ReactNode, ph: string) => <div className="aa-bar"><div className="aa-bar-l">{title}</div>{search(ph)}</div>;

  let body: ReactNode = null;
  if (area === "home") {
    const groups: { kind: AAttn["kind"]; title: string; label: string }[] = [
      { kind: "quote", title: mode === "shop" ? "Quotes waiting on the customer" : "Quote approvals", label: "Quote" },
      { kind: "art", title: mode === "shop" ? "Artwork waiting on the customer" : "Artwork approvals", label: "Order" },
      { kind: "pay", title: "Payments due", label: "Invoice" },
      { kind: "receive", title: mode === "shop" ? "Garments to receive" : "Garments to send us", label: "Order" },
    ];
    body = (
      <>
        <div className="aa-stats">
          <div className="aa-stat"><span className="ic"><Ico d={I.quotes} size={22} /></span><b>{money(openQuotes)}</b><span>Open quotes</span></div>
          <div className="aa-stat"><span className="ic"><Ico d={I.orders} size={22} /></span><b>{inWork.length}</b><span>Orders in progress</span></div>
          <div className="aa-stat"><span className="ic"><Ico d={I.due} size={22} /></span><b>{money(due)}</b><span>Amount due</span></div>
          <div className={"aa-stat" + (overdue > 0.004 ? " red" : "")}><span className="ic"><Ico d={I.dollar} size={22} /></span><b>{money(overdue)}</b><span>Amount overdue</span></div>
        </div>
        <div className="aa-home">
          <div className="aa-home-main">
            <div className="aa-htabs">
              <button type="button" className={homeTab === "orders" ? "on" : ""} onClick={() => setHomeTab("orders")}>Orders</button>
              <button type="button" className={homeTab === "quotes" ? "on" : ""} onClick={() => setHomeTab("quotes")}>Quotes</button>
            </div>
            <div className="aa-htab-body">
              {tableHead(<span className="faint">{homeTab === "orders" ? `${invoices.length} order${invoices.length === 1 ? "" : "s"}` : `${quotes.length} quote${quotes.length === 1 ? "" : "s"}`}</span>, homeTab === "orders" ? "Search orders" : "Search quotes")}
              {homeTab === "orders" ? orderTable(invoices, "invoice") : orderTable(quotes, "quote")}
            </div>
          </div>
          <aside className="aa-attn">
            <div className="aa-attn-h">Requires {mode === "shop" ? "attention" : "your attention"}</div>
            {groups.map((g) => {
              const items = attention.filter((a) => a.kind === g.kind);
              if (!items.length) return null;
              return (
                <div key={g.kind} className="aa-attn-g">
                  <div className="aa-attn-t">{g.title}</div>
                  {items.map((a, i) => (
                    <Link key={g.kind + a.order_id + i} href={orderHref(a.order_id, a.hash)} className="aa-attn-i">
                      <span><span className="k">{g.label}</span><span className="v">#{a.number}</span></span>
                      <span><span className="k">{g.kind === "pay" ? "Balance" : "Since"}</span><span className="v">{a.date}</span></span>
                      <span className="go"><Ico d={I.arrow} size={18} /></span>
                    </Link>
                  ))}
                </div>
              );
            })}
            {!attention.length && <div className="aa-attn-none">{mode === "shop" ? "Nothing waiting on this customer." : "You're all caught up."}</div>}
          </aside>
        </div>
      </>
    );
  } else if (area === "quotes") body = <>{tableHead(<h2>Quotes</h2>, "Search quotes by number, name or status")}{orderTable(quotes, "quote")}</>;
  else if (area === "orders") body = <>{tableHead(<h2>Orders in progress</h2>, "Search orders by number, name or status")}{orderTable(inWork, "work")}</>;
  else if (area === "invoices") body = <>
    {tableHead(<><h2>Invoices</h2><span className="aa-sum">Invoiced <b>{money(invoices.reduce((a, o) => a + o.total, 0))}</b> · Balance <b className={due > 0.004 ? "aa-due" : ""}>{money(due)}</b></span></>, "Search invoices by number, name or status")}
    {orderTable(invoices, "invoice")}</>;
  else if (area === "payments") {
    const rows = payments.filter((p) => has(q, p.number, p.method, money(p.amount), p.paid_on));
    body = <>{tableHead(<><h2>Payments</h2><span className="aa-sum">Paid <b>{money(payments.reduce((a, p) => a + p.amount, 0))}</b></span></>, "Search by order number, method or amount")}
      <div className="aa-card aa-tblcard"><table className="aa-tbl">
        <thead><tr><th>Date</th><th>Order</th><th>Method</th><th className="r">Amount</th></tr></thead>
        <tbody>
          {rows.map((p) => <tr key={p.id} onClick={() => router.push(orderHref(p.order_id))}><td>{when(p.paid_on || p.created_at)}</td><td className="num"><Link href={orderHref(p.order_id)} onClick={(e) => e.stopPropagation()}>{p.number}</Link></td><td>{p.method || "—"}</td><td className="r num b">{money(p.amount)}</td></tr>)}
          {!rows.length && <tr><td colSpan={4}><div className="aa-empty">{payments.length ? `No matches for “${q}”.` : "No payments yet."}</div></td></tr>}
        </tbody>
      </table></div></>;
  } else if (area === "artwork") {
    const live = ds.filter((d) => !gone[d.id] && !(d.id in arch ? arch[d.id] : d.archived_at));
    const archived = ds.filter((d) => !gone[d.id] && (d.id in arch ? arch[d.id] : d.archived_at));
    const dRows = live.filter((d) => designMatches(d, q)).sort((a, b) => Number(!!b.starred) - Number(!!a.starred) || b.number - a.number);
    const aRows = archived.filter((d) => designMatches(d, q)).sort((a, b) => b.number - a.number);
    const ms = mockups.map((m) => (m.id in mStars ? { ...m, starred: mStars[m.id] } : m));
    const mRows = ms.filter((m) => has(q, m.title, m.number)).sort((a, b) => Number(!!b.starred) - Number(!!a.starred));
    const starMock = async (m: AMockup) => {
      if (!onStarMockup) return;
      setStarErr("");
      setMStars((x) => ({ ...x, [m.id]: !m.starred }));
      const r = await onStarMockup(m.id, !m.starred);
      if (!r.ok) { setMStars((x) => ({ ...x, [m.id]: !!m.starred })); setStarErr(r.error || "Couldn't save the star."); }
    };
    const favMocks = ms.filter((m) => m.starred);
    const star = async (d: Design) => {
      if (!onStar) return;
      setStarErr("");
      setStars((s) => ({ ...s, [d.id]: !d.starred }));
      const r = await onStar(d.id, !d.starred);
      if (!r.ok) { setStars((s) => ({ ...s, [d.id]: !!d.starred })); setStarErr(r.error || "Couldn't save the star."); }
    };
    const used = new Set(usedIds);
    // unused logos can be deleted (two clicks); logos on a mockup or order can only be archived
    const remove = async (d: Design) => {
      setStarErr("");
      if (!used.has(d.id)) {
        if (armedDel !== d.id) { setArmedDel(d.id); setTimeout(() => setArmedDel((x) => (x === d.id ? "" : x)), 3500); return; }
        setArmedDel("");
        if (!onDelete) return;
        setGone((g) => ({ ...g, [d.id]: true }));
        const r = await onDelete(d.id);
        if (!r.ok) { setGone((g) => ({ ...g, [d.id]: false })); setStarErr(r.error || "Couldn't delete the logo."); }
        return;
      }
      if (!onArchive) return;
      setArch((x) => ({ ...x, [d.id]: new Date().toISOString() }));
      const r = await onArchive(d.id, true);
      if (!r.ok) { setArch((x) => ({ ...x, [d.id]: null })); setStarErr(r.error || "Couldn't archive the logo."); }
    };
    const restore = async (d: Design) => {
      if (!onArchive) return;
      setArch((x) => ({ ...x, [d.id]: null }));
      const r = await onArchive(d.id, false);
      if (!r.ok) { setArch((x) => ({ ...x, [d.id]: d.archived_at || new Date().toISOString() })); setStarErr(r.error || "Couldn't restore the logo."); }
    };
    const card = (d: Design, isArchived: boolean) => (
      <div key={d.id} className={"design-card" + (d.starred ? " starred" : "") + (isArchived ? " archived" : "")}>
        <div className="dc-img">{designUrls[d.id] ? <img src={designUrls[d.id]} alt={d.name} /> : <span>{(d.file_name.split(".").pop() || "file").toUpperCase()}</span>}
          <div className="dc-tools">
            {!isArchived && onStar && <button type="button" className={"dc-star" + (d.starred ? " on" : "")} title={d.starred ? "Remove from favorites" : "Add to favorites"} aria-label={d.starred ? "Remove from favorites" : "Add to favorites"} aria-pressed={!!d.starred} onClick={() => star(d)}>{d.starred ? "★" : "☆"}</button>}
            {!isArchived && (onDelete || onArchive) && (
              <button type="button" className={"dc-del" + (armedDel === d.id ? " armed" : "")} onClick={() => remove(d)}
                title={used.has(d.id) ? "Used on a mockup or order, so it can't be deleted. Archive it instead." : armedDel === d.id ? "Click again to delete for good" : "Delete this logo"}
                aria-label={used.has(d.id) ? "Archive logo" : "Delete logo"}>
                {used.has(d.id) ? <Ico d={I.archive} size={15} /> : armedDel === d.id ? "Delete?" : <Ico d={I.trash} size={15} />}
              </button>
            )}
          </div>
        </div>
        <div className="dc-b">{mode === "shop" ? <Link href={`/shop/artwork/${d.id}`}><b>D-{d.number}</b></Link> : <b>D-{d.number}</b>}<span>{d.name || "Logo"}</span>{d.inks && <span className="faint">{d.inks}</span>}
          {isArchived && <button type="button" className="btn sm" style={{ marginTop: 6, alignSelf: "flex-start" }} onClick={() => restore(d)}>Restore</button>}
        </div>
      </div>
    );
    const favs = live.filter((d) => d.starred).sort((a, b) => b.number - a.number);
    body = <>
      <div className="aa-home">
      <div className="aa-home-main stack">
      {tableHead(<h2>Artwork</h2>, "Search by logo number (D-10004), name, ink or order")}
      <div className="aa-card">
        <div className="aa-sec-h"><h3>Logos</h3><span className="faint">{mode === "shop" ? "Starred logos come up first when picking art for this customer." : "Star your favorites so they come up first."} Unused logos can be deleted; logos on a mockup or order can be archived.</span>{starErr && <span className="aa-due">{starErr}</span>}</div>
        {dRows.length ? (() => { const P = pageOf("logos", dRows); return <><div className="design-grid aa-grid3">{P.items.map((d) => card(d, false))}{slots(P.pad)}</div>{pager("logos", dRows.length, P.p, P.n)}</>; })()
          : <div className="aa-empty">{live.length ? `No logos match “${q}”.` : "No logos on file yet."}</div>}
        {archived.length > 0 && (
          <div className="aa-arch">
            <button type="button" className="btn sm ghost" onClick={() => setShowArch(!showArch)}>{showArch ? "Hide archived logos" : `View archived logos (${archived.length})`}</button>
            {showArch && (aRows.length ? (() => { const P = pageOf("arch", aRows); return <><div className="design-grid aa-grid3" style={{ marginTop: 10 }}>{P.items.map((d) => card(d, true))}{slots(P.pad)}</div>{pager("arch", aRows.length, P.p, P.n)}</>; })() : <div className="aa-empty">No archived logos match “{q}”.</div>)}
          </div>
        )}
      </div>
      <div className="aa-card">
        <div className="aa-sec-h"><h3>Mockups</h3></div>
        {mRows.length ? (() => { const P = pageOf("mock", mRows); return <>
          <div className="design-grid aa-grid3">
            {P.items.map((m) => (
              <div key={m.id} className={"design-card" + (m.starred ? " starred" : "")}>
                <div className="dc-img mock"><a href={m.url} target="_blank" rel="noreferrer" className="dc-open">{m.thumb ? <img src={m.thumb} alt={m.title} /> : null}</a>
                  {onStarMockup && <div className="dc-tools"><button type="button" className={"dc-star" + (m.starred ? " on" : "")} title={m.starred ? "Remove from favorites" : "Add to favorites"} aria-label={m.starred ? "Remove from favorites" : "Add to favorites"} aria-pressed={!!m.starred} onClick={() => starMock(m)}>{m.starred ? "★" : "☆"}</button></div>}
                </div>
                <div className="dc-b"><a href={m.url} target="_blank" rel="noreferrer"><b>{m.title}</b></a><span className="faint">{m.number ? `Order #${m.number} · ` : ""}{when(m.created_at)}</span></div>
              </div>
            ))}{slots(P.pad)}
          </div>{pager("mock", mRows.length, P.p, P.n)}</>; })()
        : <div className="aa-empty">{mockups.length ? `No mockups match “${q}”.` : "No mockups yet."}</div>}
      </div>
      </div>
      <aside className="aa-attn aa-favs">
        <div className="aa-attn-h">★ Favorites</div>
        <div className="aa-attn-t">Logos</div>
        {favs.map((d) => (
          <div key={d.id} className="aa-fav">
            {designUrls[d.id] ? <img src={designUrls[d.id]} alt="" /> : <span className="aa-fav-ph">{(d.file_name.split(".").pop() || "").toUpperCase()}</span>}
            <span className="aa-fav-t">{mode === "shop" ? <Link href={`/shop/artwork/${d.id}`}><b>D-{d.number}</b></Link> : <b>D-{d.number}</b>}<span>{d.name || "Logo"}</span></span>
            {onStar && <button type="button" className="dc-star on" title="Remove from favorites" aria-label="Remove from favorites" onClick={() => star(d)}>★</button>}
          </div>
        ))}
        {!favs.length && <div className="aa-attn-none">No favorite logos yet. Tap the ☆ on a logo to add it here{mode === "shop" ? "; favorites come up first when picking art for this customer." : "."}</div>}
        <div className="aa-attn-t" style={{ marginTop: 6 }}>Mockups</div>
        {favMocks.map((m) => (
          <div key={m.id} className="aa-fav">
            <a href={m.url} target="_blank" rel="noreferrer">{m.thumb ? <img src={m.thumb} alt="" /> : <span className="aa-fav-ph" />}</a>
            <span className="aa-fav-t"><a href={m.url} target="_blank" rel="noreferrer"><b>{m.title}</b></a><span className="faint">{m.number ? `Order #${m.number}` : when(m.created_at)}</span></span>
            {onStarMockup && <button type="button" className="dc-star on" title="Remove from favorites" aria-label="Remove from favorites" onClick={() => starMock(m)}>★</button>}
          </div>
        ))}
        {!favMocks.length && <div className="aa-attn-none">No favorite mockups yet. Tap the ☆ on a mockup to add it here.</div>}
      </aside>
      </div>
    </>;
  } else if (area === "messages") {
    const rows = messages.filter((m) => has(q, m.body, m.author_name, m.number)).slice().reverse();
    body = <>
      {tableHead(<h2>Messages</h2>, "Search messages")}
      {onSend && <SendBox canAct={canAct} mode={mode} onSend={onSend} />}
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
      {tableHead(<><h2>{mode === "shop" ? "Waiting to receive" : "Garments to send us"}</h2><span className="aa-sum">{mode === "shop" ? "Customer-supplied garments we need before these jobs can print" : "These orders print on garments you supply"}</span></>, "Search by order number or name")}
      {orderTable(receive, "work")}</>;
  } else if (area === "details") body = details;

  return (
    <div className="aa">
      <nav className="aa-nav" aria-label="Account areas">
        {AREAS.filter((a) => a.show !== false).map((a) => (
          <button key={a.id} type="button" className={"aa-tab" + (area === a.id ? " on" : "")} onClick={() => { go(a.id); setQ(""); }}>
            <Ico d={a.icon} /><span>{a.label}</span>{a.n ? <span className="aa-n">{a.n}</span> : null}
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
    <div className="aa-card aa-send">
      <label className="lbl" htmlFor="aa-msg">{mode === "shop" ? "SEND A MESSAGE TO THIS CUSTOMER" : "SEND US A MESSAGE"}</label>
      <textarea id="aa-msg" rows={3} placeholder={mode === "shop" ? "Not about one order? Write it here. They'll see it in their portal and get an email." : "Questions about anything? Write us here. For a specific order, message on that order."} value={t} onChange={(e) => setT(e.target.value)} disabled={!canAct} />
      <div className="row"><span className="faint" style={{ fontSize: 12 }}>{note || (!canAct ? "Turned off in the preview." : "")}</span><span className="spacer" />
        <button type="button" className="btn primary" disabled={!canAct || busy || !t.trim()} onClick={async () => { setBusy(true); const r = await onSend(t); setBusy(false); if (r.ok) { setT(""); setNote(r.emailed ? "Sent and emailed." : "Sent."); router.refresh(); } else setNote(r.error || "Couldn't send."); }}>{busy ? "Sending…" : "Send"}</button>
      </div>
    </div>
  );
}
