"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DefaultField, TrainingDefaults as Defaults } from "@/lib/orderTrainings";

/**
 * A training's order defaults (Oct 31, Nick on MEI: "the default shipping is always FedEx Ground, unless he says
 * something different in the ClickUp or email… always set to reorder by default with no production confirmation"):
 * order type, production confirms, delivery and ship method, put on every order Create order makes for the training's
 * jobs. A field staff pick here is theirs; one left on "Learn" is learned from the orders marked right (it says from
 * which). Shown on the training editor (Settings → Order training) and the customer's Programs tab.
 */
const CARRIERS = ["FedEx Ground", "FedEx Home Delivery", "FedEx 2Day", "FedEx Standard Overnight", "UPS Ground", "UPS 2nd Day Air", "UPS Next Day Air", "USPS Ground Advantage", "USPS Priority Mail"];
export default function TrainingDefaults({ trainingId }: { trainingId: string }) {
  const sb = createClient();
  const [d, setD] = useState<Defaults | null>(null);
  const [state, setState] = useState("");
  // the presses a weekly run can be on (Settings → Production)
  const [presses, setPresses] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { void sb.from("settings").select("data").eq("id", 1).maybeSingle().then(({ data }) => setPresses((((data?.data as { production?: { machines?: { id: string; name: string; active?: boolean }[] } } | null)?.production?.machines) || []).filter((m) => m.active !== false).map((m) => ({ id: m.id, name: m.name })))); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let on = true;
    void sb.from("order_trainings").select("defaults").eq("id", trainingId).maybeSingle().then(({ data }) => { if (on) setD(((data?.defaults || {}) as Defaults)); });
    return () => { on = false; };
  }, [trainingId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null;
  const save = async (f: DefaultField, v: string | boolean | undefined) => {
    const set = new Set<string>(d.set || []), learned = { ...(d.learned || {}) };
    const next: Defaults = { ...d };
    if (v === undefined || v === "") { delete (next as Record<string, unknown>)[f]; set.delete(f); }
    else { (next as Record<string, unknown>)[f] = v; set.add(f); delete learned[f]; }
    next.set = [...set]; next.learned = learned;
    setD(next); setState("Saving…");
    const { error } = await sb.from("order_trainings").update({ defaults: next }).eq("id", trainingId);
    setState(error ? `Couldn't save: ${error.message}` : "Saved");
  };
  const mine = (f: DefaultField) => (d.set || []).includes(f);
  const note = (f: DefaultField) => (mine(f) ? "" : d.learned?.[f] ? `Learned from ${d.learned[f]}` : "");
  const val = (f: DefaultField) => (mine(f) || d.learned?.[f] ? (d as Record<string, unknown>)[f] : undefined);
  const sel = (f: DefaultField, label: string, opts: [string, string][], conv: (s: string) => string | boolean = (s) => s) => {
    const v = val(f);
    return (
      <div className="field tdf-f">
        <label htmlFor={`tdf-${f}-${trainingId}`}>{label}</label>
        <select id={`tdf-${f}-${trainingId}`} value={v === undefined ? "" : String(v)} onChange={(e) => void save(f, e.target.value === "" ? undefined : conv(e.target.value))}>
          <option value="">{note(f) ? `Learned: ${opts.find(([k]) => k === String(v))?.[1] || "—"}` : "Learn from orders"}</option>
          {opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {note(f) && <span className="faint tdf-n">{note(f)}</span>}
      </div>
    );
  };
  const shipV = val("ship_method") as string | undefined;
  // a weekly run (Nick, Nov 16 2026, All My Sons: in by Thursday, runs the next Tuesday, due that Friday)
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const saveRun = async (k: "cutoff" | "day" | "due" | "press", v: string) => {
    const r = { ...(d.run || { cutoff: 4, day: 2, due: 5 }) };
    const next: Defaults = { ...d };
    if (k === "press") { if (v) r.press = v; else delete r.press; next.run = r; }
    else if (v === "") delete next.run; else { r[k] = +v; next.run = r; }
    setD(next); setState("Saving…");
    const { error } = await sb.from("order_trainings").update({ defaults: next }).eq("id", trainingId);
    setState(error ? `Couldn't save: ${error.message}` : "Saved");
  };
  // the simple work order for these jobs (Nick, Nov 17 2026: Cedar's store carts and All My Sons)
  const saveWo = async (v: boolean) => {
    const next: Defaults = { ...d };
    if (v) next.simple_wo = true; else delete next.simple_wo;
    setD(next); setState("Saving…");
    const { error } = await sb.from("order_trainings").update({ defaults: next }).eq("id", trainingId);
    setState(error ? `Couldn't save: ${error.message}` : "Saved");
  };
  const runSel = (k: "cutoff" | "day" | "due", label: string) => (
    <div className="field tdf-f">
      <label htmlFor={`tdf-run-${k}-${trainingId}`}>{label}</label>
      <select id={`tdf-run-${k}-${trainingId}`} value={d.run ? String(d.run[k]) : ""} onChange={(e) => void saveRun(k, e.target.value)}>
        <option value="">{k === "cutoff" ? "No weekly run" : "—"}</option>
        {DAYS.map((x, i) => <option key={x} value={i}>{x}</option>)}
      </select>
    </div>
  );
  return (
    <div className="tdf">
      <div className="tdf-h"><b>Order defaults</b><span className="faint"> · put on every order made for these jobs; shipping only when the job doesn&apos;t name a carrier or pickup</span><span className="faint tdf-st">{state}</span></div>
      <div className="tdf-row">
        {sel("order_type", "Order type", [["new", "New order"], ["reorder", "Reorder"], ["reorder_changes", "Reorder with changes"]])}
        {sel("confirm", "Production confirms", [["false", "No, never"], ["true", "Yes, every print"]], (s) => s === "true")}
        {sel("own_seps", "Their separations", [["true", "Yes, they send their own"], ["false", "No, we separate"]], (s) => s === "true")}
        {sel("delivery_method", "Delivery", [["ship", "Ship"], ["pickup", "Pickup"], ["deliver", "We deliver"]])}
        <div className="field tdf-f">
          <label htmlFor={`tdf-sm-${trainingId}`}>Ship method</label>
          <input id={`tdf-sm-${trainingId}`} type="text" list={`tdf-car-${trainingId}`} defaultValue={shipV || ""} key={`${shipV || ""}`} placeholder={note("ship_method") ? "" : "Learn from orders"}
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== (shipV || "")) void save("ship_method", v || undefined); }} />
          <datalist id={`tdf-car-${trainingId}`}>{CARRIERS.map((c) => <option key={c} value={c} />)}</datalist>
          {note("ship_method") && <span className="faint tdf-n">{note("ship_method")}</span>}
        </div>
        <div className="field tdf-f">
          <label htmlFor={`tdf-wo-${trainingId}`}>Work order</label>
          <select id={`tdf-wo-${trainingId}`} value={d.simple_wo ? "simple" : ""} onChange={(e) => void saveWo(e.target.value === "simple")}>
            <option value="">Full work order</option>
            <option value="simple">Simple (one page, no prices)</option>
          </select>
        </div>
        {runSel("cutoff", "Weekly run: in by")}
        {d.run && runSel("day", "Runs on")}
        {d.run && runSel("due", "Due")}
        {d.run && <div className="field tdf-f">
          <label htmlFor={`tdf-run-press-${trainingId}`}>Runs on press</label>
          <select id={`tdf-run-press-${trainingId}`} value={d.run.press || ""} onChange={(e) => void saveRun("press", e.target.value)} title="Its orders book themselves on this press on the run day, never Ready to schedule">
            <option value="">Booked by hand</option>
            {presses.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>}
      </div>
    </div>
  );
}
