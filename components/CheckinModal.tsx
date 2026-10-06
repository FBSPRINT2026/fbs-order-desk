"use client";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { bySize, type CheckJob, type CheckLine, type CheckinRow, type Issue } from "@/lib/checkinShared";

/**
 * Count a job's goods in: one grid per style / color, a box per size. Tap a size's expected number (or ✓ on the row,
 * or "Everything's here") to take the full amount; type what you actually counted when it's different. Any
 * difference, damage or wrong item becomes a problem with a reason, and the job shows up under Problems until it's
 * resolved.
 */
const REASONS: [Issue, string][] = [["short", "Short"], ["damaged", "Damaged"], ["mispick", "Wrong item"], ["over", "Extra"]];
export const ISSUE_WORD: Record<string, string> = { short: "Short", over: "Extra", damaged: "Damaged", mispick: "Wrong item" };
type Extra = { issue: Issue; bad: number; note: string };

export default function CheckinModal({ job, onClose, onSaved }: { job: CheckJob; onClose: () => void; onSaved: (c: CheckinRow) => void }) {
  const sb = useMemo(() => createClient(), []);
  // every size box of every item: expected and what was counted ("" = not counted yet)
  const cells = useMemo(() => job.items.flatMap((it) => Object.entries(it.sizes).sort(([a], [b]) => bySize(a, b)).map(([size, expected]) => ({ k: `${it.key}|${size}`, it, size, expected }))), [job]);
  const [got, setGot] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<Record<string, Extra>>({});
  const [adding, setAdding] = useState(false), [addK, setAddK] = useState(""), [addN, setAddN] = useState("1"), [addWhy, setAddWhy] = useState<Issue>("damaged");
  const [boxes, setBoxes] = useState(""), [note, setNote] = useState("");
  const [photos, setPhotos] = useState<{ path: string; name: string }[]>([]);
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");

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
    setBusy("Uploading photos…"); setErr("");
    for (const f of [...fs].slice(0, 8)) {
      const path = `checkins/${job.ref.replace(/[^\w-]/g, "_")}/${Date.now()}-${f.name.replace(/[^\w.-]+/g, "_")}`;
      const r = await sb.storage.from("proofs").upload(path, f, { contentType: f.type || "image/jpeg" });
      if (r.error) { setErr(r.error.message); break; }
      setPhotos((p) => [...p, { path, name: f.name }]);
    }
    setBusy("");
  }

  async function save() {
    if (left) { setErr(`Count every size first: ${left} left (tap a number to take the full amount).`); return; }
    setBusy("Saving…"); setErr("");
    const lines: CheckLine[] = cells.map((c) => {
      const v = n(c.k) ?? 0, p = problems.find((x) => x.k === c.k);
      return { item: [c.it.style, c.it.color].filter(Boolean).join(" · "), style: c.it.style, color: c.it.color, size: c.size, expected: c.expected, received: v, issue: p ? p.issue : "", ...(p?.bad ? { bad: p.bad } : {}), ...(p?.note ? { note: p.note } : {}) };
    });
    const r = await fetch("/api/goods/checkin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ref: job.ref, lines, boxes: boxes === "" ? null : +boxes, note, photos: photos.map((p) => p.path), source: job.source }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    setBusy("");
    if (!r?.ok || j.error) { setErr(j.error || "Couldn't save."); return; }
    onSaved(j.checkin);
  }

  const tone = (c: { k: string; expected: number }) => { const v = n(c.k); return v === null ? "" : extra[c.k]?.issue === "damaged" || extra[c.k]?.issue === "mispick" ? " bad" : v === c.expected ? " ok" : v < c.expected ? " short" : " over"; };
  const items = job.items.map((it) => ({ it, cs: cells.filter((c) => c.it === it) }));

  return (
    <div className="mk-modal-back ck-back" role="dialog" aria-modal="true" aria-labelledby="ck-t" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="ck-modal">
        <div className="ck-head">
          <div>
            <h2 id="ck-t">Check in #{job.number} <span className="faint" data-notranslate>{job.customer}</span></h2>
            <div className="ck-sub" data-notranslate>{job.nickname}{job.po ? ` · PO ${job.po}` : ""}</div>
            <div className="ck-src">{job.source === "manifest"
              ? <>From the {job.suppliers.join(" / ")} manifest: <b>{expected} pcs</b>{job.boxes ? ` in ${job.boxes} box${job.boxes === 1 ? "" : "es"}` : ""}{job.ordered && job.ordered !== expected ? ` (the job has ${job.ordered})` : ""}.</>
              : <>From the job&apos;s line items (no manifest): <b>{expected} pcs</b>.</>}</div>
          </div>
          <button type="button" className="btn icon ghost" aria-label="Close" onClick={onClose}>×</button>
        </div>

        <div className="ck-tools">
          <button type="button" className="btn primary" onClick={() => fill(cells)}>✓ Everything&apos;s here ({expected})</button>
          <button type="button" className="btn ghost" onClick={() => { setGot({}); setExtra({}); }}>Clear</button>
          <span className="spacer" />
          <label className="ck-boxes">Boxes<input type="number" min={0} inputMode="numeric" value={boxes} onChange={(e) => setBoxes(e.target.value)} placeholder={job.boxes ? String(job.boxes) : "—"} />{job.boxes ? <span className="faint">of {job.boxes}</span> : null}</label>
        </div>

        <div className="ck-body">
          {items.map(({ it, cs }) => {
            const exp = cs.reduce((s, c) => s + c.expected, 0), cnt = cs.reduce((s, c) => s + (n(c.k) ?? 0), 0), done = cs.every((c) => n(c.k) !== null);
            return (
              <section key={it.key} className="ck-item">
                <div className="ck-item-h">
                  <b data-notranslate>{[it.style, it.color].filter(Boolean).join(" · ") || "Item"}</b>{it.desc && <span className="faint" data-notranslate>{it.desc}</span>}
                  <span className="spacer" />
                  <span className={"ck-tot" + (done ? (cnt === exp ? " ok" : " off") : "")}>{done ? `${cnt} / ${exp}` : `${exp} pcs`}</span>
                  <button type="button" className="btn sm" tabIndex={-1} onClick={() => fill(cs)} title="Take the full amount for every size">✓ All</button>
                </div>
                <div className="ck-grid" style={{ gridTemplateColumns: `repeat(${cs.length}, minmax(64px, 1fr))` }}>
                  {cs.map((c) => (
                    <div key={c.k} className={"ck-cell" + tone(c)}>
                      <span className="ck-size">{c.size === "OTHER" ? "Other" : c.size}</span>
                      <button type="button" className="ck-exp" tabIndex={-1} title="Tap: all of them are here" onClick={() => fill([c])}>{c.expected}</button>
                      <input type="number" min={0} inputMode="numeric" aria-label={`${c.size} received`} value={got[c.k] ?? ""} placeholder="—"
                        data-ck={cells.indexOf(c)} autoFocus={cells.indexOf(c) === 0}
                        onChange={(e) => setGot((g) => ({ ...g, [c.k]: e.target.value }))} onFocus={(e) => e.target.select()} onWheel={(e) => (e.target as HTMLInputElement).blur()}
                        onKeyDown={(e) => {
                          // Enter works like Tab (next size, then the next item's first size); on the last size, to the Check In button
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          const nx = document.querySelector<HTMLElement>(`.ck-modal input[data-ck="${cells.indexOf(c) + (e.shiftKey ? -1 : 1)}"]`) || document.querySelector<HTMLElement>(".ck-foot .ck-go");
                          nx?.focus();
                        }} />
                      <span className="ck-step">
                        <button type="button" tabIndex={-1} aria-label={`One less ${c.size}`} onClick={() => setGot((g) => ({ ...g, [c.k]: String(Math.max(0, (n(c.k) ?? c.expected) - 1)) }))}>−</button>
                        <button type="button" tabIndex={-1} aria-label={`One more ${c.size}`} onClick={() => setGot((g) => ({ ...g, [c.k]: String((n(c.k) ?? c.expected) + 1) }))}>+</button>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}

          <section className={"ck-probs" + (problems.length ? " has" : "")}>
            <div className="ck-item-h"><b>{problems.length ? `${problems.length} problem${problems.length === 1 ? "" : "s"}` : "No problems"}</b>
              <span className="faint">{problems.length ? "Each one is flagged in Goods & Receiving until it's resolved." : "Counts that don't match show up here. Damage or a wrong item on a size that counted right:"}</span>
              <span className="spacer" />
              <button type="button" className="btn sm ghost" onClick={() => { setAdding(!adding); setAddK(cells[0]?.k || ""); }}>{adding ? "Cancel" : "+ Damaged or wrong item"}</button></div>
            {adding && (
              <div className="ck-add">
                <select value={addK} onChange={(e) => setAddK(e.target.value)} aria-label="Which size">{cells.map((c) => <option key={c.k} value={c.k}>{[c.it.style, c.it.color].filter(Boolean).join(" · ")} · {c.size === "OTHER" ? "Other" : c.size}</option>)}</select>
                <select value={addWhy} onChange={(e) => setAddWhy(e.target.value as Issue)} aria-label="What's wrong"><option value="damaged">Damaged</option><option value="mispick">Wrong item</option></select>
                <label>How many<input type="number" min={1} inputMode="numeric" value={addN} onChange={(e) => setAddN(e.target.value)} /></label>
                <button type="button" className="btn sm primary" onClick={() => { const c = cells.find((x) => x.k === addK); if (!c) return; if (n(c.k) === null) fill([c]); setX(c.k, { issue: addWhy, bad: Math.max(1, +addN || 1) }, addWhy); setAdding(false); }}>Add</button>
              </div>
            )}
            {problems.map((p) => (
              <div key={p.k} className="ck-prob">
                <span className="ck-prob-w" data-notranslate><b>{[p.it.style, p.it.color].filter(Boolean).join(" · ")} · {p.size === "OTHER" ? "Other" : p.size}</b> got {p.v} of {p.expected}{p.bad ? ` · ${p.bad} ${p.issue === "mispick" ? "wrong" : "damaged"}` : ""}</span>
                <select value={p.issue} onChange={(e) => setX(p.k, { issue: e.target.value as Issue }, p.issue)} aria-label="Reason">{REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                {p.issue === "damaged" || p.issue === "mispick" ? <label className="ck-bad">How many<input type="number" min={0} inputMode="numeric" value={p.bad || ""} onChange={(e) => setX(p.k, { bad: +e.target.value || 0 }, p.issue)} /></label> : <span />}
                <input className="ck-pnote" placeholder="Note (optional)" value={p.note} onChange={(e) => setX(p.k, { note: e.target.value }, p.issue)} />
              </div>
            ))}
          </section>

          <div className="ck-foot-f">
            <label className="ck-note">Note<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything about this delivery (boxes crushed, came on the S&S truck…)" /></label>
            <label className="btn ck-photo">📷 Add photos<input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} /></label>
            {photos.length > 0 && <span className="faint">{photos.length} photo{photos.length === 1 ? "" : "s"} added</span>}
          </div>
        </div>

        {err && <div className="pv-err">{err}</div>}
        <div className="ck-foot">
          <span className={"ck-sum" + (left ? "" : counted === expected && !problems.length ? " ok" : " off")}>{left ? `${left} size${left === 1 ? "" : "s"} left to count · ${counted} so far` : `${counted} of ${expected} counted${problems.length ? ` · ${problems.length} problem${problems.length === 1 ? "" : "s"}` : " · all here"}`}</span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className={"btn ck-go " + (problems.length ? "warn" : "primary")} disabled={!!busy} onClick={save}>{busy || (problems.length ? `Check In with ${problems.length} Problem${problems.length === 1 ? "" : "s"}` : "Check In")}</button>
        </div>
      </div>
    </div>
  );
}
