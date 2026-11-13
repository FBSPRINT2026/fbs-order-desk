"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { custLabel } from "@/lib/format";
import { useSticky } from "@/lib/useSticky";
import { mergeSettings } from "@/lib/pricing";
import { estimateBoxes } from "@/lib/shipping";
import ShippingCenter from "@/components/shipping/ShippingCenter";
import { markPickedUp, outboundLookup, type LookupJob, type Where } from "./actions";

/**
 * Outbound (Nov 11 2026, Nick): everything done printing that has to leave the shop, by how it leaves: shipped (the
 * Shipping Center), delivered (our driver or a courier) or picked up off the shelf. One of the shop floor's three areas
 * with Receiving and Fulfillment, the same whatever SP / EMB / HP is picked.
 * The shipping computer's home, by the door (Nov 13, Nick): someone walks in, staff type their name and see every open
 * job of theirs and where it is; Print box label and Start shipping on top; the Shipping Center stays underneath.
 */
type Row = { key: string; id: string; href: string; number: string; job: string; customer: string; qty: number; due: string | null; since: string | null; printavo: boolean; how: "ship" | "deliver" | "pickup" };
const day = (d: string | null) => (d ? new Date(d.slice(0, 10) + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "—");
const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000)) : null);
const howOf = (s: string) => (/pick/i.test(s) ? "pickup" : /deliver|courier|drop/i.test(s) ? "deliver" : "ship") as Row["how"];
const WHERE: Record<Where, [string, string]> = {
  shelf: ["On the pickup shelf", "ob-w-shelf"], ship: ["Ready to ship", "ob-w-ship"], deliver: ["Ready to deliver", "ob-w-ship"],
  packing: ["Being packed", "ob-w-pack"], printing: ["Still printing", "ob-w-print"], waiting: ["Not started", "ob-w-print"],
};
const ORDER: Where[] = ["shelf", "ship", "deliver", "packing", "printing", "waiting"];
const Ico = { box: <svg viewBox="0 0 24 24"><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4M12 11v10" /></svg>, truck: <svg viewBox="0 0 24 24"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></svg> };

export default function Outbound() {
  const [tab, setTab] = useSticky<"ship" | "pickup" | "deliver">("outbound.tab3", "ship");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [perBox, setPerBox] = useState(72);
  const [q, setQ] = useState(""), [found, setFound] = useState<LookupJob[] | null>(null), [looking, setLooking] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [shipReq, setShipReq] = useState<{ n: string; at: number } | null>(null);
  const [labelFor, setLabelFor] = useState<{ n: string; at: number } | null>(null);
  const [scanned, setScanned] = useState<string>("");
  const [busy, setBusy] = useState("");
  const qRef = useRef<HTMLInputElement>(null);

  async function load() {
    const sb = createClient();
    const [n, p, st] = await Promise.all([
      sb.from("orders").select("id, number, nickname, qty, due_date, customer_id, delivery_method, updated_at").is("discarded_at", null).eq("status", "ready").order("due_date", { ascending: true, nullsFirst: false }).limit(500),
      sb.from("archived_orders").select("id, visual_id, nickname, qty, due_date, customer_id, status_name, updated_at, delivery:data->deliveryMethod").is("removed_at", null).ilike("status_name", "%ready to ship%").order("due_date", { ascending: true, nullsFirst: false }).limit(500),
      sb.from("settings").select("data").eq("id", 1).maybeSingle(),
    ]);
    setPerBox(mergeSettings(st.data?.data).ship.perBox || 72);
    type N = { id: string; number: number; nickname: string; qty: number; due_date: string | null; customer_id: string | null; delivery_method: string | null; updated_at: string };
    type P = { id: string; visual_id: string; nickname: string; qty: number; due_date: string | null; customer_id: string | null; updated_at: string; delivery: string | null };
    const ns = (n.data || []) as N[], ps = (p.data || []) as unknown as P[];
    const ids = [...new Set([...ns, ...ps].map((o) => o.customer_id).filter(Boolean))] as string[];
    const { data: cs } = ids.length ? await sb.from("customers").select("id, company, name").in("id", ids) : { data: [] };
    const cust = new Map(((cs || []) as { id: string; company: string; name: string }[]).map((c) => [c.id, custLabel(c)]));
    setRows([
      ...ns.map((o): Row => ({ key: "o" + o.id, id: o.id, href: `/shop/orders/${o.id}`, number: String(o.number), job: o.nickname || "", customer: cust.get(o.customer_id || "") || "—", qty: o.qty || 0, due: o.due_date, since: o.updated_at, printavo: false, how: howOf(o.delivery_method || "ship") })),
      ...ps.map((o): Row => ({ key: "a" + o.id, id: o.id, href: `/shop/archive/${o.id}`, number: o.visual_id, job: o.nickname || "", customer: cust.get(o.customer_id || "") || "—", qty: o.qty || 0, due: o.due_date, since: o.updated_at, printavo: true, how: howOf(String(o.delivery || "ship")) })),
    ]);
  }
  useEffect(() => { void load(); }, []);

  // the person at the door: look them up as they're typed
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2 || jobCode(t)) { setFound(null); return; }
    setLooking(true);
    const h = setTimeout(async () => {
      const r = await outboundLookup(t);
      setLooking(false);
      if (r.ok) setFound(r.jobs); else setMsg({ ok: false, text: r.error });
    }, 300);
    return () => clearTimeout(h);
  }, [q]);

  // a label or work order scanned anywhere on the page (Nick, Nov 13: "I have the window open and I scanned a label…
  // it's going to ask me what to do"): the scanner types fast and ends with Enter; outside a box, catch it and ask
  useEffect(() => {
    let buf = "", last = 0;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const now = Date.now();
      if (now - last > 120) buf = "";
      last = now;
      if (e.key === "Enter") { const n = jobCode(buf); buf = ""; if (n) { e.preventDefault(); setScanned(n); } return; }
      if (e.key.length === 1) buf += e.key;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const of = (h: Row["how"]) => (rows || []).filter((r) => r.how === h);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  async function pickedUp(ids: string[]) {
    setBusy(ids.join()); setMsg(null);
    const r = await markPickedUp(ids);
    setBusy("");
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setMsg({ ok: true, text: r.done === 1 ? "Marked picked up." : `${r.done} jobs marked picked up.` });
    setFound((f) => (f ? f.filter((j) => !ids.includes(j.id)) : f));
    void load();
  }
  /** "" when the ship window opens, else why it can't */
  function startShipping(n: string): string {
    const num = n.trim().replace(/^#/, "").match(/\d{3,7}/)?.[0];
    if (!num) return "Type or scan a job #.";
    if (!of("ship").some((r) => r.number === num)) return `#${num} isn't ready to ship. It has to be Ready, with delivery by shipping.`;
    setMsg(null); setTab("ship"); setShipReq({ n: num, at: Date.now() });
    return "";
  }
  const shipOrSay = (n: string) => { const why = startShipping(n); if (why) setMsg({ ok: false, text: why }); };
  const label = (n: string) => setLabelFor({ n, at: Date.now() });

  const list = (rs: Row[], kind: "deliver" | "pickup") => (
    <div className="tbl-wrap ob-tblw"><table className="tbl">
      <thead><tr><th>Job</th><th>Customer</th><th>Pieces</th><th>In-hands</th><th>{kind === "pickup" ? "On the shelf" : "Ready since"}</th><th /></tr></thead>
      <tbody>{rs.map((r) => { const d = daysSince(r.since); return (
        <tr key={r.key}><td><Link className="ordno" href={r.href}>#{r.number}</Link><div className="sub">{r.job}</div></td><td>{r.customer}</td><td>{r.qty.toLocaleString()}</td>
          <td className={r.due && r.due.slice(0, 10) < today ? "ob-late" : ""}>{day(r.due)}</td>
          <td className={kind === "pickup" && (d ?? 0) >= 5 ? "ob-late" : ""}>{d == null ? "—" : d === 0 ? "today" : `${d} day${d === 1 ? "" : "s"}`}</td>
          <td className="r"><button type="button" className="btn sm" onClick={() => label(r.number)}>Label</button>{" "}{kind === "pickup" && !r.printavo && <button type="button" className="btn sm" disabled={!!busy} onClick={() => void pickedUp([r.id])}>{busy === r.id ? "…" : "Picked up"}</button>}</td></tr>
      ); })}
      {!rs.length && <tr><td colSpan={6} className="faint">{kind === "pickup" ? "Nothing on the pickup shelf." : "Nothing to deliver."}</td></tr>}</tbody>
    </table></div>
  );

  const sorted = useMemo(() => (found || []).slice().sort((a, b) => ORDER.indexOf(a.where) - ORDER.indexOf(b.where)), [found]);
  const onShelf = sorted.filter((j) => j.where === "shelf" && !j.printavo);
  const names = [...new Set(sorted.map((j) => j.customer))];

  return (
    <div className="ob-grid">
      <div className="page-head ob-head"><div><h1>Outbound</h1><div className="eyebrow">What&apos;s here and ready to leave: who&apos;s picking up, what ships, what we deliver</div></div></div>
      <div className="ob-left">
        <label className="ob-q">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
          <input ref={qRef} type="text" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { const n = jobCode(q); if (n) { e.preventDefault(); setScanned(n); setQ(""); } } }} placeholder="Who's picking up? Customer, job # or PO, or scan a label" aria-label="Look up a customer, job # or PO" />
          {q && <button type="button" className="linkbtn" onClick={() => { setQ(""); qRef.current?.focus(); }}>Clear</button>}
        </label>
        {msg && <div className={"ob-msg" + (msg.ok ? " ok" : "")}>{msg.text}</div>}

        {q.trim().length >= 2 && !jobCode(q) && (
          <section className="panel ob-who">
            <div className="panel-h">
              <h2>{names.length === 1 ? names[0] : `“${q.trim()}”`}</h2>
              <span className="faint">{looking && !found ? "Looking…" : `${sorted.length} open job${sorted.length === 1 ? "" : "s"}${onShelf.length ? ` · ${onShelf.length} on the shelf` : ""}`}</span>
              <span className="spacer" />
              {onShelf.length > 1 && <button type="button" className="btn primary" disabled={!!busy} onClick={() => void pickedUp(onShelf.map((j) => j.id))}>Mark all {onShelf.length} picked up</button>}
            </div>
            {found && !sorted.length ? <div className="panel-b faint">No open jobs for “{q.trim()}”. Check the spelling, or try the job # or PO.</div> : (
              <table className="tbl">
                <thead><tr><th>Job</th>{names.length > 1 && <th>Customer</th>}<th>Where it is</th><th>Pieces</th><th>In-hands</th><th /></tr></thead>
                <tbody>{sorted.map((j) => (
                  <tr key={j.key}>
                    <td><Link className="ordno" href={j.href}>#{j.number}</Link><div className="sub">{j.job}</div></td>
                    {names.length > 1 && <td>{j.customer}</td>}
                    <td><span className={"ob-w " + WHERE[j.where][1]}>{WHERE[j.where][0]}</span>{j.note && <div className="sub">{j.note}</div>}</td>
                    <td>{j.qty.toLocaleString()}</td>
                    <td className={j.due && j.due.slice(0, 10) < today ? "ob-late" : ""}>{day(j.due)}</td>
                    <td className="r">
                      <button type="button" className="btn sm" onClick={() => label(j.number)}>Label</button>{" "}
                      {j.where === "shelf" && !j.printavo && <button type="button" className="btn sm" disabled={!!busy} onClick={() => void pickedUp([j.id])}>{busy === j.id ? "…" : "Picked up"}</button>}
                      {j.where === "ship" && <button type="button" className="btn sm primary" onClick={() => shipOrSay(j.number)}>Ship</button>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </section>
        )}

        <nav className="aa-nav ot-nav ob-nav" aria-label="Outbound">
          {([["ship", "Ship", of("ship").length], ["pickup", "Pickup shelf", of("pickup").length], ["deliver", "Delivery", of("deliver").length]] as const).map(([k, l, n]) =>
            <button key={k} type="button" className={"aa-tab" + (tab === k ? " on" : "")} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}><span className="ot-l">{l}</span>{rows && n > 0 && <span className="aa-n">{n}</span>}</button>)}
        </nav>
        {/* the Shipping Center stays mounted so its ship window can open from a scan on any tab */}
        <div hidden={tab !== "ship"}><ShippingCenter embedded shipReq={shipReq} /></div>
        {tab !== "ship" && (!rows ? <div className="faint">Loading…</div> : list(of(tab), tab))}
      </div>

      <aside className="ob-right"><LabelPanel pick={labelFor} perBox={perBox} /></aside>

      {scanned && <ScanChoice n={scanned} onClose={() => setScanned("")} onLabel={() => { label(scanned); setScanned(""); }} onShip={() => { const why = startShipping(scanned); if (!why) setScanned(""); return why; }} />}
    </div>
  );
}

/** a scanned or typed job: the QR's link ("…/j/50000-2"), "50000-2" or "#50000" → "50000" */
function jobCode(t: string): string {
  const s = t.trim();
  return s.match(/\/j\/#?(\d{3,7})(?:-\d{1,3})?/)?.[1] || s.match(/^#?(\d{3,7})(?:-\d{1,3})?$/)?.[1] || "";
}

/** After a scan: what to do with this job (Nick, Nov 13). */
function ScanChoice({ n, onClose, onLabel, onShip }: { n: string; onClose: () => void; onLabel: () => void; onShip: () => string }) {
  const [job, setJob] = useState<LabelJob | null>(null), [missing, setMissing] = useState(false), [why, setWhy] = useState("");
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    void fetch("/api/print", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", job: n, boxes: 1 }) })
      .then((r) => r.json()).then((j) => (j.job ? setJob(j.job) : setMissing(true))).catch(() => setMissing(true));
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="pp-modal" role="dialog" aria-modal="true" aria-label={`Job #${n}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pp-sheet obs">
        <div className="pp-sheet-h"><b>#{n}</b><button type="button" className="btn icon ghost" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="obs-b">
          <div className="obs-job">{job ? <><b>{job.customer}</b><span>{job.name}</span><span className="faint">{job.qty.toLocaleString()} pcs</span></> : missing ? <span className="obl-miss">No job with that number.</span> : <span className="faint">Finding the job…</span>}</div>
          <div className="obs-acts">
            <button ref={first} type="button" className="obs-go" disabled={missing} onClick={onLabel}>{Ico.box}<span>Print box label</span></button>
            <button type="button" className="obs-go primary" disabled={missing} onClick={() => setWhy(onShip())}>{Ico.truck}<span>Start shipping</span></button>
          </div>
          {why && <div className="ob-msg">{why}</div>}
          {job && <a className="linkbtn obs-open" href={job.kind === "o" ? `/shop/orders/${job.id}` : `/shop/archive/${job.id}`}>Open the job</a>}
        </div>
      </div>
    </div>
  );
}

/**
 * The box label tool, always open on the right (Nick, Nov 13: "on the right panel, just a simple box label tool where you
 * fill it out"): scan or type the job, or press Label on any row or after a scan; the picture is the label exactly as
 * the Zebra prints it (`boxLabelSvg`, the same layout as the ZPL); how many, and the box count when it's known. Enter prints.
 */
type LabelJob = { kind: "o" | "a"; id: string; number: string; name: string; customer: string; qty: number };
function LabelPanel({ pick, perBox }: { pick: { n: string; at: number } | null; perBox: number }) {
  // typed into the box (q) vs the job picked from the list, scanned or sent here (num): nothing below the box shows
  // until a job is picked (Nick, Nov 13: "start typing and you should select it from the list below… then it drops it down")
  const [q, setQ] = useState(""), [num, setNum] = useState(pick?.n || ""), [hi, setHi] = useState(0);
  const [card, setCard] = useState<LabelJob | null>(null), [svg, setSvg] = useState("");
  const [looking, setLooking] = useState(!!pick?.n), [missing, setMissing] = useState("");
  const [jobs, setJobs] = useState<{ number: string; customer: string; name: string }[]>([]);
  const [boxes, setBoxes] = useState(1), [show, setShow] = useState(1), [only, setOnly] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // most days the box count isn't known until packing is done: labels print "BOX ___ OF ___" unless this is ticked
  const [known, setKnown] = useState(false);
  const boxRef = useRef<HTMLInputElement>(null);
  const post = (body: Record<string, unknown>) => fetch("/api/print", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => ({})) })).catch(() => ({ ok: false, j: { error: "Offline. Try again." } as Record<string, string> }));
  // the jobs to pick from: everything open, newest first (approved through ready, and old Printavo jobs that are ready)
  useEffect(() => {
    void (async () => {
      const sb = createClient();
      const [o, a] = await Promise.all([
        sb.from("orders").select("number, nickname, customer_id").is("discarded_at", null).in("status", ["approved", "production", "fulfillment", "ready"]).order("number", { ascending: false }).limit(800),
        sb.from("archived_orders").select("visual_id, nickname, customer_id").is("removed_at", null).ilike("status_name", "%ready%").limit(300),
      ]);
      type O = { number: number; nickname: string; customer_id: string | null }; type A = { visual_id: string; nickname: string; customer_id: string | null };
      const os = (o.data || []) as O[], as = (a.data || []) as A[];
      const ids = [...new Set([...os, ...as].map((x) => x.customer_id).filter(Boolean))] as string[];
      const cust = new Map<string, string>();
      for (let i = 0; i < ids.length; i += 200) { const { data } = await sb.from("customers").select("id, company, name").in("id", ids.slice(i, i + 200)); for (const c of (data || []) as { id: string; company: string; name: string }[]) cust.set(c.id, custLabel(c)); }
      setJobs([...os.map((x) => ({ number: String(x.number), customer: cust.get(x.customer_id || "") || "", name: x.nickname || "" })), ...as.map((x) => ({ number: x.visual_id, customer: cust.get(x.customer_id || "") || "", name: x.nickname || "" }))]);
    })();
  }, []);
  const t = q.trim().toLowerCase().replace(/^#/, "");
  const matches = !t || jobCode(q).length && /\//.test(q) ? [] : jobs.filter((j) => (/^\d+$/.test(t) ? j.number.startsWith(t) : `${j.customer} ${j.name}`.toLowerCase().includes(t))).slice(0, 8);
  function choose(n: string) { setNum(n); setQ(""); setHi(0); setMsg(null); }
  function enter() {
    const m = matches[Math.min(hi, matches.length - 1)];
    if (m && !/\//.test(q)) return choose(m.number);
    const code = jobCode(q);
    if (code) choose(code);
  }
  // a job sent here (Label on a row, or a scan)
  useEffect(() => { if (pick) choose(pick.n); }, [pick?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  // the picked job
  useEffect(() => {
    if (!num) { setCard(null); setSvg(""); setLooking(false); return; }
    setLooking(true); setMissing("");
    void (async () => {
      const r = await post({ action: "preview", job: num, boxes: 1 });
      setLooking(false);
      if (!r.ok || !r.j.job) { setCard(null); setSvg(""); setMissing(num); setNum(""); return; }
      setCard(r.j.job); setBoxes(estimateBoxes(r.j.job.qty, perBox)); setShow(1); setKnown(false); setOnly("");
      setTimeout(() => { boxRef.current?.focus(); boxRef.current?.select(); }, 30);
    })();
  }, [num, perBox]); // eslint-disable-line react-hooks/exhaustive-deps
  // the picture, for the box being shown
  useEffect(() => {
    if (!card) return;
    const h = setTimeout(async () => { const r = await post({ action: "preview", job: { kind: card.kind, id: card.id }, boxes, known, box: Math.min(show, boxes) }); if (r.ok && r.j.svg) setSvg(r.j.svg); }, 200);
    return () => clearTimeout(h);
  }, [card, boxes, show, known]); // eslint-disable-line react-hooks/exhaustive-deps
  async function print() {
    if (!card || busy) return;
    setBusy(true); setMsg(null);
    const r = await post({ action: "box", job: { kind: card.kind, id: card.id }, boxes, known, only: known ? +only || undefined : undefined });
    setBusy(false); setMsg({ ok: r.ok && r.j.ok !== false, text: r.j.message || r.j.error || "Sent." });
  }
  const n = Math.min(show, boxes);
  const label = known && +only ? `Print box ${+only} of ${boxes}` : `Print ${boxes} label${boxes === 1 ? "" : "s"}`;
  return (
    <section className="panel obl-panel">
      <div className="panel-h"><h2>Box label</h2>{card && <><span className="spacer" /><button type="button" className="linkbtn" onClick={() => { setNum(""); setCard(null); setSvg(""); setMsg(null); }}>Another job</button></>}</div>
      <div className="panel-b obl-side">
        {card ? (
          <div className="obl-job"><b>#{card.number}</b><span>{card.customer}</span>{card.name && <span className="faint">{card.name}</span>}</div>
        ) : (
          <div className="obl-find">
            <input type="text" value={q} autoComplete="off" onChange={(e) => { setQ(e.target.value); setHi(0); setMissing(""); }}
              onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, matches.length - 1)); } else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); } else if (e.key === "Enter") { e.preventDefault(); enter(); } }}
              placeholder="Job #, customer or job name" aria-label="Find the job for the label" />
            {matches.length > 0 && <ul className="obl-dd" role="listbox">{matches.map((m, i) => (
              <li key={m.number} role="option" aria-selected={i === hi} className={i === hi ? "on" : undefined} onMouseDown={(e) => { e.preventDefault(); choose(m.number); }} onMouseEnter={() => setHi(i)}>
                <b>#{m.number}</b><span>{m.customer}</span>{m.name && <small>{m.name}</small>}</li>))}</ul>}
            {looking ? <small className="faint">Finding #{num}…</small> : missing ? <small className="obl-miss">No job #{missing}.</small> : t && !matches.length && !jobCode(q) ? <small className="faint">No open job matches. Type the whole # and press Enter for any job.</small> : null}
          </div>
        )}
        {card && <>
        <div className="obl-pic">
          {svg ? <div className="obl-label" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="obl-label obl-empty">{looking ? "Finding the job…" : "The label shows here"}</div>}
          {card && known && boxes > 1 && <div className="obl-flip"><button type="button" className="btn sm" disabled={n <= 1} onClick={() => setShow(n - 1)}>‹</button><span>Box {n} of {boxes}</span><button type="button" className="btn sm" disabled={n >= boxes} onClick={() => setShow(n + 1)}>›</button></div>}
        </div>
        <div className="obl-k">How many labels?</div>
        <div className="obl-n">
          <button type="button" className="ob-step" aria-label="One fewer label" disabled={!card} onClick={() => setBoxes(Math.max(1, boxes - 1))}>−</button>
          <input ref={boxRef} type="number" min={1} max={99} value={boxes} disabled={!card} onChange={(e) => setBoxes(Math.max(1, Math.min(99, Math.round(+e.target.value) || 1)))} onKeyDown={(e) => { if (e.key === "Enter") void print(); }} aria-label="Labels" />
          <button type="button" className="ob-step" aria-label="One more label" disabled={!card} onClick={() => setBoxes(Math.min(99, boxes + 1))}>+</button>
        </div>
        <label className="obl-kb"><input type="checkbox" checked={known} onChange={(e) => setKnown(e.target.checked)} /> I know my box count</label>
        {/* what each label will say, as little boxes (Nick, Nov 13: "a simple graphic… 1 of 2, 2 of 2"; for the crew who don't read English) */}
        <div className="obl-boxes" aria-label={known ? `Box 1 of ${boxes} to box ${boxes} of ${boxes}` : "Box ___ of ___"} data-notranslate>
          {Array.from({ length: Math.min(boxes, 10) }, (_, i) => <span key={i} className={"obl-bx" + (known ? "" : " blank")}>{BoxIcon}<b>{known ? `${i + 1}/${boxes}` : "__/__"}</b></span>)}
          {boxes > 10 && <span className="obl-more">+{boxes - 10}</span>}
        </div>
        {known && <label className="ob-f"><span>Only one box (reprint)</span><input type="number" min={1} max={99} value={only} disabled={!card} onChange={(e) => setOnly(e.target.value)} placeholder="All" /></label>}
        <button type="button" className="btn primary obl-go" disabled={!card || busy} onClick={() => void print()}>{busy ? "Sending…" : label}</button>
        {msg && <div className={"ob-msg" + (msg.ok ? " ok" : "")}>{msg.text}</div>}
        {card?.kind === "o" && <a className="linkbtn obl-sheet" href={`/print/${card.id}/labels?boxes=${boxes}`} target="_blank" rel="noreferrer">Print on paper instead</a>}
        </>}
      </div>
    </section>
  );
}

const BoxIcon = <svg viewBox="0 0 24 24" aria-hidden><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4M12 11v10" /></svg>;
