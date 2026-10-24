"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import { useCan, useRole } from "@/components/RoleContext";
import { THREAD_LINES, closestThreads, lineBrand, lineName, threadLabel, threads, type Thread } from "@/lib/embroidery";
import { forgetThreadStock, stockKey, type StockThread } from "@/lib/threadStock";
import { PMS_COATED } from "@/lib/pms";

/**
 * Thread Room (Oct 23, Nick: "just like we have the ink room, we need to have the thread room… its little logo can be a
 * spool"). The embroidery side's Ink Room, for Maria and her team:
 *   - Standard colors: the Madeira Polyneon colors we keep, like the stock inks (Oct 23, Nick: "make these threads
 *     our standard thread… think of them like stock ink colors": the 42 Polyneon colors of Madeira's #919-48 kit), with
 *     cones on hand, the low mark and where each hangs; first in every list
 *   - Thread cards: every Madeira Polyneon 40, Classic Rayon 40 and Isacord 40 color with its PMS; tap one to see it, put it on the
 *     wall or take it off (the Mockup Creator suggests a thread we stock first when it's about as close)
 *   - Match a color: a PMS or a color → the closest Madeira threads, the same match the Mockup Creator makes
 * Kept in stock_threads (archived, never deleted). Changing it takes the Thread Room permission.
 */
type Tab = "wall" | "card" | "match";
type Draft = { cones: string; min: string; spot: string; notes: string };
const pmsHexOf = (q: string) => {
  const t = q.trim().replace(/^(pms|pantone)\s*/i, "").replace(/\s+/g, " ");
  if (/^#?[0-9a-f]{6}$/i.test(t)) return { hex: t.startsWith("#") ? t : "#" + t, label: t.startsWith("#") ? t.toUpperCase() : "#" + t.toUpperCase() };
  const want = t.replace(/\s+[cu]$/i, "").toLowerCase();
  const k = Object.keys(PMS_COATED).find((n) => n.replace(/^PMS\s*/, "").replace(/\s+C$/, "").toLowerCase() === want);
  return k ? { hex: PMS_COATED[k], label: k } : null;
};

export default function ThreadRoom() {
  const canEdit = useCan("threadRoom");
  const { email } = useRole();
  const [tab, setTab] = useSticky<Tab>("threads.tab", "wall");
  const [line, setLine] = useSticky<Thread["line"]>("threads.line", "Polyneon 40");
  const [q, setQ] = useState(""), [mq, setMq] = useState("");
  const [stock, setStock] = useState<StockThread[] | null>(null);
  const [sel, setSel] = useState<Thread | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const all = useMemo(() => threads(), []);
  const load = () => createClient().from("stock_threads").select("*").is("archived_at", null).order("code").then(({ data, error }) => { if (error) setErr(error.message); setStock((data || []) as StockThread[]); });
  useEffect(() => { void load(); }, []);
  const onWall = (t: Thread) => (stock || []).find((s) => s.line === t.line && s.code === t.code) || null;
  const card = useMemo(() => {
    const t = q.trim().toLowerCase().replace(/^(pms|pantone)\s*/, "");
    return all.filter((x) => x.line === line && (!t || x.code.startsWith(t) || x.name.toLowerCase().includes(t) || x.pms.some((p) => p.toLowerCase().includes(t))));
  }, [all, line, q]);
  const wall = useMemo(() => (stock || []).map((s) => all.find((t) => t.line === s.line && t.code === s.code) || ({ line: s.line as Thread["line"], code: s.code, name: s.name, hex: s.hex, pms: s.pms ? [s.pms] : [] } as Thread))
    .filter((t) => { const x = q.trim().toLowerCase(); return !x || t.code.startsWith(x) || t.name.toLowerCase().includes(x); }), [stock, all, q]);
  const want = pmsHexOf(mq);
  const stockSet = new Set((stock || []).map((s) => stockKey(s.line, s.code)));
  // the maker's own match for a PMS first (their conversion chart), then the closest by color
  const pmsKey = want && /^PMS /.test(want.label) ? want.label.replace(/^PMS\s*/, "").toLowerCase() : "";
  const makers = pmsKey ? all.filter((t) => t.line === line && t.pms.some((p) => p.toLowerCase() === pmsKey)) : [];
  const matches = want ? [...makers.map((t) => ({ ...closestThreads(want.hex, { line, n: 400, stock: stockSet }).find((x) => x.code === t.code)!, maker: true })).filter((x) => x.code), ...closestThreads(want.hex, { line, n: 8, stock: stockSet }).filter((x) => !makers.some((m) => m.code === x.code)).map((x) => ({ ...x, maker: false }))] : [];

  function pick(t: Thread) {
    setSel(t); setErr("");
    const s = onWall(t);
    setDraft({ cones: s?.cones != null ? String(s.cones) : "", min: s?.min_cones != null ? String(s.min_cones) : "", spot: s?.spot || "", notes: s?.notes || "" });
  }
  async function putOnWall(t: Thread, on: boolean) {
    setBusy(true); setErr("");
    const sb = createClient(), s = onWall(t);
    const r = on
      ? await sb.from("stock_threads").insert({ brand: lineBrand(t.line), line: t.line, code: t.code, name: t.name, hex: t.hex, pms: t.pms[0] || "", created_by: email || "" })
      : s ? await sb.from("stock_threads").update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", s.id) : { error: null };
    setBusy(false);
    if (r.error) { setErr(r.error.message); return; }
    forgetThreadStock(); void load();
  }
  async function saveDraft() {
    if (!sel || !draft) return;
    const s = onWall(sel); if (!s) return;
    setBusy(true); setErr("");
    const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.round(+v || 0)));
    const { error } = await createClient().from("stock_threads").update({ cones: num(draft.cones), min_cones: num(draft.min), spot: draft.spot.trim(), notes: draft.notes.trim(), updated_at: new Date().toISOString() }).eq("id", s.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    void load();
  }

  const low = (stock || []).filter((s) => s.cones != null && s.min_cones != null && s.cones <= s.min_cones).length;
  const tile = (t: Thread) => {
    const s = onWall(t), isLow = !!s && s.cones != null && s.min_cones != null && s.cones <= s.min_cones;
    return (
      <button key={t.line + t.code} type="button" className={"ink-tile thr-tile" + (sel?.code === t.code && sel.line === t.line ? " on" : "") + (s ? " in" : "")} onClick={() => pick(t)} title={`${threadLabel(t)}${t.pms.length ? ` · PMS ${t.pms[0]}` : ""}`}>
        <i style={{ background: t.hex || "#ddd" }} className="thr-spool" />
        <b data-notranslate>{t.code}</b>
        <small>{t.name}</small>
        {s ? <small className={"ink-instock" + (isLow ? " low" : "")}>{s.cones != null ? `Standard · ${s.cones} cone${s.cones === 1 ? "" : "s"}` : "Standard"}{isLow ? " · low" : ""}</small> : t.pms.length ? <small className="faint" data-notranslate>PMS {t.pms[0].replace(/^PMS\s*/i, "")}</small> : null}
      </button>
    );
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Thread Room</h1><div className="eyebrow">Embroidery threads: Madeira Polyneon (our standard) and Isacord, matched to PMS</div></div>
        <div className="faint" style={{ fontSize: 13 }}>{stock ? `${stock.length} standard colors${low ? ` · ${low} low` : ""}` : "Loading…"} {THREAD_LINES.map((l) => ` · ${all.filter((t) => t.line === l).length} ${lineName(l).replace(/^Madeira /, "")}`).join("")}</div>
      </div>
      {err && <div className="pv-err">{err}</div>}
      <div className="ink-wrap">
        <section className="panel ink-list">
          <div className="panel-b stack" style={{ gap: 10 }}>
            <div className="toolbar">
              <div className="chips" role="tablist">
                <button type="button" role="tab" aria-selected={tab === "wall"} className={"chip" + (tab === "wall" ? " on" : "")} onClick={() => setTab("wall")}>Standard colors{stock ? ` (${stock.length})` : ""}</button>
                <button type="button" role="tab" aria-selected={tab === "card"} className={"chip" + (tab === "card" ? " on" : "")} onClick={() => setTab("card")}>Thread cards</button>
                <button type="button" role="tab" aria-selected={tab === "match"} className={"chip" + (tab === "match" ? " on" : "")} onClick={() => setTab("match")}>Match a color</button>
              </div>
              <select value={line} onChange={(e) => setLine(e.target.value as Thread["line"])} aria-label="Thread line">{THREAD_LINES.map((l) => <option key={l} value={l}>{lineName(l)}</option>)}</select>
            </div>
            {tab === "match" ? (
              <>
                <input className="ink-q" type="search" value={mq} onChange={(e) => setMq(e.target.value)} placeholder="A PMS (2745, 021 C) or a color (#2A007C)" aria-label="PMS or color to match" autoFocus />
                {mq.trim() && !want && <div className="faint">Type a PMS number like 2745 or 021, or a color like #2A007C.</div>}
                {want && (
                  <div className="thr-match">
                    <div className="thr-want"><i style={{ background: want.hex }} /><b data-notranslate>{want.label}</b></div>
                    <table className="tbl"><thead><tr><th>Thread</th><th>PMS</th><th>How close</th><th /></tr></thead>
                      <tbody>{matches.map((t) => (
                        <tr key={t.code} onClick={() => pick(t)} style={{ cursor: "pointer" }}>
                          <td><span className="sw thr-sw" style={{ background: t.hex }} /> <b data-notranslate>{t.code}</b> {t.name}</td>
                          <td className="faint" data-notranslate>{t.pms.join(", ") || "—"}</td>
                          <td>{t.maker ? <b>{lineName(line).split(" ")[0]}&apos;s match for this PMS</b> : <>{t.word} <span className="faint">(ΔE {t.dE})</span></>}</td>
                          <td>{t.stocked ? <span className="ink-instock">Standard</span> : null}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <>
                <input className="ink-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a thread: number, name or PMS" aria-label="Find a thread" />
                {tab === "wall" && <div className="faint" style={{ fontSize: 13 }}>Our standard colors: the threads we keep on the wall, like the stock inks. The Mockup Creator picks one of these when it&apos;s close; anything else is a special order. {canEdit ? "Tap one to set cones on hand, the low mark and where it hangs." : ""}</div>}
                {tab === "card" && <div className="faint" style={{ fontSize: 13 }}>Every {lineName(line)} color with its PMS, our standard colors first. {canEdit ? "Tap one to make it a standard color or take it off." : ""}</div>}
                {!stock ? <div className="faint">Loading…</div> : (() => {
                  const xs = tab === "wall" ? wall : card;
                  // the thread cards: our standard colors first, then the rest of the card
                  if (tab === "card" && xs.length) {
                    const std = xs.filter((t) => onWall(t)), rest = xs.filter((t) => !onWall(t));
                    return <>
                      {std.length > 0 && <div className="ink-group"><h3>Standard colors <span className="faint">{std.length}</span></h3><div className="ink-grid">{std.map(tile)}</div></div>}
                      <div className="ink-group"><h3>{std.length ? "Special order" : `All ${lineName(line)} colors`} <span className="faint">{rest.length}</span></h3><div className="ink-grid">{rest.slice(0, 600).map(tile)}</div></div>
                    </>;
                  }
                  if (!xs.length) return <div className="faint">{q ? `No thread matches “${q}”.` : tab === "wall" ? "No standard colors yet. Open the thread cards and add the threads we keep." : "No threads on file for this line yet."}</div>;
                  return <div className="ink-grid">{xs.slice(0, 600).map(tile)}</div>;
                })()}
              </>
            )}
          </div>
        </section>

        <section className="panel ink-calc" aria-live="polite">
          <div className="panel-b stack">
            {!sel ? <div className="faint">Tap a thread to see it here.</div> : (() => {
              const s = onWall(sel);
              return (
                <>
                  <div className="thr-big"><i style={{ background: sel.hex }} /><div><h2 data-notranslate>{sel.code} {sel.name}</h2><div className="faint">{lineName(sel.line)}{sel.pms.length ? <> · PMS <span data-notranslate>{sel.pms.join(", ")}</span></> : ""}</div></div></div>
                  <div className="faint" style={{ fontSize: 12.5 }}>On an order it reads <b data-notranslate>{threadLabel(sel)}</b>. Screen colors are close, not exact: check the real cone.</div>
                  {canEdit && <div className="row" style={{ gap: 8 }}>
                    {s ? <button type="button" className="btn" disabled={busy} onClick={() => void putOnWall(sel, false)}>Not a standard color</button>
                      : <button type="button" className="btn primary" disabled={busy} onClick={() => void putOnWall(sel, true)}>Make it a standard color</button>}
                  </div>}
                  {s && draft && (
                    <div className="stack thr-form">
                      <div className="row" style={{ gap: 8 }}>
                        <label className="f-col"><span className="imp-l">Cones on hand</span><input type="number" min={0} value={draft.cones} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, cones: e.target.value })} /></label>
                        <label className="f-col"><span className="imp-l">Low at</span><input type="number" min={0} value={draft.min} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, min: e.target.value })} placeholder="2" /></label>
                      </div>
                      <label className="f-col"><span className="imp-l">Where it hangs</span><input value={draft.spot} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, spot: e.target.value })} placeholder="Wall B, row 3" /></label>
                      <label className="f-col"><span className="imp-l">Notes</span><input value={draft.notes} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
                      {canEdit && <div><button type="button" className="btn primary" disabled={busy} onClick={() => void saveDraft()}>Save</button></div>}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </section>
      </div>
    </>
  );
}
