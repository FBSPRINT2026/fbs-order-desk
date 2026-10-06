"use client";
import { useMemo, useState } from "react";
import { INK_COLORS } from "@/lib/pricing";
import { diffSetup, type PHead, type PressOption, type PressSheet } from "@/lib/pressActual";
import { useT } from "./lang";

/**
 * One print location on the phone's Press setup: the suggested setup (from the separation), or what really ran once
 * the crew saved it, with what changed. "Change what we ran" opens the editor: pick the press that ran it, move heads
 * up and down, change a screen's ink or mesh, add or take out flashes and cool-downs, say why. Saving keeps both: the
 * suggestion stays as it was, "as printed" is saved on the job (and, ticked, carried into the separation, the art's
 * inks and the order for next time).
 */
const MESH = [86, 110, 125, 156, 160, 180, 200, 230, 255, 305];
const when = (d: string, loc: string) => new Date(d).toLocaleString(loc, { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Heads({ heads, faint = false }: { heads: PHead[]; faint?: boolean }) {
  const { t } = useT();
  return (
    <ol className={"jm-heads" + (faint ? " faint" : "")}>{heads.map((h, i) => (
      <li key={i} className={"h-" + h.what}><span className="jm-hn">{i + 1}</span>
        {h.what === "screen" ? <><i style={{ background: h.hex || "#ccc" }} /><b>{h.name}</b>{h.mesh ? <small>{t("{0} mesh", h.mesh)}</small> : null}</>
          : <b className="jm-faint">{t(h.what === "flash" ? "Flash" : h.what === "cool" ? "Cool down (empty)" : "Empty")}</b>}
      </li>
    ))}</ol>
  );
}

export default function PressSheetCard({ sheet, presses, job, onSaved }: { sheet: PressSheet; presses: PressOption[]; job: { kind: "o" | "a"; id: string }; onSaved: (s: PressSheet[]) => void }) {
  const { t, locale } = useT();
  const [edit, setEdit] = useState(false), [showPlan, setShowPlan] = useState(false);
  const a = sheet.actual;
  return (
    <div className="jm-card">
      <div className="jm-cardh"><b>{t(sheet.location || "Print")}{sheet.number ? ` · S-${sheet.number}` : ""}</b><span className="jm-faint">{a ? a.press_name || sheet.press : sheet.press || t("press not chosen")}</span></div>
      {edit ? <Editor sheet={sheet} presses={presses} job={job} onCancel={() => setEdit(false)} onSaved={(s) => { setEdit(false); onSaved(s); }} /> : a ? (
        <>
          <div className="jm-asp"><span className="jm-asp-tag">✓ {t("As printed")}</span><small>{a.by_name} · {when(a.created_at, locale)}</small></div>
          <Heads heads={a.heads} />
          {a.changes.length > 0 && <div className="jm-chg"><b>{t("Changed from the suggestion")}</b><ul>{a.changes.map((c, i) => <li key={i}>{c.text}</li>)}</ul></div>}
          {a.notes && <p className="jm-pre">{a.notes}</p>}
          {a.learned && <small className="jm-faint">{t("Saved for next time: the separation, the art's inks and this order use these.")}</small>}
          <button type="button" className="jm-link" onClick={() => setShowPlan(!showPlan)}>{showPlan ? t("Hide the suggested setup") : t("Show the suggested setup")}</button>
          {showPlan && <><div className="jm-label">{t("Suggested")}{sheet.press ? ` · ${sheet.press}` : ""}</div><Heads heads={sheet.heads} faint /></>}
        </>
      ) : (
        <>
          <div className="jm-label">{t("Suggested")}{!sheet.sepId ? ` · ${t("from the inks on the job")}` : ""}</div>
          {sheet.heads.length ? <Heads heads={sheet.heads} /> : <p className="jm-faint">{t("No press setup saved yet. Screens in print order:")}</p>}
        </>
      )}
      {!edit && sheet.notes && <p className="jm-pre">{sheet.notes}</p>}
      {!edit && <button type="button" className="jm-ghost" onClick={() => setEdit(true)}>{a ? t("Change what we ran") : t("We ran it differently")}</button>}
    </div>
  );
}

function Editor({ sheet, presses, job, onCancel, onSaved }: { sheet: PressSheet; presses: PressOption[]; job: { kind: "o" | "a"; id: string }; onCancel: () => void; onSaved: (s: PressSheet[]) => void }) {
  const { t } = useT();
  const a = sheet.actual;
  const [pressId, setPressId] = useState(a?.press_id || sheet.pressId || presses[0]?.id || "");
  const [heads, setHeads] = useState<PHead[]>(() => (a?.heads || sheet.heads).map((h) => ({ ...h })));
  const [notes, setNotes] = useState(""), [learn, setLearn] = useState(true);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const press = presses.find((p) => p.id === pressId);
  const changes = useMemo(() => diffSetup(sheet, { pressId, press: press?.name || "", heads }), [sheet, pressId, press, heads]);
  const used = heads.filter((h) => h.what !== "empty").length;
  const set = (i: number, p: Partial<PHead>) => setHeads((hs) => hs.map((h, j) => (j === i ? { ...h, ...p } : h)));
  const move = (i: number, d: number) => setHeads((hs) => { const j = i + d; if (j < 0 || j >= hs.length) return hs; const n = hs.slice(); [n[i], n[j]] = [n[j], n[i]]; return n; });
  const inkList = [...new Set([...sheet.heads.filter((h) => h.what === "screen").map((h) => h.name), ...INK_COLORS])];

  async function save() {
    setBusy(true); setErr("");
    const r = await fetch("/api/jobs/press", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job, sheet: sheet.id, pressId, heads, notes, learn }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Offline. Try again." };
    setBusy(false);
    if (!r?.ok) return setErr(t(j.error || "Couldn't save."));
    onSaved(j.sheets);
  }

  return (
    <div className="jm-ped">
      <div className="jm-label">{t("Press that ran it")}</div>
      <div className="jm-chips">{presses.map((p) => <button key={p.id} type="button" className={"jm-chip" + (p.id === pressId ? " on" : "")} onClick={() => setPressId(p.id)}>{p.name} <small>{t("{0} heads", p.colors)}</small></button>)}</div>
      {press && used > press.colors && <div className="jm-warn">{t("{0} has {1} heads; this uses {2}.", press.name, press.colors, used)}</div>}
      <div className="jm-label">{t("Heads, in order")}</div>
      <datalist id={`inks-${sheet.id}`}>{inkList.map((n) => <option key={n} value={n} />)}</datalist>
      <ol className="jm-ped-l">{heads.map((h, i) => (
        <li key={i} className={"h-" + h.what}>
          <span className="jm-hn">{i + 1}</span>
          {h.what === "screen" ? (
            <div className="jm-ped-ink">
              <label className="jm-sw" style={{ background: h.hex || "#ccc" }} title={t("Ink color")}><input type="color" value={h.hex || "#cccccc"} onChange={(e) => set(i, { hex: e.target.value })} aria-label={t("Ink color")} /></label>
              <input list={`inks-${sheet.id}`} value={h.name} onChange={(e) => set(i, { name: e.target.value })} aria-label={t("Ink")} placeholder={t("Ink")} />
            </div>
          ) : <b className="jm-faint jm-ped-k">{t(h.what === "flash" ? "Flash" : h.what === "cool" ? "Cool down (empty)" : "Empty")}</b>}
          <span className="jm-ped-b">
            {h.what === "screen" && <select value={h.mesh || ""} onChange={(e) => set(i, { mesh: +e.target.value || null })} aria-label={t("Mesh")}><option value="">{t("Mesh")}</option>{[...new Set([...MESH, ...(h.mesh ? [h.mesh] : [])])].sort((x, y) => x - y).map((m) => <option key={m} value={m}>{t("{0} mesh", m)}</option>)}</select>}
            <button type="button" aria-label={t("Move up")} disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
            <button type="button" aria-label={t("Move down")} disabled={i === heads.length - 1} onClick={() => move(i, 1)}>▼</button>
            <button type="button" aria-label={t("Take out")} onClick={() => setHeads((hs) => hs.filter((_, j) => j !== i))}>✕</button>
          </span>
        </li>
      ))}</ol>
      <div className="jm-chips">
        <button type="button" className="jm-chip" onClick={() => setHeads([...heads, { what: "flash", name: "", hex: "", mesh: null }])}>+ {t("Flash")}</button>
        <button type="button" className="jm-chip" onClick={() => setHeads([...heads, { what: "cool", name: "", hex: "", mesh: null }])}>+ {t("Cool down")}</button>
        <button type="button" className="jm-chip" onClick={() => setHeads([...heads, { what: "empty", name: "", hex: "", mesh: null }])}>+ {t("Empty head")}</button>
        <button type="button" className="jm-chip" onClick={() => setHeads([...heads, { what: "screen", name: "", hex: "", mesh: null }])}>+ {t("Screen")}</button>
      </div>
      <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("Why? e.g. Press 1 was down. The gold printed too light, went to a darker gold.")} />
      {changes.length > 0 ? <div className="jm-chg"><b>{t("Changed from the suggestion")}</b><ul>{changes.map((c, i) => <li key={i}>{c.text}</li>)}</ul></div> : <p className="jm-faint" style={{ margin: 0 }}>{t("Same as the suggested setup.")}</p>}
      {sheet.sepId ? <label className="jm-check"><input type="checkbox" checked={learn} onChange={(e) => setLearn(e.target.checked)} /> <span>{t("Use this next time (updates the separation, the art's inks and this order, so a reorder starts from what really printed)")}</span></label>
        : <p className="jm-faint" style={{ margin: 0 }}>{t("Saved on the job's production notes.")}</p>}
      {err && <div className="jm-err">{err}</div>}
      <div className="jm-row">
        <button type="button" className="jm-ghost" disabled={busy} onClick={onCancel}>{t("Cancel")}</button>
        <button type="button" className="jm-go" disabled={busy || !heads.some((h) => h.what === "screen" && h.name.trim())} onClick={save}>{busy ? t("Saving…") : t("Save what we ran")}</button>
      </div>
    </div>
  );
}
