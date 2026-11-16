"use client";
import LogoThumb from "@/components/LogoThumb";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import SearchInput from "@/components/SearchInput";
import { useShopData } from "@/lib/shopData";
import { Due, Pill } from "@/components/bits";
import { money, testFound } from "@/lib/format";
import { useSticky } from "@/lib/useSticky";
import { quickJump } from "@/app/shop/search-actions";
import { previewUrls } from "@/lib/designs";
import { ARCHIVE_LIST_COLS, type ArchiveSummary } from "@/lib/archive";
import { statusKey, type Design } from "@/lib/pricing";
import { holdLabel } from "@/lib/holds";
import { allRows } from "@/lib/readAll";
import RowLink from "@/components/RowLink";
import PrintavoMark from "@/components/PrintavoMark";

/**
 * Search everything (Oct 21, Nick: "this looks like a complete disaster… it should be much more informative"). The
 * customer it found first, as a card with the same summary as the customer page (what's in the works, what they owe,
 * their last order, how often they order, lifetime) and its buttons; every order, ours and Printavo's together, newest
 * first, one line each with its mockup, status, due, pieces, total and balance; their logos as pictures; portal
 * messages and texts that mention it; supplier shipments; other customers one line each. A filter toolbar on top, a
 * short AI answer.
 * Option A (Nov 16, Nick: "search results are just hard to read… it should just say, like, clearly… customer, invoices"):
 * two plain sections first, Customers (one line each: who, and Open customer; no money numbers: Nick, "I don't need the
 * financial stats… very simple results") and Invoices (one table, ours and Printavo's together: #, job, date, status,
 * total, with All / Unpaid / In the works / Quotes); then artwork, messages, ClickUp jobs, shipments and projects.
 */
type Row = { key: string; href: string; number: number; quote: boolean; name: string; customer: string; customerId: string | null; status: string; /** On hold · reason */ hold?: string; label?: string; color?: string; archived: boolean; due: string | null; day: string; pcs: number; total: number; balance: number; thumb?: string };
type Cust = { id: string; company: string; name: string; email: string; phone: string; price_type: string | null; payment_terms: string | null };
type Msg = { key: string; href: string; who: string; when: string; text: string; kind: string };
type Ship = { href: string; title: string; sub: string };
type Proj = { href: string; title: string; sub: string; tag: string };
type Kind = "all" | "customers" | "orders" | "jobs" | "artwork" | "messages" | "shipments" | "projects";
/** a customer's ClickUp job (Nov 1, Nick: searching "43148" found nothing while AMS 43148 Rhode Island waited on ClickUp Jobs with no order) */
type Job = { href: string; ext: boolean; title: string; sub: string; tag: string };

const fmtDay = (d: string | null | undefined) => (d ? new Date(d.slice(0, 10) + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
const custName = (c?: { company?: string | null; name?: string | null } | null) => c?.company || c?.name || "";
/** a question for the AI (who / what / when… / a "?" / six words or more), not a name or a number to look up */
const isQuestion = (t: string) => /\?\s*$/.test(t) || /^(who|what|when|where|why|how|did|does|do|is|are|was|were|which|can|has|have|should|show|find|list|tell)\b/i.test(t) || t.trim().split(/\s+/).length >= 6;
/** the words searched for, marked in a result */
function Hl({ text, words }: { text: string; words: string[] }) {
  const ws = words.filter((w) => w.length >= 2).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!ws.length || !text) return <>{text}</>;
  const parts = text.split(new RegExp(`(${ws.join("|")})`, "ig"));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i} className="sxr-hl">{p}</mark> : p))}</>;
}

function SearchInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const q0 = (sp.get("q") || "").trim();
  const [q, setQ] = useState(q0);
  useEffect(() => { setQ(q0); }, [q0]);
  const { orders: ours, customers: custMap, loading } = useShopData();
  const kind: Kind = "all";
  const [invF, setInvF] = useSticky<"all" | "unpaid" | "works" | "quotes">("search.invoices", "all");
  const [allInv, setAllInv] = useState(false);
  const [allCust, setAllCust] = useState(false);
  const [custs, setCusts] = useState<Cust[]>([]);
  const [arch, setArch] = useState<(ArchiveSummary & { po_number?: string | null; customers?: { company: string; name: string } | null })[]>([]);
  const [bestArch, setBestArch] = useState<ArchiveSummary[]>([]);
  const [otherStats, setOtherStats] = useState<Record<string, { n: number; total: number; last: string }>>({});
  const [art, setArt] = useState<Design[]>([]);
  const [artUrls, setArtUrls] = useState<Record<string, string>>({});
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [ships, setShips] = useState<Ship[]>([]);
  const [projs, setProjs] = useState<Proj[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pending, setPending] = useState(0);
  const searchedFor = useRef("");
  const [ai, setAi] = useState<{ answer?: string; refs?: { label: string; href: string }[]; off?: boolean; reason?: string; error?: string; busy?: boolean; skip?: boolean } | null>(null);

  // an order number goes straight there; anything else is searched (and the AI answers) (Oct 24, Nick; names: Nov 12)
  const [jump, setJump] = useState<"wait" | "none">("wait");
  useEffect(() => {
    let live = true;
    setJump("wait");
    if (!q0) { setJump("none"); return; }
    // a customer's name no longer jumps straight to them (Nov 12, Nick: "Armstrong… we're getting Armstrong McCall"):
    // names show the results; only an exact order number still opens its order
    if (!/^#?\d{3,7}$/.test(q0.trim())) { setJump("none"); return; }
    quickJump(q0).then((h) => { if (!live) return; if (h) router.replace(h); else setJump("none"); }, () => live && setJump("none"));
    return () => { live = false; };
  }, [q0]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = q0.replace(/[%,()*]/g, " ").trim();
  const num = /^#?\d{3,7}$/.test(t) ? t.replace("#", "") : "";
  const low = t.toLowerCase();

  // customers, Printavo jobs, logos, messages, shipments, projects (our own orders come from the shop's order list)
  useEffect(() => {
    if (jump !== "none") return;
    searchedFor.current = q0;
    setCusts([]); setArch([]); setArt([]); setMsgs([]); setShips([]); setProjs([]); setJobs([]); setBestArch([]); setOtherStats({});
    if (t.length < 2) { setPending(0); return; }
    setPending(7);
    let live = true;
    const done = () => { if (live) setPending((n) => Math.max(0, n - 1)); };
    const sb = createClient();
    const like = `%${t}%`;
    const ASEL = `${ARCHIVE_LIST_COLS}, po_number, customers(company, name)`;
    (async () => {
      const { data: c } = await sb.from("customers").select("id, company, name, email, phone, price_type, payment_terms, is_test").or(`company.ilike.${like},name.ilike.${like},email.ilike.${like}`).order("company").limit(25);
      const cs = ((c || []) as (Cust & { is_test?: boolean })[]).filter((x) => testFound(x, t));
      if (!live) return;
      setCusts(cs); done();
      // Printavo jobs: by number, by words, and the matched customers' own
      const ids = cs.slice(0, 6).map((x) => x.id);
      const [byNum, byWords, byCust] = await Promise.all([
        num ? sb.from("archived_orders").select(ASEL).is("removed_at", null).eq("visual_id", num).limit(5) : Promise.resolve({ data: [] }),
        // a number is a job number AND anything with it in it: their PO number, the job's name (Oct 23, Nick: "I searched
        // 85254… In Printavo it returns order 32303 because that's a customer PO. It should search deeper")
        sb.rpc("search_archived_orders", { p_words: [num || low], p_limit: 40 }).select(ASEL).order("order_date", { ascending: false, nullsFirst: false }),
        ids.length && !num ? sb.from("archived_orders").select(ASEL).is("removed_at", null).in("customer_id", ids).order("order_date", { ascending: false, nullsFirst: false }).limit(60) : Promise.resolve({ data: [] }),
      ]);
      const seen = new Set<string>();
      const all = [...(byNum.data || []), ...(byWords.data || []), ...(byCust.data || [])].filter((r) => { const k = (r as { id: string }).id; if (seen.has(k)) return false; seen.add(k); return true; });
      if (live) setArch(all as never); done();
      // each matched customer's totals (for the card and the other customers' lines)
      if (cs.length) {
        const { data: st } = await allRows((r0, r1) => sb.from("archived_orders").select(ARCHIVE_LIST_COLS).is("removed_at", null).in("customer_id", cs.map((x) => x.id)).order("id").range(r0, r1), 5000);
        const rows = (st || []) as ArchiveSummary[];
        if (!live) return;
        setBestArch(rows);
        const m: Record<string, { n: number; total: number; last: string }> = {};
        for (const r of rows) { if (!r.customer_id || r.kind === "quote") continue; const s = (m[r.customer_id] ||= { n: 0, total: 0, last: "" }); s.n++; s.total += +r.total || 0; if ((r.order_date || "") > s.last) s.last = r.order_date || ""; }
        setOtherStats(m);
      }
      // texts from the matched customers that mention it
      if (ids.length && !num) {
        const { data: tx } = await sb.from("text_messages").select("id, body, sent_at, from_me, chat_name, handle, customer_id").in("customer_id", ids).ilike("body", like).order("sent_at", { ascending: false }).limit(15);
        if (live) setMsgs((m) => [...m, ...((tx || []) as { id: string; body: string; sent_at: string; from_me: boolean; chat_name: string | null; handle: string; customer_id: string }[]).map((x) => ({ key: "t" + x.id, href: `/shop/customers/${x.customer_id}?area=messages`, who: x.from_me ? "You" : x.chat_name || x.handle, when: x.sent_at, text: x.body, kind: "Text" }))].sort((a, b) => b.when.localeCompare(a.when)));
      }
    })();
    sb.from("designs").select("*").eq("draft", false).is("archived_at", null).or([`name.ilike.${like}`, ...(num ? [`number.eq.${num}`] : [])].join(",")).order("number", { ascending: false }).limit(12).then(async ({ data }) => {
      const ds = (data || []) as Design[];
      if (!live) return;
      setArt(ds); done();
      if (ds.length) { const u = await previewUrls(sb, ds); if (live) setArtUrls(u); }
    });
    sb.from("messages").select("id, body, author_name, created_at, order_id, customer_id").is("hidden_at", null).ilike("body", like).order("created_at", { ascending: false }).limit(15).then(({ data }) => {
      const rows = (data || []) as { id: string; body: string; author_name: string; created_at: string; order_id: string | null; customer_id: string | null }[];
      if (live) setMsgs((m) => [...m, ...rows.map((x) => ({ key: "m" + x.id, href: x.order_id ? `/shop/orders/${x.order_id}#messages` : x.customer_id ? `/shop/customers/${x.customer_id}?area=messages` : "/shop/inbox", who: x.author_name || "Portal", when: x.created_at, text: x.body, kind: "Portal" }))].sort((a, b) => b.when.localeCompare(a.when)));
      done();
    });
    fetch(`/api/goods/manifest?q=${encodeURIComponent(t)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({})).then((m) => {
      if (live) setShips(((m.hits || []) as { who: string; supplier: string; supplier_order: string; po: string; ship_date: string | null; boxes: number; pcs: number; order: { number: number; href: string } | null }[]).map((x) => ({ href: x.order?.href || `/shop/receiving`, title: `${x.who} · ${x.supplier === "sanmar" ? "SanMar" : "S&S"} ${x.supplier_order}`, sub: [x.po ? `PO ${x.po}` : "", `${x.boxes} box${x.boxes === 1 ? "" : "es"}, ${x.pcs} pcs`, x.ship_date ? `shipped ${fmtDay(x.ship_date)}` : "", x.order ? `on #${x.order.number}` : "not linked yet"].filter(Boolean).join(" · ") })));
      done();
    });
    // ClickUp jobs by name (their PO numbers are in the name): an open one opens on ClickUp Jobs, one made into an order
    // opens the order, a finished one with no order here opens in ClickUp
    Promise.all([
      sb.from("clickup_tasks").select("id, team_id, name, status, status_type, order_id, order_number, url, created_at_cu").is("parent", null).ilike("name", like).order("created_at_cu", { ascending: false }).limit(15),
      sb.from("clickup_teams").select("id, name"),
    ]).then(([{ data }, { data: tms }]) => {
      const tn = new Map(((tms || []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
      if (live) setJobs(((data || []) as { id: string; team_id: string; name: string; status: string; status_type: string; order_id: string | null; order_number: number | null; url: string; created_at_cu: string | null }[]).map((x) => {
        const shut = /^(closed|done)$/i.test(x.status_type);
        return {
          href: x.order_id ? `/shop/orders/${x.order_id}` : shut ? x.url : `/shop/clickup?job=${encodeURIComponent(x.id)}`, ext: !x.order_id && shut,
          title: x.name, sub: [tn.get(x.team_id) || "", x.created_at_cu ? fmtDay(x.created_at_cu) : ""].filter(Boolean).join(" · "),
          tag: x.order_id ? `Order #${x.order_number || ""}` : shut ? "Done in ClickUp" : "No order yet",
        };
      }));
      done();
    }, () => done());
    sb.from("projects").select("id, name, status, customers(company, name)").ilike("name", like).limit(15).then(({ data }) => {
      if (live) setProjs(((data || []) as unknown as { id: string; name: string; status: string; customers: { company: string; name: string } | null }[]).map((x) => ({ href: `/shop/projects/${x.id}`, title: x.name, sub: custName(x.customers), tag: x.status })));
      done();
    });
    return () => { live = false; };
  }, [q0, jump]); // eslint-disable-line react-hooks/exhaustive-deps

  // the customer it's about: one whose name has the words, the one with the most orders
  const best = useMemo(() => {
    if (!custs.length) return null;
    const count = (id: string) => ours.filter((o) => o.customer_id === id).length + (otherStats[id]?.n || 0);
    return [...custs].sort((a, b) => count(b.id) - count(a.id))[0];
  }, [custs, ours, otherStats]);
  const custIds = useMemo(() => new Set(custs.slice(0, 6).map((c) => c.id)), [custs]);

  // every order, ours and Printavo's, newest first
  const rows: Row[] = useMemo(() => {
    if (t.length < 2) return [];
    const mine = ours.filter((o) => (num && String(o.number) === num) || `${o.nickname || ""} ${o.po_number || ""}`.toLowerCase().includes(num || low) || (!num && o.customer_id && custIds.has(o.customer_id)));
    const a: Row[] = mine.map((o) => ({ key: o.id, href: `/shop/orders/${o.id}`, number: o.number, quote: o.type === "quote", name: o.nickname || "Untitled Job", customer: custName(custMap[o.customer_id || ""]), customerId: o.customer_id, status: statusKey(o), hold: holdLabel((o as { flags?: unknown }).flags), archived: false, due: o.due_date, day: (o.created_at || "").slice(0, 10), pcs: o.qty, total: o.total, balance: o.type === "invoice" ? o.balance : 0 }));
    const b: Row[] = arch.map((r) => ({ key: r.id, href: `/shop/archive/${r.id}`, number: +r.visual_id || 0, quote: r.kind === "quote", name: r.nickname || "Untitled Job", customer: custName(r.customers), customerId: r.customer_id, status: "archived", label: r.status_name || "", color: r.status_color || "#888", archived: true, due: r.due_date, day: (r.order_date || "").slice(0, 10), pcs: r.qty || 0, total: +r.total || 0, balance: r.kind === "quote" ? 0 : +r.balance || 0 }));
    return [...a, ...b].sort((x, y) => y.day.localeCompare(x.day) || y.number - x.number);
  }, [ours, arch, custIds, custMap, t, num, low]);

  // the AI answer: once the results are in (it reads them too)
  useEffect(() => {
    // only for a question (Nov 2, Nick: "people are complaining that this search… returns hard to read results": a name
    // like "xyz" got "I'm not sure what you're asking")
    if (t.length < 3 || num || jump !== "none" || !isQuestion(t)) { setAi(null); return; }
    if (loading || pending || searchedFor.current !== q0) return;
    const found = [...rows.slice(0, 20).map((r) => ({ ref: r.href.replace("/shop/orders/", "o:").replace("/shop/archive/", "a:"), text: `#${r.number} ${r.name} · ${r.customer} · ${r.archived ? r.label : r.status}${r.due ? ` · due ${r.due}` : ""} · total ${r.total}${r.balance > 0.004 ? ` · owes ${r.balance}` : ""}` })), ...custs.slice(0, 8).map((c) => ({ ref: `c:${c.id}`, text: `${c.company || c.name} · ${c.name} · ${c.email}` }))];
    let live = true;
    setAi({ busy: true });
    fetch("/api/ai/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: t, found }) })
      .then((r) => r.json()).then((j) => { if (live) setAi(j.skip ? null : j); }).catch(() => { if (live) setAi({ error: "The AI couldn't answer right now." }); });
    return () => { live = false; };
  }, [pending, loading, q0, jump]); // eslint-disable-line react-hooks/exhaustive-deps

  // the customers, the one with the most orders first
  const custList = useMemo(() => (best ? [best, ...custs.filter((c) => c.id !== best.id)] : custs), [best, custs]);

  const counts: Record<Kind, number> = { all: 0, customers: custs.length, orders: rows.length, jobs: jobs.length, artwork: art.length, messages: msgs.length, shipments: ships.length, projects: projs.length };
  counts.all = counts.customers + counts.orders + counts.jobs + counts.artwork + counts.messages + counts.shipments + counts.projects;
  const show = (k: Kind) => (kind === "all" || kind === k) && counts[k] > 0;
  const searching = loading || pending > 0;

  return (
    <>
      <div className="page-head"><div><h1>Search</h1><div className="eyebrow">Customers and invoices first, then logos, messages, ClickUp jobs, shipments and projects</div></div></div>
      <form className="srch-box" onSubmit={(e) => { e.preventDefault(); router.replace(`/shop/search?q=${encodeURIComponent(q.trim())}`); }}>
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} onDictated={(x) => { if (x.trim()) router.replace(`/shop/search?q=${encodeURIComponent(x.trim())}`); }} placeholder="Search everything" autoFocus aria-label="Search" />
        <button type="submit" className="btn primary">Search</button>
      </form>
      {searching && t.length >= 2 && <div className="faint sx-busy">Searching…</div>}
      {ai && !ai.off && !ai.skip && (
        <div className="sx-ai"><b>AI answer</b>{ai.busy ? <span className="faint">Thinking…</span> : ai.error ? <span className="bad">{ai.error}</span> : <span>{ai.answer}</span>}
          {!ai.busy && !!ai.refs?.length && <span className="sx-ai-refs">{ai.refs.map((r, i) => <Link key={i} href={r.href}>{r.label}</Link>)}</span>}
        </div>
      )}
      {t.length < 2 ? <div className="empty">Type a name, an order #, a PO, a logo or a tracking number.</div> : !searching && !counts.all ? <div className="empty">Nothing found for “{q0}”.</div> : null}

      {show("customers") && (
        <section className="sx-sec">
          <h2 className="sx-h">Customers <span className="chip-n">{custList.length}</span></h2>
          <div className="sxc">
            {(allCust ? custList : custList.slice(0, 5)).map((c) => (
              <div className="sxc-r" key={c.id}>
                <div className="sxc-who"><Link href={`/shop/customers/${c.id}`} className="sxc-n">{c.company || c.name}</Link>
                  <div className="faint">{[c.company ? c.name : "", c.email, c.phone].filter(Boolean).join(" · ")}</div></div>
                <Link className="btn primary" href={`/shop/customers/${c.id}`}>Open customer</Link>
              </div>
            ))}
            {!allCust && custList.length > 5 && <button type="button" className="sxr-more" onClick={() => setAllCust(true)}>Show all {custList.length} customers</button>}
          </div>
        </section>
      )}

      {show("orders") && (() => {
        const words = t.split(/\s+/);
        const many = new Set(rows.map((r) => r.customerId || r.customer)).size > 1;
        const owes = (r: Row) => !r.quote && r.balance > 0.004;
        const works = (r: Row) => !r.archived && !r.quote && r.status !== "completed" && r.status !== "canceled";
        const F: [typeof invF, string, Row[]][] = [
          ["all", "All", rows],
          ["unpaid", "Unpaid", rows.filter(owes)],
          ["works", "In the works", rows.filter(works).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || b.number - a.number)],
          ["quotes", "Quotes", rows.filter((r) => r.quote)],
        ];
        const cur = F.find((f) => f[0] === invF) || F[0];
        const list = allInv ? cur[2] : cur[2].slice(0, 10);
        return (
          <section className="sx-sec">
            <div className="sx-hrow">
              <h2 className="sx-h">Invoices <span className="chip-n">{rows.length}</span></h2>
              <div className="chips" role="tablist" aria-label="Show">
                {F.map(([k, l, xs]) => <button key={k} type="button" role="tab" aria-selected={invF === k} className={"chip" + (invF === k ? " on" : "")} onClick={() => { setInvF(k); setAllInv(false); }}>{l}<span className="chip-n">{xs.length}</span></button>)}
              </div>
            </div>
            {cur[2].length ? (
              <div className="tbl-wrap"><table className="tbl sxi">
                <thead><tr><th>#</th><th>Job</th><th>Date</th><th>Status</th><th className="r money-only">Total</th></tr></thead>
                <tbody>
                  {list.map((r) => (
                    <tr className={"rl" + (owes(r) ? " sxi-owe" : "")} key={r.key}>
                      <td className="nowrap"><RowLink href={r.href} /><span className="ordno"><Hl text={String(r.number)} words={words} /></span>{r.archived && <PrintavoMark />}{r.quote && <span className="tag">Quote</span>}</td>
                      <td><Hl text={r.name} words={words} />{many && r.customer ? <div className="sub"><Hl text={r.customer} words={words} /></div> : null}</td>
                      <td className="nowrap">{!r.archived && !r.quote && r.status !== "completed" && r.due ? <>due <Due date={r.due} status={r.status} /></> : fmtDay(r.day)}</td>
                      <td className="nowrap">{r.archived ? <span className="pv-dot" style={{ ["--sc" as string]: r.color }}>{r.label}</span> : <Pill status={r.status} hold={r.hold} />}{owes(r) && <span className="sxi-unpaid money-only">Unpaid</span>}</td>
                      <td className="r nowrap money-only">{money(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!allInv && cur[2].length > 10 && <button type="button" className="sxr-more" onClick={() => setAllInv(true)}>Show all {cur[2].length}</button>}
              </div>
            ) : <div className="empty">None {cur[0] === "unpaid" ? "unpaid" : cur[0] === "works" ? "in the works" : "quotes"} for “{q0}”.</div>}
          </section>
        );
      })()}

      {show("artwork") && (
        <section className="sx-sec">
          <h2 className="sx-h">Artwork <span className="chip-n">{art.length}</span></h2>
          <div className="sx-art">{art.map((d) => (
            <Link key={d.id} href={`/shop/artwork/${d.id}`} className="sx-art-i"><span className="sx-art-p">{artUrls[d.id] ? <LogoThumb d={d} url={artUrls[d.id]} /> : null}</span><b>D-{d.number} {d.name}</b><small className="faint">{custName(custMap[d.customer_id || ""])}</small></Link>
          ))}</div>
        </section>
      )}

      {show("messages") && (
        <section className="sx-sec">
          <h2 className="sx-h">Messages <span className="chip-n">{msgs.length}</span><span className="faint">portal messages and texts that mention it</span></h2>
          <div className="tbl-wrap"><table className="tbl"><tbody>
            {msgs.map((m) => <tr className="rl" key={m.key}><td style={{ width: 70 }}><RowLink href={m.href} /><span className="tag">{m.kind}</span></td><td style={{ width: 160 }}><b>{m.who}</b></td><td className="sx-msg">{m.text}</td><td className="r">{fmtDay(m.when)}</td></tr>)}
          </tbody></table></div>
        </section>
      )}

      {show("jobs") && (
        <section className="sx-sec">
          <h2 className="sx-h">ClickUp jobs <span className="chip-n">{jobs.length}</span></h2>
          <div className="tbl-wrap"><table className="tbl"><tbody>{jobs.map((j, i) => <tr className="rl" key={i}><td>{j.ext ? <a className="rl-a" href={j.href} target="_blank" rel="noreferrer" aria-label={`Open ${j.title} in ClickUp`} /> : <RowLink href={j.href} />}<b>{j.title}</b></td><td className="faint">{j.sub}</td><td><span className="tag">{j.tag}</span></td></tr>)}</tbody></table></div>
        </section>
      )}

      {show("shipments") && (
        <section className="sx-sec">
          <h2 className="sx-h">Supplier shipments <span className="chip-n">{ships.length}</span></h2>
          <div className="tbl-wrap"><table className="tbl"><tbody>{ships.map((s, i) => <tr className="rl" key={i}><td><RowLink href={s.href} /><b>{s.title}</b></td><td className="faint">{s.sub}</td></tr>)}</tbody></table></div>
        </section>
      )}

      {show("projects") && (
        <section className="sx-sec">
          <h2 className="sx-h">Projects <span className="chip-n">{projs.length}</span></h2>
          <div className="tbl-wrap"><table className="tbl"><tbody>{projs.map((p, i) => <tr className="rl" key={i}><td><RowLink href={p.href} /><b>{p.title}</b></td><td>{p.sub}</td><td><span className="tag">{p.tag}</span></td></tr>)}</tbody></table></div>
        </section>
      )}

    </>
  );
}

export default function SearchPage() {
  return <Suspense fallback={<div className="empty">Loading…</div>}><SearchInner /></Suspense>;
}
