"use client";
import { useMemo, useRef, useState } from "react";
import { bySize, type CheckJob, type CheckLine, type CheckinRow, type Issue } from "@/lib/checkinShared";
import { shrinkPhoto } from "./JobFiles";
import { useT } from "./lang";

/**
 * Counting a job's goods in on a phone: one size at a time, smallest first (each style / color in turn), on a big
 * keypad. "All 24 here" takes the full amount and moves on; type a different number and Next. A short count is a
 * problem on its own; damaged or wrong items get a reason and how many. Then a review: boxes, a note, photos, Check In.
 * Saves the same check-in as Goods & Receiving (same problems, same manifest update), through /api/jobs/checkin so the
 * crew can do it with their PIN on the shop's Wi-Fi.
 */
type Cell = { k: string; item: CheckJob["items"][number]; size: string; expected: number };
type Bad = { issue: Issue; bad: number };
const sz = (s: string) => (s === "OTHER" ? "Other" : s);

export default function PhoneCheckin({ job, onDone }: { job: CheckJob; onDone: (c: CheckinRow) => void }) {
  const { t } = useT();
  const cells: Cell[] = useMemo(() => job.items.flatMap((item) => Object.entries(item.sizes).filter(([, q]) => q > 0).sort(([a], [b]) => bySize(a, b)).map(([size, expected]) => ({ k: `${item.key}|${size}`, item, size, expected }))), [job]);
  const [got, setGot] = useState<Record<string, number>>({});
  const [bad, setBad] = useState<Record<string, Bad>>({});
  const [i, setI] = useState(0), [typed, setTyped] = useState("");
  const [review, setReview] = useState(false), [asking, setAsking] = useState(false);
  const [boxes, setBoxes] = useState<number | "">(job.boxes || ""), [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const cam = useRef<HTMLInputElement>(null);

  const c = cells[i];
  const counted = Object.keys(got).length, pcs = cells.reduce((s, x) => s + (got[x.k] ?? 0), 0), expected = cells.reduce((s, x) => s + x.expected, 0);
  const problems = cells.filter((x) => got[x.k] !== undefined && (got[x.k] !== x.expected || bad[x.k]?.bad));
  const name = (x: Cell) => [x.item.style, x.item.color].filter(Boolean).join(" · ") || t("Item");

  function go(n: number) { const j = Math.max(0, Math.min(cells.length - 1, n)); setI(j); setTyped(got[cells[j].k] !== undefined ? String(got[cells[j].k]) : ""); setAsking(false); }
  function take(v: number) {
    const ng = { ...got, [c.k]: v }; setGot(ng); setErr("");
    // on to the next size not counted yet (or the review when they're all done)
    const next = cells.findIndex((x, j) => j > i && ng[x.k] === undefined);
    const any = next >= 0 ? next : cells.findIndex((x) => ng[x.k] === undefined);
    if (any < 0) { setReview(true); return; }
    go(any);
  }
  const key = (d: string) => setTyped((s) => (d === "⌫" ? s.slice(0, -1) : (s + d).replace(/^0+(?=\d)/, "").slice(0, 4)));

  async function save() {
    if (counted < cells.length) { setErr(t("Count every size first: {0} left (tap a number to take the full amount).", cells.length - counted)); return; }
    setBusy(true); setErr("");
    const lines: CheckLine[] = cells.map((x) => {
      const v = got[x.k] ?? 0, b = bad[x.k];
      const issue: Issue = b?.bad ? b.issue : v < x.expected ? "short" : v > x.expected ? "over" : "";
      return { item: name(x), style: x.item.style, color: x.item.color, size: x.size, expected: x.expected, received: v, issue, ...(b?.bad ? { bad: b.bad } : {}) };
    });
    const fd = new FormData();
    fd.set("data", JSON.stringify({ ref: job.ref, lines, boxes: boxes === "" ? null : boxes, note, source: job.source }));
    for (const f of photos.slice(0, 8)) fd.append("photo", await shrinkPhoto(f));
    const r = await fetch("/api/jobs/checkin", { method: "POST", body: fd }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    setBusy(false);
    if (!r?.ok || j.error) { setErr(t(j.error || "Couldn't save.")); return; }
    onDone(j.checkin);
  }

  if (!cells.length) return <div className="jm-card"><p>{t("No sizes to count on this job.")}</p></div>;

  if (review) return (
    <>
      <div className="jm-card">
        <div className="jm-cardh"><b>{t("Check what you counted")}</b><span className={"jm-ck-tot" + (pcs === expected && !problems.length ? " ok" : " off")}>{pcs} / {expected}</span></div>
        {job.items.map((it) => {
          const cs = cells.filter((x) => x.item === it);
          return (
            <div key={it.key} className="jm-ck-rev">
              <b>{[it.style, it.color].filter(Boolean).join(" · ")}</b>
              <div className="jm-ck-revs">{cs.map((x) => { const v = got[x.k]; const tone = v === undefined ? "" : bad[x.k]?.bad ? " bad" : v === x.expected ? " ok" : v < x.expected ? " short" : " over"; return <button key={x.k} type="button" className={"jm-ck-chip" + tone} onClick={() => { setReview(false); go(cells.indexOf(x)); }}><span>{sz(x.size)}</span><b>{v ?? "—"}</b><small>/{x.expected}</small></button>; })}</div>
            </div>
          );
        })}
        <p className="jm-faint" style={{ margin: 0 }}>{t("Tap a size to change it.")}</p>
      </div>
      {problems.length > 0 && <div className="jm-card jm-ck-probs"><b>{problems.length === 1 ? t("1 problem") : t("{0} problems", problems.length)}</b>
        <ul>{problems.map((x) => <li key={x.k}>{name(x)} · {sz(x.size)}: {t("got {0} of {1}", got[x.k] ?? 0, x.expected)}{bad[x.k]?.bad ? ` · ${t(bad[x.k].issue === "mispick" ? "{0} wrong" : "{0} damaged", bad[x.k].bad)}` : ""}</li>)}</ul>
        <small>{t("Each one is flagged in Goods & Receiving until it's resolved.")}</small></div>}
      <div className="jm-card">
        <div className="jm-label">{t("Boxes")}</div>
        <div className="jm-count">
          <button type="button" aria-label={t("One fewer box")} onClick={() => setBoxes(Math.max(0, (+boxes || 0) - 1))}>−</button>
          <input inputMode="numeric" value={boxes} placeholder={job.boxes ? String(job.boxes) : "—"} onChange={(e) => setBoxes(e.target.value === "" ? "" : Math.min(999, +e.target.value.replace(/\D/g, "") || 0))} aria-label={t("Boxes")} />
          <button type="button" aria-label={t("One more box")} onClick={() => setBoxes((+boxes || 0) + 1)}>+</button>
        </div>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Anything about this delivery (boxes crushed, came on the S&S truck…)")} />
        <button type="button" className="jm-ghost" onClick={() => cam.current?.click()}>{photos.length ? (photos.length === 1 ? t("1 photo added") : t("{0} photos added", photos.length)) + " · " + t("Add more") : t("📷 Add photos")}</button>
        <input ref={cam} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { const fs = [...(e.target.files || [])]; e.target.value = ""; setPhotos((p) => [...p, ...fs].slice(0, 8)); }} />
        {err && <div className="jm-err">{err}</div>}
        <button type="button" className={"jm-go" + (problems.length ? " warn" : "")} disabled={busy} onClick={save}>{busy ? t("Saving…") : problems.length ? (problems.length === 1 ? t("Check In with 1 Problem") : t("Check In with {0} Problems", problems.length)) : t("Check In")}</button>
      </div>
    </>
  );

  const val = typed === "" ? null : +typed;
  const itemCells = cells.filter((x) => x.item === c.item);
  return (
    <>
      <div className="jm-ck-top">
        <span>{t("Size {0} of {1}", i + 1, cells.length)}</span>
        <span>{t("{0} of {1} counted", pcs, expected)}</span>
        {counted === 0 && <button type="button" className="jm-link" onClick={() => { setGot(Object.fromEntries(cells.map((x) => [x.k, x.expected]))); setReview(true); }}>{t("✓ Everything's here ({0})", expected)}</button>}
      </div>
      <div className="jm-card jm-ck">
        <div className="jm-ck-item">{name(c)}{c.item.desc ? <small>{c.item.desc}</small> : null}</div>
        <div className="jm-ck-sizes" role="tablist">{itemCells.map((x) => { const v = got[x.k]; const tone = v === undefined ? "" : bad[x.k]?.bad ? " bad" : v === x.expected ? " ok" : " off"; return <button key={x.k} type="button" role="tab" aria-selected={x === c} className={(x === c ? "on" : "") + tone} onClick={() => go(cells.indexOf(x))}>{sz(x.size)}</button>; })}</div>
        <div className="jm-ck-now">
          <div className="jm-ck-size">{sz(c.size)}</div>
          <div className="jm-ck-num"><b className={val === null ? "empty" : val === c.expected ? "ok" : "off"}>{val ?? "—"}</b><span>{t("of {0}", c.expected)}</span></div>
        </div>
        <button type="button" className="jm-ck-all" onClick={() => take(c.expected)}>✓ {t("All {0} here", c.expected)}</button>
        <div className="jm-ck-pad">{["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "next"].map((d) => (
          d === "next" ? <button key={d} type="button" className="go" disabled={val === null} onClick={() => val !== null && take(val)}>{t("Next")} →</button>
            : <button key={d} type="button" className={d === "⌫" ? "fn" : ""} aria-label={d === "⌫" ? t("Delete") : d} onClick={() => key(d)}>{d}</button>
        ))}</div>
        {val !== null && val < c.expected && <div className="jm-ck-short">{t("{0} short", c.expected - val)}</div>}
        <div className="jm-row">
          <button type="button" className="jm-ghost" disabled={i === 0} onClick={() => go(i - 1)}>← {t("Back|nav")}</button>
          <button type="button" className={"jm-ghost" + (bad[c.k]?.bad ? " on" : "")} onClick={() => setAsking(!asking)}>{bad[c.k]?.bad ? t(bad[c.k].issue === "mispick" ? "{0} wrong" : "{0} damaged", bad[c.k].bad) : t("Damaged / wrong")}</button>
        </div>
        {asking && (
          <div className="jm-ck-bad">
            <div className="jm-chips">{(["damaged", "mispick"] as Issue[]).map((k) => <button key={k} type="button" className={"jm-chip" + ((bad[c.k]?.issue || "damaged") === k ? " on" : "")} onClick={() => setBad({ ...bad, [c.k]: { issue: k, bad: bad[c.k]?.bad || 1 } })}>{t(k === "damaged" ? "Damaged" : "Wrong item")}</button>)}</div>
            <div className="jm-count">
              <button type="button" aria-label="−" onClick={() => setBad({ ...bad, [c.k]: { issue: bad[c.k]?.issue || "damaged", bad: Math.max(0, (bad[c.k]?.bad || 0) - 1) } })}>−</button>
              <input inputMode="numeric" value={bad[c.k]?.bad || 0} aria-label={t("How many")} onChange={(e) => setBad({ ...bad, [c.k]: { issue: bad[c.k]?.issue || "damaged", bad: +e.target.value.replace(/\D/g, "") || 0 } })} />
              <button type="button" aria-label="+" onClick={() => setBad({ ...bad, [c.k]: { issue: bad[c.k]?.issue || "damaged", bad: (bad[c.k]?.bad || 0) + 1 } })}>+</button>
            </div>
            <small className="jm-faint">{t("Count them in the number above too; this says how many of them are no good.")}</small>
          </div>
        )}
      </div>
      {counted > 0 && <button type="button" className="jm-ghost" onClick={() => setReview(true)}>{counted < cells.length ? t("Review ({0} sizes left)", cells.length - counted) : t("Review and check in")}</button>}
    </>
  );
}
