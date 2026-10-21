"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import SearchInput from "@/components/SearchInput";
import { useShopData } from "@/lib/shopData";
import { Due, Pill, pvStatusOf } from "@/components/bits";
import { money } from "@/lib/format";
import { useSticky } from "@/lib/useSticky";
import { previewUrls } from "@/lib/designs";
import { ARCHIVE_LIST_COLS, type ArchiveSummary } from "@/lib/archive";
import { PAY_TERMS, type Design, type PayTerms } from "@/lib/pricing";

/**
 * Search everything (Oct 21, Nick: "this looks like a complete disaster… it should be much more informative"). The
 * customer it found first, as a card with the same summary as the customer page (what's in the works, what they owe,
 * their last order, how often they order, lifetime) and its buttons; every order, ours and Printavo's together, newest
 * first, one line each with its mockup, status, due, pieces, total and balance; their logos as pictures; portal
 * messages and texts that mention it; supplier shipments; other customers one line each. A filter toolbar on top, a
 * short AI answer.
 */
type Row = { key: string; href: string; number: number; quote: boolean; name: string; customer: string; customerId: string | null; status: string; pv?: string; label?: string; color?: string; archived: boolean; due: string | null; day: string; pcs: number; total: number; balance: number; thumb?: string };
type Cust = { id: string; company: string; name: string; email: string; phone: string; price_type: string | null; payment_terms: string | null };
type Msg = { key: string; href: string; who: string; when: string; text: string; kind: string };
type Ship = { href: string; title: string; sub: string };
type Proj = { href: string; title: string; sub: string; tag: string };
type Kind = "all" | "customers" | "orders" | "artwork" | "messages" | "shipments" | "projects";

const fmtDay = (d: string | null | undefined) => (d ? new Date(d.slice(0, 10) + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
const today = () => new Date().toISOString().slice(0, 10);
const dd = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const custName = (c?: { company?: string | null; name?: string | null } | null) => c?.company || c?.name || "";

function SearchInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const q0 = (sp.get("q") || "").trim();
  const [q, setQ] = useState(q0);
  useEffect(() => { setQ(q0); }, [q0]);
  const { orders: ours, customers: custMap, loading } = useShopData();
  const [kind, setKind] = useSticky<Kind>("search.kind", "all");
  const [custs, setCusts] = useState<Cust[]>([]);
  const [arch, setArch] = useState<(ArchiveSummary & { po_number?: string | null; customers?: { company: string; name: string } | null })[]>([]);
  const [bestArch, setBestArch] = useState<ArchiveSummary[]>([]);
  const [otherStats, setOtherStats] = useState<Record<string, { n: number; total: number; last: string }>>({});
  const [art, setArt] = useState<Design[]>([]);
  const [artUrls, setArtUrls] = useState<Record<string, string>>({});
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [ships, setShips] = useState<Ship[]>([]);
  const [projs, setProjs] = useState<Proj[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(0);
  const [more, setMore] = useState(false);
  const searchedFor = useRef("");
  const [ai, setAi] = useState<{ answer?: string; refs?: { label: string; href: string }[]; off?: boolean; reason?: string; error?: string; busy?: boolean; skip?: boolean } | null>(null);

  const t = q0.replace(/[%,()*]/g, " ").trim();
  const num = /^#?\d{3,7}$/.test(t) ? t.replace("#", "") : "";
  const low = t.toLowerCase();

  // customers, Printavo jobs, logos, messages, shipments, projects (our own orders come from the shop's order list)
  useEffect(() => {
    searchedFor.current = q0;
    setCusts([]); setArch([]); setArt([]); setMsgs([]); setShips([]); setProjs([]); setBestArch([]); setOtherStats({}); setMore(false);
    if (t.length < 2) { setPending(0); return; }
    setPending(6);
    let live = true;
    const done = () => { if (live) setPending((n) => Math.max(0, n - 1)); };
    const sb = createClient();
    const like = `%${t}%`;
    const ASEL = `${ARCHIVE_LIST_COLS}, po_number, customers(company, name)`;
    (async () => {
      const { data: c } = await sb.from("customers").select("id, company, name, email, phone, price_type, payment_terms, is_test").or(`company.ilike.${like},name.ilike.${like},email.ilike.${like}`).order("company").limit(25);
      const cs = ((c || []) as (Cust & { is_test?: boolean })[]).filter((x) => !x.is_test);
      if (!live) return;
      setCusts(cs); done();
      // Printavo jobs: by number, by words, and the matched customers' own
      const ids = cs.slice(0, 6).map((x) => x.id);
      const [byNum, byWords, byCust] = await Promise.all([
        num ? sb.from("archived_orders").select(ASEL).eq("visual_id", num).limit(5) : Promise.resolve({ data: [] }),
        num ? Promise.resolve({ data: [] }) : sb.rpc("search_archived_orders", { p_words: [low], p_limit: 40 }).select(ASEL).order("order_date", { ascending: false, nullsFirst: false }),
        ids.length && !num ? sb.from("archived_orders").select(ASEL).in("customer_id", ids).order("order_date", { ascending: false, nullsFirst: false }).limit(60) : Promise.resolve({ data: [] }),
      ]);
      const seen = new Set<string>();
      const all = [...(byNum.data || []), ...(byWords.data || []), ...(byCust.data || [])].filter((r) => { const k = (r as { id: string }).id; if (seen.has(k)) return false; seen.add(k); return true; });
      if (live) setArch(all as never); done();
      // each matched customer's totals (for the card and the other customers' lines)
      if (cs.length) {
        const { data: st } = await sb.from("archived_orders").select(ARCHIVE_LIST_COLS).in("customer_id", cs.map((x) => x.id)).limit(5000);
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
    sb.from("messages").select("id, body, author_name, created_at, order_id, customer_id").ilike("body", like).order("created_at", { ascending: false }).limit(15).then(({ data }) => {
      const rows = (data || []) as { id: string; body: string; author_name: string; created_at: string; order_id: string | null; customer_id: string | null }[];
      if (live) setMsgs((m) => [...m, ...rows.map((x) => ({ key: "m" + x.id, href: x.order_id ? `/shop/orders/${x.order_id}#messages` : x.customer_id ? `/shop/customers/${x.customer_id}?area=messages` : "/shop/inbox", who: x.author_name || "Portal", when: x.created_at, text: x.body, kind: "Portal" }))].sort((a, b) => b.when.localeCompare(a.when)));
      done();
    });
    fetch(`/api/goods/manifest?q=${encodeURIComponent(t)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({})).then((m) => {
      if (live) setShips(((m.hits || []) as { who: string; supplier: string; supplier_order: string; po: string; ship_date: string | null; boxes: number; pcs: number; order: { number: number; href: string } | null }[]).map((x) => ({ href: x.order?.href || `/shop/receiving`, title: `${x.who} · ${x.supplier === "sanmar" ? "SanMar" : "S&S"} ${x.supplier_order}`, sub: [x.po ? `PO ${x.po}` : "", `${x.boxes} box${x.boxes === 1 ? "" : "es"}, ${x.pcs} pcs`, x.ship_date ? `shipped ${fmtDay(x.ship_date)}` : "", x.order ? `on #${x.order.number}` : "not linked yet"].filter(Boolean).join(" · ") })));
      done();
    });
    sb.from("projects").select("id, name, status, customers(company, name)").ilike("name", like).limit(15).then(({ data }) => {
      if (live) setProjs(((data || []) as unknown as { id: string; name: string; status: string; customers: { company: string; name: string } | null }[]).map((x) => ({ href: `/shop/projects/${x.id}`, title: x.name, sub: custName(x.customers), tag: x.status })));
      done();
    });
    return () => { live = false; };
  }, [q0]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const mine = ours.filter((o) => (num ? String(o.number) === num : `${o.nickname || ""} ${o.po_number || ""}`.toLowerCase().includes(low)) || (!num && o.customer_id && custIds.has(o.customer_id)));
    const a: Row[] = mine.map((o) => ({ key: o.id, href: `/shop/orders/${o.id}`, number: o.number, quote: o.type === "quote", name: o.nickname || "Untitled Job", customer: custName(custMap[o.customer_id || ""]), customerId: o.customer_id, status: o.status, pv: pvStatusOf(o as never), archived: false, due: o.due_date, day: (o.created_at || "").slice(0, 10), pcs: o.qty, total: o.total, balance: o.type === "invoice" ? o.balance : 0 }));
    const b: Row[] = arch.map((r) => ({ key: r.id, href: `/shop/archive/${r.id}`, number: +r.visual_id || 0, quote: r.kind === "quote", name: r.nickname || "Untitled Job", customer: custName(r.customers), customerId: r.customer_id, status: "archived", label: r.status_name || "", color: r.status_color || "#888", archived: true, due: r.due_date, day: (r.order_date || "").slice(0, 10), pcs: r.qty || 0, total: +r.total || 0, balance: r.kind === "quote" ? 0 : +r.balance || 0 }));
    return [...a, ...b].sort((x, y) => y.day.localeCompare(x.day) || y.number - x.number);
  }, [ours, arch, custIds, custMap, t, num, low]);

  // mockup pictures for our orders shown
  useEffect(() => {
    const want = rows.filter((r) => !r.archived).slice(0, 40).map((r) => { const o = ours.find((x) => x.id === r.key); const p = (o?.groups || []).flatMap((g) => (g as { mockupThumbs?: string[] }).mockupThumbs || [])[0]; return p ? [r.key, p] as const : null; }).filter(Boolean) as (readonly [string, string])[];
    const need = want.filter(([k]) => !thumbs[k]);
    if (!need.length) return;
    createClient().storage.from("proofs").createSignedUrls(need.map((x) => x[1]), 3600).then(({ data }) => setThumbs((m) => ({ ...m, ...Object.fromEntries(need.map(([k], i) => [k, data?.[i]?.signedUrl || ""])) })));
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // the AI answer: once the results are in (it reads them too)
  useEffect(() => {
    if (t.length < 3) { setAi(null); return; }
    if (loading || pending || searchedFor.current !== q0) return;
    const found = [...rows.slice(0, 20).map((r) => ({ ref: r.href.replace("/shop/orders/", "o:").replace("/shop/archive/", "a:"), text: `#${r.number} ${r.name} · ${r.customer} · ${r.archived ? r.label : r.status}${r.due ? ` · due ${r.due}` : ""} · total ${r.total}${r.balance > 0.004 ? ` · owes ${r.balance}` : ""}` })), ...custs.slice(0, 8).map((c) => ({ ref: `c:${c.id}`, text: `${c.company || c.name} · ${c.name} · ${c.email}` }))];
    let live = true;
    setAi({ busy: true });
    fetch("/api/ai/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: t, found }) })
      .then((r) => r.json()).then((j) => { if (live) setAi(j.skip ? null : j); }).catch(() => { if (live) setAi({ error: "The AI couldn't answer right now." }); });
    return () => { live = false; };
  }, [pending, loading, q0]); // eslint-disable-line react-hooks/exhaustive-deps

  // the card's numbers for the best customer: all their orders, not only the ones the words found
  const card = useMemo(() => {
    if (!best) return null;
    const t0 = today();
    const mine = ours.filter((o) => o.customer_id === best.id);
    const pv = bestArch.filter((r) => r.customer_id === best.id);
    const inv = [...mine.filter((o) => o.type === "invoice").map((o) => ({ n: o.number, day: (o.created_at || "").slice(0, 10), total: o.total, bal: o.balance, done: o.status === "completed", due: o.due_date })),
      ...pv.filter((r) => r.kind !== "quote").map((r) => ({ n: +r.visual_id || 0, day: (r.order_date || "").slice(0, 10), total: +r.total || 0, bal: +r.balance || 0, done: true, due: r.due_date }))];
    const active = inv.filter((x) => !x.done);
    const next = active.filter((x) => x.due).sort((a, b) => (a.due || "").localeCompare(b.due || ""))[0];
    const owed = inv.filter((x) => x.bal > 0.004);
    const due = owed.reduce((s, x) => s + x.bal, 0);
    const late = owed.filter((x) => x.due && x.due < t0);
    const days = [...new Set(inv.map((x) => x.day).filter(Boolean))].sort().reverse();
    const last = inv.filter((x) => x.day === days[0]).sort((a, b) => b.n - a.n)[0];
    const gaps = days.slice(0, 11).map((d, i, a) => (i ? dd(a[i - 1], d) : 0)).slice(1).filter((g) => g > 0).sort((a, b) => a - b);
    const gap = gaps.length >= 2 ? gaps[Math.floor(gaps.length / 2)] : 0;
    const every = !gap ? "" : gap < 14 ? `Every ~${gap} days` : gap < 63 ? `Every ~${Math.round(gap / 7)} weeks` : gap < 300 ? `Every ~${Math.round(gap / 30.4)} months` : "About once a year";
    const nextAround = gap && days[0] ? new Date(Date.parse(days[0]) + gap * 86400000).toISOString().slice(0, 10) : "";
    const total = inv.reduce((s, x) => s + x.total, 0);
    return { active, next, due, owed, late, last, days, every, nextAround, total, n: inv.length, since: days.length ? days[days.length - 1].slice(0, 4) : "", t0 };
  }, [best, ours, bestArch]);

  const others = custs.filter((c) => c.id !== best?.id);
  const counts: Record<Kind, number> = { all: 0, customers: custs.length, orders: rows.length, artwork: art.length, messages: msgs.length, shipments: ships.length, projects: projs.length };
  counts.all = counts.customers + counts.orders + counts.artwork + counts.messages + counts.shipments + counts.projects;
  const show = (k: Kind) => (kind === "all" || kind === k) && counts[k] > 0;
  const shownRows = more ? rows : rows.slice(0, 25);
  const searching = loading || pending > 0;

  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Search</div><h1>{q0 ? `“${q0}”` : "Search everything"}</h1></div></div>
      <form className="srch-box" onSubmit={(e) => { e.preventDefault(); router.replace(`/shop/search?q=${encodeURIComponent(q.trim())}`); }}>
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} onDictated={(x) => { if (x.trim()) router.replace(`/shop/search?q=${encodeURIComponent(x.trim())}`); }} placeholder="Search everything" autoFocus aria-label="Search" />
        <button type="submit" className="btn primary">Search</button>
      </form>
      {t.length >= 2 && (
        <div className="toolbar">
          <div className="chips" role="tablist" aria-label="Show">
            {([["all", "All"], ["customers", "Customers"], ["orders", "Orders"], ["artwork", "Artwork"], ["messages", "Messages"], ["shipments", "Shipments"], ["projects", "Projects"]] as [Kind, string][])
              .filter(([k]) => k === "all" || counts[k] > 0 || kind === k)
              .map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={kind === k} className={"chip" + (kind === k ? " on" : "")} onClick={() => setKind(k)}>{l}<span className="chip-n">{counts[k]}</span></button>)}
          </div>
          {searching && <span className="faint">Searching…</span>}
        </div>
      )}
      {ai && !ai.off && !ai.skip && (
        <div className="sx-ai"><b>AI answer</b>{ai.busy ? <span className="faint">Thinking…</span> : ai.error ? <span className="bad">{ai.error}</span> : <span>{ai.answer}</span>}
          {!ai.busy && !!ai.refs?.length && <span className="sx-ai-refs">{ai.refs.map((r, i) => <Link key={i} href={r.href}>{r.label}</Link>)}</span>}
        </div>
      )}
      {t.length < 2 ? <div className="empty">Type a name, an order #, a PO, a logo or a tracking number.</div> : !searching && !counts.all ? <div className="empty">Nothing found for “{q0}”.</div> : null}

      {best && card && show("customers") && (
        <section className="sx-cust">
          <div className="sx-cust-h">
            <div className="sx-cust-t"><Link href={`/shop/customers/${best.id}`}><b>{best.company || best.name}</b></Link>
              <span className="faint">{[best.company ? best.name : "", best.email, best.phone, best.price_type === "wholesale" ? "Wholesale" : "Retail", PAY_TERMS[(best.payment_terms || "receipt") as PayTerms]].filter(Boolean).join(" · ")}</span></div>
            <Link className="btn" href={`/shop/customers/${best.id}`}>Open customer</Link>
          </div>
          <div className="stats">
            <button type="button" className="stat" onClick={() => setKind("orders")}><span className="k">In the works</span><span className="v">{card.active.length} job{card.active.length === 1 ? "" : "s"}</span><small>{card.next ? `#${card.next.n} due ${fmtDay(card.next.due)}` : card.active.length ? "No in-hands dates" : "Nothing in progress"}</small></button>
            <button type="button" className="stat money-only" onClick={() => router.push(`/shop/customers/${best.id}?area=payments`)}><span className="k">Balance</span><span className={"v" + (card.late.length ? " alert" : "")}>{card.due > 0.004 ? money(card.due) : "Paid up"}</span><small>{card.late.length ? `${money(card.late.reduce((s, x) => s + x.bal, 0))} past due on ${card.late.map((x) => "#" + x.n).slice(0, 3).join(", ")}` : card.owed.length ? card.owed.map((x) => "#" + x.n).slice(0, 3).join(", ") : PAY_TERMS[(best.payment_terms || "receipt") as PayTerms]}</small></button>
            <button type="button" className="stat" onClick={() => setKind("orders")}><span className="k">Last order</span><span className="v">{card.last ? fmtDay(card.last.day) : "None yet"}</span><small>{card.last ? `#${card.last.n} · ${dd(card.t0, card.last.day)} days ago` : ""}</small></button>
            <button type="button" className="stat" onClick={() => setKind("orders")}><span className="k">Orders about</span><span className="v">{card.every || "Not enough orders"}</span><small>{card.nextAround ? (card.nextAround < card.t0 ? `Due for one: ${dd(card.t0, card.nextAround)} days past usual` : `Next one around ${fmtDay(card.nextAround)}`) : ""}</small></button>
            <button type="button" className="stat money-only" onClick={() => router.push(`/shop/customers/${best.id}`)}><span className="k">Lifetime</span><span className="v">{money(card.total)}</span><small>{card.n} order{card.n === 1 ? "" : "s"}{card.since ? ` since ${card.since}` : ""}</small></button>
          </div>
        </section>
      )}

      {show("orders") && (
        <section className="sx-sec">
          <h3>Orders <span className="faint">{rows.length} · newest first · ours and Printavo&apos;s together</span></h3>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>#</th><th>Job</th><th>Customer</th><th>Status</th><th>Due</th><th className="r">Pcs</th><th className="r money-only">Total</th><th className="r money-only">Balance</th></tr></thead>
              <tbody>
                {shownRows.map((r) => (
                  <tr key={r.key} tabIndex={0} onClick={() => router.push(r.href)} onKeyDown={(e) => e.key === "Enter" && router.push(r.href)}>
                    <td><span className="ordno">{r.number}</span> <span className={"tag " + (r.quote ? "q" : "i")}>{r.quote ? "Quote" : "Inv"}</span></td>
                    <td><div className="sx-job"><span className="sx-th">{thumbs[r.key] ? <img src={thumbs[r.key]} alt="" /> : null}</span><span>{r.name}{r.archived && <span className="aa-arch">Printavo</span>}</span></div></td>
                    <td>{r.customer}</td>
                    <td>{r.archived ? <span className="pv-dot" style={{ ["--sc" as string]: r.color }}>{r.label}</span> : <Pill status={r.status} pv={r.pv} />}</td>
                    <td>{r.due ? <Due date={r.due} status={r.archived ? "completed" : r.status} /> : <span className="faint">No date</span>}</td>
                    <td className="r">{r.pcs}</td>
                    <td className="r money-only">{money(r.total)}</td>
                    <td className="r money-only"><span className={"bal" + (r.balance > 0.004 ? "" : " paid")}>{r.quote ? "" : r.balance > 0.004 ? money(r.balance) : "Paid"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 25 && !more && <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => setMore(true)}>Show all {rows.length}</button>}
        </section>
      )}

      {show("artwork") && (
        <section className="sx-sec">
          <h3>Artwork <span className="faint">{art.length}</span></h3>
          <div className="sx-art">{art.map((d) => (
            <Link key={d.id} href={`/shop/artwork/${d.id}`} className="sx-art-i"><span className="sx-art-p">{artUrls[d.id] ? <img src={artUrls[d.id]} alt="" /> : null}</span><b>D-{d.number} {d.name}</b><small className="faint">{custName(custMap[d.customer_id || ""])}</small></Link>
          ))}</div>
        </section>
      )}

      {show("messages") && (
        <section className="sx-sec">
          <h3>Messages <span className="faint">{msgs.length} · portal messages and texts that mention it</span></h3>
          <div className="tbl-wrap"><table className="tbl"><tbody>
            {msgs.map((m) => <tr key={m.key} onClick={() => router.push(m.href)}><td style={{ width: 70 }}><span className="tag">{m.kind}</span></td><td style={{ width: 160 }}><b>{m.who}</b></td><td className="sx-msg">{m.text}</td><td className="r">{fmtDay(m.when)}</td></tr>)}
          </tbody></table></div>
        </section>
      )}

      {show("shipments") && (
        <section className="sx-sec">
          <h3>Supplier shipments <span className="faint">{ships.length}</span></h3>
          <div className="tbl-wrap"><table className="tbl"><tbody>{ships.map((s, i) => <tr key={i} onClick={() => router.push(s.href)}><td><b>{s.title}</b></td><td className="faint">{s.sub}</td></tr>)}</tbody></table></div>
        </section>
      )}

      {show("projects") && (
        <section className="sx-sec">
          <h3>Projects <span className="faint">{projs.length}</span></h3>
          <div className="tbl-wrap"><table className="tbl"><tbody>{projs.map((p, i) => <tr key={i} onClick={() => router.push(p.href)}><td><b>{p.title}</b></td><td>{p.sub}</td><td><span className="tag">{p.tag}</span></td></tr>)}</tbody></table></div>
        </section>
      )}

      {show("customers") && (best ? others.length > 0 : custs.length > 0) && (
        <section className="sx-sec">
          <h3>{best ? "Other customers" : "Customers"} <span className="faint">{best ? others.length : custs.length}</span></h3>
          <div className="tbl-wrap"><table className="tbl"><tbody>
            {(best ? others : custs).map((c) => {
              const mine = ours.filter((o) => o.customer_id === c.id && o.type === "invoice");
              const st = otherStats[c.id] || { n: 0, total: 0, last: "" };
              const n = mine.length + st.n, tot = mine.reduce((s, o) => s + o.total, 0) + st.total;
              const last = [st.last, ...mine.map((o) => (o.created_at || "").slice(0, 10))].sort().reverse()[0] || "";
              return <tr key={c.id} onClick={() => router.push(`/shop/customers/${c.id}`)}><td><b>{c.company || c.name}</b></td><td className="faint">{[c.company ? c.name : "", c.email].filter(Boolean).join(" · ")}</td><td>{n ? `${n} order${n === 1 ? "" : "s"}${last ? ` · last ${fmtDay(last)}` : ""}` : "No orders yet"}</td><td className="r money-only">{n ? `${money(tot)} lifetime` : ""}</td></tr>;
            })}
          </tbody></table></div>
        </section>
      )}
    </>
  );
}

export default function SearchPage() {
  return <Suspense fallback={<div className="empty">Loading…</div>}><SearchInner /></Suspense>;
}
