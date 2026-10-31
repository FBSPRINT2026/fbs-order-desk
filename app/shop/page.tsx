"use client";
import OrderBoard from "@/components/OrderBoard";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { createClient } from "@/lib/supabase/client";
import AiSearch from "@/components/AiSearch";
import SalesAnalytics from "@/components/SalesAnalytics";
import { Pill, pvStatusOf } from "@/components/bits";
import { money } from "@/lib/format";
import { useSticky } from "@/lib/useSticky";
import { useRole } from "@/components/RoleContext";
import { mailRows, type MailSug } from "@/lib/inbox";
import { getMailStatus } from "./mail-actions";
import MyDay, { CrewTodos } from "@/components/MyDay";
import FavoritesRecap from "@/components/FavoritesRecap";
import { emailIsMine, personName, senderLabel } from "@/lib/mail/sender";
import EmailSummary, { type EmailGroups, type EmailItem } from "@/components/EmailSummary";
import { DETAILS_LABEL, detailsCount, ordersNeedingDetails } from "@/lib/productionDetails";
import type { Group } from "@/lib/pricing";
import { allRows } from "@/lib/readAll";

/**
 * The daily dashboard: the first thing every admin sees. Everything that needs someone today, in one place:
 * customer messages to answer, emails in from customers (to tie to a job), follow-ups, jobs due / late / shipping
 * today, what's in production, what's waiting on the customer, goods coming in, and customers who ordered this time
 * last year. "My accounts" narrows it to the customers you own (from Printavo's order owner until go-live).
 */

type Cust = { id: string; company: string; name: string; email?: string | null };

type Job = { id: string; href: string; number: number; nickname: string; customer_id: string | null; due: string | null; status: string; statusLabel: string; printavo: boolean; total: number; owner: string; ship: boolean };
type Msg = { id: string; order_id: string | null; customer_id: string | null; author_name: string; author_email: string; body: string; created_at: string; topic: string | null };
type Mail = { id: string; customer_id: string | null; order_id: string | null; subject: string; body: string; from_email: string; to_email?: string | null; occurred_at: string; direction: string; external_id: string | null; thread_id: string | null; meta: { from_name?: string; account_id?: string; ignored?: boolean; no_reply?: boolean; references?: string[]; triage?: { needs_reply?: boolean; summary?: string; intent?: string; urgency?: string; urgent_reason?: string } } | null };
type SepLite = { id: string; number: number; order_id: string | null; location: string; garment_color: string; status: string; due_date: string | null; customer_id: string | null; channels: unknown[]; updated_at: string };
// separations on the dashboard are the ones being worked on (Printed and Archived aren't listed)
const SEP_ST: Record<string, [string, string]> = { working: ["Working", "#A152C9"] };
type Reorder = { customer_id: string; number: string; nickname: string; date: string; total: number; href: string; owner: string };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const day = (d: string | null) => (d ? new Date(d.slice(0, 10) + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "—");
const PV_DONE = /job completed|quote - closed|cancel/i;
const pvKind = (s: string) => /ship|delivery/i.test(s) ? "ship" : /^quote/i.test(s) ? "quote" : /ready for production|scheduling|pre production|holder|waiting on details/i.test(s) ? "queue" : /issue/i.test(s) ? "issue" : "production";

export default function Dashboard() {
  const role = useRole(), { perms } = role;
  // "View as" a person (owners): the dashboard is theirs (their replies, their name)
  const viewing = !!role.viewAs && role.viewAs.includes("@");
  const myEmail = viewing ? role.viewAs : role.email || "", staffName = viewing ? role.viewName || "" : role.staffName || "";
  // who "Mine" means: the signed-in person's first name (from the layout, no extra round trip before the data loads)
  const me = myEmail ? (staffName || myEmail.split("@")[0]).split(/[\s._@-]+/)[0].toLowerCase() : "";
  const boss = perms.money; // owners / admins see the sales numbers; crew (production, receiving, shipping) get the production dashboard
  const crew = !boss;
  const [seps, setSeps] = useState<SepLite[]>([]);
  const [prodTab, setProdTab] = useState<string | null>(null);
  const [owed, setOwed] = useState<{ id: string; number: string; nickname: string; customer_id: string | null; balance: number; due: string | null }[]>([]);
  const [mine, setMine] = useSticky("dash.mine", false);
  const [custs, setCusts] = useState<Record<string, Cust>>({});
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [mailNeeds, setMailNeeds] = useState<Mail[]>([]), [mailUrgent, setMailUrgent] = useState<Mail[]>([]), [myBox, setMyBox] = useState<string | null>(null), [myBoxEmail, setMyBoxEmail] = useState<string | null>(null);
  const [reorders, setReorders] = useState<Reorder[]>([]);
  // Replies wait for both the email and whose mailbox is mine (Oct 12: "You're all caught up" showed for a few
  // seconds before the emails came in)
  const [mailIn, setMailIn] = useState(false), [boxIn, setBoxIn] = useState(false);
  // customers who'd ordered before the last 30 days (anyone else writing in is a new customer, for the Email summary)
  const [oldCust, setOldCust] = useState<Set<string> | null>(null);
  const [goods, setGoods] = useState({ today: 0, arrived: 0 });
  const [owners, setOwners] = useState<Record<string, string>>({}); // customer → account owner (first name)
  // reorders of old Printavo jobs waiting on production (Jose) to confirm the print details
  const [pdn, setPdn] = useState<{ id: string; number: number; nickname: string; customer_id: string | null; due_date: string | null; groups: Group[] }[]>([]);
  const [pdnCust, setPdnCust] = useState<Record<string, string>>({});

  useEffect(() => {
    const sb = createClient();
    (async () => {
      const lastYearFrom = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); d.setDate(d.getDate() - 7); return iso(d); })();
      const lastYearTo = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); d.setDate(d.getDate() + 21); return iso(d); })();
      // everything the page needs, asked for at once (each query used to wait for the one before it)
      const [o, a, m, e, ly, recent, sml, bal, sepQ, aoQ] = await Promise.all([
        sb.from("orders").select("id, number, nickname, customer_id, due_date, status, type, total, delivery_method, submitted_at, printavo_id, pv_status:printavo_state->>status").eq("draft", false).is("discarded_at", null).not("status", "in", "(completed)").limit(800),
        sb.from("archived_orders").select("id, visual_id, nickname, customer_id, due_date, status_name, kind, total, owner:data->>owner").not("status_name", "in", '("Job Completed","Quote - Closed")').limit(800),
        sb.from("messages").select("id, order_id, customer_id, author_name, author_email, body, created_at, topic").eq("author_type", "customer").is("read_at", null).order("created_at", { ascending: false }).limit(30),
        sb.from("activities").select("id, customer_id, order_id, subject, body, from_email, to_email, occurred_at, direction, external_id, thread_id, meta").eq("kind", "email").gte("occurred_at", new Date(Date.now() - 21 * 86400000).toISOString()).order("occurred_at", { ascending: false }).limit(500),
        sb.from("archived_orders").select("id, visual_id, nickname, customer_id, order_date, total, kind, owner:data->>owner").eq("kind", "invoice").gte("order_date", lastYearFrom).lte("order_date", lastYearTo).order("order_date").limit(400),
        allRows((r0, r1) => sb.from("archived_orders").select("customer_id, order_date, owner:data->>owner").gte("order_date", addDays(-240)).order("order_date", { ascending: false }).order("id").range(r0, r1), 3000),
        allRows((r0, r1) => sb.from("supplier_manifest_lines").select("tracking, track_status, est_delivery, delivered_at, ship_date, method").neq("kind", "ignored").gte("created_at", new Date(Date.now() - 20 * 86400000).toISOString()).order("id").range(r0, r1), 3000),
        sb.from("archived_orders").select("id, visual_id, nickname, customer_id, balance, due_date").eq("kind", "invoice").gt("balance", 0.5).order("balance", { ascending: false }).limit(60),
        sb.from("separations").select("id, number, order_id, location, garment_color, status, due_date, customer_id, channels, updated_at").not("status", "in", "(cancelled,films)").order("due_date", { ascending: true, nullsFirst: false }).limit(200),
        allRows((r0, r1) => sb.from("customer_private").select("customer_id, account_owner").neq("account_owner", "").order("customer_id").range(r0, r1), 5000),
      ]);
      ordersNeedingDetails<{ id: string; number: number; nickname: string; customer_id: string | null; due_date: string | null; groups: Group[] }>(sb, "id, number, nickname, customer_id, due_date, groups")
        .then(async (r) => {
          setPdn(r.sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999") || a.number - b.number));
          const ids = [...new Set(r.map((x) => x.customer_id).filter(Boolean))] as string[];
          if (!ids.length) return;
          const { data } = await sb.from("customers").select("id, company, name").in("id", ids);
          setPdnCust(Object.fromEntries(((data || []) as Cust[]).map((c) => [c.id, c.company || c.name])));
        }, () => null);
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
        ...((o.data || []) as { id: string; number: number; nickname: string; customer_id: string | null; due_date: string | null; status: string; type: string; total: number; delivery_method: string; submitted_at: string | null; printavo_id: string | null; pv_status: string | null }[])
          .filter((x) => !(x.status === "request" && !x.submitted_at))
          .map((x) => ({ id: x.id, href: `/shop/orders/${x.id}`, number: x.number, nickname: x.nickname, customer_id: x.customer_id, due: x.due_date, status: x.status, statusLabel: pvStatusOf(x), printavo: false, total: +x.total || 0, owner: own[x.customer_id || ""] || "", ship: x.status === "ready" && x.delivery_method === "ship" })),
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
        const cids = [...new Set([...mr.filter((r) => r.needs).map((r) => r.x.customer_id), ...((m.data || []) as Msg[]).map((x) => x.customer_id)].filter(Boolean))] as string[];
        const cut = new Date(Date.now() - 30 * 864e5).toISOString();
        // one tiny look per customer (a single query for all of them hit the row cap on Nine18's 10,000 old orders and
        // called everyone new)
        const old = await Promise.all(cids.slice(0, 60).map(async (cid) => {
          const { data: a1 } = await sb.from("archived_orders").select("id").eq("customer_id", cid).lt("order_date", cut.slice(0, 10)).limit(1);
          if (a1?.length) return cid;
          const { data: o1 } = await sb.from("orders").select("id").eq("customer_id", cid).eq("draft", false).lt("created_at", cut).limit(1);
          return o1?.length ? cid : null;
        }));
        setOldCust(new Set(old.filter(Boolean) as string[]));
      })().catch(() => null).finally(() => setMailIn(true));
      getMailStatus().then((r) => { if (!r.ok) return; const b = viewing ? (r.all || []).find((x) => x.email.toLowerCase() === myEmail.toLowerCase()) : r.mine; setMyBox(b?.enabled ? b.id : viewing ? "none" : null); setMyBoxEmail(b?.enabled ? b.email : null); }).catch(() => null).finally(() => setBoxIn(true));
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
      for (const { data } of await Promise.all(chunks.map((c) => sb.from("customers").select("id, company, name, email").in("id", c))))
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
  const myMsgs = msgs.filter((x) => (viewing ? !!me && owners[x.customer_id || ""] === me : isMine(x.customer_id)));
  // an email is mine when it came to my mailbox (or it's one of my customers')
  // an email that came to someone's mailbox is theirs alone (Oct 12, Nick: "none of my email in any part of her login,
  // and none of hers in mine"): yours show, someone else's never do; one with no mailbox (a web form) shows to all
  const mailMine = (x: Mail) => emailIsMine(x, myBox, myBoxEmail);
  const myNeeds = mailNeeds.filter(mailMine);
  const myUrgent = mailUrgent.filter(mailMine).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)); // longest waiting first
  // one list of everything waiting on a reply: urgent emails first (longest waiting first), then the rest, newest first
  const urgentIds = new Set(myUrgent.map((x) => x.id));
  const needIds = useMemo(() => new Set(myNeeds.map((x) => x.id)), [myNeeds.map((x) => x.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  // the Email summary (Oct 26, Nick): customers to get back to, new customers, quotes from the website. Not customers
  // (vendors, newsletters) never show.
  const emailGroups = useMemo((): EmailGroups => {
    const g: EmailGroups = { back: [], fresh: [], web: [] };
    const ini = (t: string) => t.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
    const short = (t: string, co: string) => { let x = t.replace(/\s+/g, " ").trim(); const c = co.trim().toLowerCase(); if (c && x.toLowerCase().startsWith(c)) x = x.slice(c.length).replace(/^[\s,:-]+/, ""); else x = x.replace(/^(the )?customer\s+(is\s+)?/i, ""); return x ? x[0].toUpperCase() + x.slice(1) : t; };
    const isNew = (cid: string | null) => !cid || (!!oldCust && !oldCust.has(cid));
    for (const x of myMsgs) {
      const co = who(x.customer_id) || x.author_name || x.author_email;
      const it: EmailItem = { k: "p" + x.id, who: personName(x.author_name).split(/\s+/)[0] ? `${personName(x.author_name).split(/\s+/)[0]}${who(x.customer_id) ? ` from ${who(x.customer_id)}` : ""}` : co, initials: ini(co), text: x.body.replace(/\s+/g, " ").slice(0, 140), at: x.created_at, href: x.order_id ? `/shop/orders/${x.order_id}` : x.customer_id ? `/shop/customers/${x.customer_id}?area=messages` : "/shop/conversations" };
      (isNew(x.customer_id) ? g.fresh : g.back).push(it);
    }
    for (const e of myNeeds) {
      if (e.meta?.triage?.intent === "not_customer") continue;
      const c = e.customer_id ? custs[e.customer_id] : null;
      const co = (c && (c.company || c.name)) || personName(e.meta?.from_name) || e.from_email;
      const it: EmailItem = { k: "e" + e.id, who: senderLabel(e.meta?.from_name, e.from_email, c), initials: ini(co), text: short(e.meta?.triage?.summary || e.subject || "(no subject)", co), at: e.occurred_at, href: `/shop/conversations?open=${e.id}`, rush: urgentIds.has(e.id) };
      // no mailbox: it came in through the website's form
      (!e.meta?.account_id ? g.web : isNew(e.customer_id) ? g.fresh : g.back).push(it);
    }
    // orders customers built and sent in from the portal, waiting on us to price them
    for (const j of jobs || []) if (!j.printavo && j.status === "request" && isMine(j.customer_id, j.owner)) {
      const co = who(j.customer_id) || "A customer";
      g.web.push({ k: "o" + j.id, who: co, initials: ini(co), text: `Quote request #${j.number}${j.nickname ? ` · ${j.nickname}` : ""}`, at: new Date().toISOString(), href: j.href });
    }
    // rush ones first, then the longest waiting
    g.back.sort((a, b) => Number(!!b.rush) - Number(!!a.rush) || a.at.localeCompare(b.at));
    g.fresh.sort((a, b) => b.at.localeCompare(a.at));
    return g;
  }, [myMsgs, myNeeds, custs, oldCust, jobs, urgentIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const myReorders = reorders.filter((x) => isMine(x.customer_id, x.owner));

  const jobRow = (j: Job) => (
    <li key={(j.printavo ? "p" : "o") + j.id} className="db-row">
      <Link href={j.href} className="db-num">#{j.number}</Link>
      <span className="db-main"><b>{who(j.customer_id) || "—"}</b><span className="faint">{j.nickname || "Untitled Job"}</span></span>
      <span className="db-side">{j.statusLabel ? <span className="db-st">{j.statusLabel}</span> : <Pill status={j.status as never} />}<span className="faint">due {day(j.due)}</span></span>
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
  const stageOf = (j: Job) => (j.statusLabel ? <span className="db-st">{j.statusLabel}</span> : <Pill status={j.status as never} />);
  const owedMine = owed.filter((b) => isMine(b.customer_id));
  // Reorder Details Needed: an owner sees only their own customers' orders, always (Oct 15, Nick: "Amanda's dashboard
  // is still showing my reminders like Little Groupies"), plus any with no account owner yet; production sees them all
  const pdnMine = boss && me ? pdn.filter((o) => { const ow = owners[o.customer_id || ""] || ""; return !ow || ow === me; }) : pdn;

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

  const detailsCard = (
    <section className="db-card db-orange db-pdn" id="dash-details">
      <div className="db-card-h"><h2>Reorder Details Needed</h2><span className="db-n">{pdnMine.length}</span><span className="faint db-h-note">reorders of old Printavo jobs: confirm the print size and inks we used</span><span className="spacer" /><Link href="/shop/details" className="linkbtn">Reorder Details →</Link></div>
      <div className="db-scroll sm">{list(pdnMine.length, (
        <table className="rv-tbl pd-tbl">
          <thead><tr><th>Order</th><th>Customer</th><th>Job</th><th>Prints</th><th className="r">Due</th></tr></thead>
          <tbody>{pdnMine.slice(0, 40).map((o) => (
            <tr key={o.id}>
              <td className="pd-o"><Link href={`/shop/details?order=${o.id}`} className="db-num">#{o.number}</Link></td>
              <td className="pd-c"><b>{pdnCust[o.customer_id || ""] || "—"}</b></td>
              <td className="pd-n faint">{o.nickname || "Untitled Job"}</td>
              <td className="pd-s"><Link href={`/shop/details?order=${o.id}`} className="pdn-tag" title={DETAILS_LABEL}>{detailsCount(o.groups)} to confirm</Link></td>
              <td className={"r pd-due" + (o.due_date && o.due_date < t0 ? " bad" : "")}>{day(o.due_date)}</td>
            </tr>
          ))}</tbody>
        </table>
      ), "Nothing waiting. Reorders of old Printavo jobs land here until their print details are confirmed.")}</div>
    </section>
  );

  // crew (production, receiving, shipping): the production dashboard. No sales, balances or customer money anywhere.
  if (crew) {
    const sepN = (k: string) => (k === "working" ? seps.length : 0);
    const sepsSorted = [...seps].sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"));
    return (
      <>
        <div className="page-head">
          <div><div className="eyebrow">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Chicago" })}</div><h1>Production Dashboard</h1></div>
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
            <CrewTodos />
            {detailsCard}
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

  // the owners' My Day (Oct 24, Nick: "I'd like to see mostly financial stuff… I like the charts… the calendar, the to-dos,
  // can you make that a side panel… and then go right into the favorites"): sales charts and top customers, then the
  // starred customers' recap; calendar, to-dos and replies on the right. Balances, the pipeline and production live on
  // their own pages.
  return (
    <>
      <MyDay side name={(staffName || myEmail.split("@")[0]).split(/[\s._@-]+/)[0].replace(/^./, (c) => c.toUpperCase())} replyCount={emailGroups.back.length + emailGroups.fresh.length + emailGroups.web.length} urgentCount={0} replies={<EmailSummary groups={emailGroups} loading={!v || !mailIn || !boxIn} />}
        groups={emailGroups} emailsLoading={!v || !mailIn || !boxIn}
        business={<>
          {boss && <SalesAnalytics part="phone" />}
          <FavoritesRecap compact as={viewing ? myEmail : undefined} jobs={jobs} msgs={myMsgs} needIds={needIds} mailMine={(e) => emailIsMine(e, myBox, myBoxEmail)} />
        </>}
>
        {/* "Needs you today" taken off My Day; Sales moves up (Oct 24, Nick) */}
        {boss && <section className="db-card db-orange db-sales md2-sales">
          <div className="db-card-h"><h2>Sales</h2><span className="faint db-h-note">sales and profit from QuickBooks · departments and customers from orders</span></div>
          {/* one big chart on the left, the numbers and lists on the right (Oct 26, Nick picked option B) */}
          <SalesAnalytics part="board" />
        </section>}
        <FavoritesRecap as={viewing ? myEmail : undefined} jobs={jobs} msgs={myMsgs} needIds={needIds} mailMine={(e) => emailIsMine(e, myBox, myBoxEmail)} />
      </MyDay>
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


