"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import type { Group } from "@/lib/pricing";
import type { QuickJob } from "@/lib/production";
import type { HoldAsk } from "@/components/MachineSchedule";

const MachineSchedule = dynamic(() => import("@/components/MachineSchedule"), { ssr: false });

/**
 * Hold the spot (Nov 9, Nick: "a way to have jobs… a placeholder… on the schedule… things sometimes take a while to get
 * approved, and we wouldn't want to not have space saved… without bogging it all down with information"). On a quote:
 * the due date, about how many pieces, the decoration, roughly how many prints and colors, and where the art is. The
 * schedule finds the spot just in time for the due date (like a Planner hold) and holds it, tied to the quote: a dashed
 * card, its details due three working days before it prints (amber that day, red after, Jose can bump it), and when the
 * quote is approved it becomes the real booking in the same spot.
 */
type Method = QuickJob["method"];
type Held = { id: string; details_due: string | null; machine: string; day: string } | null;
const day = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export default function HoldSpotTool({ order, customer }: { order: { id: string; number: number; nickname: string | null; due_date: string | null; groups: Group[] }; customer: string }) {
  const sb = createClient();
  const [held, setHeld] = useState<Held>(null), [machines, setMachines] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false), [ask, setAsk] = useState<HoldAsk | null>(null), [msg, setMsg] = useState(""), [err, setErr] = useState("");
  const gs = order.groups || [];
  const imps = gs.flatMap((g) => g.imprints || []);
  const pcs0 = gs.reduce((a, g) => a + g.lines.reduce((b, l) => b + Object.values(l.sizes || {}).reduce((c, n) => c + (+(n as number) || 0), 0), 0), 0);
  const m0: Method = imps[0]?.method === "embroidery" ? "embroidery" : imps[0] && ["dtf", "dtg", "heat"].includes(imps[0].method) ? "heat" : "screen";
  const [due, setDue] = useState(order.due_date || ""), [pcs, setPcs] = useState(String(pcs0 || "")), [method, setMethod] = useState<Method>(m0);
  const [prints, setPrints] = useState(String(Math.max(1, imps.length || 1))), [colors, setColors] = useState(imps.length ? String(Math.max(...imps.map((i) => +i.colors || 1))) : ""), [art, setArt] = useState(imps.some((i) => i.design_id) ? "ready" : "coming");

  const load = useCallback(async () => {
    const { data: h } = await sb.from("production_holds").select("id, details_due").eq("order_id", order.id).eq("status", "planned").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!h) { setHeld(null); return; }
    const { data: sl } = await sb.from("production_slots").select("machine, day").eq("hold_id", h.id).order("day").limit(1).maybeSingle();
    setHeld({ id: h.id as string, details_due: (h.details_due as string) || null, machine: String(sl?.machine || ""), day: String(sl?.day || "") });
    if (!Object.keys(machines).length) { const { data: st } = await sb.from("settings").select("data").eq("id", 1).maybeSingle(); const ms = ((st?.data as { production?: { machines?: { id: string; name: string }[] } } | null)?.production?.machines || []); setMachines(Object.fromEntries(ms.map((x) => [x.id, x.name.split(" · ")[0]]))); }
  }, [order.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  function go() {
    setErr("");
    const n = Math.round(+pcs), p = Math.max(1, Math.min(8, Math.round(+prints || 1))), c = Math.max(1, Math.min(12, Math.round(+colors || 2)));
    if (!due) { setErr("Pick the due date."); return; }
    if (!(n > 0)) { setErr("About how many pieces?"); return; }
    const spec: QuickJob = { method, qty: n, garment: "tee", dark: true, locations: Array.from({ length: p }, (_, i) => ({ name: i === 0 ? "Front" : i === 1 ? "Back" : `Print ${i + 1}`, colors: method === "screen" ? c : 1, stitches: method === "embroidery" ? 8000 : 0 })) };
    setAsk({ orderId: order.id, number: order.number, name: order.nickname || `#${order.number}`, customer, spec, due, art, onDone: (r) => { setAsk(null); if (r.ok) { setOpen(false); setMsg(r.msg); void load(); } else setErr(r.msg); } });
  }
  async function letGo() {
    if (!held) return;
    await sb.from("production_holds").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", held.id);
    await sb.from("production_slots").delete().eq("hold_id", held.id);
    setMsg("Spot let go."); setHeld(null);
  }

  return (
    <>
      {held ? <span className="hst-held" title="This quote holds time on the production schedule">📅 Held: {machines[held.machine] || "Press"} {held.day ? day(held.day) : ""}{held.details_due ? ` · details due ${day(held.details_due)}` : ""} · <Link href="/shop/board">Change</Link> · <button type="button" className="linkbtn" onClick={() => void letGo()}>Let it go</button></span>
        : <button type="button" className="btn hst-btn" onClick={() => { setOpen(true); setErr(""); setMsg(""); }} title="Save time on the production schedule before the details are firm">📅 Hold the spot</button>}
      {msg && !open && <span className="hst-msg faint">{msg}</span>}
      {open && (
        <div className="pp-modal" onClick={() => setOpen(false)}>
          <div className="pp-sheet hst" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Hold the spot">
            <div className="pp-sheet-h"><b>Hold the spot</b><button type="button" className="btn icon ghost" onClick={() => setOpen(false)} aria-label="Close">✕</button></div>
            <div className="hst-b">
              <div className="hst-2">
                <label className="field"><span>Due date</span><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /><small className="faint">When it has to be done</small></label>
                <label className="field"><span>Pieces</span><input type="number" min={1} value={pcs} onChange={(e) => setPcs(e.target.value)} /><small className="faint">{pcs0 ? "From the quote · change it if you know more" : "About how many"}</small></label>
              </div>
              <div className="field"><span>Decoration</span><div className="hst-seg" role="radiogroup">{([["screen", "Screen print"], ["embroidery", "Embroidery"], ["heat", "Heat press"]] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={method === k} className={method === k ? "on" : ""} onClick={() => setMethod(k)}>{l}</button>)}</div></div>
              <div className="hst-2">
                <label className="field"><span>Prints</span><input type="number" min={1} max={8} value={prints} onChange={(e) => setPrints(e.target.value)} /><small className="faint">Rough is fine</small></label>
                {method === "screen" && <label className="field"><span>Colors (most on one print)</span><input type="number" min={1} max={12} value={colors} placeholder="?" onChange={(e) => setColors(e.target.value)} /><small className="faint">Leave blank if you don&apos;t know</small></label>}
              </div>
              <div className="field"><span>Artwork</span><div className="hst-seg" role="radiogroup">{([["ready", "Ready"], ["coming", "Coming"], ["none", "Not started"]] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={art === k} className={art === k ? "on" : ""} onClick={() => setArt(k)}>{l}</button>)}</div></div>
              <p className="faint hst-note">The schedule finds the spot before the due date and saves it. The details are due three working days before it prints, and you get a to-do that day.</p>
              {err && <div className="pv-err">{err}</div>}
              <div className="hst-a"><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn primary" disabled={!!ask} onClick={go}>{ask ? "Finding the spot…" : "Hold the spot"}</button></div>
            </div>
          </div>
        </div>
      )}
      {ask && <MachineSchedule hold={ask} />}
    </>
  );
}
