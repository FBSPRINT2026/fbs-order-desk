"use client";
import { useEffect, useState } from "react";
import type { JobCard } from "@/lib/jobCard";
import type { PhoneInk, PhoneInks as PhoneInksData } from "@/lib/jobInksServer";
import { batchQt, fmtVol, qtLabel } from "@/lib/inkPlan";
import { useT } from "./lang";

type Batch = PhoneInk["batches"][number];
const YEAR = 365.25 * 864e5;
const day = (d: string, loc: string) => new Date(d).toLocaleDateString(loc, { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });
const grams = (g: number) => (g < 10 ? g.toFixed(2) : g.toFixed(1)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " g";

/** "last made" rule: never logged, over ~2 years (just make it), or recent (look on the shelf first) */
function lastMade(b: Batch[]): { tone: "make" | "shelf" | "none"; at: Batch | null } {
  const at = b[0] || null;
  if (!at) return { tone: "none", at };
  return { tone: Date.now() - new Date(at.made_at).getTime() > 2 * YEAR ? "make" : "shelf", at };
}

function Swatch({ ink, big }: { ink: PhoneInk; big?: boolean }) {
  return <span className={"jm-sw" + (big ? " big" : "") + (ink.hex ? "" : " none")} style={ink.hex ? { background: ink.hex } : undefined} aria-hidden="true" />;
}

/**
 * The inks this job needs and about how much of each (lib/inkPlan.ts estimate). PMS colors open their Epic Rio formula:
 * tap Make, pick the batch (sized to the job, whole quarts then half gallons), weigh it out, and log it so the color's
 * history shows when it was last made.
 */
export default function PhoneInks({ card, data }: { card: JobCard; data: PhoneInksData }) {
  const { t, locale } = useT();
  const [sel, setSel] = useState<string | null>(null);
  const [hist, setHist] = useState<Record<string, Batch[]>>(() => Object.fromEntries(data.inks.map((x) => [x.key, x.batches])));
  // each ink is its own history entry, so Back returns to the list
  useEffect(() => { const on = (e: PopStateEvent) => setSel((e.state && e.state.ink) || null); addEventListener("popstate", on); return () => removeEventListener("popstate", on); }, []);
  const open = (k: string) => { history.pushState({ jm: "inks", ink: k }, ""); setSel(k); scrollTo(0, 0); };
  const ink = sel ? data.inks.find((x) => x.key === sel) : null;
  if (ink) return <InkDetail card={card} ink={ink} batches={hist[ink.key] || []} onLogged={(b) => setHist((h) => ({ ...h, [ink.key]: [b, ...(h[ink.key] || [])] }))} />;

  const status = (x: PhoneInk) => {
    if (x.kind === "white" || x.kind === "stock") return <span className="jm-ist ok">{t("On the shelf")}</span>;
    if (x.kind === "other") return <span className="jm-ist">{x.key === "x:unnamed" ? t("Name the colors on the separation") : t("No Epic Rio formula yet")}</span>;
    const m = lastMade(hist[x.key] || []);
    if (m.tone === "none") return <span className="jm-ist">{t("Mix it · no batch logged yet")}</span>;
    if (m.tone === "make") return <span className="jm-ist make">{t("Last made {0}: just make it", day(m.at!.made_at, locale))}</span>;
    return <span className="jm-ist ok">{t("Made {0}: check the shelf", day(m.at!.made_at, locale))}</span>;
  };

  return (
    <>
      {!data.inks.length && <div className="jm-card"><p>{t("No screen-print colors on this job yet.")}</p></div>}
      {data.inks.length > 0 && (
        <div className="jm-card">
          {data.inks.map((x) => (
            <button key={x.key} type="button" className="jm-ink" onClick={() => open(x.key)}>
              <Swatch ink={x} />
              <span className="jm-ink-main">
                <b>{x.key === "x:unnamed" ? t("Colors not named") : x.name}</b>
                <small>{x.where.map((w) => t(w.location)).join(", ")}{x.n > 1 ? ` · ${t("{0} screens", x.n)}` : ""}</small>
                {status(x)}
              </span>
              <span className="jm-ink-amt">≈ {fmtVol(x.grams, x.density)}</span>
            </button>
          ))}
        </div>
      )}
      <p className="jm-faint">
        {t("Estimates: ink on the shirts plus what stays in the screens.")}
        {data.noSeps ? " " + t("Some prints have no separation yet, so those use the default coverage.") : ""}
        {data.unnamed ? " " + t("Colors come from the Printavo job.") : ""}
      </p>
    </>
  );
}

function InkDetail({ card, ink, batches, onLogged }: { card: JobCard; ink: PhoneInk; batches: Batch[]; onLogged: (b: Batch) => void }) {
  const { t, locale } = useT();
  const need = batchQt(ink.grams, ink.density);
  const [mix, setMix] = useState(false), [qt, setQt] = useState(need);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const m = lastMade(batches);
  const lines = ink.lines || [];
  const perQt = (l: NonNullable<PhoneInk["lines"]>[number]) => (l.g != null ? l.g : ((l.pct || 0) * (ink.gramsPerQt || 0)) / 100);
  const total = lines.reduce((a, l) => a + perQt(l) * qt, 0);
  const down = () => setQt((q) => Math.max(1, q > 4 ? q - 2 : q - 1));
  const up = () => setQt((q) => Math.min(40, q >= 4 ? q + 2 : q + 1));

  async function log() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/inks/batches", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: ink.code, qt, grams: Math.round(total * 10) / 10, job: { kind: card.kind, id: card.id, label: `#${card.number} ${card.name || card.customer || ""}`.trim() } }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    setBusy(false);
    if (!r?.ok || !j.batch) return setMsg({ ok: false, text: t(j.error || "Couldn't save.") });
    onLogged(j.batch); setMix(false); setMsg({ ok: true, text: t("Logged {0} of {1}.", qtLabel(qt), ink.code) });
  }

  return (
    <>
      <div className="jm-card">
        <div className="jm-inkh"><Swatch ink={ink} big /><div><h2 className="jm-h">{ink.key === "x:unnamed" ? t("Colors not named") : ink.name}</h2><b className="jm-ink-need">≈ {fmtVol(ink.grams, ink.density)} {t("for this job")}</b></div></div>
        {ink.where.map((w, i) => <div key={i} className="jm-inkw"><span>{t(w.location)} · {t("{0} pcs", w.pieces)}</span><b>≈ {fmtVol(w.grams, ink.density)}</b></div>)}
        {ink.why && <p className="jm-faint">{ink.why}</p>}
        {(ink.kind === "white" || ink.kind === "stock") && <div className="jm-ok">{t("Pull it from the shelf.")}</div>}
        {ink.kind === "other" && <div className="jm-warn">{ink.key === "x:unnamed" ? t("The separation doesn't name its ink colors, so there's no formula to pull up. Ask the art department.") : t("No Epic Rio formula matches this name. Check the ink name on the separation, or look it up in IMS.")}</div>}
        {msg && <div className={msg.ok ? "jm-ok" : "jm-err"} role="status">{msg.text}</div>}
        {ink.kind === "pms" && !mix && (
          <>
            {m.tone === "make" && <div className="jm-warn">{t("Last made {0}, over two years ago. Just make it; no need to look for it.", day(m.at!.made_at, locale))}</div>}
            {m.tone === "shelf" && <div className="jm-ok">{t("Made {0} ({1}). There's probably some on the shelf: check before you mix.", day(m.at!.made_at, locale), qtLabel(+m.at!.qt))}</div>}
            <button type="button" className="jm-go" onClick={() => { setQt(need); setMix(true); setMsg(null); }}>{t("Make {0}", ink.code)}</button>
          </>
        )}
      </div>

      {ink.kind === "pms" && mix && (
        <div className="jm-card">
          <div className="jm-cardh"><b>{t("Mix {0}", ink.code)}</b><span className="jm-faint">{t("Epic Rio formula")}</span></div>
          <div className="jm-label">{t("How much to make")}</div>
          <div className="jm-count">
            <button type="button" aria-label={t("Less")} onClick={down}>−</button>
            <output className="jm-qt">{qtLabel(qt)}</output>
            <button type="button" aria-label={t("More")} onClick={up}>+</button>
          </div>
          <p className="jm-faint">{qt === need ? t("Sized for this job (≈ {0}), rounded up.", fmtVol(ink.grams, ink.density)) : t("This job needs ≈ {0}.", fmtVol(ink.grams, ink.density))}</p>
          <table className="jm-mix"><tbody>
            {lines.map((l, i) => <tr key={i}><td><b>{l.code}</b><small>{l.desc}</small></td><td className="r">{grams(perQt(l) * qt)}</td></tr>)}
            <tr className="tot"><td>{t("Total")}</td><td className="r">{grams(total)}</td></tr>
          </tbody></table>
          <button type="button" className="jm-go" disabled={busy} onClick={log}>{busy ? t("Saving…") : t("We made it: log {0}", qtLabel(qt))}</button>
          <button type="button" className="jm-ghost" disabled={busy} onClick={() => setMix(false)}>{t("Cancel")}</button>
        </div>
      )}

      {ink.kind === "pms" && (
        <div className="jm-card">
          <div className="jm-label">{t("History")}</div>
          {!batches.length && <p className="jm-faint">{t("No batch logged yet.")}</p>}
          {batches.slice(0, 6).map((b) => (
            <div key={b.id} className="jm-inkw"><span>{day(b.made_at, locale)}{b.made_by ? ` · ${b.made_by}` : ""}{b.job ? <small>{b.job}</small> : null}</span><b>{qtLabel(+b.qt)}</b></div>
          ))}
        </div>
      )}
    </>
  );
}
