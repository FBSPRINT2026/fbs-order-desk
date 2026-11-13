"use client";
import { useEffect, useMemo, useState } from "react";
import type { JobCard } from "@/lib/jobCard";
import { bySize, type CheckJob } from "@/lib/checkinShared";
import { useT } from "./lang";

/**
 * The post count (the catcher, at the end of the oven; Nick, Nov 13 2026: "they should only have to correct it"). Each
 * size starts at the count-in; they change only what's different. Rejects either print again or the job goes short
 * (a reseller's waste); a wrong count-in is fixed here too. Then where the job goes: Ship, or the shelf for Pickup or
 * Delivery, and it can move on to Ready.
 */
type Row = { key: string; style: string; color: string; size: string; pre: number; was: number; post: number; reject: number };

export default function PostCount({ card, checkin, job }: { card: JobCard; checkin: CheckJob | null | undefined; job: { kind: "o" | "a"; id: string } }) {
  const { t } = useT();
  // the count-in by size (the latest count, else what was ordered)
  const start = useMemo<Row[]>(() => {
    const last = (checkin?.checkins || [])[0];
    const src = last?.lines?.length
      ? last.lines.map((l) => ({ style: l.style, color: l.color, size: l.size, n: l.received }))
      : card.groups.flatMap((g) => g.rows.flatMap((r) => r.sizes.map((z) => ({ style: r.style || r.desc, color: r.color, size: z.label, n: z.qty }))));
    const m = new Map<string, Row>();
    for (const x of src) {
      const key = `${x.style}|${x.color}|${x.size}`;
      const r = m.get(key) || { key, style: x.style, color: x.color, size: x.size, pre: 0, was: 0, post: 0, reject: 0 };
      r.pre += x.n; r.was += x.n; r.post += x.n; m.set(key, r);
    }
    return [...m.values()].sort((a, b) => a.style.localeCompare(b.style) || a.color.localeCompare(b.color) || bySize(a.size, b.size));
  }, [checkin, card]);
  const fromCount = !!(checkin?.checkins || [])[0]?.lines?.length;
  const [rows, setRows] = useState<Row[]>(start);
  const [fixing, setFixing] = useState(false);
  const [outcome, setOutcome] = useState<"reprint" | "short">("reprint");
  const [ready, setReady] = useState(true), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [saved, setSaved] = useState<string[] | null>(null);
  const [last, setLast] = useState<{ post: number; pre: number; rejects: number; by: string; created_at: string } | null>(null);
  useEffect(() => { fetch(`/api/jobs/post?kind=${job.kind}&id=${job.id}`, { cache: "no-store" }).then((r) => r.json()).then((j) => setLast((j.counts || [])[0] || null)).catch(() => null); }, [job.kind, job.id, saved]);

  const set = (key: string, k: "pre" | "post" | "reject", v: number) => setRows((rs) => rs.map((r) => {
    if (r.key !== key) return r;
    const n = { ...r, [k]: Math.max(0, v) };
    // fixing the count-in moves "here now" with it while it hadn't been changed
    if (k === "pre" && r.post === r.pre) n.post = n.pre;
    return n;
  }));
  const tot = rows.reduce((a, r) => ({ pre: a.pre + r.pre, post: a.post + r.post, reject: a.reject + r.reject }), { pre: 0, post: 0, reject: 0 });
  const missing = Math.max(0, tot.pre - tot.post);
  const groups = [...new Set(rows.map((r) => `${r.style}|${r.color}`))];
  const where = card.delivery === "ship" ? { h: t("Goes to shipping"), p: t("Box it, label each box, and take it to the shipping table.") }
    : card.delivery === "deliver" ? { h: t("Goes on the delivery shelf"), p: t("Box it, label each box, and put it on the shelf for delivery.") }
    : card.delivery === "pickup" ? { h: t("Goes on the pickup shelf"), p: t("Box it, label each box, and put it on the shelf for pickup.") }
    : { h: t("Ask the office where it goes"), p: t("Pickup or shipping isn't set on this order yet.") };

  async function save() {
    setBusy(true); setErr("");
    const lines = rows.map((r) => ({ style: r.style, color: r.color, size: r.size, pre: r.pre, post: r.post, reject: r.reject, ...(r.pre !== r.was ? { was: r.was } : {}) }));
    const r = await fetch("/api/jobs/post", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job, lines, outcome: tot.reject ? outcome : "", ready: ready && !(tot.reject && outcome === "reprint"), note }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Offline. Try again." };
    setBusy(false);
    if (!r?.ok) return setErr(t(j.error || "Couldn't save."));
    setSaved(j.done || []); scrollTo(0, 0);
  }

  const Num = ({ v, on, label }: { v: number; on: (n: number) => void; label: string }) => (
    <span className="jm-pc-num" aria-label={label}>
      <button type="button" onClick={() => on(v - 1)} aria-label={t("One less")}>−</button>
      <input inputMode="numeric" value={v} onChange={(e) => on(+e.target.value.replace(/\D/g, "") || 0)} onFocus={(e) => e.target.select()} />
      <button type="button" onClick={() => on(v + 1)} aria-label={t("One more")}>+</button>
    </span>
  );

  if (saved) return (
    <>
      <div className="jm-card jm-pc-done">
        <b>{t("Post count saved")}</b>
        <p className="jm-faint">{t("{0} of {1} here", tot.post, tot.pre)}{tot.reject ? ` · ${t("{0} rejects", tot.reject)}` : ""}{saved.length ? ` · ${saved.map((x) => t(x)).join(" · ")}` : ""}</p>
      </div>
      <div className="jm-card jm-pc-where"><div className="jm-label">{t("Where it goes")}</div><b>{where.h}</b><p className="jm-faint">{where.p}</p></div>
      <button type="button" className="jm-link" onClick={() => setSaved(null)}>{t("Count again")}</button>
    </>
  );

  return (
    <>
      {last && <p className="jm-faint">{t("Last post count: {0} of {1} by {2}", last.post, last.pre, last.by)}</p>}
      <div className="jm-card jm-pc-where"><div className="jm-label">{t("Where it goes")}</div><b>{where.h}</b><p className="jm-faint">{where.p}</p></div>
      <div className="jm-card">
        <div className="jm-cardh"><b>{t("Here now")}</b><button type="button" className="jm-link" onClick={() => setFixing(!fixing)}>{fixing ? t("Done fixing") : t("Count-in was wrong?")}</button></div>
        <p className="jm-faint">{fromCount ? t("Filled in from the count-in. Change only what's different.") : t("Nothing was counted in, so this starts from the order.")}</p>
        {groups.map((gk) => {
          const rs = rows.filter((r) => `${r.style}|${r.color}` === gk);
          return (
            <div key={gk} className="jm-pc-g">
              <div className="jm-pc-gh"><b>{rs[0].style || t("Garment")}</b> <span>{rs[0].color}</span></div>
              {rs.map((r) => (
                <div key={r.key} className={"jm-pc-row" + (r.post !== r.pre ? " off" : "") + (r.reject ? " rej" : "")}>
                  <span className="jm-pc-size" data-notranslate>{r.size}</span>
                  {fixing ? <span className="jm-pc-col"><small>{t("Count-in")}</small><Num v={r.pre} on={(n) => set(r.key, "pre", n)} label={t("Count-in")} /></span>
                    : <span className="jm-pc-col pre"><small>{t("Count-in")}</small><b>{r.pre}</b></span>}
                  <span className="jm-pc-col"><small>{t("Here now")}</small><Num v={r.post} on={(n) => set(r.key, "post", n)} label={t("Here now")} /></span>
                  <span className="jm-pc-col"><small>{t("Rejects")}</small><Num v={r.reject} on={(n) => set(r.key, "reject", n)} label={t("Rejects")} /></span>
                </div>
              ))}
            </div>
          );
        })}
        <div className="jm-pc-tot"><span>{t("Count-in")} <b>{tot.pre}</b></span><span>{t("Here now")} <b>{tot.post}</b></span>{tot.reject > 0 && <span>{t("Rejects")} <b>{tot.reject}</b></span>}{missing > 0 && <span className="bad">{t("{0} short", missing)}</span>}</div>
      </div>
      {tot.reject > 0 && (
        <div className="jm-card">
          <div className="jm-label">{t("The rejects")}</div>
          <div className="jm-pc-seg">
            <button type="button" className={outcome === "reprint" ? "on" : ""} onClick={() => setOutcome("reprint")}>{t("Reprint them")}<small>{t("{0} pcs go back on the schedule", tot.reject)}</small></button>
            <button type="button" className={outcome === "short" ? "on" : ""} onClick={() => setOutcome("short")}>{t("Ship it short")}<small>{t("Within their waste")}</small></button>
          </div>
        </div>
      )}
      <div className="jm-card">
        <label className="jm-label" htmlFor="pc-note">{t("Note (optional)")}</label>
        <textarea id="pc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Anything the office should know")} />
        {card.kind === "o" && !(tot.reject && outcome === "reprint") && <label className="jm-pc-ready"><input type="checkbox" checked={ready} onChange={(e) => setReady(e.target.checked)} /> {t("It's boxed: move the order to Ready")}</label>}
      </div>
      {err && <div className="jm-err" role="alert">{err}</div>}
      <button type="button" className="jm-go" disabled={busy} onClick={save}>{busy ? t("Saving…") : tot.post === tot.pre && !tot.reject ? t("All here · save") : t("Save the post count")}</button>
    </>
  );
}
