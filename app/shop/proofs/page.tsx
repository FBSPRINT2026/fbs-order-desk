"use client";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import SearchInput from "@/components/SearchInput";
import SendProofTool from "@/components/tools/SendProofTool";
import type { Group } from "@/lib/pricing";

/**
 * Proofs (Oct 29, Nick: "add proofs underneath projects… a logger say like, oh, sent to customer… proof sent, request is
 * changed, present now… it all has to flow… organized by screen printing, embroidery, and heat press so that… you can
 * click in and see the proofs for each department, what's been approved, what's waiting").
 *
 * Every proof on the open orders, in one place: an order's art proof (its mockups, by version) and each sew-out, at the
 * station it's at (ready to send, waiting on the customer, changes asked, approved), by department. Opening one shows its
 * steps, read from the same records the order and the Digitizing page use (proofs, sewouts, the order's history), and
 * the next thing to do: send it (the preview first), copy its link, or open the order.
 */
type Dept = "screen" | "embroidery" | "heat";
type State = "ready" | "waiting" | "changes" | "approved";
type O = { id: string; number: number; nickname: string; status: string; due_date: string | null; groups: Group[] | null; customers: { company?: string; name?: string } | null };
type P = { id: string; order_id: string; version: number; status: "pending" | "approved" | "changes"; sent_at: string | null; sent_to: string | null; viewed_at: string | null; view_count: number; decided_at: string | null; decided_name: string | null; customer_comment: string; archived_at: string | null; mockup_id: string | null; approved_via: string | null; created_at: string };
type S = { id: string; order_id: string; imprint_id: string; version: number; status: "pending" | "approved" | "changes"; sent_at: string | null; sent_to: string | null; viewed_at: string | null; view_count: number; decided_at: string | null; decided_name: string | null; customer_comment: string; archived_at: string | null; created_at: string };
type Ev = { order_id: string; kind: string; detail: string; actor: string; created_at: string };
type Item = { key: string; kind: "art" | "sewout"; o: O; state: State; depts: Dept[]; what: string; where: string; at: string; sub: string; version: number; sw?: S; live?: P[] };

const STATIONS: [State, string, string, string, ReactNode][] = [
  ["ready", "Ready to send", "made, not sent yet", "var(--fbs-blue)", <svg key="r" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></svg>],
  ["waiting", "Waiting on the customer", "sent, no answer yet", "var(--warn)", <svg key="w" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 2h12M6 22h12M7 2c0 5 10 7 10 10S7 17 7 22M17 2c0 5-10 7-10 10s10 5 10 10" /></svg>],
  ["changes", "Changes asked", "make them, send again", "var(--danger)", <svg key="c" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>],
  ["approved", "Approved", "ready for production", "var(--ok)", <svg key="a" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3" /></svg>],
];
const DEPTS: [Dept | "all", string][] = [["all", "All"], ["screen", "Screen printing"], ["embroidery", "Embroidery"], ["heat", "Heat press"]];
const deptOf = (m?: string): Dept => (m === "embroidery" ? "embroidery" : m === "dtf" ? "heat" : "screen");
const day = (s?: string | null) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" }) : "");
const stamp = (s: string) => new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
const ART_EV = ["proofs_requested", "proof_reminder", "proof_approved", "proof_changes", "art_approved", "proof_restored", "proof_waiting"];
const SEW_EV = ["sewout_saved", "sewout_sent", "sewout_edited", "sewout_reminder", "sewout_approved", "sewout_changes"];
const EV_WORD: Record<string, string> = {
  proofs_requested: "Proof sent", proof_reminder: "Reminder sent", proof_approved: "Approved by the customer", proof_changes: "Changes asked", art_approved: "Approved another way",
  proof_restored: "Went back to an earlier proof", proof_waiting: "Waiting", sewout_saved: "Sew-out photo saved", sewout_sent: "Sew-out sent", sewout_edited: "Sew-out edited",
  sewout_reminder: "Reminder sent", sewout_approved: "Sew-out approved", sewout_changes: "Changes asked",
};

export default function ProofsPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [err, setErr] = useState(""), [msg, setMsg] = useState("");
  const [station, setStation] = useSticky<State>("proofs.station", "waiting");
  const [dept, setDept] = useSticky<Dept | "all">("proofs.dept", "all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [n, setN] = useState(0);

  useEffect(() => {
    let live = true;
    void (async () => {
      const sb = createClient();
      const { data, error } = await sb.from("orders").select("id, number, nickname, status, due_date, groups, customers(company, name)").not("status", "in", "(completed,request)").order("number", { ascending: false }).limit(500);
      if (error) { setErr(error.message); return; }
      const os = (data || []) as unknown as O[];
      const ids = os.map((o) => o.id);
      // a few orders at a time: the database hands back at most 1,000 rows a query (500 orders' mockups are more)
      const chunk = <T,>(f: (part: string[]) => PromiseLike<{ data: T[] | null }>) => Promise.all(Array.from({ length: Math.ceil(ids.length / 40) }, (_, i) => f(ids.slice(i * 40, i * 40 + 40)))).then((rs) => rs.flatMap((r) => r.data || []));
      const [ps, ms, sws, evs] = await Promise.all([
        chunk<P>((part) => sb.from("proofs").select("id, order_id, version, status, sent_at, sent_to, viewed_at, view_count, decided_at, decided_name, customer_comment, archived_at, mockup_id, approved_via, created_at").in("order_id", part).not("version", "is", null)),
        chunk<{ id: string; order_id: string }>((part) => sb.from("mockups").select("id, order_id").in("order_id", part).is("archived_at", null)),
        chunk<S>((part) => sb.from("sewouts").select("id, order_id, imprint_id, version, status, sent_at, sent_to, viewed_at, view_count, decided_at, decided_name, customer_comment, archived_at, created_at").in("order_id", part)),
        chunk<Ev>((part) => sb.from("order_events").select("order_id, kind, detail, actor, created_at").in("order_id", part).in("kind", [...ART_EV, ...SEW_EV]).order("created_at", { ascending: false }).limit(1000)),
      ]);
      if (!live) return;
      const out: Item[] = [];
      for (const o of os) {
        const gs = o.groups || [];
        const depts = [...new Set(gs.flatMap((g) => (g.imprints || []).map((im) => deptOf(im.method))))];
        // the art proof: the order's current mockups and the proof version out with the customer
        const mine = ps.filter((p) => p.order_id === o.id), cur = ms.filter((m) => m.order_id === o.id);
        const liveP = mine.filter((p) => !p.archived_at);
        const unsent = cur.length > 0 && cur.some((m) => !liveP.some((p) => p.mockup_id === m.id));
        const nextV = (mine.length ? Math.max(...mine.map((p) => p.version)) : 0) + 1;
        const prints = [...new Set(gs.flatMap((g) => (g.imprints || []).map((im) => im.location).filter(Boolean)))].join(", ");
        if (unsent) out.push({ key: `art:${o.id}`, kind: "art", o, state: "ready", depts, what: `Art proof · version ${nextV}`, where: prints, at: "", sub: liveP.length ? `Version ${liveP[0].version} was ${liveP.some((p) => p.status === "changes") ? "sent back for changes" : "sent"}` : "Mockups saved", version: nextV, live: liveP });
        else if (liveP.length) {
          const st: State = liveP.some((p) => p.status === "pending") ? "waiting" : liveP.some((p) => p.status === "changes") ? "changes" : "approved";
          const p0 = liveP.find((p) => p.decided_at) || liveP[0];
          const sub = st === "waiting" ? (p0.sent_to === "link copied" ? `Link copied ${day(p0.sent_at)}` : `Sent ${day(p0.sent_at)}`) + (p0.viewed_at ? ` · opened${p0.view_count > 1 ? ` ${p0.view_count}×` : ""}` : " · not opened yet")
            : st === "changes" ? `${p0.decided_name || "The customer"} · ${day(p0.decided_at)}` : `${p0.approved_via === "staff" ? "Another way" : p0.decided_name || "Approved"} · ${day(p0.decided_at)}${p0.customer_comment ? " · with a change" : ""}`;
          out.push({ key: `art:${o.id}`, kind: "art", o, state: st, depts, what: `Art proof · version ${liveP[0].version}`, where: prints, at: p0.decided_at || p0.sent_at || p0.created_at, sub, version: liveP[0].version, live: liveP });
        }
        // each print's sew-out (the newest)
        for (const g of gs) for (const im of g.imprints || []) {
          if (im.method !== "embroidery") continue;
          const s = sws.filter((x) => x.order_id === o.id && x.imprint_id === im.id).sort((a, b) => b.version - a.version)[0];
          if (!s || (s.archived_at && s.status === "pending")) continue;
          const st: State = s.status === "approved" ? "approved" : s.status === "changes" ? "changes" : s.sent_at ? "waiting" : "ready";
          const sub = st === "ready" ? `Photo saved ${day(s.created_at)}` : st === "waiting" ? `${s.sent_to === "link copied" ? "Link copied" : "Sent"} ${day(s.sent_at)}${s.viewed_at ? " · opened" : " · not opened yet"}` : `${s.decided_name || "The customer"} · ${day(s.decided_at)}`;
          out.push({ key: `sew:${s.id}`, kind: "sewout", o, state: st, depts: ["embroidery"], what: `Sew-out · version ${s.version}`, where: `${im.location}${im.size ? `, ${im.size}` : ""}`, at: s.decided_at || s.sent_at || s.created_at, sub, version: s.version, sw: s });
        }
      }
      setItems(out); setEvents(evs);
    })();
    return () => { live = false; };
  }, [n]);

  const inDept = (it: Item) => dept === "all" || it.depts.includes(dept);
  const match = (it: Item) => { const t = q.trim().toLowerCase(); return !t || `${it.o.number} ${it.o.nickname} ${it.o.customers?.company || ""} ${it.o.customers?.name || ""} ${it.where}`.toLowerCase().includes(t); };
  const count = (s: State) => (items || []).filter((it) => it.state === s && inDept(it)).length;
  const shown = useMemo(() => (items || []).filter((it) => it.state === station && inDept(it) && match(it)).sort((a, b) => (b.at || "").localeCompare(a.at || "") || b.o.number - a.o.number), [items, station, dept, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const deptCount = (d: Dept | "all") => (items || []).filter((it) => it.state === station && (d === "all" || it.depts.includes(d))).length;
  const after = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 6000); setN((x) => x + 1); };

  /** the steps of one proof, oldest first: the order's history for it, and when the customer opened it */
  const steps = (it: Item) => {
    const ev = events.filter((e) => e.order_id === it.o.id && (it.kind === "art" ? ART_EV : SEW_EV).includes(e.kind) && (it.kind === "art" || !it.where || e.detail.toLowerCase().includes(it.where.split(",")[0].toLowerCase()) || /^Sew-out v\d+(:|$| \()/.test(e.detail)));
    const rows = ev.map((e) => ({ at: e.created_at, what: EV_WORD[e.kind] || e.kind, detail: e.detail, who: e.actor, tone: /approved/.test(e.kind) ? "ok" : /changes/.test(e.kind) ? "bad" : "" }));
    const views = it.kind === "art" ? (it.live || []).filter((p) => p.viewed_at).slice(0, 1).map((p) => ({ at: p.viewed_at!, what: "Opened by the customer", detail: p.view_count > 1 ? `${p.view_count} times` : "", who: "", tone: "" })) : it.sw?.viewed_at ? [{ at: it.sw.viewed_at, what: "Opened by the customer", detail: it.sw.view_count > 1 ? `${it.sw.view_count} times` : "", who: "", tone: "" }] : [];
    return [...rows, ...views].sort((a, b) => a.at.localeCompare(b.at));
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Proof Center</h1><div className="eyebrow">Every proof and sew-out on the open orders: where it is, and what&apos;s next</div></div>
      </div>
      {err && <div className="pv-err">{err}</div>}
      {msg && <div className="pv-err sow-msg" role="status">{msg}</div>}
      <section className="panel">
        <div className="panel-b stack" style={{ gap: 12 }}>
          <div className="dgz-line prf-line" role="tablist" aria-label="Where each proof is">
            <div className="dgz-rail" aria-hidden />
            {STATIONS.map(([k, l, hint, c, icon]) => { const nn = count(k); return (
              <button key={k} type="button" role="tab" aria-selected={station === k} className={"dgz-stn" + (station === k ? " on" : "")} style={{ ["--c" as string]: c }} onClick={() => setStation(k)}>
                <span className="dgz-ring">{icon}<span className={"dgz-cnt" + (items && !nn ? " z" : "")}>{items ? nn : "…"}</span></span>
                <span className="dgz-nm">{l}</span><span className="dgz-hint">{hint}</span>
              </button>); })}
          </div>
          <div className="toolbar" data-toolbar>
            <div className="chips">{DEPTS.map(([k, l]) => <button key={k} type="button" className={"chip" + (dept === k ? " on" : "")} aria-pressed={dept === k} onClick={() => setDept(k)}>{l} <span className="pill-n">{items ? deptCount(k) : "…"}</span></button>)}</div>
            <SearchInput placeholder="Search order, customer or print" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {!items ? <div className="faint">Loading…</div> : !shown.length ? <div className="faint">{station === "ready" ? "Nothing waiting to be sent." : station === "waiting" ? "No proofs waiting on a customer." : station === "changes" ? "No changes asked." : "Nothing approved on the open orders."}</div> : (
            <div className="tbl-wrap"><table className="tbl prf">
              <thead><tr><th>Order</th><th>Proof</th><th>Department</th><th>Where it is</th></tr></thead>
              <tbody>{shown.map((it) => { const on = open === it.key; return (
                <Fragment key={it.key}>
                  <tr className={on ? "on" : ""} onClick={() => setOpen(on ? null : it.key)} style={{ cursor: "pointer" }}>
                    <td><Link className="ordno" href={`/shop/orders/${it.o.id}`} onClick={(e) => e.stopPropagation()}>#{it.o.number}</Link><div className="sub">{[it.o.customers?.company || it.o.customers?.name, it.o.nickname].filter(Boolean).join(" · ")}</div></td>
                    <td><b>{it.what}</b><div className="sub">{it.where}</div></td>
                    <td>{it.depts.map((d) => <span key={d} className={"prf-dept " + d}>{d === "screen" ? "SP" : d === "embroidery" ? "EMB" : "HP"}</span>)}</td>
                    <td><span className="pill" style={{ ["--sc" as string]: STATIONS.find((s) => s[0] === it.state)![3] }}><span className="pill-t">{STATIONS.find((s) => s[0] === it.state)![1]}</span></span><div className="sub">{it.sub}</div></td>
                  </tr>
                  {on && <tr className="prf-more"><td colSpan={4}>
                    <div className="prf-open">
                      <div className="prf-steps">
                        <div className="imp-l">Steps</div>
                        {steps(it).length ? <ol>{steps(it).map((x, i) => <li key={i} className={x.tone}><b>{x.what}</b><span>{stamp(x.at)}{x.who ? ` · ${x.who.split("@")[0]}` : ""}</span>{x.detail && <small>{x.detail}</small>}</li>)}</ol> : <div className="faint" style={{ fontSize: 12.5 }}>Nothing sent yet.</div>}
                      </div>
                      <div className="prf-acts">
                        {it.state === "ready" && <SendProofTool target={it.kind === "art" ? { kind: "art", orderId: it.o.id } : { kind: "sewout", orderId: it.o.id, sewoutId: it.sw!.id }} label={it.kind === "art" ? `Send version ${it.version}` : "Send to customer"} onDone={after} />}
                        {it.state === "ready" && it.kind === "art" && <SendProofTool target={{ kind: "art", orderId: it.o.id }} mode="copy" onDone={after} />}
                        {it.state === "waiting" && <SendProofTool target={it.kind === "art" ? { kind: "art", orderId: it.o.id, live: true } : { kind: "sewout", orderId: it.o.id, sewoutId: it.sw!.id }} mode="copy" onDone={after} />}
                        <a className="btn sm" href={it.kind === "art" ? `/print/${it.o.id}?proof=1` : `/print/${it.o.id}?sewout=${it.sw!.id}`} target="_blank" rel="noreferrer">PDF</a>
                        <Link className="btn sm" href={it.kind === "art" ? `/shop/orders/${it.o.id}?tab=prod` : "/shop/digitizing"}>{it.kind === "art" ? "Open the order" : "Open in Digitizing"}</Link>
                      </div>
                    </div>
                  </td></tr>}
                </Fragment>); })}</tbody>
            </table></div>
          )}
        </div>
      </section>
    </>
  );
}
