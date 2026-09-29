"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { createClient } from "@/lib/supabase/client";
import AssistantStrip from "@/components/AssistantStrip";
import SalesAnalytics from "@/components/SalesAnalytics";
import QuickShipQuote from "@/components/QuickShipQuote";
import { useRouter } from "next/navigation";
import { saveDashboard, type WidgetItem } from "@/app/shop/shortcut-actions";
import { Pill } from "@/components/bits";
import { money } from "@/lib/format";

/**
 * The daily dashboard: the first thing every admin sees. Everything that needs someone today, in one place:
 * customer messages to answer, emails in from customers (to tie to a job), follow-ups, jobs due / late / shipping
 * today, what's in production, what's waiting on the customer, goods coming in, and customers who ordered this time
 * last year. "My accounts" narrows it to the customers you own (from Printavo's order owner until go-live).
 */

type Cust = { id: string; company: string; name: string };

/** Every widget you can put on the dashboard (the + Widgets menu). w = default width out of 4. */
const CATALOG: { id: string; title: string; help: string; w: number; cat: string; boss?: boolean }[] = [
  { id: "glance", cat: "Overview", title: "Today at a glance", help: "The day's counts: messages, due & late, shipping, production, goods, reorders.", w: 4 },
  { id: "actions", cat: "Overview", title: "Quick actions", help: "One-click: new quote, find an order, receive the S&S truck, import manifests.", w: 1 },
  { id: "week", cat: "Overview", title: "This week", help: "Jobs due each day for the next 7 days.", w: 4 },
  { id: "note", cat: "Overview", title: "My notes", help: "A sticky note just for you.", w: 1 },
  { id: "salesKpis", cat: "Sales", title: "Sales numbers", help: "This month and year vs last year, orders, average order.", w: 4, boss: true },
  { id: "salesChart", cat: "Sales", title: "Sales by month", help: "This year against last year, month by month.", w: 2, boss: true },
  { id: "topCustomers", cat: "Sales", title: "Top customers", help: "Biggest customers over the last 12 months.", w: 1, boss: true },
  { id: "owed", cat: "Sales", title: "Open balances", help: "Invoices with money still owed, biggest first.", w: 1 },
  { id: "reorders", cat: "Sales", title: "Ordered this time last year", help: "Customers to reach out to before they reorder elsewhere.", w: 2 },
  { id: "waiting", cat: "Sales", title: "Waiting on the customer", help: "Quotes out and approvals we're waiting on.", w: 1 },
  { id: "requests", cat: "Sales", title: "New order requests", help: "Orders customers sent in from the portal, to review.", w: 1 },
  { id: "messages", cat: "Messages", title: "Customer messages to answer", help: "Unread messages from customers.", w: 2 },
  { id: "emails", cat: "Messages", title: "Emails from customers", help: "Recent customer emails; attach each to its job.", w: 2 },
  { id: "followups", cat: "Messages", title: "Follow-ups", help: "The Assistant's list: quotes to chase, approvals, payments.", w: 2 },
  { id: "due", cat: "Production", title: "Due today & late", help: "Jobs due today and anything past due.", w: 2 },
  { id: "tomorrow", cat: "Production", title: "Due tomorrow", help: "Jobs due tomorrow.", w: 1 },
  { id: "production", cat: "Production", title: "In production", help: "Everything being made, soonest due first.", w: 2 },
  { id: "ship", cat: "Shipping", title: "Ready to ship", help: "Jobs ready to go out.", w: 1 },
  { id: "shipQuote", cat: "Shipping", title: "Quick shipping quote", help: "ZIP + weight → UPS / FedEx prices from our shop.", w: 2 },
  { id: "goods", cat: "Receiving", title: "Goods & receiving", help: "Shipments arriving and arrived today.", w: 1 },
];
const defaultLayout = (boss: boolean): WidgetItem[] =>
  ["glance", ...(boss ? ["salesKpis"] : []), "messages", "due", "actions", "ship", ...(boss ? ["salesChart", "topCustomers"] : []), "owed", "shipQuote", "goods", "note", "emails", "followups", "production", "reorders", "waiting", "tomorrow", "requests"]
    .map((id) => ({ id, w: CATALOG.find((c) => c.id === id)!.w }));
type Job = { id: string; href: string; number: number; nickname: string; customer_id: string | null; due: string | null; status: string; statusLabel: string; printavo: boolean; total: number; owner: string; ship: boolean };
type Msg = { id: string; order_id: string | null; customer_id: string | null; author_name: string; author_email: string; body: string; created_at: string; topic: string | null };
type Mail = { id: string; customer_id: string | null; order_id: string | null; subject: string; body: string; from_email: string; occurred_at: string; meta: Record<string, unknown> };
type Reorder = { customer_id: string; number: string; nickname: string; date: string; total: number; href: string; owner: string };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const day = (d: string | null) => (d ? new Date(d.slice(0, 10) + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "—");
const ago = (t: string) => { const m = Math.round((Date.now() - Date.parse(t)) / 60000); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const PV_DONE = /job completed|quote - closed|cancel/i;
const pvKind = (s: string) => /ship|delivery/i.test(s) ? "ship" : /^quote/i.test(s) ? "quote" : /ready for production|scheduling|pre production|holder|waiting on details/i.test(s) ? "queue" : /issue/i.test(s) ? "issue" : "production";

export default function Dashboard() {
  const [me, setMe] = useState("");
  const [boss, setBoss] = useState(false); // owners / admins see the sales numbers
  const [layout, setLayout] = useState<WidgetItem[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const [owed, setOwed] = useState<{ id: string; number: string; nickname: string; customer_id: string | null; balance: number; due: string | null }[]>([]);
  const [mine, setMine] = useState(false);
  const [custs, setCusts] = useState<Record<string, Cust>>({});
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [mails, setMails] = useState<Mail[]>([]);
  const [reorders, setReorders] = useState<Reorder[]>([]);
  const [goods, setGoods] = useState({ today: 0, arrived: 0 });
  const [owners, setOwners] = useState<Record<string, string>>({}); // customer → account owner (first name)

  useEffect(() => {
    const sb = createClient();
    (async () => {
      const { data: { user } } = await sb.auth.getUser();
      if (user?.email) { const { data: st } = await sb.from("staff").select("name, role, dashboard").eq("email", user.email.toLowerCase()).maybeSingle(); const isBoss = ["owner", "admin"].includes((st?.role as string) || ""); setBoss(isBoss); setLayout(Array.isArray(st?.dashboard) && (st!.dashboard as WidgetItem[]).length ? (st!.dashboard as WidgetItem[]) : defaultLayout(isBoss)); setMe(((st?.name as string) || user.email.split("@")[0]).split(/[\s._-]+/)[0].toLowerCase()); }
      const lastYearFrom = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); d.setDate(d.getDate() - 7); return iso(d); })();
      const lastYearTo = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); d.setDate(d.getDate() + 21); return iso(d); })();
      const [o, a, m, e, ly, recent, sml, bal] = await Promise.all([
        sb.from("orders").select("id, number, nickname, customer_id, due_date, status, type, total, delivery_method, submitted_at").not("status", "in", "(completed)").limit(800),
        sb.from("archived_orders").select("id, visual_id, nickname, customer_id, due_date, status_name, kind, total, owner:data->>owner").not("status_name", "in", '("Job Completed","Quote - Closed")').limit(800),
        sb.from("messages").select("id, order_id, customer_id, author_name, author_email, body, created_at, topic").eq("author_type", "customer").is("read_at", null).order("created_at", { ascending: false }).limit(30),
        sb.from("activities").select("id, customer_id, order_id, subject, body, from_email, occurred_at, meta").eq("kind", "email").eq("direction", "in").gte("occurred_at", new Date(Date.now() - 4 * 86400000).toISOString()).order("occurred_at", { ascending: false }).limit(30),
        sb.from("archived_orders").select("id, visual_id, nickname, customer_id, order_date, total, kind, owner:data->>owner").eq("kind", "invoice").gte("order_date", lastYearFrom).lte("order_date", lastYearTo).order("order_date").limit(400),
        sb.from("archived_orders").select("customer_id, order_date, owner:data->>owner").gte("order_date", addDays(-240)).order("order_date", { ascending: false }).limit(3000),
        sb.from("supplier_manifest_lines").select("tracking, track_status, est_delivery, delivered_at, ship_date, method").neq("kind", "ignored").gte("created_at", new Date(Date.now() - 20 * 86400000).toISOString()).limit(3000),
        sb.from("archived_orders").select("id, visual_id, nickname, customer_id, balance, due_date").eq("kind", "invoice").gt("balance", 0.5).order("balance", { ascending: false }).limit(60),
      ]);
      setOwed(((bal.data || []) as { id: string; visual_id: string; nickname: string; customer_id: string | null; balance: number; due_date: string | null }[]).map((b) => ({ id: b.id, number: b.visual_id, nickname: b.nickname, customer_id: b.customer_id, balance: +b.balance || 0, due: b.due_date })));
      // account owners: the owner on the customer's latest Printavo order
      const own: Record<string, string> = {};
      for (const r of (recent.data || []) as { customer_id: string | null; owner: string | null }[]) if (r.customer_id && r.owner && !own[r.customer_id]) own[r.customer_id] = r.owner.split(/\s+/)[0].toLowerCase();
      setOwners(own);
      const js: Job[] = [
        ...((o.data || []) as { id: string; number: number; nickname: string; customer_id: string | null; due_date: string | null; status: string; type: string; total: number; delivery_method: string; submitted_at: string | null }[])
          .filter((x) => !(x.status === "request" && !x.submitted_at))
          .map((x) => ({ id: x.id, href: `/shop/orders/${x.id}`, number: x.number, nickname: x.nickname, customer_id: x.customer_id, due: x.due_date, status: x.status, statusLabel: "", printavo: false, total: +x.total || 0, owner: own[x.customer_id || ""] || "", ship: x.status === "ready" && x.delivery_method === "ship" })),
        ...((a.data || []) as { id: string; visual_id: string; nickname: string; customer_id: string | null; due_date: string | null; status_name: string; kind: string; total: number; owner: string | null }[])
          .filter((x) => !PV_DONE.test(x.status_name || ""))
          .map((x) => ({ id: x.id, href: `/shop/archive/${x.id}`, number: +x.visual_id || 0, nickname: x.nickname, customer_id: x.customer_id, due: x.due_date, status: x.kind === "quote" ? "quote" : pvKind(x.status_name), statusLabel: x.status_name, printavo: true, total: +x.total || 0, owner: (x.owner || "").split(/\s+/)[0].toLowerCase(), ship: pvKind(x.status_name) === "ship" })),
      ];
      setJobs(js);
      setMsgs((m.data || []) as Msg[]);
      setMails((e.data || []) as Mail[]);
      // reorder reminders: ordered around this time last year, nothing since (in the last 60 days)
      const recentBuyers = new Set(((recent.data || []) as { customer_id: string | null; order_date: string | null }[]).filter((r) => r.order_date && r.order_date >= addDays(-60)).map((r) => r.customer_id));
      for (const x of js) if (!x.printavo && x.customer_id) recentBuyers.add(x.customer_id);
      const seen = new Set<string>();
      setReorders(((ly.data || []) as { id: string; visual_id: string; nickname: string; customer_id: string | null; order_date: string; total: number; owner: string | null }[])
        .filter((r) => r.customer_id && !recentBuyers.has(r.customer_id) && !seen.has(r.customer_id) && !!seen.add(r.customer_id))
        .map((r) => ({ customer_id: r.customer_id!, number: r.visual_id, nickname: r.nickname, date: r.order_date, total: +r.total || 0, href: `/shop/archive/${r.id}`, owner: (r.owner || "").split(/\s+/)[0].toLowerCase() })));
      // goods: shipments arriving / arrived today
      const t = iso(new Date());
      const trk = new Map<string, { est: string | null; del: string | null; st: string; ship: string | null; method: string }>();
      for (const l of (sml.data || []) as { tracking: string; track_status: string; est_delivery: string | null; delivered_at: string | null; ship_date: string | null; method: string }[]) {
        const k = l.tracking || `local:${l.ship_date}:${l.method}`;
        if (!trk.has(k)) trk.set(k, { est: l.est_delivery, del: l.delivered_at, st: l.track_status, ship: l.ship_date, method: l.method });
      }
      const localDay = (s: string | null) => (s ? iso(new Date(s.length === 10 ? s + "T12:00" : s)) : "");
      let today = 0, arrived = 0;
      for (const x of trk.values()) {
        if (x.st === "delivered") { if (localDay(x.del) === t) arrived++; continue; }
        if (localDay(x.est) === t) today++;
      }
      setGoods({ today, arrived });
      // customer names for everything on the page
      const ids = [...new Set([...js.map((x) => x.customer_id), ...((m.data || []) as Msg[]).map((x) => x.customer_id), ...((e.data || []) as Mail[]).map((x) => x.customer_id), ...((ly.data || []) as { customer_id: string | null }[]).map((x) => x.customer_id), ...((bal.data || []) as { customer_id: string | null }[]).map((x) => x.customer_id)].filter(Boolean))] as string[];
      const out: Record<string, Cust> = {};
      for (let i = 0; i < ids.length; i += 300) {
        const { data } = await sb.from("customers").select("id, company, name").in("id", ids.slice(i, i + 300));
        for (const c of (data || []) as Cust[]) out[c.id] = c;
      }
      setCusts(out);
    })();
  }, []);

  const who = (id: string | null) => { const c = custs[id || ""]; return c ? c.company || c.name : ""; };
  const isMine = (customerId: string | null, owner?: string) => !mine || !me || (owner || owners[customerId || ""] || "") === me;

  const v = useMemo(() => {
    if (!jobs) return null;
    const t = iso(new Date()), tm = addDays(1);
    const js = jobs.filter((j) => isMine(j.customer_id, j.owner));
    const work = js.filter((j) => j.status !== "quote" && j.status !== "quote_sent" && j.status !== "request");
    return {
      late: work.filter((j) => j.due && j.due < t && !j.ship).sort((a, b) => (a.due || "").localeCompare(b.due || "")),
      today: work.filter((j) => j.due === t),
      tomorrow: work.filter((j) => j.due === tm),
      ship: js.filter((j) => j.ship),
      production: work.filter((j) => ["production", "queue", "approved", "art", "blanks", "issue"].includes(j.status)),
      waiting: js.filter((j) => ["quote_sent", "request"].includes(j.status) || (j.printavo && j.status === "quote")),
      issues: js.filter((j) => j.status === "issue"),
    };
  }, [jobs, mine, me, owners]); // eslint-disable-line react-hooks/exhaustive-deps
  const myMsgs = msgs.filter((x) => isMine(x.customer_id));
  const myMails = mails.filter((x) => isMine(x.customer_id));
  const myReorders = reorders.filter((x) => isMine(x.customer_id, x.owner));

  const jobRow = (j: Job) => (
    <li key={(j.printavo ? "p" : "o") + j.id} className="db-row">
      <Link href={j.href} className="db-num">#{j.number}</Link>
      <span className="db-main"><b>{who(j.customer_id) || "—"}</b><span className="faint">{j.nickname || "Untitled Job"}</span></span>
      <span className="db-side">{j.printavo ? <span className="db-st">{j.statusLabel}</span> : <Pill status={j.status as never} />}<span className="faint">due {day(j.due)}</span></span>
    </li>
  );
  const list = (n: number, body: React.ReactNode) => (n ? body : <div className="db-empty">Nothing here right now.</div>);
  const week = (() => { const out: { d: string; label: string; jobs: Job[] }[] = []; const base = new Date(); for (let i = 0; i < 7; i++) { const x = new Date(base); x.setDate(base.getDate() + i); const d = iso(x); out.push({ d, label: i === 0 ? "Today" : x.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" }), jobs: (jobs || []).filter((j) => isMine(j.customer_id, j.owner) && j.due === d && !["quote", "quote_sent", "request"].includes(j.status)) }); } return out; })();

  /** Every widget: its title, color, how many things are in it, where it links, and what it shows. */
  const W: Record<string, { title: string; tone: string; n?: number; link?: [string, string]; boss?: boolean; body: () => React.ReactNode }> = !v ? {} : {
    glance: { title: "Today at a glance", tone: "blue", body: () => (
      <div className="db-kpis db-kpis-w">
        <a href="#w-messages" className={myMsgs.length ? "hot" : ""}><span>Messages to answer</span><b>{myMsgs.length}</b></a>
        <a href="#w-due" className={v.late.length ? "bad" : ""}><span>Due today · late</span><b>{v.today.length}<small> · {v.late.length}</small></b></a>
        <Link href="/shop/shipping"><span>Ship today</span><b>{v.ship.length}</b></Link>
        <a href="#w-production"><span>In production</span><b>{v.production.length}</b></a>
        <Link href="/shop/receiving"><span>Goods arriving · arrived</span><b>{goods.today}<small> · {goods.arrived}</small></b></Link>
        <a href="#w-reorders"><span>Reorder reminders</span><b>{myReorders.length}</b></a>
      </div>
    ) },
    salesKpis: { title: "Sales numbers", tone: "blue", boss: true, body: () => <SalesAnalytics part="kpis" /> },
    salesChart: { title: "Sales by month", tone: "blue", boss: true, body: () => <SalesAnalytics part="chart" /> },
    topCustomers: { title: "Top customers", tone: "orange", boss: true, body: () => <SalesAnalytics part="top" /> },
    messages: { title: "Customer messages to answer", tone: "blue", n: myMsgs.length, body: () => list(myMsgs.length, (
      <ul className="db-list">{myMsgs.map((x) => (
        <li key={x.id} className="db-row db-msg">
          <span className="db-main"><b>{who(x.customer_id) || x.author_name || x.author_email}</b><span className="db-body">{x.body.slice(0, 180)}{x.body.length > 180 ? "…" : ""}</span></span>
          <span className="db-side"><span className="faint">{ago(x.created_at)}</span>{x.order_id ? <Link href={`/shop/orders/${x.order_id}`} className="btn sm">Open order</Link> : x.customer_id ? <Link href={`/shop/customers/${x.customer_id}?area=messages`} className="btn sm">Reply</Link> : null}</span>
        </li>
      ))}</ul>
    )) },
    emails: { title: "Emails from customers", tone: "salmon", n: myMails.length, body: () => (myMails.length ? (
      <ul className="db-list">{myMails.map((x) => (
        <li key={x.id} className="db-row db-msg">
          <span className="db-main"><b>{who(x.customer_id) || x.from_email}</b><span className="db-sub">{x.subject || "(no subject)"}</span><span className="db-body">{x.body.slice(0, 160)}{x.body.length > 160 ? "…" : ""}</span></span>
          <span className="db-side"><span className="faint">{ago(x.occurred_at)}</span>
            {x.order_id ? <Link href={`/shop/orders/${x.order_id}`} className="btn sm">On its job</Link>
              : <AttachToJob mail={x} jobs={(jobs || []).filter((j) => !j.printavo && j.customer_id && j.customer_id === x.customer_id)} onDone={(orderId) => setMails(mails.map((m) => (m.id === x.id ? { ...m, order_id: orderId } : m)))} />}
          </span>
        </li>
      ))}</ul>
    ) : <div className="db-empty">Emails show up here once your inbox is connected. The Assistant reads them, suggests the job each belongs to, and turns requests into tasks.</div>) },
    followups: { title: "Follow-ups", tone: "orange", link: ["/shop/assistant", "Assistant"], body: () => <AssistantStrip /> },
    due: { title: "Due today & late", tone: v.late.length ? "bad" : "blue", n: v.today.length + v.late.length, link: ["/shop/calendar", "Calendar"], body: () => list(v.today.length + v.late.length, (
      <>
        {v.late.length > 0 && <><div className="db-sub-h bad">Late</div><ul className="db-list">{v.late.slice(0, 30).map(jobRow)}</ul></>}
        {v.today.length > 0 && <><div className="db-sub-h">Due today</div><ul className="db-list">{v.today.map(jobRow)}</ul></>}
      </>
    )) },
    ship: { title: "Ready to ship", tone: "orange", n: v.ship.length, link: ["/shop/shipping", "Shipping Center"], body: () => list(v.ship.length, <ul className="db-list">{v.ship.map(jobRow)}</ul>) },
    tomorrow: { title: "Due tomorrow", tone: "blue", n: v.tomorrow.length, body: () => list(v.tomorrow.length, <ul className="db-list">{v.tomorrow.map(jobRow)}</ul>) },
    week: { title: "This week", tone: "blue", n: week.reduce((a, d) => a + d.jobs.length, 0), link: ["/shop/calendar", "Calendar"], body: () => (
      <div className="db-week">{week.map((d) => (
        <div key={d.d} className={"db-day" + (d.jobs.length ? "" : " none")}><b>{d.label}</b><span className="db-day-n">{d.jobs.length}</span>
          {d.jobs.length > 0 && <ul className="db-list">{d.jobs.slice(0, 6).map(jobRow)}</ul>}{d.jobs.length > 6 && <div className="faint" style={{ fontSize: 12 }}>+{d.jobs.length - 6} more</div>}</div>
      ))}</div>
    ) },
    production: { title: "In production", tone: "salmon", n: v.production.length, link: ["/shop/board", "Production"], body: () => list(v.production.length, <ul className="db-list">{[...v.production].sort((a, b) => (a.due || "9").localeCompare(b.due || "9")).slice(0, 60).map(jobRow)}</ul>) },
    waiting: { title: "Waiting on the customer", tone: "teal", n: v.waiting.length, link: ["/shop/orders", "Orders"], body: () => list(v.waiting.length, <ul className="db-list">{v.waiting.slice(0, 40).map(jobRow)}</ul>) },
    reorders: { title: "Ordered this time last year", tone: "teal", n: myReorders.length, body: () => list(myReorders.length, (
      <ul className="db-list">{myReorders.slice(0, 20).map((r) => (
        <li key={r.customer_id} className="db-row">
          <span className="db-main"><b><Link href={`/shop/customers/${r.customer_id}`}>{who(r.customer_id) || "Customer"}</Link></b><span className="faint">#{r.number} {r.nickname || ""} · {day(r.date)} last year · {money(r.total)}</span></span>
          <span className="db-side"><Link href={`/shop/customers/${r.customer_id}?area=messages`} className="btn sm">Reach out</Link></span>
        </li>
      ))}</ul>
    )) },
    owed: { title: "Open balances", tone: "salmon", n: owed.filter((b) => isMine(b.customer_id)).length, body: () => { const bs = owed.filter((b) => isMine(b.customer_id)); return list(bs.length, (
      <>
        <div className="db-owed-t">{money(bs.reduce((a, b) => a + b.balance, 0))} owed on {bs.length} invoice{bs.length === 1 ? "" : "s"}</div>
        <ul className="db-list">{bs.slice(0, 25).map((b) => (
          <li key={b.id} className="db-row"><Link href={`/shop/archive/${b.id}`} className="db-num">#{b.number}</Link><span className="db-main"><b>{who(b.customer_id) || "—"}</b><span className="faint">{b.nickname}</span></span><span className="db-side"><b>{money(b.balance)}</b></span></li>
        ))}</ul>
      </>
    )); } },
    goods: { title: "Goods & receiving", tone: "orange", link: ["/shop/receiving", "Goods & Receiving"], body: () => (
      <div className="db-kpis db-kpis-w db-kpis-2"><Link href="/shop/receiving"><span>Arriving today</span><b>{goods.today}</b></Link><Link href="/shop/receiving"><span>Arrived today</span><b>{goods.arrived}</b></Link></div>
    ) },
    note: { title: "My notes", tone: "orange", body: () => null },
    actions: { title: "Quick actions", tone: "blue", body: () => <QuickActions /> },
    shipQuote: { title: "Quick shipping quote", tone: "orange", link: ["/shop/shipping", "Shipping Center"], body: () => <QuickShipQuote /> },
    requests: { title: "New order requests", tone: "blue", n: (jobs || []).filter((j) => j.status === "request" && isMine(j.customer_id, j.owner)).length, link: ["/shop/incoming", "Incoming Orders"], body: () => { const rq = (jobs || []).filter((j) => j.status === "request" && isMine(j.customer_id, j.owner)); return list(rq.length, <ul className="db-list">{rq.map(jobRow)}</ul>); } },
  };
  const visible = (layout || []).filter((it) => W[it.id] && (!W[it.id].boss || boss));
  const store = (next: WidgetItem[]) => { setLayout(next); saveDashboard(next); };
  const move = (from: number, to: number) => { if (!layout || from === to) return; const all = [...visible]; const [x] = all.splice(from, 1); all.splice(to, 0, x); store(all); };

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div><h1>Today</h1></div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <div className="rv-seg" role="group" aria-label="Whose accounts">
            <button type="button" className={!mine ? "on" : ""} onClick={() => setMine(false)}>Everyone</button>
            <button type="button" className={mine ? "on" : ""} onClick={() => setMine(true)}>My accounts</button>
          </div>
          {editing && <button type="button" className="btn" onClick={() => setMenu(true)}>+ Widgets</button>}
          <button type="button" className={"btn" + (editing ? " primary" : "")} onClick={() => { setEditing((x) => !x); setMenu(false); }}>{editing ? "Done" : "Customize"}</button>
        </div>
      </div>
      {editing && <div className="db-edit-tip">Drag a widget by its title to move it. Use the size buttons to make it wider or taller, ✕ to remove it, and <b>+ Widgets</b> to add more. Your layout is saved just for you.</div>}

      {!v || !layout ? <div className="empty">Loading your day…</div> : (
        <div className={"db-board" + (editing ? " editing" : "")}>
          {visible.map((it, i) => {
            const w = W[it.id];
            return (
              <section key={it.id + i} id={"w-" + it.id} className={`db-card db-w db-${w.tone}` + (it.tall ? " tall" : "") + (drag === i ? " dragging" : "")} style={{ gridColumn: `span ${it.w}` }}
                draggable={editing} onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setDrag(null)}
                onDragOver={(e) => { if (drag !== null) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); if (drag !== null) move(drag, i); setDrag(null); }}>
                <div className="db-card-h">
                  {editing && <span className="db-grip" aria-hidden>⋮⋮</span>}
                  <h2>{w.title}</h2>{w.n !== undefined && <span className="db-n">{w.n}</span>}
                  <span className="spacer" />
                  {editing ? (
                    <span className="db-ctl">
                      {[1, 2, 3, 4].map((n) => <button key={n} type="button" className={it.w === n ? "on" : ""} title={["Small", "Medium", "Large", "Full width"][n - 1]} onClick={() => store(visible.map((x, j) => (j === i ? { ...x, w: n } : x)))}>{["S", "M", "L", "XL"][n - 1]}</button>)}
                      <button type="button" className={it.tall ? "on" : ""} title="Taller" onClick={() => store(visible.map((x, j) => (j === i ? { ...x, tall: !x.tall } : x)))}>↕</button>
                      <button type="button" title="Move earlier" disabled={!i} onClick={() => move(i, i - 1)}>←</button>
                      <button type="button" title="Move later" disabled={i === visible.length - 1} onClick={() => move(i, i + 1)}>→</button>
                      <button type="button" title="Remove" onClick={() => store(visible.filter((_, j) => j !== i))}>✕</button>
                    </span>
                  ) : w.link ? <Link href={w.link[0]} className="linkbtn">{w.link[1]} →</Link> : null}
                </div>
                <div className="db-w-b">
                  {it.id === "note" ? <NoteBox text={it.text || ""} onSave={(text) => store(visible.map((x, j) => (j === i ? { ...x, text } : x)))} /> : w.body()}
                </div>
              </section>
            );
          })}
          {!visible.length && <div className="db-empty" style={{ gridColumn: "1 / -1" }}>No widgets yet. Click Customize → + Widgets.</div>}
        </div>
      )}

      {menu && (
        <div className="pp-modal" role="dialog" aria-modal="true" aria-label="Widgets" onMouseDown={(e) => { if (e.target === e.currentTarget) setMenu(false); }}>
          <div className="pp-sheet" style={{ maxWidth: 720 }}>
            <div className="pp-sheet-h"><b>Widgets</b><button type="button" className="btn icon ghost" aria-label="Close" onClick={() => setMenu(false)}>✕</button></div>
            <div className="db-menu">
              {[...new Set(CATALOG.map((c) => c.cat))].map((cat) => (
                <div key={cat} className="db-menu-g">
                  <div className="db-menu-h">{cat}</div>
                  {CATALOG.filter((c) => c.cat === cat && (!c.boss || boss)).map((c) => {
                    const on = visible.some((x) => x.id === c.id);
                    return (
                      <label key={c.id} className={"db-menu-i" + (on ? " on" : "")}>
                        <input type="checkbox" checked={on} onChange={() => store(on ? visible.filter((x) => x.id !== c.id) : [...visible, { id: c.id, w: c.w }])} />
                        <span><b>{c.title}</b><span className="faint">{c.help}</span></span>
                      </label>
                    );
                  })}
                </div>
              ))}
              <div className="row" style={{ gap: 8, marginTop: 8 }}><button type="button" className="btn ghost" onClick={() => store(defaultLayout(boss))}>Reset to the standard layout</button><span className="spacer" /><button type="button" className="btn primary" onClick={() => setMenu(false)}>Done</button></div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** A sticky note on the dashboard (saved with your layout). */
function NoteBox({ text, onSave }: { text: string; onSave: (t: string) => void }) {
  const [t, setT] = useState(text);
  useEffect(() => { setT(text); }, [text]);
  return <textarea className="db-note-box" value={t} onChange={(e) => setT(e.target.value)} onBlur={() => { if (t !== text) onSave(t); }} placeholder="Jot down anything: calls to make, reminders, ideas… (saves when you click away)" />;
}

/** Tie an email to one of the customer's open jobs (it then shows on that job). */
function AttachToJob({ mail, jobs, onDone }: { mail: Mail; jobs: Job[]; onDone: (orderId: string) => void }) {
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  if (!mail.customer_id) return <Link href="/shop/customers" className="btn sm">Find customer</Link>;
  if (!jobs.length) return <Link href={`/shop/customers/${mail.customer_id}`} className="btn sm">Open customer</Link>;
  return (
    <span className="db-attach">
      <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Which job is this email about">
        <option value="">Which job?</option>
        {jobs.map((j) => <option key={j.id} value={j.id}>#{j.number} {j.nickname}</option>)}
      </select>
      <button type="button" className="btn sm primary" disabled={!pick || busy} onClick={async () => {
        setBusy(true);
        const { error } = await createClient().from("activities").update({ order_id: pick }).eq("id", mail.id);
        setBusy(false);
        if (!error) onDone(pick);
      }}>Attach</button>
    </span>
  );
}

/** Quick actions: start a quote, jump to an order #, receiving shortcuts. */
function QuickActions() {
  const router = useRouter();
  const [num, setNum] = useState("");
  const [busy, setBusy] = useState(false);
  async function newQuote() {
    setBusy(true);
    const { data } = await createClient().from("orders").insert({ lines: [], status: "quote", type: "quote" }).select("id").single();
    setBusy(false);
    if (data) router.push(`/shop/orders/${data.id}?new=1`);
  }
  async function findOrder(e: React.FormEvent) {
    e.preventDefault();
    const n = num.replace(/\D/g, ""); if (!n) return;
    const sb = createClient();
    const { data: o } = await sb.from("orders").select("id").eq("number", +n).maybeSingle();
    if (o) return router.push(`/shop/orders/${o.id}`);
    const { data: a } = await sb.from("archived_orders").select("id").eq("visual_id", n).maybeSingle();
    if (a) return router.push(`/shop/archive/${a.id}`);
    router.push(`/shop/search?q=${encodeURIComponent(num)}`);
  }
  return (
    <div className="qa">
      <button type="button" className="btn primary" disabled={busy} onClick={newQuote}>{busy ? "Creating…" : "+ New Quote"}</button>
      <form onSubmit={findOrder} className="qa-find"><input value={num} onChange={(e) => setNum(e.target.value)} placeholder="Order # …" aria-label="Go to order number" /><button type="submit" className="btn sm">Go</button></form>
      <Link href="/shop/receiving" className="btn">Receive S&amp;S Truck</Link>
      <Link href="/shop/shipping" className="btn">Shipping Center</Link>
    </div>
  );
}
