"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import type { Group } from "@/lib/pricing";
import { estimate, fmtMin, garmentKind, mergeProduction, quickNeed, type ProductionSettings, type QuickJob } from "@/lib/production";
import { guessHex, lineColor } from "@/lib/mockup";
import { isDarkHex } from "@/lib/neckLabels";
import MenuItem from "@/components/MenuItem";
import type { HoldAsk } from "@/components/MachineSchedule";

const MachineSchedule = dynamic(() => import("@/components/MachineSchedule"), { ssr: false });

/**
 * Production holder (Nov 10, Nick: "when you hold the spot, the tool should read the order and go, okay, I know half of
 * these are sweatshirts… confirm these details… what do you think the colors will be"; it replaced Hold the spot, Nov 9).
 * Saves press time for a quote before its art is in. It reads the order (each garment's pieces, kind and darkness, the
 * due date) and guesses the rest: the decoration and the print spots from the order's prints, else its art files' names
 * (FRONT / BACK / SLEEVE), else the customer's past orders; the colors at each spot the same way. Staff fix what's off and
 * hold it; the schedule (components/MachineSchedule.tsx, hidden mode) finds the spot just in time for the due date, the
 * art and details are due three working days before, and when the quote is approved the hold becomes its booking.
 * Opened from the order page's Production menu; a held spot shows as a small tag in the order's header. Orders made from
 * the same email that have no hold yet can be held the same way in one go.
 */
type Method = QuickJob["method"];
type Held = { id: string; details_due: string | null; machine: string; day: string } | null;
type OrderLite = { id: string; number: number; nickname: string | null; due_date: string | null; groups: Group[]; customer_id?: string | null };
type Loc = { name: string; colors: string };
const day = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const COLORS = ["1", "2", "3", "4+", "?"] as const;
const SPOTS = ["Full Front", "Full Back", "Left Chest", "Right Chest", "Left Sleeve", "Right Sleeve", "Back Neck", "Pocket", "Left Leg", "Hood"];
/** a print spot named in a file's name ("GOODNEWSCLUB-BACKSCREEN.pdf", "Front Left Chest") */
const spotIn = (name: string): string | null => {
  const n = name.toUpperCase().replace(/[_\-.]+/g, " ");
  if (/LEFT\s*CHEST|\bLC\b/.test(n)) return "Left Chest";
  if (/RIGHT\s*CHEST/.test(n)) return "Right Chest";
  if (/LEFT\s*SLEEVE|\bLS\b(?!\d)/.test(n)) return "Left Sleeve";
  if (/RIGHT\s*SLEEVE/.test(n)) return "Right Sleeve";
  if (/SLEEVE/.test(n)) return "Left Sleeve";
  if (/NECK|NAPE/.test(n)) return "Back Neck";
  if (/BACK/.test(n)) return "Full Back";
  if (/FRONT/.test(n)) return "Full Front";
  return null;
};
const nColors = (c: string) => (c === "?" ? 2 : c === "4+" ? 4 : Math.max(1, +c || 2));
const methodOf = (m?: string): Method => (m === "embroidery" ? "embroidery" : m && ["dtf", "dtg", "heat"].includes(m) ? "heat" : "screen");

/** an order's garments as the schedule plans them: each line's pieces, kind (tee / heavy / bag / cap) and darkness */
function partsOf(gs: Group[]) {
  return gs.flatMap((g) => g.lines).map((l) => {
    const qty = Object.values(l.sizes || {}).reduce((a, n) => a + (+(n as number) || 0), 0);
    const text = [l.brand, l.style, l.garment].filter(Boolean).join(" ");
    const hex = guessHex(lineColor(l));
    return { qty, garment: garmentKind(text), dark: hex ? isDarkHex(hex) : true, label: [l.brand, l.style].filter(Boolean).join(" ") || l.garment || "Garment", kind: garmentKind(text) };
  }).filter((p) => p.qty > 0);
}
const KIND = { tee: "tees", heavy: "sweatshirts / hoodies", bag: "bags", cap: "caps" } as const;

/** the job the schedule plans from this order and these answers */
function specOf(o: OrderLite, method: Method, locs: Loc[]): QuickJob | null {
  const parts = partsOf(o.groups);
  const qty = parts.reduce((a, p) => a + p.qty, 0);
  if (!qty || !locs.length) return null;
  const main = [...parts].sort((a, b) => b.qty - a.qty)[0];
  return { method, qty, garment: main.garment, dark: main.dark, parts: parts.map(({ qty: q, garment, dark }) => ({ qty: q, garment, dark })),
    locations: locs.map((l) => ({ name: l.name, colors: method === "screen" ? nColors(l.colors) : 1, stitches: method === "embroidery" ? 8000 : 0 })) };
}

export default function ProductionHolder({ order, customer, chip }: { order: OrderLite; customer: string; /** the header tag only (shown when a spot is held) */ chip?: boolean }) {
  const sb = useMemo(() => createClient(), []);
  const [held, setHeld] = useState<Held>(null), [machines, setMachines] = useState<Record<string, string>>({});
  const [ps, setPs] = useState<ProductionSettings | null>(null);
  const [open, setOpen] = useState(false), [ask, setAsk] = useState<HoldAsk | null>(null), [msg, setMsg] = useState(""), [err, setErr] = useState("");
  const imps = (order.groups || []).flatMap((g) => g.imprints || []);
  const [method, setMethod] = useState<Method>(methodOf(imps[0]?.method));
  const [locs, setLocs] = useState<Loc[]>([]), [why, setWhy] = useState(""), [art, setArt] = useState(imps.some((i) => i.design_id) ? "ready" : "coming");
  const [adding, setAdding] = useState(false);
  // the other orders made from the same email with no hold yet (Fisher's five designs, one email)
  const [sibs, setSibs] = useState<OrderLite[]>([]);

  const load = useCallback(async () => {
    const { data: h } = await sb.from("production_holds").select("id, details_due").eq("order_id", order.id).eq("status", "planned").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!h) { setHeld(null); return; }
    const { data: sl } = await sb.from("production_slots").select("machine, day").eq("hold_id", h.id).order("day").limit(1).maybeSingle();
    setHeld({ id: h.id as string, details_due: (h.details_due as string) || null, machine: String(sl?.machine || ""), day: String(sl?.day || "") });
  }, [order.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!held?.machine || machines[held.machine] || !ps) return;
    setMachines(Object.fromEntries(ps.machines.map((x) => [x.id, x.name.split(" · ")[0]])));
  }, [held, ps, machines]);
  useEffect(() => { void sb.from("settings").select("data").eq("id", 1).maybeSingle().then(({ data }) => setPs(mergeProduction((data?.data as { production?: unknown } | null)?.production))); }, [sb]);

  // the guesses, worked out when the panel opens
  const guess = useCallback(async () => {
    // 1) the order's own prints
    const own = [...new Map(imps.filter((i) => i.location).map((i) => [i.location, i])).values()];
    if (own.length) { setLocs(own.map((i) => ({ name: i.location, colors: method === "screen" ? String(Math.min(4, +i.colors || 2)).replace("4", "4+") : "1" }))); setWhy("From the prints on the order."); return; }
    // 2) its art files' names (GOODNEWSCLUB-FRONTSCREEN.pdf, …-BACKSCREEN.pdf)
    const { data: af } = await sb.from("art_files").select("name, category").eq("order_id", order.id);
    const fromFiles = [...new Set(((af || []) as { name: string; category: string | null }[]).filter((f) => !/supplier|order_sheet|not_needed|po/i.test(f.category || "")).map((f) => spotIn(f.name)).filter(Boolean) as string[])];
    // 3) the customer's recent orders: their usual spots, decoration and colors
    let past: { loc: string; colors: number; method: string }[] = [];
    if (order.customer_id) {
      const { data: os } = await sb.from("orders").select("groups").eq("customer_id", order.customer_id).neq("id", order.id).is("discarded_at", null).order("created_at", { ascending: false }).limit(15);
      past = ((os || []) as { groups: Group[] | null }[]).flatMap((x) => (x.groups || []).flatMap((g) => (g.imprints || []).map((i) => ({ loc: i.location, colors: +i.colors || 0, method: i.method }))).filter((x) => x.loc));
    }
    const pm = past.length ? [...past.reduce((m, x) => m.set(methodOf(x.method), (m.get(methodOf(x.method)) || 0) + 1), new Map<Method, number>())].sort((a, b) => b[1] - a[1])[0][0] : null;
    const m = imps.length ? method : pm || method;
    if (!imps.length && pm) setMethod(pm);
    const colorAt = (loc: string) => {
      const cs = past.filter((x) => x.loc === loc && x.colors > 0).map((x) => x.colors).sort((a, b) => a - b);
      const all = past.filter((x) => x.colors > 0).map((x) => x.colors).sort((a, b) => a - b);
      const med = (cs.length ? cs : all)[Math.floor((cs.length ? cs : all).length / 2)];
      return m !== "screen" ? "1" : med ? (med >= 4 ? "4+" : String(med)) : "?";
    };
    const usual = [...past.reduce((mm, x) => mm.set(x.loc, (mm.get(x.loc) || 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).map(([l]) => l);
    const names = fromFiles.length ? fromFiles : usual.length ? usual.slice(0, 2) : [m === "embroidery" ? "Left Chest" : "Full Front"];
    setLocs(names.map((n) => ({ name: n, colors: colorAt(n) })));
    setWhy(`${fromFiles.length ? "Spots from the art files' names" : usual.length ? "Spots from their recent orders" : "No prints or art yet"}; ${m !== "screen" ? "" : past.length ? `colors from their recent orders (${past.length} prints).` : "colors not known yet."}`.replace(/; $/, "."));
  }, [order.id, order.customer_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const findSibs = useCallback(async () => {
    const { data: me } = await sb.from("ai_suggestions").select("dedupe_key").eq("order_id", order.id).like("dedupe_key", "email:%:order%").limit(1).maybeSingle();
    const anchor = String(me?.dedupe_key || "").match(/^email:([^:]+):order/)?.[1];
    if (!anchor) { setSibs([]); return; }
    const { data: sg } = await sb.from("ai_suggestions").select("order_id").like("dedupe_key", `email:${anchor}:order%`).not("order_id", "is", null);
    const ids = [...new Set(((sg || []) as { order_id: string }[]).map((x) => x.order_id))].filter((id) => id !== order.id);
    if (!ids.length) { setSibs([]); return; }
    const [{ data: os }, { data: hs }] = await Promise.all([
      sb.from("orders").select("id, number, nickname, due_date, groups, customer_id, status").in("id", ids).is("discarded_at", null),
      sb.from("production_holds").select("order_id").in("order_id", ids).eq("status", "planned"),
    ]);
    const heldIds = new Set(((hs || []) as { order_id: string }[]).map((x) => x.order_id));
    setSibs(((os || []) as (OrderLite & { status: string })[]).filter((x) => !heldIds.has(x.id) && ["quote", "quote_sent", "art"].includes(x.status)).sort((a, b) => a.number - b.number));
  }, [order.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function start() { setOpen(true); setErr(""); setMsg(""); void guess(); void findSibs(); }

  const spec = specOf(order, method, locs);
  const minutes = useMemo(() => {
    if (!spec || !ps) return 0;
    const mach = ps.machines.find((x) => x.type === method);
    return mach ? estimate(ps, quickNeed(ps, spec), mach).minutes : 0;
  }, [spec, ps, method]); // eslint-disable-line react-hooks/exhaustive-deps

  async function hold(list: OrderLite[]) {
    setErr("");
    // holding again moves the hold: the old spot is let go first, never two for one quote
    if (held && list.some((o) => o.id === order.id)) await letGo();
    if (!order.due_date) { setErr("Set the order's due date first."); return; }
    if (!locs.length) { setErr("Add at least one location."); return; }
    const said: string[] = [];
    const next = (i: number) => {
      const o = list[i];
      if (!o) { setAsk(null); setOpen(false); setMsg(said.join(" ")); void load(); return; }
      const sp = specOf(o, method, locs);
      if (!sp || !(o.due_date || order.due_date)) { said.push(`#${o.number}: no garments or due date, not held.`); next(i + 1); return; }
      setAsk({ orderId: o.id, number: o.number, name: o.nickname || `#${o.number}`, customer, spec: sp, due: (o.due_date || order.due_date)!, art,
        onDone: (r) => { said.push(list.length > 1 ? `#${o.number}: ${r.msg}` : r.msg); if (!r.ok && list.length === 1) { setAsk(null); setErr(r.msg); return; } setAsk(null); setTimeout(() => next(i + 1), 50); } });
    };
    next(0);
  }
  async function letGo() {
    if (!held) return;
    await sb.from("production_holds").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", held.id);
    await sb.from("production_slots").delete().eq("hold_id", held.id);
    setMsg("Spot let go."); setHeld(null);
  }

  const parts = partsOf(order.groups || []);
  const pcs = parts.reduce((a, p) => a + p.qty, 0);
  const byKind = [...parts.reduce((m, p) => m.set(p.kind, (m.get(p.kind) || 0) + p.qty), new Map<string, number>())];

  // the header tag: only when a spot is held
  if (chip) {
    if (!held) return null;
    return (
      <details className="phd-tag" onBlur={(e) => { const d = e.currentTarget; setTimeout(() => { if (!d.contains(document.activeElement)) d.open = false; }, 0); }}>
        <summary title="This quote holds time on the production schedule (Production holder)">Held{held.day ? ` · ${day(held.day)}` : ""}</summary>
        <div className="phd-menu">
          <div><b>{machines[held.machine] || "Press"}</b>{held.day ? ` · ${day(held.day)}` : ""}</div>
          {held.details_due ? <div className="faint">Art and details by {day(held.details_due)}</div> : null}
          <div className="phd-acts"><Link className="btn sm" href="/shop/board">Change</Link><button type="button" className="btn sm" onClick={() => void letGo()}>Let it go</button></div>
        </div>
      </details>
    );
  }

  return (
    <>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open"); start(); }}>
        <MenuItem icon="calendar" tone="blue" title={held ? `Held · ${machines[held.machine] || "Press"}${held.day ? ` · ${day(held.day)}` : ""}` : "Production holder"} sub={held ? `${held.details_due ? `Art by ${day(held.details_due)} · ` : ""}hold again or let go` : "Save press time before the art's in"} />
      </button>
      {msg && !open && <span className="phd-msg faint">{msg}</span>}
      {/* on the page itself, not in the Production menu (the menu closes when the pop-up takes the click) */}
      {open && typeof document !== "undefined" && createPortal(
        <div className="pp-modal" onClick={() => setOpen(false)}>
          <div className="pp-sheet phd" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Production holder">
            <div className="pp-sheet-h"><b>Production holder <span className="faint phd-no">#{order.number} {order.nickname || ""}</span></b><button type="button" className="btn icon ghost" onClick={() => setOpen(false)} aria-label="Close">✕</button></div>
            <div className="phd-b">
              <div className="phd-sum">
                <div>{parts.length ? parts.map((p, i) => <span key={i}>{i ? " · " : ""}{p.qty} {p.label}</span>) : <span className="faint">No garments on the order yet</span>}</div>
                <div className="faint">{pcs.toLocaleString("en-US")} pcs{byKind.length > 1 ? ` (${byKind.map(([k, n]) => `${n} ${KIND[k as keyof typeof KIND]}`).join(", ")})` : ""} · {order.due_date ? `due ${day(order.due_date)}` : "no due date yet"}</div>
              </div>
              {held && <div className="phd-now">Held now on {machines[held.machine] || "a press"}{held.day ? `, ${day(held.day)}` : ""}. <button type="button" className="phd-link" onClick={() => void letGo()}>Let it go</button></div>}
              <div className="phd-lab">Decoration</div>
              <div className="phd-seg" role="radiogroup">{([["screen", "Screen print"], ["embroidery", "Embroidery"], ["heat", "Heat press"]] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={method === k} className={method === k ? "on" : ""} onClick={() => setMethod(k)}>{l}</button>)}</div>
              <div className="phd-lab"><span>Locations</span>{method === "screen" && <i>colors, my best guess</i>}</div>
              {locs.map((l, i) => (
                <div className="phd-loc" key={l.name + i}>
                  <b>{l.name}</b>
                  {method === "screen" ? <div className="phd-cs" role="radiogroup" aria-label={`${l.name} colors`}>{COLORS.map((c) => <button key={c} type="button" role="radio" aria-checked={l.colors === c} className={l.colors === c ? "on" : ""} onClick={() => setLocs((xs) => xs.map((x, k) => (k === i ? { ...x, colors: c } : x)))}>{c}</button>)}</div> : <span className="faint">{method === "embroidery" ? "about 8,000 stitches" : "pressed"}</span>}
                  <button type="button" className="phd-x" aria-label={`Take off ${l.name}`} onClick={() => setLocs((xs) => xs.filter((_, k) => k !== i))}>✕</button>
                </div>
              ))}
              {adding ? <div className="phd-add">{SPOTS.filter((s) => !locs.some((l) => l.name === s)).map((s) => <button key={s} type="button" className="btn sm" onClick={() => { setLocs((xs) => [...xs, { name: s, colors: method === "screen" ? "?" : "1" }]); setAdding(false); }}>{s}</button>)}</div>
                : <button type="button" className="phd-link" onClick={() => setAdding(true)}>+ Add a location</button>}
              {why && <div className="faint phd-why">{why}</div>}
              <div className="phd-lab">Artwork</div>
              <div className="phd-seg" role="radiogroup">{([["ready", "Ready"], ["coming", "Coming"], ["none", "Not started"]] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={art === k} className={art === k ? "on" : ""} onClick={() => setArt(k)}>{l}</button>)}</div>
              <div className="phd-est">{minutes ? <span>About <b>{fmtMin(minutes)}</b> of {method === "embroidery" ? "sewing" : "press"} time</span> : <span className="faint">Pick a location to see the time</span>}<span className="faint">art and details due 3 working days before it runs</span></div>
              {err && <div className="pv-err">{err}</div>}
            </div>
            <div className="phd-f">
              <span className="faint">{sibs.length ? <>{sibs.length} more from this email · <button type="button" className="phd-link" disabled={!!ask} onClick={() => hold([order, ...sibs])}>Hold all {sibs.length + 1}</button></> : "Approved later, it becomes the real booking."}</span>
              <span className="phd-a"><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn primary" disabled={!!ask || !locs.length} onClick={() => hold([order])}>{ask ? "Finding the spot…" : held ? "Hold again" : "Hold it"}</button></span>
            </div>
          </div>
        </div>, document.body)}
      {ask && <MachineSchedule key={ask.orderId} hold={ask} />}
    </>
  );
}
