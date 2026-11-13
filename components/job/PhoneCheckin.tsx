"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { bySize, type CheckJob, type CheckLine, type CheckinRow, type Issue } from "@/lib/checkinShared";
import { shrinkPhoto } from "./JobFiles";
import { useT } from "./lang";
import PhotoButtons from "@/components/PhotoButtons";

/**
 * Counting a job's goods in on a phone (Count in v2; Nick, Nov 13 2026: "a selector up at the top… all the different line
 * items… select and then count in… a master button on top… hold it on your phone for a second… I don't wanna
 * accidentally count in jobs"). Every style / color on the job is listed at the top; pick one and type each size, or
 * "All 150 of these here". Holding the green button a full second counts everything in (letting go early does nothing).
 * A short count is a problem on its own; damaged or wrong items get a reason and how many. Then a review: boxes, a note,
 * photos, Check In.
 * Leaving halfway asks first (Nick, Nov 13, #40382): save what's counted to finish later (anyone picks it up, on any
 * phone or the desk: /api/jobs/checkin/draft) or reset the job to uncounted.
 * Saves the same check-in as Goods & Receiving (same problems, same manifest update), through /api/jobs/checkin so the
 * crew can do it with their PIN on the shop's Wi-Fi.
 */
type Cell = { k: string; item: CheckJob["items"][number]; size: string; expected: number };
type Bad = { issue: Issue; bad: number };
const sz = (s: string) => (s === "OTHER" ? "Other" : s);

/** A count in progress: the job menu asks it before leaving the count (Main menu, ← Job menu, the phone's Back). */
export const countGuard: { busy: () => boolean; ask: (then: () => void) => void } = { busy: () => false, ask: (then) => then() };

const ago = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };

export default function PhoneCheckin({ job, onDone, onLeave }: { job: CheckJob; onDone: (c: CheckinRow) => void; onLeave?: () => void }) {
  const { t } = useT();
  const cells: Cell[] = useMemo(() => job.items.flatMap((item) => Object.entries(item.sizes).filter(([, q]) => q > 0).sort(([a], [b]) => bySize(a, b)).map(([size, expected]) => ({ k: `${item.key}|${size}`, item, size, expected }))), [job]);
  const items = useMemo(() => job.items.filter((it) => cells.some((c) => c.item === it)), [job, cells]);
  const [got, setGot] = useState<Record<string, number>>({});
  const [bad, setBad] = useState<Record<string, Bad>>({});
  const [pick, setPick] = useState(items[0]?.key || "");
  const [review, setReview] = useState(false), [asking, setAsking] = useState(false), [badK, setBadK] = useState("");
  const [boxes, setBoxes] = useState<number | "">(job.boxes || ""), [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [resumed, setResumed] = useState<{ by: string; at: string } | null>(null);
  const [leave, setLeave] = useState<(() => void) | null>(null);

  const counted = Object.keys(got).length, pcs = cells.reduce((s, x) => s + (got[x.k] ?? 0), 0), expected = cells.reduce((s, x) => s + x.expected, 0);
  const problems = cells.filter((x) => got[x.k] !== undefined && (got[x.k] !== x.expected || bad[x.k]?.bad));
  const name = (x: { item: Cell["item"] }) => [x.item.style, x.item.color].filter(Boolean).join(" · ") || t("Item");
  const it = items.find((x) => x.key === pick) || items[0];
  const itCells = cells.filter((x) => x.item === it);
  const itGot = (i: Cell["item"]) => cells.filter((x) => x.item === i).reduce((s, x) => s + (got[x.k] ?? 0), 0);
  const itExp = (i: Cell["item"]) => cells.filter((x) => x.item === i).reduce((s, x) => s + x.expected, 0);
  const itTyped = (i: Cell["item"]) => cells.some((x) => x.item === i && got[x.k] !== undefined);
  const itAll = (i: Cell["item"]) => cells.every((x) => x.item !== i || got[x.k] !== undefined);

  // a count left halfway: pick it up where it stopped
  useEffect(() => {
    let off = false;
    void fetch(`/api/jobs/checkin/draft?ref=${encodeURIComponent(job.ref)}`, { cache: "no-store" }).then((r) => r.json()).then((j) => {
      const d = j?.draft; if (off || !d || !Object.keys(d.got || {}).length) return;
      const keys = new Set(cells.map((c) => c.k));
      setGot(Object.fromEntries(Object.entries(d.got as Record<string, number>).filter(([k]) => keys.has(k))));
      setBad(Object.fromEntries(Object.entries((d.bad || {}) as Record<string, Bad>).filter(([k]) => keys.has(k))));
      setResumed({ by: d.by || "", at: d.at || "" });
      const first = items.find((i) => !cells.every((c) => c.item !== i || d.got[c.k] !== undefined));
      if (first) setPick(first.key);
    }).catch(() => {});
    return () => { off = true; };
  }, [job.ref]); // eslint-disable-line react-hooks/exhaustive-deps

  // leaving halfway asks first
  const dirty = !review ? counted > 0 || Object.keys(bad).length > 0 : true;
  // once saved for later (or checked in), leaving no longer asks
  const released = useRef(false);
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty && !busy && !released.current;
  useEffect(() => {
    countGuard.busy = () => dirtyRef.current;
    countGuard.ask = (then) => (dirtyRef.current ? setLeave(() => then) : then());
    return () => { countGuard.busy = () => false; countGuard.ask = (then) => then(); };
  }, []);

  async function saveDraft(then: () => void) {
    setBusy(true); setErr("");
    const r = await fetch("/api/jobs/checkin/draft", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ref: job.ref, got, bad, counted: pcs, expected }) }).catch(() => null);
    setBusy(false);
    if (!r?.ok) { setErr(t("Couldn't save the count. Try again.")); setLeave(null); return; }
    released.current = true; dirtyRef.current = false; setLeave(null); then();
  }
  async function reset(then: () => void) {
    setBusy(true);
    await fetch(`/api/jobs/checkin/draft?ref=${encodeURIComponent(job.ref)}`, { method: "DELETE" }).catch(() => null);
    setBusy(false); setGot({}); setBad({}); setResumed(null); setReview(false); dirtyRef.current = false; setLeave(null); then();
  }

  const setOne = (k: string, v: string) => { released.current = false; const d = v.replace(/\D/g, "").slice(0, 5); setErr(""); setGot((g) => { const n = { ...g }; if (d === "") delete n[k]; else n[k] = +d; return n; }); };
  const fillItem = (i: Cell["item"]) => setGot((g) => ({ ...g, ...Object.fromEntries(cells.filter((x) => x.item === i).map((x) => [x.k, x.expected])) }));
  function next() {
    const after = items.slice(items.indexOf(it) + 1).find((i) => !itAll(i)) || items.find((i) => i !== it && !itAll(i));
    if (after) { setPick(after.key); setAsking(false); scrollTo(0, 0); } else setReview(true);
  }

  // press and hold a full second: everything (or the rest) is here
  const [holding, setHolding] = useState(false); const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdStart = (e?: { preventDefault: () => void }) => {
    e?.preventDefault(); if (timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null; setHolding(false);
      setGot((g) => ({ ...Object.fromEntries(cells.map((x) => [x.k, x.expected])), ...g }));
      try { navigator.vibrate?.(40); } catch { /* not on every phone */ }
      setReview(true); scrollTo(0, 0);
    }, 1000);
  };
  const holdStop = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; setHolding(false); setErr(t("Hold it a full second to count all in.")); } };

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
    released.current = true; dirtyRef.current = false;
    onDone(j.checkin);
  }

  if (!cells.length) return <div className="jm-card"><p>{t("No sizes to count on this job.")}</p></div>;

  const leaving = leave && (
    <div className="ci2-veil" role="dialog" aria-modal="true" aria-label={t("Stop counting?")}>
      <div className="ci2-ask">
        <b>{t("You're halfway through counting this")}</b>
        <p>{t("{0} of {1} counted so far.", pcs, expected)}</p>
        <button type="button" className="jm-go" disabled={busy} onClick={() => void saveDraft(leave)}>{busy ? t("Saving…") : t("Save what I counted · finish later")}</button>
        <button type="button" className="ci2-reset" disabled={busy} onClick={() => void reset(leave)}>{t("Reset to uncounted")}</button>
        <button type="button" className="jm-ghost" disabled={busy} onClick={() => setLeave(null)}>{t("Keep counting")}</button>
      </div>
    </div>
  );
  const stop = <button type="button" className="ci2-stop" onClick={() => countGuard.ask(() => onLeave?.())}>{t("Stop counting")}</button>;

  if (review) return (
    <>
      {leaving}
      <div className="jm-card">
        <div className="jm-cardh"><b>{t("Check what you counted")}</b><span className={"jm-ck-tot" + (pcs === expected && !problems.length ? " ok" : " off")}>{pcs} / {expected}</span></div>
        {items.map((i) => {
          const cs = cells.filter((x) => x.item === i);
          return (
            <div key={i.key} className="jm-ck-rev">
              <b data-notranslate>{[i.style, i.color].filter(Boolean).join(" · ")}</b>
              <div className="jm-ck-revs">{cs.map((x) => { const v = got[x.k]; const tone = v === undefined ? "" : bad[x.k]?.bad ? " bad" : v === x.expected ? " ok" : v < x.expected ? " short" : " over"; return <button key={x.k} type="button" className={"jm-ck-chip" + tone} onClick={() => { setReview(false); setPick(i.key); }}><span>{sz(x.size)}</span><b>{v ?? "—"}</b><small>/{x.expected}</small></button>; })}</div>
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
        {photos.length > 0 && <div className="jm-faint">{photos.length === 1 ? t("1 photo added") : t("{0} photos added", photos.length)}</div>}
        <div className="row" style={{ gap: 8 }}><PhotoButtons multiple className="jm-ghost" take={t("📷 Take photos")} choose={t("Choose photos")} onFiles={(fs) => setPhotos((p) => [...p, ...fs].slice(0, 8))} /></div>
        {err && <div className="jm-err">{err}</div>}
        <button type="button" className={"jm-go" + (problems.length ? " warn" : "")} disabled={busy} onClick={save}>{busy ? t("Saving…") : problems.length ? (problems.length === 1 ? t("Check In with 1 Problem") : t("Check In with {0} Problems", problems.length)) : t("Check In")}</button>
      </div>
      {stop}
    </>
  );

  const rest = cells.filter((x) => got[x.k] === undefined).reduce((s, x) => s + x.expected, 0);
  const nextIt = items.slice(items.indexOf(it) + 1).find((i) => !itAll(i)) || items.find((i) => i !== it && !itAll(i));
  const last = !nextIt;
  const bk = badK && itCells.some((x) => x.k === badK) ? badK : itCells[0]?.k || "";
  return (
    <div className="ci2">
      {leaving}
      {resumed && <div className="ci2-resumed"><span>{t("Picked up where {0} stopped ({1}): {2} of {3} counted.", resumed.by || t("someone"), ago(resumed.at), pcs, expected)}</span>
        <button type="button" className="jm-link" onClick={() => setLeave(() => () => {})}>{t("Start over")}</button></div>}
      <div className="ci2-tot"><b>{pcs}</b> {t("of {0} counted", expected)}</div>
      {rest > 0 && <button type="button" className={"ci2-hold" + (holding ? " go" : "")} onPointerDown={holdStart} onPointerUp={holdStop} onPointerLeave={holdStop} onPointerCancel={holdStop} onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) holdStart(e); }} onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") holdStop(); }}>
        <span className="ci2-fill" />
        <span className="ci2-ht"><b>{holding ? t("Keep holding…") : counted ? t("The rest are here?") : t("Everything's here?")}</b>
          <small>{counted ? t("Hold 1 second to count the other {0} in", rest) : t("Hold 1 second to count all {0} in", expected)}</small></span>
      </button>}
      <div className="ci2-lbl">{t("Items on this job · {0}", items.length)}</div>
      <div className="ci2-items">{items.map((i) => {
        const c = itGot(i), e = itExp(i), typed = itTyped(i), all = itAll(i);
        const st = !typed ? (i === it ? t("Counting") : t("Not yet")) : !all ? t("Counting") : c === e && !cells.some((x) => x.item === i && bad[x.k]?.bad) ? t("✓ All here") : c < e ? t("{0} short", e - c) : c > e ? t("{0} over", c - e) : t("Problem");
        const tone = !typed ? (i === it ? "on" : "") : !all ? "on" : c === e ? "ok" : "short";
        return (
          <button key={i.key} type="button" className="ci2-item" aria-pressed={i === it} onClick={() => { setPick(i.key); setAsking(false); }}>
            <span className="ci2-it"><b data-notranslate>{[i.style, i.color].filter(Boolean).join(" ") || t("Item")}</b><small data-notranslate>{[i.desc, cells.filter((x) => x.item === i).map((x) => sz(x.size)).join(" ")].filter(Boolean).join(" · ")}</small></span>
            <span className="ci2-ct"><b>{c} / {e}</b><small className={tone}>{st}</small></span>
          </button>
        );
      })}</div>
      <div className="ci2-sizes">
        <div className="ci2-sh"><b data-notranslate>{name({ item: it })}</b><button type="button" className="ci2-allthese" onClick={() => fillItem(it)}>✓ {t("All {0} of these here", itExp(it))}</button></div>
        <div className="ci2-grid">{itCells.map((x) => {
          const v = got[x.k]; const has = v !== undefined;
          const tone = !has ? "" : bad[x.k]?.bad ? "bad" : v === x.expected ? "ok" : v < x.expected ? "short" : "over";
          return [
            <span key={x.k + "s"} className="ci2-sz">{sz(x.size)}</span>,
            <span key={x.k + "o"} className={"ci2-of " + tone}>{t("of {0}", x.expected)}{has && v < x.expected ? ` · ${t("{0} short", x.expected - v)}` : has && v > x.expected ? ` · ${t("{0} over", v - x.expected)}` : ""}{bad[x.k]?.bad ? ` · ${t(bad[x.k].issue === "mispick" ? "{0} wrong" : "{0} damaged", bad[x.k].bad)}` : ""}</span>,
            <input key={x.k + "i"} className={tone} inputMode="numeric" pattern="[0-9]*" placeholder="–" value={has ? String(v) : ""} aria-label={`${name(x)} ${sz(x.size)}`} onChange={(e) => setOne(x.k, e.target.value)} />,
          ];
        })}</div>
        <button type="button" className={"jm-ghost" + (itCells.some((x) => bad[x.k]?.bad) ? " on" : "")} onClick={() => setAsking(!asking)}>{asking ? t("Close") : t("Damaged / wrong item")}</button>
        {asking && (
          <div className="jm-ck-bad">
            <div className="jm-chips">{itCells.map((x) => <button key={x.k} type="button" className={"jm-chip" + (x.k === bk ? " on" : "")} onClick={() => setBadK(x.k)}>{sz(x.size)}</button>)}</div>
            <div className="jm-chips">{(["damaged", "mispick"] as Issue[]).map((k) => <button key={k} type="button" className={"jm-chip" + ((bad[bk]?.issue || "damaged") === k ? " on" : "")} onClick={() => setBad({ ...bad, [bk]: { issue: k, bad: bad[bk]?.bad || 1 } })}>{t(k === "damaged" ? "Damaged" : "Wrong item")}</button>)}</div>
            <div className="jm-count">
              <button type="button" aria-label="−" onClick={() => setBad({ ...bad, [bk]: { issue: bad[bk]?.issue || "damaged", bad: Math.max(0, (bad[bk]?.bad || 0) - 1) } })}>−</button>
              <input inputMode="numeric" value={bad[bk]?.bad || 0} aria-label={t("How many")} onChange={(e) => setBad({ ...bad, [bk]: { issue: bad[bk]?.issue || "damaged", bad: +e.target.value.replace(/\D/g, "") || 0 } })} />
              <button type="button" aria-label="+" onClick={() => setBad({ ...bad, [bk]: { issue: bad[bk]?.issue || "damaged", bad: (bad[bk]?.bad || 0) + 1 } })}>+</button>
            </div>
            <small className="jm-faint">{t("Count them in the number above too; this says how many of them are no good.")}</small>
          </div>
        )}
      </div>
      {err && <div className="jm-err">{err}</div>}
      <button type="button" className={"jm-go" + (last ? " ci2-done" : "")} onClick={next}>{last ? t("Review and check in") : t("Next: {0} →", name({ item: nextIt || it }))}</button>
      {stop}
    </div>
  );
}
