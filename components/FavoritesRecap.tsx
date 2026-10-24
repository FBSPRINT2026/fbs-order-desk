"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { getFavoritesRecap, type FavCustomer, type FavEmail, type FavSales, type FavText } from "@/app/shop/favorites-actions";
import { ST } from "@/lib/pricing";

/**
 * My Day → Favorites (Oct 24, Nick: "if I favorited Dear Hearts, you should have a view on the my day that shows like,
 * oh, here's their jobs, here's their status, they sent you an email, there's a text message waiting… just expand on
 * that a little bit"). One card per starred customer (Customers → ☆):
 * - their open jobs, each with how far along it is (Quote → Art → Goods → Print → Ship) and its real status;
 * - what's waiting on you: portal messages, emails waiting on a reply (your mailbox only), a text with no answer yet;
 * - what happened lately (the last few emails and texts either way);
 * - this year's sales, orders and their last order.
 * Favorites with nothing open and nothing new fold into one line at the bottom.
 */
export type FavJob = { id: string; href: string; number: number; nickname: string; customer_id: string | null; due: string | null; status: string; statusLabel: string; printavo: boolean };
export type FavMsg = { id: string; customer_id: string | null; order_id: string | null; body: string; created_at: string };

const STEPS = ["Quote", "Art", "Goods", "Print", "Ship"];
/** how far along a job is: 0 quote … 4 ready / shipping (Printavo's status names read by their words) */
function stepOf(j: FavJob): number {
  const s = j.printavo ? j.statusLabel.toLowerCase() : j.status;
  if (!j.printavo) return ({ request: 0, quote: 0, quote_sent: 0, approved: 1, art: 1, blanks: 2, production: 3, issue: 3, ready: 4 } as Record<string, number>)[s] ?? 1;
  if (/^quote|request/.test(s)) return 0;
  if (/ship|deliver|pick ?up|ready for pick|complete/.test(s)) return 4;
  if (/production|press|print|embroider|schedul|heat/.test(s)) return 3;
  if (/goods|blank|garment|receiv|order(ed)? |s&s|sanmar/.test(s)) return 2;
  return 1; // art, proofs, mockups, approved, waiting on details
}
const label = (j: FavJob) => (j.printavo ? j.statusLabel : ST[j.status]?.label || j.status);
const tz = "America/Chicago";
const dayOf = (s: string) => new Date(s).toLocaleDateString("en-CA", { timeZone: tz });
function when(s: string) {
  const d = dayOf(s), t = new Date().toLocaleDateString("en-CA", { timeZone: tz });
  if (d === t) return new Date(s).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz }).replace(" ", "").toLowerCase();
  const days = Math.round((Date.parse(t + "T12:00") - Date.parse(d + "T12:00")) / 864e5);
  if (days === 1) return "Yesterday";
  if (days < 7) return new Date(s).toLocaleDateString([], { weekday: "short", timeZone: tz });
  return new Date(s).toLocaleDateString([], { month: "short", day: "numeric", timeZone: tz });
}
const due = (d: string | null) => (d ? new Date(d.slice(0, 10) + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "");
const money0 = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const initials = (n: string) => n.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "★";

type Item = { k: string; kind: "email" | "text" | "portal"; text: string; at: string; href?: string; out?: boolean };

export default function FavoritesRecap({ jobs, msgs, needIds, mailMine }: {
  jobs: FavJob[] | null; msgs: FavMsg[];
  /** emails waiting on a reply (the page's rule) */ needIds: Set<string>;
  /** whose mailbox an email belongs to (someone else's email never shows) */ mailMine: (e: { to_email?: string | null; direction?: string; meta?: { account_id?: string; cc?: string[] } | null }) => boolean;
}) {
  const [d, setD] = useState<{ favs: FavCustomer[]; emails: FavEmail[]; texts: FavText[]; sales: FavSales[]; seesTexts: boolean } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    const load = () => getFavoritesRecap().then((r) => { if (r.ok) { setD(r); setErr(""); } else setErr(r.error); }, () => null);
    load();
    const t = setInterval(load, 120000);
    return () => clearInterval(t);
  }, []);

  const cards = useMemo(() => {
    if (!d) return [];
    return d.favs.map((c) => {
      const js = (jobs || []).filter((j) => j.customer_id === c.id).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
      const em = d.emails.filter((e) => e.customer_id === c.id && mailMine({ to_email: e.to_email, direction: e.direction, meta: { account_id: e.account_id || undefined, cc: e.cc } }));
      const tx = d.texts.filter((t) => t.customer_id === c.id); // newest first
      // a text is waiting when their latest texts came after our last one
      const lastMine = tx.find((t) => t.from_me);
      const textWaiting = tx.filter((t) => !t.from_me && (!lastMine || t.sent_at > lastMine.sent_at));
      const waiting: Item[] = [
        ...msgs.filter((m) => m.customer_id === c.id).map((m) => ({ k: "p" + m.id, kind: "portal" as const, text: m.body.replace(/\s+/g, " ").slice(0, 160), at: m.created_at, href: m.order_id ? `/shop/orders/${m.order_id}` : `/shop/customers/${c.id}?area=messages` })),
        ...em.filter((e) => needIds.has(e.id)).map((e) => ({ k: "e" + e.id, kind: "email" as const, text: e.summary || e.subject || "(no subject)", at: e.occurred_at, href: `/shop/conversations?open=${e.id}` })),
        ...(textWaiting.length ? [{ k: "t" + textWaiting[0].sent_at, kind: "text" as const, text: textWaiting[0].body ? `"${textWaiting[0].body}"` : textWaiting[0].pics ? "Sent a picture" : "New text", at: textWaiting[0].sent_at, href: `/shop/customers/${c.id}?area=messages` }] : []),
      ].sort((a, b) => b.at.localeCompare(a.at));
      const shown = new Set(waiting.map((w) => w.k));
      const lately: Item[] = [
        ...em.filter((e) => !needIds.has(e.id)).map((e) => ({ k: "e" + e.id, kind: "email" as const, text: e.summary || e.subject || "(no subject)", at: e.occurred_at, href: `/shop/conversations?open=${e.id}`, out: e.direction === "out" })),
        ...tx.filter((t) => !textWaiting.includes(t) && (t.body || t.pics)).slice(0, 3).map((t) => ({ k: "t" + t.sent_at, kind: "text" as const, text: t.body ? `"${t.body}"` : "A picture", at: t.sent_at, href: `/shop/customers/${c.id}?area=messages`, out: t.from_me })),
      ].filter((x) => !shown.has(x.k)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3);
      const last = [...em.map((e) => e.occurred_at), ...tx.map((t) => t.sent_at), ...msgs.filter((m) => m.customer_id === c.id).map((m) => m.created_at)].sort().pop() || null;
      const s = d.sales.find((x) => x.customer_id === c.id) || null;
      return { c, js, waiting, lately, last, s, quiet: !js.length && !waiting.length && !lately.length };
    }).sort((a, b) => Number(a.quiet) - Number(b.quiet) || b.waiting.length - a.waiting.length || b.js.length - a.js.length || a.c.name.localeCompare(b.c.name));
  }, [d, jobs, msgs, needIds, mailMine]);

  const busy = cards.filter((x) => !x.quiet), quiet = cards.filter((x) => x.quiet);
  const icon = (k: Item["kind"]) => k === "email"
    ? <svg viewBox="0 0 24 24" aria-hidden><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
    : k === "text"
      ? <svg viewBox="0 0 24 24" aria-hidden><path d="M4 5h16v11H9l-5 4z" /></svg>
      : <svg viewBox="0 0 24 24" aria-hidden><path d="M4 4h16v12H8l-4 4z" /><path d="M8 9h8M8 12h5" /></svg>;
  const row = (x: Item, live: boolean) => (
    <Link key={x.k} href={x.href || "#"} className="fv-it">
      <span className={"fv-dot" + (live ? "" : " o")} aria-hidden />
      <span className="fv-ic" title={x.kind === "portal" ? "Portal message" : x.kind === "text" ? "Text" : "Email"}>{icon(x.kind)}</span>
      <span className="fv-tx">{x.out ? <span className="faint">You: </span> : null}{x.text}</span>
      <span className="fv-when">{when(x.at)}</span>
    </Link>
  );

  return (
    <section className="fv" aria-label="Favorites">
      <div className="fv-h"><h2><span className="fv-star" aria-hidden>★</span>Favorites</h2><span className="faint">the customers you starred: their jobs, and what&apos;s new</span><span className="spacer" /><Link href="/shop/customers" className="linkbtn">Customers</Link></div>
      {err ? <div className="db-empty">{err}</div> : !d || !jobs ? <div className="db-empty">Loading your favorites…</div> : !cards.length ? (
        <div className="fv-none">Star a customer on the Customers page (☆ next to their name) and they show up here with their jobs, emails and texts.</div>
      ) : (
        <>
          {busy.map(({ c, js, waiting, lately, last, s }) => (
            <article key={c.id} className="fv-card">
              <header className="fv-top">
                <span className="fv-av" aria-hidden>{initials(c.name)}</span>
                <div className="fv-who"><Link href={`/shop/customers/${c.id}`} className="fv-n">{c.name}</Link><span className="faint">{[c.contact, last ? `last talked ${when(last).toLowerCase() === "yesterday" ? "yesterday" : when(last)}` : ""].filter(Boolean).join(" · ")}</span></div>
                <span className="spacer" />
                <Link href={`/shop/customers/${c.id}?area=messages`} className="btn sm">Messages</Link>
                <Link href={`/shop/customers/${c.id}`} className="btn sm">Open</Link>
              </header>
              <div className="fv-body">
                <div className="fv-col">
                  <div className="fv-l">Jobs{js.length ? ` (${js.length})` : ""}</div>
                  {!js.length ? <div className="fv-q">No open jobs.</div> : js.slice(0, 4).map((j) => { const st = stepOf(j); return (
                    <Link key={(j.printavo ? "p" : "o") + j.id} href={j.href} className="fv-job">
                      <span className="fv-jn"><b>#{j.number}</b> {j.nickname || "Untitled job"}{j.due && <span className="fv-due">Due {due(j.due)}</span>}</span>
                      <span className="fv-trk" role="img" aria-label={`${STEPS[st]} of ${STEPS.join(", ")}`}>{STEPS.map((x, i) => <i key={x} className={i < st ? "d" : i === st ? "c" : ""} />)}</span>
                      <span className="fv-st">{STEPS.map((x, i) => i === st ? <b key={x}>{x}: {label(j)}</b> : <span key={x}>{x}</span>).reduce<React.ReactNode[]>((a, n, i) => (i ? [...a, " → ", n] : [n]), [])}</span>
                    </Link>
                  ); })}
                  {js.length > 4 && <Link href={`/shop/customers/${c.id}`} className="fv-more">{js.length - 4} more</Link>}
                </div>
                <div className="fv-col">
                  <div className="fv-l">Waiting on you</div>
                  {waiting.length ? waiting.slice(0, 4).map((x) => row(x, true)) : <div className="fv-q">Nothing. You&apos;re caught up with them.</div>}
                  {lately.length > 0 && <><div className="fv-l fv-l2">Lately</div>{lately.map((x) => row(x, false))}</>}
                </div>
              </div>
              <footer className="fv-foot">
                <span>This year <b>{money0(s?.sales || 0)}</b></span>
                <span>Orders <b>{s?.orders || 0}</b></span>
                {s?.last_order && <span>Last order <b>{due(s.last_order)}</b></span>}
              </footer>
            </article>
          ))}
          {quiet.length > 0 && <>
            <div className="fv-ql">Quiet: no open jobs, nothing new</div>
            <div className="fv-quiet">{quiet.map(({ c, s }) => (
              <Link key={c.id} href={`/shop/customers/${c.id}`} className="fv-chip"><span className="fv-star" aria-hidden>★</span>{c.name}{s?.last_order ? <span className="faint"> · last order {due(s.last_order)}</span> : null}</Link>
            ))}</div>
          </>}
        </>
      )}
    </section>
  );
}
