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
  const [tab, setTab] = useSticky<"pickup" | "deliver">("outbound.tab2", "pickup");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [perBox, setPerBox] = useState(72);
  const [mode, setMode] = useState<"" | "label" | "ship">("");
  const [q, setQ] = useState(""), [found, setFound] = useState<LookupJob[] | null>(null), [looking, setLooking] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [shipReq, setShipReq] = useState<{ n: string; at: number } | null>(null);
  const [busy, setBusy] = useState("");
  const qRef = useRef<HTMLInputElement>(null), scRef = useRef<HTMLDivElement>(null);

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
    if (t.length < 2) { setFound(null); return; }
    setLooking(true);
    const h = setTimeout(async () => {
      const r = await outboundLookup(t);
      setLooking(false);
      if (r.ok) setFound(r.jobs); else setMsg({ ok: false, text: r.error });
    }, 300);
    return () => clearTimeout(h);
  }, [q]);

  const of = (h: Row["how"]) => (rows || []).filter((r) => r.how === h);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const late = (rows || []).filter((r) => r.due && r.due.slice(0, 10) < today);
  const shelfOld = of("pickup").filter((r) => (daysSince(r.since) ?? 0) >= 5);

  async function pickedUp(ids: string[]) {
    setBusy(ids.join()); setMsg(null);
    const r = await markPickedUp(ids);
    setBusy("");
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setMsg({ ok: true, text: r.done === 1 ? "Marked picked up." : `${r.done} jobs marked picked up.` });
    setFound((f) => (f ? f.filter((j) => !ids.includes(j.id)) : f));
    void load();
  }
  function startShipping(n: string) {
    const num = n.trim().replace(/^#/, "").match(/\d{3,7}/)?.[0];
    if (!num) return setMsg({ ok: false, text: "Type or scan a job #." });
    if (!of("ship").some((r) => r.number === num)) return setMsg({ ok: false, text: `#${num} isn't ready to ship. It has to be Ready, with delivery by shipping.` });
    setMsg(null); setShipReq({ n: num, at: Date.now() }); setMode("");
  }

  const list = (rs: Row[], kind: "deliver" | "pickup") => (
    <div className="tbl-wrap"><table className="tbl">
      <thead><tr><th>Job</th><th>Customer</th><th>Pieces</th><th>In-hands</th><th>{kind === "pickup" ? "On the shelf" : "Ready since"}</th>{kind === "pickup" && <th />}</tr></thead>
      <tbody>{rs.map((r) => { const d = daysSince(r.since); return (
        <tr key={r.key}><td><Link className="ordno" href={r.href}>#{r.number}</Link><div className="sub">{r.job}</div></td><td>{r.customer}</td><td>{r.qty.toLocaleString()}</td>
          <td className={r.due && r.due.slice(0, 10) < today ? "ob-late" : ""}>{day(r.due)}</td>
          <td className={kind === "pickup" && (d ?? 0) >= 5 ? "ob-late" : ""}>{d == null ? "—" : d === 0 ? "today" : `${d} day${d === 1 ? "" : "s"}`}</td>
          {kind === "pickup" && <td className="r">{!r.printavo && <button type="button" className="btn sm" disabled={!!busy} onClick={() => void pickedUp([r.id])}>{busy === r.id ? "…" : "Picked up"}</button>}</td>}</tr>
      ); })}
      {!rs.length && <tr><td colSpan={kind === "pickup" ? 6 : 5} className="faint">{kind === "pickup" ? "Nothing on the pickup shelf." : "Nothing to deliver."}</td></tr>}</tbody>
    </table></div>
  );

  const sorted = useMemo(() => (found || []).slice().sort((a, b) => ORDER.indexOf(a.where) - ORDER.indexOf(b.where)), [found]);
  const onShelf = sorted.filter((j) => j.where === "shelf" && !j.printavo);
  const names = [...new Set(sorted.map((j) => j.customer))];
  // the job the top box points at (Nick, Nov 13: "once you put 50000 in the top line, it should auto fill the job"):
  // the one whose # was typed, the only one found, or the row clicked
  const [rowPick, setRowPick] = useState("");
  const typedNo = q.trim().replace(/^#/, "").match(/^\d{3,7}$/)?.[0] || "";
  const picked = sorted.find((j) => j.key === rowPick) || sorted.find((j) => j.number === typedNo) || (sorted.length === 1 ? sorted[0] : null);
  const jobNo = picked?.number || typedNo;
  useEffect(() => { setRowPick(""); }, [q]);
  function labels() { setMsg(null); setMode(mode === "label" ? "" : "label"); }
  function ship() {
    setMsg(null);
    if (jobNo) return startShipping(jobNo);
    setMode(mode === "ship" ? "" : "ship");
  }

  return (
    <>
      <div className="page-head"><div><h1>Outbound</h1><div className="eyebrow">Done printing and ready to leave: what ships, what we deliver, what&apos;s on the shelf for pickup</div></div></div>

      <div className="ob-act">
        <label className="ob-q">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
          <input ref={qRef} type="text" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Who's picking up? Customer, job # or PO" aria-label="Look up a customer, job # or PO" />
          {q && <button type="button" className="linkbtn" onClick={() => { setQ(""); qRef.current?.focus(); }}>Clear</button>}
        </label>
        <button type="button" className={"ob-big" + (mode === "label" ? " on" : "")} onClick={labels}>{Ico.box}Print box label{jobNo ? <small>#{jobNo}</small> : null}</button>
        <button type="button" className={"ob-big primary" + (mode === "ship" ? " on" : "")} onClick={ship}>{Ico.truck}Start shipping{jobNo ? <small>#{jobNo}</small> : null}</button>
      </div>
      {msg && <div className={"ob-msg" + (msg.ok ? " ok" : "")}>{msg.text}</div>}

      {mode === "label" && <LabelPanel key={jobNo} start={jobNo} perBox={perBox} onClose={() => setMode("")} />}
      {mode === "ship" && <ShipPanel ready={of("ship")} onShip={startShipping} onClose={() => setMode("")} />}

      {q.trim().length >= 2 && (
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
                <tr key={j.key} className={sorted.length > 1 && picked?.key === j.key ? "ob-picked" : undefined} onClick={sorted.length > 1 ? () => setRowPick(j.key) : undefined} style={sorted.length > 1 ? { cursor: "pointer" } : undefined}>
                  <td><Link className="ordno" href={j.href} onClick={(e) => e.stopPropagation()}>#{j.number}</Link><div className="sub">{j.job}</div></td>
                  {names.length > 1 && <td>{j.customer}</td>}
                  <td><span className={"ob-w " + WHERE[j.where][1]}>{WHERE[j.where][0]}</span>{j.note && <div className="sub">{j.note}</div>}</td>
                  <td>{j.qty.toLocaleString()}</td>
                  <td className={j.due && j.due.slice(0, 10) < today ? "ob-late" : ""}>{day(j.due)}</td>
                  <td className="r">
                    {j.where === "shelf" && !j.printavo && <button type="button" className="btn sm" disabled={!!busy} onClick={() => void pickedUp([j.id])}>{busy === j.id ? "…" : "Picked up"}</button>}
                    {j.where === "ship" && <button type="button" className="btn sm primary" onClick={() => startShipping(j.number)}>Ship</button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>
      )}

      <div className="stats">
        <button type="button" className="stat" onClick={() => setTab("pickup")}><span className="v">{rows ? of("pickup").length : "…"}</span><span className="k">On the pickup shelf</span></button>
        <button type="button" className="stat" onClick={() => setTab("pickup")}><span className={"v" + (shelfOld.length ? " alert" : "")}>{shelfOld.length}</span><span className="k">Waiting 5+ days</span></button>
        <button type="button" className="stat" onClick={() => scRef.current?.scrollIntoView({ behavior: "smooth" })}><span className="v">{rows ? of("ship").length : "…"}</span><span className="k">To ship</span></button>
        <button type="button" className="stat" onClick={() => setTab("deliver")}><span className="v">{rows ? of("deliver").length : "…"}</span><span className="k">To deliver</span></button>
        <button type="button" className="stat"><span className={"v" + (late.length ? " alert" : "")}>{late.length}</span><span className="k">Past in-hands</span></button>
      </div>
      <div className="toolbar ob-tabs"><div className="chips">
        {([["pickup", "Pickup shelf"], ["deliver", "Deliver"]] as const).map(([k, l]) => <button key={k} type="button" className={"chip" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{l}<span className="chip-n">{rows ? of(k).length : ""}</span></button>)}
      </div></div>
      {!rows ? <div className="faint">Loading…</div> : list(of(tab), tab)}

      <div className="ob-sc" ref={scRef}><ShippingCenter embedded shipReq={shipReq} /></div>
    </>
  );
}

/**
 * Print box label is a pop-up with the label itself (Nick, Nov 13: "it makes a pop-up and shows you the box label… then
 * you can just select how many from there"). The job typed in the top box comes in already found; the picture is the
 * label exactly as the Zebra prints it (`boxLabelSvg`, the same layout as the ZPL). Enter prints.
 */
type LabelJob = { kind: "o" | "a"; id: string; number: string; name: string; customer: string; qty: number };
function LabelPanel({ start, perBox, onClose }: { start: string; perBox: number; onClose: () => void }) {
  const [job, setJob] = useState(start), [card, setCard] = useState<LabelJob | null>(null), [svg, setSvg] = useState("");
  const [looking, setLooking] = useState(!!start), [missing, setMissing] = useState(false);
  const [boxes, setBoxes] = useState(1), [show, setShow] = useState(1), [only, setOnly] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const boxRef = useRef<HTMLInputElement>(null);
  const post = (body: Record<string, unknown>) => fetch("/api/print", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => ({})) })).catch(() => ({ ok: false, j: { error: "Offline. Try again." } as Record<string, string> }));
  // find the job (typed up top, or here)
  useEffect(() => {
    const num = job.trim().match(/\/j\/#?(\d{3,7})/)?.[1] || job.trim().replace(/^#/, "").match(/^(\d{3,7})(?:-\d+)?$/)?.[1];
    if (!num) { setCard(null); setSvg(""); setLooking(false); setMissing(false); return; }
    setLooking(true);
    const h = setTimeout(async () => {
      const r = await post({ action: "preview", job: num, boxes: 1 });
      setLooking(false);
      if (!r.ok || !r.j.job) { setCard(null); setSvg(""); setMissing(true); return; }
      setMissing(false); setCard(r.j.job); setBoxes(estimateBoxes(r.j.job.qty, perBox)); setShow(1);
      setTimeout(() => { boxRef.current?.focus(); boxRef.current?.select(); }, 30);
    }, start && job === start ? 0 : 300);
    return () => clearTimeout(h);
  }, [job, perBox]); // eslint-disable-line react-hooks/exhaustive-deps
  // the picture, for the box being shown
  useEffect(() => {
    if (!card) return;
    const h = setTimeout(async () => { const r = await post({ action: "preview", job: { kind: card.kind, id: card.id }, boxes, box: Math.min(show, boxes) }); if (r.ok && r.j.svg) setSvg(r.j.svg); }, 200);
    return () => clearTimeout(h);
  }, [card, boxes, show]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [busy, onClose]);
  async function print() {
    if (!card || busy) return;
    setBusy(true); setMsg(null);
    const r = await post({ action: "box", job: { kind: card.kind, id: card.id }, boxes, only: +only || undefined });
    setBusy(false); setMsg({ ok: r.ok && r.j.ok !== false, text: r.j.message || r.j.error || "Sent." });
  }
  const n = Math.min(show, boxes);
  const label = +only ? `Print box ${+only} of ${boxes}` : `Print ${boxes} label${boxes === 1 ? "" : "s"}`;
  return (
    <div className="pp-modal" role="dialog" aria-modal="true" aria-label="Print box labels" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="pp-sheet obl">
        <div className="pp-sheet-h"><b>Print box labels</b><button type="button" className="btn icon ghost" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="obl-body">
          <div className="obl-pic">
            {svg ? <div className="obl-label" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="obl-label obl-empty">{looking ? "Finding the job…" : "The label shows here"}</div>}
            {card && boxes > 1 && <div className="obl-flip"><button type="button" className="btn sm" disabled={n <= 1} onClick={() => setShow(n - 1)}>‹</button><span>Box {n} of {boxes}</span><button type="button" className="btn sm" disabled={n >= boxes} onClick={() => setShow(n + 1)}>›</button></div>}
          </div>
          <div className="obl-side">
            {card ? (
              <div className="obl-job"><b>#{card.number}</b><span>{card.customer}</span>{card.name && <span className="faint">{card.name}</span>}<span className="faint">{card.qty.toLocaleString()} pcs</span>
                <button type="button" className="linkbtn" onClick={() => { setJob(""); setCard(null); setSvg(""); }}>Another job</button></div>
            ) : (
              <label className="ob-f ob-f-job"><span>Job</span><input type="text" autoFocus value={job} onChange={(e) => setJob(e.target.value)} placeholder="Scan the work order or type the job #" />
                {missing && <small className="obl-miss">No job with that number.</small>}</label>
            )}
            <div className="obl-k">How many boxes?</div>
            <div className="obl-n">
              <button type="button" className="ob-step" aria-label="One fewer box" disabled={!card} onClick={() => setBoxes(Math.max(1, boxes - 1))}>−</button>
              <input ref={boxRef} type="number" min={1} max={99} value={boxes} disabled={!card} onChange={(e) => setBoxes(Math.max(1, Math.min(99, Math.round(+e.target.value) || 1)))} onKeyDown={(e) => { if (e.key === "Enter") void print(); }} aria-label="Boxes" />
              <button type="button" className="ob-step" aria-label="One more box" disabled={!card} onClick={() => setBoxes(Math.min(99, boxes + 1))}>+</button>
            </div>
            {card && <div className="faint">Guessed from the pieces, {perBox} a box.</div>}
            <label className="ob-f"><span>Only one box (reprint)</span><input type="number" min={1} max={99} value={only} disabled={!card} onChange={(e) => setOnly(e.target.value)} placeholder="All" /></label>
            <button type="button" className="btn primary obl-go" disabled={!card || busy} onClick={() => void print()}>{busy ? "Sending…" : label}</button>
            {msg && <div className={"ob-msg" + (msg.ok ? " ok" : "")}>{msg.text}</div>}
            {card?.kind === "o" && <a className="linkbtn obl-sheet" href={`/print/${card.id}/labels?boxes=${boxes}`} target="_blank" rel="noreferrer">Print on paper instead</a>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Pick or scan a job that's ready to ship; the Shipping Center below opens its ship window. */
function ShipPanel({ ready, onShip, onClose }: { ready: Row[]; onShip: (n: string) => void; onClose: () => void }) {
  const [v, setV] = useState("");
  const t = v.trim().toLowerCase().replace(/^#/, "");
  const shown = ready.filter((r) => !t || [r.number, r.customer, r.job].some((s) => s.toLowerCase().includes(t))).slice(0, 8);
  return (
    <section className="panel ob-pane">
      <div className="panel-h"><h2>Start shipping</h2><span className="faint">Rates, the label, and tracking emailed to the customer</span><span className="spacer" /><button type="button" className="linkbtn" onClick={onClose}>Close</button></div>
      <div className="panel-b">
        <div className="ob-form">
          <label className="ob-f ob-f-job"><span>Job</span><input type="text" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onShip(shown.length === 1 && !/^\d{3,7}$/.test(t) ? shown[0].number : v); }} placeholder="Scan a box label or work order, or type the job # or customer" /></label>
          <button type="button" className="btn primary" onClick={() => onShip(shown.length === 1 && !/^\d{3,7}$/.test(t) ? shown[0].number : v)}>Ship</button>
        </div>
        <div className="ob-picks">
          {shown.map((r) => <button key={r.key} type="button" className="ob-pick" onClick={() => onShip(r.number)}><b>#{r.number}</b><span>{r.customer}</span><small>{r.qty.toLocaleString()} pcs · {day(r.due)}</small></button>)}
          {!shown.length && <span className="faint">{ready.length ? "Nothing ready to ship matches that." : "Nothing is ready to ship right now."}</span>}
        </div>
      </div>
    </section>
  );
}
