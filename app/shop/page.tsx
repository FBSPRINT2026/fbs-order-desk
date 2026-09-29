"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { createClient } from "@/lib/supabase/client";
import AssistantStrip from "@/components/AssistantStrip";
import SalesAnalytics from "@/components/SalesAnalytics";
import { Pill } from "@/components/bits";
import { money } from "@/lib/format";

/**
 * The daily dashboard: the first thing every admin sees. Everything that needs someone today, in one place:
 * customer messages to answer, emails in from customers (to tie to a job), follow-ups, jobs due / late / shipping
 * today, what's in production, what's waiting on the customer, goods coming in, and customers who ordered this time
 * last year. "My accounts" narrows it to the customers you own (from Printavo's order owner until go-live).
 */

type Cust = { id: string; company: string; name: string };
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
      if (user?.email) { const { data: st } = await sb.from("staff").select("name, role").eq("email", user.email.toLowerCase()).maybeSingle(); setBoss(["owner", "admin"].includes((st?.role as string) || "")); setMe(((st?.name as string) || user.email.split("@")[0]).split(/[\s._-]+/)[0].toLowerCase()); }
      const lastYearFrom = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); d.setDate(d.getDate() - 7); return iso(d); })();
      const lastYearTo = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); d.setDate(d.getDate() + 21); return iso(d); })();
      const [o, a, m, e, ly, recent, sml] = await Promise.all([
        sb.from("orders").select("id, number, nickname, customer_id, due_date, status, type, total, delivery_method, submitted_at").not("status", "in", "(completed)").limit(800),
        sb.from("archived_orders").select("id, visual_id, nickname, customer_id, due_date, status_name, kind, total, owner:data->>owner").not("status_name", "in", '("Job Completed","Quote - Closed")').limit(800),
        sb.from("messages").select("id, order_id, customer_id, author_name, author_email, body, created_at, topic").eq("author_type", "customer").is("read_at", null).order("created_at", { ascending: false }).limit(30),
        sb.from("activities").select("id, customer_id, order_id, subject, body, from_email, occurred_at, meta").eq("kind", "email").eq("direction", "in").gte("occurred_at", new Date(Date.now() - 4 * 86400000).toISOString()).order("occurred_at", { ascending: false }).limit(30),
        sb.from("archived_orders").select("id, visual_id, nickname, customer_id, order_date, total, kind, owner:data->>owner").eq("kind", "invoice").gte("order_date", lastYearFrom).lte("order_date", lastYearTo).order("order_date").limit(400),
        sb.from("archived_orders").select("customer_id, order_date, owner:data->>owner").gte("order_date", addDays(-240)).order("order_date", { ascending: false }).limit(3000),
        sb.from("supplier_manifest_lines").select("tracking, track_status, est_delivery, delivered_at, ship_date, method").neq("kind", "ignored").gte("created_at", new Date(Date.now() - 20 * 86400000).toISOString()).limit(3000),
      ]);
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
      const ids = [...new Set([...js.map((x) => x.customer_id), ...((m.data || []) as Msg[]).map((x) => x.customer_id), ...((e.data || []) as Mail[]).map((x) => x.customer_id), ...((ly.data || []) as { customer_id: string | null }[]).map((x) => x.customer_id)].filter(Boolean))] as string[];
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
  const card = (title: string, tone: string, n: number, body: React.ReactNode, link?: [string, string]) => (
    <section className={"db-card db-" + tone}>
      <div className="db-card-h"><h2>{title}</h2><span className="db-n">{n}</span>{link && <><span className="spacer" /><Link href={link[0]} className="linkbtn">{link[1]} →</Link></>}</div>
      {n ? body : <div className="db-empty">Nothing here right now.</div>}
    </section>
  );

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div><h1>Today</h1></div>
        <div className="rv-seg" role="group" aria-label="Whose accounts">
          <button type="button" className={!mine ? "on" : ""} onClick={() => setMine(false)}>Everyone</button>
          <button type="button" className={mine ? "on" : ""} onClick={() => setMine(true)}>My accounts</button>
        </div>
      </div>

      {!v ? <div className="empty">Loading your day…</div> : (
        <>
          <div className="db-kpis">
            <a href="#db-msgs" className={myMsgs.length ? "hot" : ""}><span>Messages to answer</span><b>{myMsgs.length}</b></a>
            <a href="#db-due" className={v.late.length ? "bad" : ""}><span>Due today · late</span><b>{v.today.length}<small> · {v.late.length}</small></b></a>
            <Link href="/shop/shipping"><span>Ship today</span><b>{v.ship.length}</b></Link>
            <a href="#db-prod"><span>In production</span><b>{v.production.length}</b></a>
            <Link href="/shop/receiving"><span>Goods arriving · arrived</span><b>{goods.today}<small> · {goods.arrived}</small></b></Link>
            <a href="#db-reorder"><span>Reorder reminders</span><b>{myReorders.length}</b></a>
          </div>

          {boss && <SalesAnalytics />}
          <div className="db-grid">
            <div className="db-col">
              <div id="db-msgs">{card("Customer messages to answer", "blue", myMsgs.length, (
                <ul className="db-list">{myMsgs.map((x) => (
                  <li key={x.id} className="db-row db-msg">
                    <span className="db-main"><b>{who(x.customer_id) || x.author_name || x.author_email}</b><span className="db-body">{x.body.slice(0, 180)}{x.body.length > 180 ? "…" : ""}</span></span>
                    <span className="db-side"><span className="faint">{ago(x.created_at)}</span>{x.order_id ? <Link href={`/shop/orders/${x.order_id}`} className="btn sm">Open order</Link> : x.customer_id ? <Link href={`/shop/customers/${x.customer_id}?area=messages`} className="btn sm">Reply</Link> : null}</span>
                  </li>
                ))}</ul>
              ))}</div>

              {card("Emails from customers", "salmon", myMails.length, (
                <ul className="db-list">{myMails.map((x) => (
                  <li key={x.id} className="db-row db-msg">
                    <span className="db-main"><b>{who(x.customer_id) || x.from_email}</b><span className="db-sub">{x.subject || "(no subject)"}</span><span className="db-body">{x.body.slice(0, 160)}{x.body.length > 160 ? "…" : ""}</span></span>
                    <span className="db-side"><span className="faint">{ago(x.occurred_at)}</span>
                      {x.order_id ? <Link href={`/shop/orders/${x.order_id}`} className="btn sm">On its job</Link>
                        : <AttachToJob mail={x} jobs={(jobs || []).filter((j) => !j.printavo && j.customer_id && j.customer_id === x.customer_id)} onDone={(orderId) => setMails(mails.map((m) => (m.id === x.id ? { ...m, order_id: orderId } : m)))} />}
                    </span>
                  </li>
                ))}</ul>
              ))}
              {!mails.length && <p className="db-note">Emails show up here once your inbox is connected (Settings → email). The Assistant reads them, suggests the job each one belongs to, and turns requests into tasks.</p>}

              <section className="db-card db-orange"><div className="db-card-h"><h2>Follow-ups</h2><span className="spacer" /><Link href="/shop/assistant" className="linkbtn">Assistant →</Link></div><AssistantStrip /></section>

              <div id="db-reorder">{card("Ordered this time last year", "teal", myReorders.length, (
                <ul className="db-list">{myReorders.slice(0, 15).map((r) => (
                  <li key={r.customer_id} className="db-row">
                    <span className="db-main"><b><Link href={`/shop/customers/${r.customer_id}`}>{who(r.customer_id) || "Customer"}</Link></b><span className="faint">#{r.number} {r.nickname || ""} · {day(r.date)} last year · {money(r.total)}</span></span>
                    <span className="db-side"><Link href={`/shop/customers/${r.customer_id}?area=messages`} className="btn sm">Reach out</Link></span>
                  </li>
                ))}</ul>
              ))}</div>
            </div>

            <div className="db-col">
              <div id="db-due">{card("Due today & late", v.late.length ? "bad" : "blue", v.today.length + v.late.length, (
                <>
                  {v.late.length > 0 && <><div className="db-sub-h bad">Late</div><ul className="db-list">{v.late.slice(0, 20).map(jobRow)}</ul></>}
                  {v.today.length > 0 && <><div className="db-sub-h">Due today</div><ul className="db-list">{v.today.map(jobRow)}</ul></>}
                </>
              ), ["/shop/calendar", "Calendar"])}</div>
              {card("Ready to ship", "orange", v.ship.length, <ul className="db-list">{v.ship.map(jobRow)}</ul>, ["/shop/shipping", "Shipping Center"])}
              {card("Due tomorrow", "blue", v.tomorrow.length, <ul className="db-list">{v.tomorrow.map(jobRow)}</ul>)}
              <div id="db-prod">{card("In production", "salmon", v.production.length, (
                <ul className="db-list db-scroll">{v.production.sort((a, b) => (a.due || "9").localeCompare(b.due || "9")).slice(0, 40).map(jobRow)}</ul>
              ), ["/shop/board", "Production"])}</div>
              {card("Waiting on the customer", "teal", v.waiting.length, <ul className="db-list db-scroll">{v.waiting.slice(0, 30).map(jobRow)}</ul>, ["/shop/orders", "Orders"])}
            </div>
          </div>
        </>
      )}
    </>
  );
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
