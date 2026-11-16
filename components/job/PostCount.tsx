"use client";
import { useEffect, useMemo, useState } from "react";
import type { JobCard } from "@/lib/jobCard";
import { bySize, type CheckJob } from "@/lib/checkinShared";
import { myPrinter } from "@/lib/labelPrinter";
import LabelPrinterPick from "@/components/LabelPrinterPick";
import { useT } from "./lang";

/**
 * The final count (the catcher, at the end of the dryer; Nick, Nov 13 + Nov 16 2026: "it's my job to put in the final
 * count… and the number of boxes"). One grid, a row per garment and a column per size, filled in from the count-in with
 * the press operator's rejects already taken off, so only a box that's off is touched. Then how many boxes, and one
 * button saves the count and prints that many box labels. Rejects beyond the operator's print again or go short; a
 * wrong count-in is fixed here too.
 */
type Row = { key: string; style: string; color: string; size: string; pre: number; was: number; post: number; reject: number; filed: number };
type Mode = "post" | "reject" | "pre";

export default function PostCount({ card, checkin, job }: { card: JobCard; checkin: CheckJob | null | undefined; job: { kind: "o" | "a"; id: string } }) {
  const { t } = useT();
  const start = useMemo<Row[]>(() => {
    const last = (checkin?.checkins || [])[0];
    const src = last?.lines?.length
      ? last.lines.map((l) => ({ style: l.style, color: l.color, size: l.size, n: l.received }))
      : card.groups.flatMap((g) => g.rows.flatMap((r) => r.sizes.map((z) => ({ style: r.style || r.desc, color: r.color, size: z.label, n: z.qty }))));
    const m = new Map<string, Row>();
    for (const x of src) {
      const key = `${x.style}|${x.color}|${x.size}`;
      const r = m.get(key) || { key, style: x.style, color: x.color, size: x.size, pre: 0, was: 0, post: 0, reject: 0, filed: 0 };
      r.pre += x.n; r.was += x.n; r.post += x.n; m.set(key, r);
    }
    return [...m.values()].sort((a, b) => a.style.localeCompare(b.style) || a.color.localeCompare(b.color) || bySize(a.size, b.size));
  }, [checkin, card]);
  const fromCount = !!(checkin?.checkins || [])[0]?.lines?.length;
  const [rows, setRows] = useState<Row[]>(start);
  const [mode, setMode] = useState<Mode>("post");
  const [q, setQ] = useState("");
  const [outcome, setOutcome] = useState<"reprint" | "short">("reprint");
  const [boxes, setBoxes] = useState(Math.max(1, Math.ceil((card.qty || 0) / 72)));
  const [ready, setReady] = useState(true), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [saved, setSaved] = useState<{ done: string[]; printed: string } | null>(null);
  const [last, setLast] = useState<{ post: number; pre: number; rejects: number; by: string; created_at: string } | null>(null);

  // the press operator's rejects (marked when the side was done): taken off "here now" and shown as rejects already filed
  useEffect(() => {
    fetch(`/api/jobs/post?kind=${job.kind}&id=${job.id}`, { cache: "no-store" }).then((r) => r.json()).then((j) => {
      setLast((j.counts || [])[0] || null);
      const rej = (j.rejects || []) as { style?: string; color?: string; size: string; n: number }[];
      if (!rej.length) return;
      setRows((rs) => {
        const out = rs.map((r) => ({ ...r }));
        for (const x of rej) {
          let left = x.n;
          for (const r of out.filter((r) => r.size === x.size && (!x.style || r.style === x.style) && (!x.color || r.color === x.color))) {
            const k = Math.min(left, r.post - r.reject); if (k <= 0) continue;
            r.reject += k; r.filed += k; r.post -= k; left -= k; if (!left) break;
          }
        }
        return out;
      });
    }).catch(() => null);
  }, [job.kind, job.id]);

  const set = (key: string, v: number) => setRows((rs) => rs.map((r) => {
    if (r.key !== key) return r;
    const n = Math.max(0, v);
    if (mode === "pre") return { ...r, pre: n, post: r.post === r.pre - r.reject ? Math.max(0, n - r.reject) : r.post };
    if (mode === "reject") { const d = n - r.reject; return { ...r, reject: n, post: Math.max(0, r.post - d) }; }
    return { ...r, post: n };
  }));
  const tot = rows.reduce((a, r) => ({ pre: a.pre + r.pre, post: a.post + r.post, reject: a.reject + r.reject, filed: a.filed + r.filed }), { pre: 0, post: 0, reject: 0, filed: 0 });
  const missing = Math.max(0, tot.pre - tot.post - tot.reject);
  const newRej = tot.reject - tot.filed;
  const sizes = ([...new Set(rows.map((r) => r.size))] as string[]).sort(bySize);
  const garments = [...new Set(rows.map((r) => `${r.style}|${r.color}`))];
  const shown = garments.filter((g) => !q.trim() || g.toLowerCase().includes(q.trim().toLowerCase()));
  const where = card.delivery === "ship" ? t("Goes to shipping") : card.delivery === "deliver" ? t("Goes on the delivery shelf") : card.delivery === "pickup" ? t("Goes on the pickup shelf") : t("Ask the office where it goes");

  async function save(print: boolean) {
    setBusy(true); setErr("");
    const lines = rows.map((r) => ({ style: r.style, color: r.color, size: r.size, pre: r.pre, post: r.post, reject: r.reject, filed: r.filed, ...(r.pre !== r.was ? { was: r.was } : {}) }));
    const r = await fetch("/api/jobs/post", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job, lines, boxes: print ? boxes : null, outcome: newRej ? outcome : "", ready: ready && !(newRej && outcome === "reprint"), note }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Offline. Try again." };
    if (!r?.ok) { setBusy(false); return setErr(t(j.error || "Couldn't save.")); }
    let printed = "";
    if (print) {
      const p = await fetch("/api/print", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "box", job, boxes, known: true, printer: myPrinter() }) }).catch(() => null);
      const pj = p ? await p.json().catch(() => ({})) : { message: "The labels didn't print. Try again from Box labels." };
      printed = t(pj.message || pj.error || (p?.ok ? "Labels sent to the printer." : "The labels didn't print."));
    }
    setBusy(false); setSaved({ done: j.done || [], printed }); scrollTo(0, 0);
  }

  if (saved) return (
    <>
      <div className="jm-card jm-fc-done">
        <div className="jm-fc-big">{tot.post}</div>
        <p className="jm-faint">{t("good pieces")}{tot.reject ? ` · ${t("{0} rejects", tot.reject)}` : ""}{missing ? ` · ${t("{0} short", missing)}` : ""}</p>
        {saved.printed && <p className="jm-faint">{saved.printed}</p>}
        {saved.done.length > 0 && <p className="jm-faint">{saved.done.map((x) => t(x)).join(" · ")}</p>}
      </div>
      <div className="jm-card jm-pc-where"><div className="jm-label">{t("Where it goes")}</div><b>{where}</b></div>
      <button type="button" className="jm-link" onClick={() => setSaved(null)}>{t("Count again")}</button>
    </>
  );

  const val = (r: Row) => (mode === "pre" ? r.pre : mode === "reject" ? r.reject : r.post);
  return (
    <>
      {last && <p className="jm-faint">{t("Last count: {0} of {1} by {2}", last.post, last.pre, last.by)}</p>}
      <div className="jm-card">
        <div className="jm-cardh"><b>{t("Final count")}</b><span className="jm-faint">{tot.filed ? t("{0} rejects from the press", tot.filed) : ""}</span></div>
        <p className="jm-faint">{fromCount ? t("Filled in from the count-in. Tap only a box that's off.") : t("Nothing was counted in, so this starts from the order.")}</p>
        <div className="jm-fc-modes" role="group">{(["post", "reject", "pre"] as Mode[]).map((m) => <button key={m} type="button" className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{t(m === "post" ? "Here now" : m === "reject" ? "Rejects" : "Count-in")}</button>)}</div>
        {garments.length > 6 && <input type="search" className="jm-fc-q" placeholder={t("Find a style or color")} value={q} onChange={(e) => setQ(e.target.value)} />}
        <div className="jm-fc-grid" style={{ gridTemplateColumns: `minmax(72px,1.4fr) repeat(${sizes.length}, minmax(0,1fr))` }}>
          <span className="jm-fc-h" />
          {sizes.map((z) => <span key={z} className="jm-fc-h" data-notranslate>{z}</span>)}
          {shown.map((g) => {
            const [style, color] = g.split("|");
            return [
              <span key={g} className="jm-fc-g"><b data-notranslate>{style}</b><small>{color}</small></span>,
              ...sizes.map((z) => {
                const r = rows.find((x) => x.style === style && x.color === color && x.size === z);
                if (!r) return <span key={g + z} />;
                const off = mode === "post" ? r.post !== r.pre - r.reject : mode === "pre" ? r.pre !== r.was : r.reject > 0;
                return (
                  <label key={g + z} className={"jm-fc-c" + (off ? (mode === "reject" ? " rej" : " off") : "")}>
                    <input inputMode="numeric" value={val(r)} onFocus={(e) => e.target.select()} onChange={(e) => set(r.key, +e.target.value.replace(/\D/g, "") || 0)} aria-label={`${style} ${color} ${z}`} />
                    <small>{mode === "post" ? `${t("of {0}", r.pre)}${r.reject ? ` · ${r.reject}✕` : ""}` : mode === "reject" ? (r.filed ? t("{0} press", r.filed) : "") : r.pre !== r.was ? t("was {0}", r.was) : ""}</small>
                  </label>
                );
              }),
            ];
          })}
        </div>
        <div className="jm-fc-sum"><span>{t("Good pieces")}</span><b>{tot.post} <small>{t("of {0}", tot.pre)}{tot.reject ? ` · ${t("{0} rejects", tot.reject)}` : ""}</small></b></div>
        {missing > 0 && <div className="jm-warn">{t("{0} short of the count-in", missing)}</div>}
      </div>
      {newRej > 0 && (
        <div className="jm-card">
          <div className="jm-label">{t("The {0} new rejects", newRej)}</div>
          <div className="jm-pc-seg">
            <button type="button" className={outcome === "reprint" ? "on" : ""} onClick={() => setOutcome("reprint")}>{t("Reprint them")}<small>{t("{0} pcs go back on the schedule", newRej)}</small></button>
            <button type="button" className={outcome === "short" ? "on" : ""} onClick={() => setOutcome("short")}>{t("Ship it short")}<small>{t("Within their waste")}</small></button>
          </div>
        </div>
      )}
      <div className="jm-card">
        <div className="jm-label">{t("How many boxes?")}</div>
        <div className="jm-count">
          <button type="button" aria-label={t("One fewer box")} onClick={() => setBoxes(Math.max(1, boxes - 1))}>−</button>
          <input inputMode="numeric" value={boxes} onChange={(e) => setBoxes(Math.max(1, Math.min(99, +e.target.value.replace(/\D/g, "") || 1)))} aria-label={t("Boxes")} />
          <button type="button" aria-label={t("One more box")} onClick={() => setBoxes(Math.min(99, boxes + 1))}>+</button>
        </div>
        <LabelPrinterPick />
        <details className="jm-fc-more"><summary>{t("Note")} · {where}</summary>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Anything the office should know")} />
          {card.kind === "o" && <label className="jm-pc-ready"><input type="checkbox" checked={ready} onChange={(e) => setReady(e.target.checked)} /> {t("It's boxed: move the order to Ready")}</label>}
        </details>
      </div>
      {err && <div className="jm-err" role="alert">{err}</div>}
      <button type="button" className="jm-go ok" disabled={busy} onClick={() => save(true)}>{busy ? t("Saving…") : t("✓ Count is right · print {0} labels", boxes)}</button>
      <button type="button" className="jm-ghost" disabled={busy} onClick={() => save(false)}>{t("Not sure yet · boxes later")}</button>
    </>
  );
}
