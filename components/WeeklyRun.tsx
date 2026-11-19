"use client";
import { useState } from "react";
import { createPortal } from "react-dom";

/**
 * A weekly run worked as one job (Nick, Nov 19 2026: "they'll just click and say AMS weekly run start… it'll pop up and it'll
 * say… we're printing these POs… when you click done… you finished the AMS weekly run… all the POs that you completed and
 * printed… check them off the list"; "these were on the list… but you don't show printed… confirm this wasn't printed and
 * move to next week's run?"). One Start for the run, Pause / Resume, and Done: a checklist of its POs (all checked), and
 * any unchecked confirmed not printed before they move to next week's run. Saves through app/api/schedule/run.
 * The crew phone's menu (components/crew/CrewMenu.tsx) and the schedule's run box (components/MachineSchedule.tsx).
 */
export type RunPO = { slotId: string; number: string; name: string; qty: number; status: string };
type T = (s: string, ...a: (string | number)[]) => string;
const plain: T = (s, ...a) => s.replace(/\{(\d+)\}/g, (_, i) => String(a[+i] ?? ""));

export function runTitle(names: string[]): string {
  // the words every PO's job name starts with ("AMS Jacksonville", "AMS Tulsa" → "AMS"), else "Weekly"
  const w = names.map((n) => (n || "").trim().split(/\s+/));
  const first = w[0]?.[0] || "";
  return first && w.every((x) => (x[0] || "").toLowerCase() === first.toLowerCase()) ? `${first} weekly run` : "Weekly run";
}

async function post(body: Record<string, unknown>) {
  const r = await fetch("/api/schedule/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : { error: "Offline. Try again." };
  return r?.ok ? { ok: true as const, ...j } : { ok: false as const, error: String(j.error || "Couldn't save.") };
}

/** the run's controls: Start the run / Pause / Resume / Done (and the Done checklist) */
export default function WeeklyRun({ machine, day, title, pos, onChanged, t = plain, compact = false }: {
  machine: string; day: string; title: string; pos: RunPO[]; onChanged: (msg: string) => void; t?: T; compact?: boolean;
}) {
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [done, setDone] = useState(false);
  const left = pos.filter((p) => p.status !== "done");
  const running = left.some((p) => p.status === "running"), paused = !running && left.some((p) => p.status === "paused");
  const go = async (action: string) => {
    setBusy(action); setErr("");
    const r = await post({ machine, day, action });
    setBusy("");
    if (!r.ok) { setErr(r.error); return; }
    onChanged(action === "start" ? t("{0} started", title) : action === "pause" ? t("{0} paused", title) : t("{0} resumed", title));
  };
  if (!left.length) return <div className="wrn-msg">{t("Every PO on this run is printed.")}</div>;
  return (
    <div className={"wrn" + (compact ? " compact" : "")}>
      {!running && !paused && <button type="button" className="wrn-go" disabled={!!busy} onClick={() => void go("start")}>{busy ? t("One moment…") : t("Start the run")}</button>}
      {(running || paused) && <div className="wrn-two">
        <button type="button" className="wrn-alt" disabled={!!busy} onClick={() => void go(running ? "pause" : "resume")}>{busy === "pause" || busy === "resume" ? t("One moment…") : running ? t("Pause") : t("Resume")}</button>
        <button type="button" className="wrn-done" disabled={!!busy} onClick={() => setDone(true)}>{t("Done")}</button>
      </div>}
      {err && <div className="wrn-err">{err}</div>}
      {done && <RunDone title={title} machine={machine} day={day} pos={left} t={t} onClose={() => setDone(false)} onSaved={(m) => { setDone(false); onChanged(m); }} />}
    </div>
  );
}

/** Done: check every PO printed; any unchecked is confirmed not printed and moves to next week's run */
function RunDone({ title, machine, day, pos, t, onClose, onSaved }: { title: string; machine: string; day: string; pos: RunPO[]; t: T; onClose: () => void; onSaved: (msg: string) => void }) {
  const [chk, setChk] = useState<Record<string, boolean>>(Object.fromEntries(pos.map((p) => [p.slotId, true])));
  const [step, setStep] = useState<"list" | "confirm">("list"), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const miss = pos.filter((p) => !chk[p.slotId]), n = pos.length - miss.length;
  const nextWeek = (() => { const x = new Date(day + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + 7); return x.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); })();
  async function save() {
    setBusy(true); setErr("");
    const r = await post({ machine, day, action: "done", printed: pos.filter((p) => chk[p.slotId]).map((p) => p.slotId), notPrinted: miss.map((p) => p.slotId) });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onSaved(miss.length ? t("{0} POs printed · {1} moved to next week's run", n, miss.length) : t("{0} POs printed", n));
  }
  return createPortal(
    <div className="wrn-bg" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="wrn-dlg">
        {step === "list" ? <>
          <h3>{t("You finished the {0}", title)}</h3>
          <p className="wrn-sub">{t("Check every PO you printed. Uncheck any that didn't get printed.")}</p>
          <div className="wrn-list">
            {pos.map((p) => (
              <label key={p.slotId} className="wrn-row">
                <input type="checkbox" checked={!!chk[p.slotId]} onChange={(e) => setChk((c) => ({ ...c, [p.slotId]: e.target.checked }))} />
                <b>#{p.number}</b><span>{p.name}</span><small>{t("{0} pcs", p.qty)}</small>
              </label>
            ))}
          </div>
          {err && <div className="wrn-err">{err}</div>}
          <div className="wrn-acts">
            <button type="button" className="wrn-alt" onClick={onClose} disabled={busy}>{t("Cancel")}</button>
            <button type="button" className="wrn-go" disabled={busy || !pos.length} onClick={() => (miss.length ? setStep("confirm") : void save())}>{busy ? t("Saving…") : t("Save · {0} of {1} printed", n, pos.length)}</button>
          </div>
        </> : <>
          <div className="wrn-warn">
            <b>{miss.length === 1 ? t("This PO was on the run but not checked printed") : t("These POs were on the run but not checked printed")}</b>
            {miss.map((p) => <span key={p.slotId}>#{p.number} · {p.name} · {t("{0} pcs", p.qty)}</span>)}
            <span>{miss.length === 1 ? t("Confirm it wasn't printed and move it to next week's run ({0})?", nextWeek) : t("Confirm they weren't printed and move them to next week's run ({0})?", nextWeek)}</span>
          </div>
          {err && <div className="wrn-err">{err}</div>}
          <div className="wrn-acts col">
            <button type="button" className="wrn-go" disabled={busy} onClick={() => void save()}>{busy ? t("Saving…") : t("Yes, move to {0}", nextWeek)}</button>
            <button type="button" className="wrn-alt" disabled={busy} onClick={() => setStep("list")}>{miss.length === 1 ? t("Go back, it was printed") : t("Go back, they were printed")}</button>
          </div>
        </>}
      </div>
    </div>, document.body);
}
