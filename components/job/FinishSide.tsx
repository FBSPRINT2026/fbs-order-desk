"use client";
import { useState } from "react";
import type { JobCard } from "@/lib/jobCard";
import type { PressOption } from "@/lib/pressActual";
import type { Station } from "@/lib/production";
import { colorHex } from "@/lib/inkColors";
import PressLayout from "@/components/PressLayout";
import { useT } from "./lang";

/**
 * A side done on the press (Nick, Nov 16 2026: "I don't want a lot of click through… printed as planned… underneath
 * that… we had rejects… was this a complicated setup"). One screen: how many printed (filled in) and the inks, one big
 * "Printed as planned"; under it, only when something happened: rejects (a garment, then a size, each tap one), an ink
 * changed, the press setup to keep (the press drawn, tap a head), and on the last side why it took longer than planned
 * and by how much.
 */
export type Wrap = { rejects?: { style: string; color: string; size: string; n: number }[]; rejectWhy?: string; ink?: string; layout?: Station[]; slow?: { why: string; minutes: number; note?: string } };
const WHYS = ["Misprint", "Hole or stain", "Other"];
const SLOW = ["Ran out of ink", "The press went down", "Waiting on the customer's OK", "Waiting on goods", "Waiting on screens", "The setup was hard", "Something else"];
const CYCLE: Record<string, Station> = { print: "flash", flash: "cool", cool: "print", down: "print", roller: "print", flashdown: "flash" };

export default function FinishSide({ card, side, group, pieces0, last, press, busy, onSave, onCancel }: {
  card: JobCard; /** "Renegades · Full Front" or "Full Front" */ side: string; group: number | null; pieces0: number; /** the job's last side */ last: boolean;
  press?: PressOption; busy: boolean; onSave: (pieces: number, wrap: Wrap) => void; onCancel: () => void;
}) {
  const { t } = useT();
  const loc = side.replace(/^.* · /, "");
  const groups = group != null ? [card.groups[group]].filter(Boolean) : card.groups.filter((g) => g.prints.some((p) => p.location === loc));
  const inks = [...new Set(groups.flatMap((g) => g.prints.filter((p) => p.location === loc).flatMap((p) => p.inks.split(/\s*[,+/]\s*/).map((x) => x.trim()).filter(Boolean))))];
  const rows = groups.flatMap((g) => g.rows).filter((r) => r.total > 0);
  const [pcs, setPcs] = useState(pieces0);
  const [open, setOpen] = useState<"" | "rej" | "ink" | "setup" | "slow">("");
  const [rej, setRej] = useState<Record<string, number>>({}), [why, setWhy] = useState(WHYS[0]), [gOpen, setGOpen] = useState<number | null>(rows.length === 1 ? 0 : null), [q, setQ] = useState("");
  const [ink, setInk] = useState("");
  const [lay, setLay] = useState<Station[] | null>(null), [pick, setPick] = useState<number | null>(null);
  const [slow, setSlow] = useState(""), [slowMin, setSlowMin] = useState(30), [slowNote, setSlowNote] = useState("");
  const rejList = (Object.entries(rej) as [string, number][]).filter(([, n]) => n > 0).map(([k, n]) => { const [i, size] = k.split("|"); const r = rows[+i]; return { style: r?.style || r?.desc || "", color: r?.color || "", size, n }; });
  const rejN = rejList.reduce((a, r) => a + r.n, 0);
  const layout = lay || press?.layout || [];
  const changed = !!(rejN || ink.trim() || lay || slow);
  const save = () => onSave(pcs, { ...(rejN ? { rejects: rejList, rejectWhy: why } : {}), ...(ink.trim() ? { ink: ink.trim() } : {}), ...(lay ? { layout: lay } : {}), ...(slow ? { slow: { why: slow, minutes: slowMin, note: slowNote } } : {}) });
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => !q.trim() || `${r.style} ${r.color} ${r.desc}`.toLowerCase().includes(q.trim().toLowerCase()));
  const line = (k: typeof open, label: string, sub: string, red = false) => (
    <button type="button" className={"jm-fs-line" + (red ? " red" : "") + (open === k ? " on" : "")} onClick={() => setOpen(open === k ? "" : k)}><span>{label}{sub && <small>{sub}</small>}</span><i aria-hidden>{open === k ? "⌃" : "›"}</i></button>
  );
  return (
    <div className="jm-fs">
      <div className="jm-fs-h">{t("{0} done", t(loc))}</div>
      <div className="jm-fs-sheet">
        <div className="jm-label">{t("How many printed?")}</div>
        <div className="jm-count">
          <button type="button" onClick={() => setPcs(Math.max(0, pcs - 1))} aria-label={t("One less")}>−</button>
          <input inputMode="numeric" value={pcs} onChange={(e) => setPcs(+e.target.value.replace(/\D/g, "") || 0)} onFocus={(e) => e.target.select()} aria-label={t("Pieces")} />
          <button type="button" onClick={() => setPcs(pcs + 1)} aria-label={t("One more")}>+</button>
        </div>
        {inks.length > 0 && <div className="jm-fs-inks" data-notranslate>{inks.map((x) => <span key={x}><i style={{ background: colorHex(x) || "#888" }} />{x.replace(/^PMS\s*/i, "")}</span>)}</div>}
      </div>
      <button type="button" className="jm-go ok jm-fs-go" disabled={busy} onClick={save}>✓ {busy ? t("Saving…") : changed ? (rejN ? t("Done · {0} rejects", rejN) : t("Done")) : t("Printed as planned")}</button>

      {line("rej", rejN ? t("We had rejects · {0}", rejN) : t("We had rejects"), "", true)}
      {open === "rej" && (
        <div className="jm-fs-sheet red">
          {rejList.length > 0 && <div className="jm-fs-tags">{rejList.map((r) => <span key={r.style + r.color + r.size}>{[r.style, r.color].filter(Boolean).join(" ")} · {r.size} ×{r.n}</span>)}</div>}
          {rows.length > 6 && <input type="search" placeholder={t("Find a style or color")} value={q} onChange={(e) => setQ(e.target.value)} />}
          <div className="jm-fs-gar">
            {shown.map(({ r, i }) => {
              const n = r.sizes.reduce((a, z) => a + (rej[`${i}|${z.label}`] || 0), 0);
              return (
                <div key={i} className={"jm-fs-gr" + (gOpen === i ? " open" : "")}>
                  <button type="button" onClick={() => setGOpen(gOpen === i ? null : i)}><i style={{ background: colorHex(r.color) || "#888" }} /><b data-notranslate>{[r.style || r.desc, r.color].filter(Boolean).join(" ")}</b><small>{n ? t("{0} rejects", n) + " · " : ""}{t("{0} pcs", r.total)}</small></button>
                  {gOpen === i && <div className="jm-fs-sz">{r.sizes.filter((z) => z.qty > 0).map((z) => { const k = `${i}|${z.label}`, v = rej[k] || 0; return (
                    <span key={z.label} className={v ? "on" : ""}>
                      <button type="button" onClick={() => setRej({ ...rej, [k]: Math.min(z.qty, v + 1) })} aria-label={t("One more reject")}><small data-notranslate>{z.label}</small><b>{v}</b></button>
                      {v > 0 && <button type="button" className="jm-fs-minus" onClick={() => setRej({ ...rej, [k]: v - 1 })} aria-label={t("One less")}>−</button>}
                    </span>); })}</div>}
                </div>
              );
            })}
          </div>
          <div className="jm-fs-seg" style={{ gridTemplateColumns: `repeat(${WHYS.length}, minmax(0, 1fr))` }}>{WHYS.map((w) => <button key={w} type="button" className={why === w ? "on" : ""} onClick={() => setWhy(w)}>{t(w)}</button>)}</div>
          <small className="jm-faint">{t("Tap a size once for each reject. They go back on the schedule to reprint.")}</small>
        </div>
      )}

      {line("ink", ink.trim() ? t("Ink changed") : t("We changed an ink"), ink.trim())}
      {open === "ink" && <div className="jm-fs-sheet"><label className="jm-label" htmlFor="fs-ink">{t("What did you change?")}</label><input id="fs-ink" value={ink} onChange={(e) => setInk(e.target.value)} placeholder={t("PMS 286 → 2935, white hit twice…")} /></div>}

      {press && layout.length > 0 && line("setup", lay ? t("Press setup saved") : t("Save this press setup"), t("For a tricky one, so it's set up the same next time"))}
      {open === "setup" && press && (
        <div className="jm-fs-sheet">
          <div className="jm-label">{press.name} · {t("how it ran")}</div>
          <div className="jm-fs-press">
            <PressLayout layout={layout} size={280} mirror={press.mirror} label={press.name.replace(/\s*[·(].*$/, "")} sub={t("{0} color", layout.length)} selected={pick}
              onPick={(i) => { setPick(i); const l = [...layout]; l[i] = CYCLE[l[i]] || "print"; setLay(l); }} />
          </div>
          <small className="jm-faint">{t("Tap a head to change it: screen → flash → cool down. Kept for {0} until it's changed again.", press.name)}</small>
          {lay && <button type="button" className="jm-link" onClick={() => { setLay(null); setPick(null); }}>{t("Put it back the way it was")}</button>}
        </div>
      )}

      {last && line("slow", slow ? t("Took longer · {0}", t(slow)) : t("It took longer than planned"), "")}
      {last && open === "slow" && (
        <div className="jm-fs-sheet">
          <div className="jm-label">{t("Why?")}</div>
          <div className="jm-fs-why">{SLOW.map((w) => <button key={w} type="button" className={slow === w ? "on" : ""} onClick={() => setSlow(slow === w ? "" : w)}>{t(w)}</button>)}</div>
          <div className="jm-label">{t("How much longer?")}</div>
          <div className="jm-fs-seg" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>{[15, 30, 45, 60, 120].map((m) => <button key={m} type="button" className={slowMin === m ? "on" : ""} onClick={() => setSlowMin(m)}>{m < 60 ? `${m}m` : `${m / 60}h`}</button>)}</div>
          <input value={slowNote} onChange={(e) => setSlowNote(e.target.value)} placeholder={t("Note (optional)")} />
        </div>
      )}
      <button type="button" className="jm-ghost" onClick={onCancel}>{t("Cancel")}</button>
    </div>
  );
}
