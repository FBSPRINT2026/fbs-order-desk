"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/components/job/lang";
import { garmentHex } from "@/lib/mockup";
import GarmentShape, { garmentKind } from "@/components/GarmentShape";
import { garmentLooks, type GarmentLook } from "@/app/shop/receiving/garment-actions";
import { bySize, type CheckJob, type CheckLine, type CheckinRow, type Issue } from "@/lib/checkinShared";

/**
 * Count a job's goods in: one grid, garments down and sizes across (Oct 27, Nick picked "B3"), a box per size. Tap a size's expected number (or ✓ on the row,
 * or "Everything's here") to take the full amount; type what you actually counted when it's different. Any
 * difference, damage or wrong item becomes a problem with a reason, and the job shows up under Problems until it's
 * resolved.
 */
const REASONS: [Issue, string][] = [["short", "Short"], ["damaged", "Damaged"], ["mispick", "Wrong item"], ["over", "Extra"]];
export const ISSUE_WORD: Record<string, string> = { short: "Short", over: "Extra", damaged: "Damaged", mispick: "Wrong item" };
type Extra = { issue: Issue; bad: number; note: string };

export default function CheckinModal({ job, onClose, onSaved }: { job: CheckJob; onClose: () => void; onSaved: (c: CheckinRow) => void }) {
  const sb = useMemo(() => createClient(), []);
  const { t } = useT();
  // every size box of every item: expected and what was counted ("" = not counted yet)
  const cells = useMemo(() => job.items.flatMap((it) => Object.entries(it.sizes).sort(([a], [b]) => bySize(a, b)).map(([size, expected]) => ({ k: `${it.key}|${size}`, it, size, expected }))), [job]);
  const [got, setGot] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<Record<string, Extra>>({});
  const [adding, setAdding] = useState(false), [addK, setAddK] = useState(""), [addN, setAddN] = useState("1"), [addWhy, setAddWhy] = useState<Issue>("damaged");
  const [boxes, setBoxes] = useState(""), [note, setNote] = useState("");
  const [photos, setPhotos] = useState<{ path: string; name: string }[]>([]);
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const [editing, setEditing] = useState("");

  const n = (k: string) => (got[k] === undefined || got[k] === "" ? null : Math.max(0, Math.round(+got[k] || 0)));
  const left = cells.filter((c) => n(c.k) === null).length;
  const expected = cells.reduce((s, c) => s + c.expected, 0), counted = cells.reduce((s, c) => s + (n(c.k) ?? 0), 0);
  const fill = (ks: { k: string; expected: number }[]) => setGot((g) => ({ ...g, ...Object.fromEntries(ks.map((c) => [c.k, String(c.expected)])) }));
  // the problems: every counted size that's off, plus damage / wrong items reported on matching counts
  const problems = cells.filter((c) => { const v = n(c.k); return (v !== null && v !== c.expected) || (extra[c.k] && (extra[c.k].issue === "damaged" || extra[c.k].issue === "mispick")); })
    .map((c) => { const v = n(c.k) ?? 0, x = extra[c.k]; return { ...c, v, issue: (x?.issue || (v < c.expected ? "short" : "over")) as Issue, bad: x?.bad || 0, note: x?.note || "" }; });
  const setX = (k: string, p: Partial<Extra>, def: Issue) => setExtra((e) => ({ ...e, [k]: { issue: e[k]?.issue || def, bad: e[k]?.bad || 0, note: e[k]?.note || "", ...p } }));

  async function addPhotos(fs: FileList | null) {
    if (!fs?.length) return;
    setBusy(t("Uploading photos…")); setErr("");
    for (const f of [...fs].slice(0, 8)) {
      const path = `checkins/${job.ref.replace(/[^\w-]/g, "_")}/${Date.now()}-${f.name.replace(/[^\w.-]+/g, "_")}`;
      const r = await sb.storage.from("proofs").upload(path, f, { contentType: f.type || "image/jpeg" });
      if (r.error) { setErr(r.error.message); break; }
      setPhotos((p) => [...p, { path, name: f.name }]);
    }
    setBusy("");
  }

  async function save() {
    if (left) { setErr(t("Count every size first: {0} left (tap a number to take the full amount).", left)); return; }
    setBusy(t("Saving…")); setErr("");
    const lines: CheckLine[] = cells.map((c) => {
      const v = n(c.k) ?? 0, p = problems.find((x) => x.k === c.k);
      return { item: [c.it.style, c.it.color].filter(Boolean).join(" · "), style: c.it.style, color: c.it.color, size: c.size, expected: c.expected, received: v, issue: p ? p.issue : "", ...(p?.bad ? { bad: p.bad } : {}), ...(p?.note ? { note: p.note } : {}) };
    });
    const r = await fetch("/api/goods/checkin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ref: job.ref, lines, boxes: boxes === "" ? null : +boxes, note, photos: photos.map((p) => p.path), source: job.source }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: t("Couldn't reach the server.") };
    setBusy("");
    if (!r?.ok || j.error) { setErr(j.error || t("Couldn't save.")); return; }
    onSaved(j.checkin);
  }

  const tone = (c: { k: string; expected: number }) => { const v = n(c.k); return v === null ? "" : extra[c.k]?.issue === "damaged" || extra[c.k]?.issue === "mispick" ? " bad" : v === c.expected ? " ok" : v < c.expected ? " short" : " over"; };
  const items = job.items.map((it) => ({ it, cs: cells.filter((c) => c.it === it) }));
  // brand, what it is and the color's swatch for each garment (Oct 27, Nick picked "Y": the garment drawn in its color,
  // a band of that color across the row, a solid edge, and the count bar filling in that color)
  const [looks, setLooks] = useState<Record<string, GarmentLook>>({});
  useEffect(() => { void garmentLooks(job.items.map((it) => ({ style: it.style, color: it.color, brand: it.brand }))).then((r) => { if (r.ok) setLooks(r.looks); }); }, [job]);
  const lookOf = (it: CheckJob["items"][number]) => {
    const l = looks[`${it.style.trim().toUpperCase().replace(/\s+/g, "")}|${it.color.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")}`];
    const brand = it.brand || l?.brand || "", title = it.desc || l?.title || "";
    return { brand, title, hex: l?.hex || garmentHex(null, it.color || ""), kind: garmentKind(`${title} ${it.style}`) };
  };
  // every size any garment has, smallest first (a garment without one gets a dot)
  const sizes = [...new Set(cells.map((c) => c.size))].sort(bySize);
  const short = cells.reduce((x, c) => { const v = n(c.k); return x + (v !== null && v < c.expected ? c.expected - v : 0); }, 0);

  return (
    <div className="mk-modal-back ck-back" role="dialog" aria-modal="true" aria-labelledby="ck-t" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="ck-modal">
        <div className="ck-head">
          <div>
            <h2 id="ck-t">{t("Check in #{0}", job.number)} <span className="faint" data-notranslate>{job.customer}</span></h2>
            <div className="ck-sub" data-notranslate>{job.nickname}{job.po ? ` · PO ${job.po}` : ""}</div>
            <div className="ck-src">{job.source === "manifest"
              ? <>{t("From the {0} manifest:", job.suppliers.join(" / "))} <b>{t("{0} pcs", expected)}</b>{job.boxes ? " " + (job.boxes === 1 ? t("in 1 box") : t("in {0} boxes", job.boxes)) : ""}{job.ordered && job.ordered !== expected ? " " + t("(the job has {0})", job.ordered) : ""}.</>
              : <>{t("From the job's line items (no manifest):")} <b>{t("{0} pcs", expected)}</b>.</>}</div>
            {job.mixed?.map((m) => <div key={m.tracking} className="ck-mix">📦 <b>{t("Mixed box …{0}", m.tracking.slice(-4))}</b>{m.box && m.box !== m.tracking ? " " + t("(box {0})", m.box) : ""}{t(": count only this job's part. The rest is for")} {m.jobs.filter((x) => x.number !== job.number).map((x) => `${x.number ? `#${x.number}` : t("a shipment not linked yet")}: ${x.items}`).join("; ")}.</div>)}
          </div>
          <button type="button" className="btn icon ghost" aria-label={t("Close")} onClick={onClose}>×</button>
        </div>

        <div className="ck-tools">
          <button type="button" className="btn primary" onClick={() => fill(cells)}>{t("✓ Everything's here ({0})", expected)}</button>
          <button type="button" className="btn ghost" onClick={() => { setGot({}); setExtra({}); setEditing(""); }}>{t("Clear")}</button>
          <span className="faint ckg-hint">{t("Tap a size to take the full amount, tap it again to type the count")}</span>
          <span className="spacer" />
          <label className="ckg-boxes">{t("Boxes")}<input type="number" min={0} inputMode="numeric" value={boxes} onChange={(e) => setBoxes(e.target.value)} placeholder={job.boxes ? String(job.boxes) : "—"} />{job.boxes ? <small className="faint">{t("of {0}", job.boxes)}</small> : null}</label>
        </div>

        <div className="ck-body">
          {/* the count grid (Oct 27, Nick picked "B3"): garments down, sizes across, every size the same small box; what's
              counted, what's left and what's short beside it */}
          {/* the totals as the shop's summary card, across the top; the grid gets the full width (Oct 27, Nick: "make this
              fill up the space… move the All to the right side") */}
          <div className="stats ckg-stats">
            <div className="stat"><span className="v">{counted.toLocaleString()}<small> / {expected.toLocaleString()}</small></span><span className="k">{t("Counted")}</span></div>
            <div className="stat"><span className="v">{left}</span><span className="k">{left === 1 ? t("Size left to count") : t("Sizes left to count")}</span></div>
            <div className="stat"><span className={"v" + (short ? " alert" : "")}>{short}</span><span className="k">{t("Short")}</span></div>
            <div className="stat"><span className="v">{expected ? Math.round((counted / expected) * 100) : 0}%</span><span className="k">{t("Done")}</span><i className="ckg-bar"><b style={{ width: `${expected ? Math.min(100, (counted / expected) * 100) : 0}%` }} /></i></div>
          </div>
          <div className="ckg">
            <div className="ckg-wrap"><table className="ckg-t">
              <thead><tr><th className="ckg-g">{t("Garment")}</th>{sizes.map((z) => <th key={z}>{z === "OTHER" ? t("Other") : z}</th>)}<th className="ckg-n">{t("Count")}</th><th className="ckg-a" /></tr></thead>
              <tbody>{items.map(({ it, cs }) => {
                const exp = cs.reduce((x, c) => x + c.expected, 0), cnt = cs.reduce((x, c) => x + (n(c.k) ?? 0), 0), done = cs.every((c) => n(c.k) !== null);
                return (
                  <tr key={it.key} className="ckg-row" style={{ ["--gc" as string]: lookOf(it).hex }}>
                    <td className="ckg-g"><div className="ckg-gl">
                      <GarmentShape kind={lookOf(it).kind} color={lookOf(it).hex} />
                      <div><div className="ckg-cn" data-notranslate>{it.color || t("No color")}</div>
                        <div className="ckg-bs" data-notranslate><b>{[lookOf(it).brand, it.style].filter(Boolean).join(" ") || t("Item")}</b></div>
                        {lookOf(it).title && <div className="faint ckg-desc" data-notranslate>{lookOf(it).title}</div>}</div>
                    </div></td>
                    {sizes.map((z) => {
                      const c = cs.find((x) => x.size === z);
                      if (!c) return <td key={z} className="ckg-na" aria-hidden><span /></td>;
                      const v = n(c.k), on = editing === c.k;
                      return (
                        <td key={z}>
                          <label className={"ckg-c" + (v === null ? "" : tone(c))} title={v === null ? t("Tap for all {0}", c.expected) : undefined}
                            onPointerDown={(e) => { if (v === null && !on) { e.preventDefault(); fill([c]); } }}>
                              <input type="number" min={0} inputMode="numeric" aria-label={t("{0} received", c.size)} value={got[c.k] ?? ""} placeholder="–" data-ck={cells.indexOf(c)}
                                onFocus={(e) => { setEditing(c.k); e.target.select(); }} onBlur={() => setEditing("")} onWheel={(e) => (e.target as HTMLInputElement).blur()}
                                onChange={(e) => setGot((g) => ({ ...g, [c.k]: e.target.value }))}
                                onKeyDown={(e) => {
                                  // Enter works like Tab (next size, then the next garment's); on the last size, to the Check In button
                                  if (e.key !== "Enter") return;
                                  e.preventDefault();
                                  const nx = document.querySelector<HTMLElement>(`.ck-modal [data-ck="${cells.indexOf(c) + (e.shiftKey ? -1 : 1)}"]`) || document.querySelector<HTMLElement>(".ck-foot .ck-go");
                                  nx?.focus();
                                }} />
                              <small>{t("of {0}", c.expected)}</small>
                          </label>
                        </td>
                      );
                    })}
                    <td className={"ckg-n" + (done ? (cnt === exp ? " ok" : " off") : "")}><b>{cnt.toLocaleString()}</b><small>{t("of {0}", exp.toLocaleString())}</small><i className="ckg-bar"><b style={{ width: `${exp ? Math.min(100, (cnt / exp) * 100) : 0}%` }} /></i></td>
                    <td className="ckg-a"><button type="button" className={"btn sm" + (done && cnt === exp ? " ckg-done" : "")} tabIndex={-1} onClick={() => fill(cs)}>{done && cnt === exp ? t("✓ All here") : t("✓ All")}</button></td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          </div>

          <section className={"ck-probs" + (problems.length ? " has" : "")}>
            <div className="ck-item-h"><b>{problems.length ? (problems.length === 1 ? t("1 problem") : t("{0} problems", problems.length)) : t("No problems")}</b>
              <span className="faint">{problems.length ? t("Each one is flagged in Goods & Receiving until it's resolved.") : t("Counts that don't match show up here. Damage or a wrong item on a size that counted right:")}</span>
              <span className="spacer" />
              <button type="button" className="btn sm ghost" onClick={() => { setAdding(!adding); setAddK(cells[0]?.k || ""); }}>{adding ? t("Cancel") : t("+ Damaged or wrong item")}</button></div>
            {adding && (
              <div className="ck-add">
                <select value={addK} onChange={(e) => setAddK(e.target.value)} aria-label={t("Which size")}>{cells.map((c) => <option key={c.k} value={c.k}>{[c.it.style, c.it.color].filter(Boolean).join(" · ")} · {c.size === "OTHER" ? t("Other") : c.size}</option>)}</select>
                <select value={addWhy} onChange={(e) => setAddWhy(e.target.value as Issue)} aria-label={t("What's wrong")}><option value="damaged">{t("Damaged")}</option><option value="mispick">{t("Wrong item")}</option></select>
                <label>{t("How many")}<input type="number" min={1} inputMode="numeric" value={addN} onChange={(e) => setAddN(e.target.value)} /></label>
                <button type="button" className="btn sm primary" onClick={() => { const c = cells.find((x) => x.k === addK); if (!c) return; if (n(c.k) === null) fill([c]); setX(c.k, { issue: addWhy, bad: Math.max(1, +addN || 1) }, addWhy); setAdding(false); }}>{t("Add")}</button>
              </div>
            )}
            {problems.map((p) => (
              <div key={p.k} className="ck-prob">
                <span className="ck-prob-w" data-notranslate><b>{[p.it.style, p.it.color].filter(Boolean).join(" · ")} · {p.size === "OTHER" ? t("Other") : p.size}</b> {t("got {0} of {1}", p.v, p.expected)}{p.bad ? " · " + t(p.issue === "mispick" ? "{0} wrong" : "{0} damaged", p.bad) : ""}</span>
                <select value={p.issue} onChange={(e) => setX(p.k, { issue: e.target.value as Issue }, p.issue)} aria-label={t("Reason")}>{REASONS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select>
                {p.issue === "damaged" || p.issue === "mispick" ? <label className="ck-bad">{t("How many")}<input type="number" min={0} inputMode="numeric" value={p.bad || ""} onChange={(e) => setX(p.k, { bad: +e.target.value || 0 }, p.issue)} /></label> : <span />}
                <input className="ck-pnote" placeholder={t("Note (optional)")} value={p.note} onChange={(e) => setX(p.k, { note: e.target.value }, p.issue)} />
              </div>
            ))}
          </section>

          <div className="ck-foot-f">
            <label className="ck-note">{t("Note")}<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Anything about this delivery (boxes crushed, came on the S&S truck…)")} /></label>
            <label className="btn ck-photo">{t("📷 Add photos")}<input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} /></label>
            {photos.length > 0 && <span className="faint">{photos.length === 1 ? t("1 photo added") : t("{0} photos added", photos.length)}</span>}
          </div>
        </div>

        {err && <div className="pv-err">{err}</div>}
        <div className="ck-foot">
          <span className={"ck-sum" + (left ? "" : counted === expected && !problems.length ? " ok" : " off")}>{left ? (left === 1 ? t("1 size left to count · {0} so far", counted) : t("{0} sizes left to count · {1} so far", left, counted)) : t("{0} of {1} counted", counted, expected) + (problems.length ? " · " + (problems.length === 1 ? t("1 problem") : t("{0} problems", problems.length)) : t(" · all here"))}</span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{t("Cancel")}</button>
          <button type="button" className={"btn ck-go " + (problems.length ? "warn" : "primary")} disabled={!!busy} onClick={save}>{busy || (problems.length ? (problems.length === 1 ? t("Check In with 1 Problem") : t("Check In with {0} Problems", problems.length)) : t("Check In"))}</button>
        </div>
      </div>
    </div>
  );
}
