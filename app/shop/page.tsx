"use client";
import OrderBoard from "@/components/OrderBoard";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { createClient } from "@/lib/supabase/client";
import AssistantStrip from "@/components/AssistantStrip";
import AiSearch from "@/components/AiSearch";
import SalesAnalytics from "@/components/SalesAnalytics";
import { Pill } from "@/components/bits";
import { money } from "@/lib/format";
import { useSticky } from "@/lib/useSticky";
import { useRole } from "@/components/RoleContext";
import { useRouter } from "next/navigation";
import { mailRows, type MailSug } from "@/lib/inbox";
import { getMailStatus } from "./mail-actions";

/**
 * The daily dashboard: the first thing every admin sees. Everything that needs someone today, in one place:
 * customer messages to answer, emails in from customers (to tie to a job), follow-ups, jobs due / late / shipping
 * today, what's in production, what's waiting on the customer, goods coming in, and customers who ordered this time
 * last year. "My accounts" narrows it to the customers you own (from Printavo's order owner until go-live).
 */

type Cust = { id: string; company: string; name: string };

type Job = { id: string; href: string; number: number; nickname: string; customer_id: string | null; due: string | null; status: string; statusLabel: string; printavo: boolean; total: number; owner: string; ship: boolean };
type Msg = { id: string; order_id: string | null; customer_id: string | null; author_name: string; author_email: string; body: string; created_at: string; topic: string | null };
type Mail = { id: string; customer_id: string | null; order_id: string | null; subject: string; body: string; from_email: string; occurred_at: string; direction: string; external_id: string | null; thread_id: string | null; meta: { from_name?: string; account_id?: string; ignored?: boolean; no_reply?: boolean; references?: string[]; triage?: { needs_reply?: boolean; summary?: string; intent?: string; urgency?: string; urgent_reason?: string } } | null };
type SepLite = { id: string; number: number; order_id: string | null; location: string; garment_color: string; status: string; due_date: string | null; customer_id: string | null; channels: unknown[]; updated_at: string };
// separations on the dashboard are the ones being worked on (Printed and Archived aren't listed)
const SEP_ST: Record<string, [string, string]> = { working: ["Working", "#A152C9"] };
type Reorder = { customer_id: string; number: string; nickname: string; date: string; total: number; href: string; owner: string };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const day = (d: string | null) => (d ? new Date(d.slice(0, 10) + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "—");
const ago = (t: string) => { const m = Math.round((Date.now() - Date.parse(t)) / 60000); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const PV_DONE = /job completed|quote - closed|cancel/i;
const pvKind = (s: string) => /ship|delivery/i.test(s) ? "ship" : /^quote/i.test(s) ? "quote" : /ready for production|scheduling|pre production|holder|waiting on details/i.test(s) ? "queue" : /issue/i.test(s) ? "issue" : "production";

export default function Dashboard() {
  const { perms, email: myEmail = "", staffName = "" } = useRole();
  // who "Mine" means: the signed-in person's first name (from the layout, no extra round trip before the data loads)
  const me = myEmail ? (staffName || myEmail.split("@")[0]).split(/[\s._-]+/)[0].toLowerCase() : "";
  const router = useRouter();
  const boss = perms.money; // owners / admins see the sales numbers; crew (production, receiving, shipping) get the production dashboard
  const crew = !boss;
  const [seps, setSeps] = useState<SepLite[]>([]);
  const [prodTab, setProdTab] = useState<string | null>(null);
  const [owed, setOwed] = useState<{ id: string; number: string; nickname: string; customer_id: string | null; balance: number; due: string | null }[]>([]);
  const [mine, setMine] = useSticky("dash.mine", false);
  const [custs, setCusts] = useState<Record<string, Cust>>({});
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [mailNeeds, setMailNeeds] = useState<Mail[]>([]), [mailUrgent, setMailUrgent] = useState<Mail[]>([]), [myBox, setMyBox] = useState<string | null>(null);
  const [reorders, setReorders] = useState<Reorder[]>([]);
  const [goods, setGoods] = useState({ today: 0, arrived: 0 });
  const [owners, setOwners] = useState<Record<string, string>>({}); // customer → account owner (first name)

  useEffect(() => {
    const sb = createClient();
    (async () => {
      const lastYearFrom = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); d.setDate(d.getDate() - 7); return iso(d); })();
      const lastYearTo = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); d.setDate(d.getDate() + 21); return iso(d); })();
      // everything the page needs, asked for at once (each query used to wait for the one before it)
      const [o, a, m, e, ly, recent, sml, bal, sepQ, aoQ] = await Promise.all([
        sb.from("orders").select("id, number, nickname, customer_id, due_date, status, type, total, delivery_method, submitted_at").not("status", "in", "(completed)").limit(800),
        sb.from("archived_orders").select("id, visual_id, nickname, customer_id, due_date, status_name, kind, total, owner:data->>owner").not("status_name", "in", '("Job Completed","Quote - Closed")').limit(800),
        sb.from("messages").select("id, order_id, customer_id, author_name, author_email, body, created_at, topic").eq("author_type", "customer").is("read_at", null).order("created_at", { ascending: false }).limit(30),
        sb.from("activities").select("id, customer_id, order_id, subject, body, from_email, to_email, occurred_at, direction, external_id, thread_id, meta").eq("kind", "email").gte("occurred_at", new Date(Date.now() - 21 * 86400000).toISOString()).order("occurred_at", { ascending: false }).limit(500),
        sb.from("archived_orders").select("id, visual_id, nickname, customer_id, order_date, total, kind, owner:data->>owner").eq("kind", "invoice").gte("order_date", lastYearFrom).lte("order_date", lastYearTo).order("order_date").limit(400),
        sb.from("archived_orders").select("customer_id, order_date, owner:data->>owner").gte("order_date", addDays(-240)).order("order_date", { ascending: false }).limit(3000),
        sb.from("supplier_manifest_lines").select("tracking, track_status, est_delivery, delivered_at, ship_date, method").neq("kind", "ignored").gte("created_at", new Date(Date.now() - 20 * 86400000).toISOString()).limit(3000),
        sb.from("archived_orders").select("id, visual_id, nickname, customer_id, balance, due_date").eq("kind", "invoice").gt("balance", 0.5).order("balance", { ascending: false }).limit(60),
        sb.from("separations").select("id, number, order_id, location, garment_color, status, due_date, customer_id, channels, updated_at").not("status", "in", "(cancelled,films)").order("due_date", { ascending: true, nullsFirst: false }).limit(200),
        sb.from("customer_private").select("customer_id, account_owner").neq("account_owner", "").limit(5000),
      ]);
      const sp = sepQ.data;
      setSeps((sp || []) as SepLite[]);
      setOwed(((bal.data || []) as { id: string; visual_id: string; nickname: string; customer_id: string | null; balance: number; due_date: string | null }[]).map((b) => ({ id: b.id, number: b.visual_id, nickname: b.nickname, customer_id: b.customer_id, balance: +b.balance || 0, due: b.due_date })));
      // account owners: the owner on the customer's latest Printavo order
      const own: Record<string, string> = {};
      for (const r of (recent.data || []) as { customer_id: string | null; owner: string | null }[]) if (r.customer_id && r.owner && !own[r.customer_id]) own[r.customer_id] = r.owner.split(/\s+/)[0].toLowerCase();
      // …unless the customer has an account owner set here (Settings → Staff → Account owners)
      for (const r of (aoQ.data || []) as { customer_id: string; account_owner: string }[]) own[r.customer_id] = r.account_owner.split(/\s+/)[0].toLowerCase();
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
      // customer email: the ones still waiting on an answer (same rule as the Inbox), and whose mailbox is mine.
      // Runs alongside the customer-name lookup below instead of holding it up.
      const allMail = (e.data || []) as Mail[];
      (async () => {
        const inIds = allMail.filter((x) => x.direction === "in").map((x) => x.id);
        const { data: sg } = inIds.length ? await sb.from("ai_suggestions").select("id, kind, status, activity_id").in("activity_id", inIds) : { data: [] };
        const mr = mailRows(allMail, (sg || []) as MailSug[]);
        setMailNeeds(mr.filter((r) => r.needs).map((r) => r.x));
        setMailUrgent(mr.filter((r) => r.urgent).map((r) => r.x));
      })().catch(() => null);
      getMailStatus().then((r) => { if (r.ok && r.mine?.enabled) setMyBox(r.mine.id); }).catch(() => null);
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
      const ids = [...new Set([...js.map((x) => x.customer_id), ...((m.data || []) as Msg[]).map((x) => x.customer_id), ...((e.data || []) as Mail[]).map((x) => x.customer_id), ...((ly.data || []) as { customer_id: string | null }[]).map((x) => x.customer_id), ...((bal.data || []) as { customer_id: string | null }[]).map((x) => x.customer_id), ...((sp || []) as SepLite[]).map((x) => x.customer_id)].filter(Boolean))] as string[];
      const out: Record<string, Cust> = {};
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 300) chunks.push(ids.slice(i, i + 300));
      // the batches go out together instead of one after another
      for (const { data } of await Promise.all(chunks.map((c) => sb.from("customers").select("id, company, name").in("id", c))))
        for (const c of (data || []) as Cust[]) out[c.id] = c;
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
  // an email is mine when it came to my mailbox (or it's one of my customers')
  const mailMine = (x: Mail) => !mine || (!!myBox && x.meta?.account_id === myBox) || (!!x.customer_id && isMine(x.customer_id));
  const myNeeds = mailNeeds.filter(mailMine);
  const myUrgent = mailUrgent.filter(mailMine).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)); // longest waiting first
  // one list of everything waiting on a reply: urgent emails first (longest waiting first), then the rest, newest first
  const urgentIds = new Set(myUrgent.map((x) => x.id));
  const replyItems = [...myMsgs.map((x) => ({ at: x.created_at, msg: x, mail: null as Mail | null })), ...myNeeds.map((x) => ({ at: x.occurred_at, msg: null as Msg | null, mail: x }))]
    .sort((a, b) => Number(!!b.mail && urgentIds.has(b.mail.id)) - Number(!!a.mail && urgentIds.has(a.mail.id)) || (a.mail && b.mail && urgentIds.has(a.mail.id) && urgentIds.has(b.mail.id) ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at)));
  const openMail = (id: string) => router.push(`/shop/inbox?open=${id}`);
  const myReorders = reorders.filter((x) => isMine(x.customer_id, x.owner));

  const jobRow = (j: Job) => (
    <li key={(j.printavo ? "p" : "o") + j.id} className="db-row">
      <Link href={j.href} className="db-num">#{j.number}</Link>
      <span className="db-main"><b>{who(j.customer_id) || "—"}</b><span className="faint">{j.nickname || "Untitled Job"}</span></span>
      <span className="db-side">{j.printavo ? <span className="db-st">{j.statusLabel}</span> : <Pill status={j.status as never} />}<span className="faint">due {day(j.due)}</span></span>
    </li>
  );
  const list = (n: number, body: React.ReactNode, empty = "Nothing here right now.") => (n ? body : <div className="db-empty">{empty}</div>);
  const panel = (title: string, tone: string, n: number | null, body: React.ReactNode, link?: [string, string], extra?: React.ReactNode) => (
    <section className={"db-card db-" + tone}>
      <div className="db-card-h"><h2>{title}</h2>{n !== null && <span className="db-n">{n}</span>}{extra}<span className="spacer" />{link && <Link href={link[0]} className="linkbtn">{link[1]} →</Link>}</div>
      {body}
    </section>
  );
  // production: where the open work is (one bar split by stage), then one list you flip between by when it's due
  const stages: { k: string; label: string; match: (j: Job) => boolean }[] = [
    { k: "queue", label: "Approved", match: (j) => j.status === "approved" || j.status === "queue" },
    { k: "art", label: "Art", match: (j) => j.status === "art" },
    { k: "blanks", label: "Blanks", match: (j) => j.status === "blanks" },
    { k: "production", label: "In Production", match: (j) => j.status === "production" },
    { k: "issue", label: "Issues", match: (j) => j.status === "issue" },
    { k: "ship", label: "Ready To Ship", match: (j) => j.ship || j.status === "ready" },
  ];
  const mineJobs = (jobs || []).filter((j) => isMine(j.customer_id, j.owner));
  const stageN = stages.map((st) => ({ ...st, n: mineJobs.filter(st.match).length }));
  const openN = stageN.reduce((a, s2) => a + s2.n, 0);
  const t0 = iso(new Date()), t1 = addDays(1), t7 = addDays(7);
  const work = mineJobs.filter((j) => !["quote", "quote_sent", "request"].includes(j.status));
  const byDue = (a: Job, b: Job) => (a.due || "").localeCompare(b.due || "") || a.number - b.number;
  const buckets = [
    { k: "late", label: "Late", short: "Late", jobs: v ? v.late : [], empty: "Nothing late." },
    { k: "today", label: "Due Today", short: "Today", jobs: work.filter((j) => j.due === t0 && !j.ship), empty: "Nothing else due today." },
    { k: "tomorrow", label: "Tomorrow", short: "Tmrw", jobs: work.filter((j) => j.due === t1 && !j.ship), empty: "Nothing due tomorrow." },
    { k: "week", label: "Next 7 Days", short: "7 Days", jobs: work.filter((j) => j.due && j.due > t1 && j.due <= t7 && !j.ship).sort(byDue), empty: "Nothing else due this week." },
    { k: "ship", label: "Ready To Ship", short: "Ship", jobs: mineJobs.filter((j) => j.ship).sort(byDue), empty: "Nothing waiting to ship." },
  ];
  const pk = prodTab || (buckets.find((b2) => b2.k !== "ship" && b2.jobs.length)?.k ?? "today");
  const cur = buckets.find((b2) => b2.k === pk) || buckets[1];
  const stageOf = (j: Job) => (j.printavo ? <span className="db-st">{j.statusLabel}</span> : <Pill status={j.status as never} />);
  const owedMine = owed.filter((b) => isMine(b.customer_id));

  const prodSection = (
            <section className="db-card db-salmon db-prod" id="dash-prod">
              <div className="db-card-h"><h2>Production</h2><span className="faint db-h-note">{openN} open jobs</span><span className="spacer" /><Link href="/shop/board" className="linkbtn">Production calendar →</Link></div>
              {openN > 0 && <div className="pd-stack" role="img" aria-label={stageN.map((s2) => `${s2.label} ${s2.n}`).join(", ")}>{stageN.filter((s2) => s2.n).map((s2) => (
                <Link key={s2.k} href="/shop/board" className={"pd-seg pd-" + s2.k} style={{ flexGrow: s2.n }} title={`${s2.label}: ${s2.n}`} />
              ))}</div>}
              <div className="pd-legend">{stageN.map((s2) => (
                <Link key={s2.k} href="/shop/board" className={"pd-lg" + (s2.n ? "" : " zero") + (s2.k === "issue" && s2.n ? " bad" : "")}><i className={"pd-" + s2.k} />{s2.label}<b>{s2.n}</b></Link>
              ))}</div>
              <div className="aa-sub pd-tabs" role="tablist">{buckets.map((b2) => (
                <button key={b2.k} type="button" role="tab" aria-selected={pk === b2.k} className={(pk === b2.k ? "on" : "") + (b2.k === "late" && b2.jobs.length ? " bad" : "")} onClick={() => setProdTab(b2.k)}><span className="t-full">{b2.label}</span><span className="t-short">{b2.short}</span><span className="aa-n">{b2.jobs.length}</span></button>
              ))}</div>
              <div className="db-scroll pd-scroll">{list(cur.jobs.length, (
                <table className="rv-tbl pd-tbl">
                  <thead><tr><th>Order</th><th>Customer</th><th>Job</th><th>Stage</th><th className="r">Due</th></tr></thead>
                  <tbody>{cur.jobs.slice(0, 80).map((j) => (
                    <tr key={(j.printavo ? "p" : "o") + j.id}>
                      <td className="pd-o"><Link href={j.href} className="db-num">#{j.number}</Link></td>
                      <td className="pd-c"><b>{who(j.customer_id) || "—"}</b></td>
                      <td className="pd-n faint">{j.nickname || "Untitled Job"}</td>
                      <td className="pd-s">{stageOf(j)}</td>
                      <td className={"r pd-due" + (j.due && j.due < t0 && !j.ship ? " bad" : "")}>{day(j.due)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              ), cur.empty)}</div>
              {pk === "ship" && cur.jobs.length > 0 && <div className="pd-foot"><Link href="/shop/shipping" className="btn sm primary">Open Shipping Center</Link></div>}
            </section>
  );

  // crew (production, receiving, shipping): the production dashboard. No sales, balances or customer money anywhere.
  if (crew) {
    const sepN = (k: string) => (k === "working" ? seps.length : 0);
    const sepsSorted = [...seps].sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"));
    return (
      <>
        <div className="page-head">
          <div><div className="eyebrow">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div><h1>Production Dashboard</h1></div>
        </div>
        <div className="dash-top"><AiSearch /></div>
        {!v ? <div className="empty">Loading your day…</div> : (
          <div className="dash">
            <div className="dash-row dash-2-1 dash-fill">
              <section className="db-card db-blue db-seps">
                <div className="db-card-h"><h2>Separations &amp; Film</h2><span className="db-n">{seps.length}</span><span className="faint db-h-note">being worked on; Print Films moves one to Printed</span><span className="spacer" /><Link href="/shop/separations" className="linkbtn">All separations →</Link></div>
                <div className="pd-legend">{Object.entries(SEP_ST).map(([k, [l, c]]) => (
                  <Link key={k} href="/shop/separations" className={"pd-lg" + (sepN(k) ? "" : " zero")}><i style={{ background: c }} />{l}<b>{sepN(k)}</b></Link>
                ))}</div>
                <div className="db-scroll">{list(sepsSorted.length, (
                  <table className="rv-tbl db-sep-tbl">
                    <thead><tr><th>Sep</th><th>Customer</th><th>Location</th><th>Status</th><th className="r">Due</th></tr></thead>
                    <tbody>{sepsSorted.slice(0, 60).map((x) => (
                      <tr key={x.id}>
                        <td><Link href={`/shop/separations/${x.id}`} className="db-num">S-{x.number}</Link></td>
                        <td className="pd-c"><b>{who(x.customer_id) || "—"}</b></td>
                        <td className="pd-n faint">{x.location}{x.garment_color ? ` · ${x.garment_color}` : ""}{x.channels?.length ? ` · ${x.channels.length} screens` : ""}</td>
                        <td className="pd-s"><span className="pill" style={{ ["--sc" as string]: SEP_ST.working[1] }}>{SEP_ST.working[0]}</span></td>
                        <td className={"r pd-due" + (x.due_date && x.due_date < t0 ? " bad" : "")}>{day(x.due_date)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                ), "No separations waiting. New requests from orders land here.")}</div>
              </section>
              {panel("Today", "orange", null, (
                <div className="db-kpis db-kpis-2">
                  <a href="#dash-prod"><span>Due today · late</span><b>{v.today.length}<small> · {v.late.length}</small></b></a>
                  <Link href="/shop/shipping"><span>Ready to ship</span><b>{v.ship.length}</b></Link>
                  <Link href="/shop/receiving"><span>Goods arriving</span><b>{goods.today}</b></Link>
                  <Link href="/shop/receiving"><span>Goods arrived</span><b>{goods.arrived}</b></Link>
                  <Link href="/shop/separations"><span>Separations in work</span><b>{seps.length}</b></Link>
                  <Link href="/shop/board"><span>In production</span><b>{v.production.length}</b></Link>
                </div>
              ))}
            </div>
            {prodSection}
            <section className="db-card db-blue db-pipe">
              <div className="db-card-h"><h2>Order Pipeline</h2><span className="faint db-h-note">every job by stage · quantities only</span></div>
              <OrderBoard />
            </section>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div><h1>Dashboard</h1></div>
      </div>

      {/* ask AI / search everything, with whose accounts the page shows beside it */}
      <div className="dash-top">
        <AiSearch />
        <div className="rv-seg dash-who" role="group" aria-label="Whose accounts to show">
          <button type="button" className={!mine ? "on" : ""} onClick={() => setMine(false)} title="Show every account">Everyone</button>
          <button type="button" className={mine ? "on" : ""} onClick={() => setMine(true)} title="Only the customers you own">Mine</button>
        </div>
      </div>

      {!v ? <div className="empty">Loading your day…</div> : (
        <div className="dash">
          {/* 1. the assistant: what needs doing */}
          {panel("Assistant", "fade", null, <AssistantStrip />, ["/shop/assistant", "All follow-ups"], <span className="faint db-h-note">follow-ups, approvals and suggestions for today</span>)}

          {/* 2. messages (2/3) · sales (1/3), same height */}
          <div className="dash-row dash-2-1 dash-fill">
            <section className="db-card db-blue db-msgs">
              <div className="db-card-h">
                <h2>Needs a reply</h2><span className="db-n">{replyItems.length}</span>
                {myUrgent.length > 0 && <span className="db-urgent-tag">{myUrgent.length} urgent</span>}
                <span className="spacer" /><Link href="/shop/inbox" className="linkbtn">Inbox →</Link>
              </div>
              <div className="db-scroll">
                {list(replyItems.length, (
                  <ul className="db-list db-replies">{replyItems.map(({ msg: x, mail: e }) => x ? (
                    <li key={x.id} className="db-row db-reply">
                      <span className="db-main"><b>{who(x.customer_id) || x.author_name || x.author_email}</b><span className="db-one">{x.body.replace(/\s+/g, " ").slice(0, 160)}</span></span>
                      <span className="db-side"><span className="faint">portal · {ago(x.created_at)}</span>{x.order_id ? <Link href={`/shop/orders/${x.order_id}`} className="btn sm">Reply</Link> : x.customer_id ? <Link href={`/shop/customers/${x.customer_id}?area=messages`} className="btn sm">Reply</Link> : null}</span>
                    </li>
                  ) : e ? (
                    <li key={e.id} className={"db-row db-reply db-click" + (urgentIds.has(e.id) ? " hot" : "")} onClick={() => openMail(e.id)} title="Open it in the Inbox, ready to answer">
                      <span className="db-main"><b>{who(e.customer_id) || e.meta?.from_name || e.from_email}</b><span className="db-one">{urgentIds.has(e.id) && e.meta?.triage?.urgent_reason ? <em>{e.meta.triage.urgent_reason} · </em> : null}{e.meta?.triage?.summary || e.subject || "(no subject)"}</span></span>
                      <span className="db-side"><span className={urgentIds.has(e.id) && (Date.now() - Date.parse(e.occurred_at)) / 36e5 > 4 ? "db-late" : "faint"}>{ago(e.occurred_at)}</span><Link href={`/shop/inbox?open=${e.id}`} className={"btn sm" + (urgentIds.has(e.id) ? " primary" : "")} onClick={(ev) => ev.stopPropagation()}>Reply</Link></span>
                    </li>
                  ) : null)}</ul>
                ), <MsgEmpty title="You're all caught up" text="No customer emails or portal messages waiting on a reply. They land here the moment a customer writes." />)}
              </div>
            </section>
            {boss ? panel("Sales", "orange", null, <SalesAnalytics part="side" />) : panel("Today", "orange", null, (
              <div className="db-kpis db-kpis-2">
                <a href="#dash-prod"><span>Due today · late</span><b>{v.today.length}<small> · {v.late.length}</small></b></a>
                <Link href="/shop/shipping"><span>Ready to ship</span><b>{v.ship.length}</b></Link>
                <Link href="/shop/receiving"><span>Goods arriving</span><b>{goods.today}</b></Link>
                <Link href="/shop/receiving"><span>Goods arrived</span><b>{goods.arrived}</b></Link>
              </div>
            ))}
          </div>

          {/* sales charts (owners / admins) */}
          {boss && <section className="db-card db-orange db-sales">
            <div className="db-card-h"><h2>Sales Charts</h2><span className="faint db-h-note">invoices by order date · closed quotes, quotes and holders don&apos;t count</span></div>
            <SalesAnalytics part="charts" />
          </section>}

          {/* 3. the order pipeline: every job by stage (follows Everyone / Mine) */}
          <section className="db-card db-blue db-pipe">
            <div className="db-card-h"><h2>{mine ? "My Order Pipeline" : "Order Pipeline"}</h2><span className="faint db-h-note">every job by stage · drag a card or use → to move it along</span></div>
            <OrderBoard mine={mine} />
          </section>

          {/* 4. production (2/3) · open balances (1/3) */}
          <div className="dash-row dash-2-1">
            {prodSection}
            {panel("Open balances", "salmon", owedMine.length, <div className="db-scroll">{list(owedMine.length, (
              <>
                <div className="db-owed-t">{money(owedMine.reduce((a, b) => a + b.balance, 0))} owed</div>
                <ul className="db-list">{owedMine.slice(0, 25).map((b) => (
                  <li key={b.id} className="db-row"><Link href={`/shop/archive/${b.id}`} className="db-num">#{b.number}</Link><span className="db-main"><b>{who(b.customer_id) || "—"}</b><span className="faint">{b.nickname}</span></span><span className="db-side"><b>{money(b.balance)}</b></span></li>
                ))}</ul>
              </>
            ))}</div>)}
          </div>

          {/* 3. keep the money coming: reorders and quotes out */}
          <div className="dash-row dash-2">
            {panel("Ordered this time last year", "teal", myReorders.length, <div className="db-scroll sm">{list(myReorders.length, (
              <ul className="db-list">{myReorders.slice(0, 20).map((r) => (
                <li key={r.customer_id} className="db-row">
                  <span className="db-main"><b><Link href={`/shop/customers/${r.customer_id}`}>{who(r.customer_id) || "Customer"}</Link></b><span className="faint">#{r.number} · {day(r.date)} last year · {money(r.total)}</span></span>
                  <span className="db-side"><Link href={`/shop/customers/${r.customer_id}?area=messages`} className="btn sm">Reach out</Link></span>
                </li>
              ))}</ul>
            ), "No reorder reminders today.")}</div>)}
            {panel("Waiting on the customer", "blue", v.waiting.length, <div className="db-scroll sm">{list(v.waiting.length, <ul className="db-list">{v.waiting.slice(0, 40).map(jobRow)}</ul>)}</div>, ["/shop/orders", "Orders"])}
          </div>
        </div>
      )}
    </>
  );
}

/** The friendly empty state for the Messages card: two chat bubbles in the brand colors. */
function MsgEmpty({ title, text }: { title: string; text: string }) {
  return (
    <div className="db-msg-empty">
      <svg viewBox="0 0 160 120" aria-hidden="true">
        <defs><linearGradient id="dbfade" x1="0" x2="1"><stop offset="0" stopColor="#0E9BD8" /><stop offset=".55" stopColor="#F26660" /><stop offset="1" stopColor="#FCB122" /></linearGradient></defs>
        <circle cx="80" cy="60" r="54" className="dme-bg" />
        <path d="M34 34h62a10 10 0 0 1 10 10v26a10 10 0 0 1-10 10H60l-14 12v-12h-12a10 10 0 0 1-10-10V44a10 10 0 0 1 10-10z" fill="#0E9BD8" />
        <rect x="38" y="48" width="44" height="6" rx="3" fill="#fff" opacity=".9" /><rect x="38" y="60" width="30" height="6" rx="3" fill="#fff" opacity=".6" />
        <path d="M78 58h48a9 9 0 0 1 9 9v20a9 9 0 0 1-9 9h-6v11l-13-11H78a9 9 0 0 1-9-9V67a9 9 0 0 1 9-9z" fill="#FCB122" />
        <circle cx="90" cy="77" r="4" fill="#fff" /><circle cx="103" cy="77" r="4" fill="#fff" /><circle cx="116" cy="77" r="4" fill="#fff" />
        <circle cx="128" cy="30" r="9" fill="#F26660" /><path d="M124 30l3 3 5-6" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="30" y="108" width="100" height="4" rx="2" fill="url(#dbfade)" />
      </svg>
      <b>{title}</b>
      <span>{text}</span>
    </div>
  );
}


