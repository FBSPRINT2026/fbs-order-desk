"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/components/RoleContext";
import { uid } from "@/lib/pricing";
import { SIZE_GROUPS, TAG_GRAY, isPicture, picturePath, type NeckFile, type NeckLabelSet } from "@/lib/neckLabels";
import { makePreview } from "@/lib/artPrep";
import NeckLabelView, { neckFileUrl } from "@/components/NeckLabelView";

/**
 * Neck labels (customer → Artwork → Brand standards), Oct 20, Nick: "we take the manufacturer's tag… cut it out, and
 * then we print in custom art for the client that has their brand". Made simple Oct 21 ("it just got way too
 * complicated… upload one tag… or all the tags… just show a picture of it, just keep that tag on file"): each set is a
 * name, the tag file as uploaded (one for every size, plus one for any size that has its own), the ink (light gray on
 * every shirt unless set), the printed width and a note, with the tag drawn inside the neck of a black and a white
 * shirt. Kept on customers.neck_labels; files in proofs/brand-guides/<customer>/neck/ (a PDF / AI / EPS also gets a
 * PNG made in the browser to draw it).
 */
export default function CustomerNeckLabels({ customerId }: { customerId: string }) {
  const sb = useMemo(() => createClient(), []);
  const { email } = useRole();
  const [sets, setSets] = useState<NeckLabelSet[] | null>(null);
  const [err, setErr] = useState(""), [busy, setBusy] = useState("");
  const [showOff, setShowOff] = useState(false);
  useEffect(() => {
    sb.from("customers").select("neck_labels").eq("id", customerId).maybeSingle().then(({ data, error }) => {
      if (error) { setErr(/neck_labels/.test(error.message) ? "Neck labels aren't set up in the database yet." : error.message); setSets([]); return; }
      setSets(((data?.neck_labels || []) as NeckLabelSet[]).filter((s) => s?.id));
    });
  }, [sb, customerId]);

  // saved fresh each time, so two people editing don't drop each other's changes
  async function save(change: (cur: NeckLabelSet[]) => NeckLabelSet[]) {
    const { data } = await sb.from("customers").select("neck_labels").eq("id", customerId).maybeSingle();
    const next = change(((data?.neck_labels || []) as NeckLabelSet[]).filter((s) => s?.id));
    const { error } = await sb.from("customers").update({ neck_labels: next }).eq("id", customerId);
    if (error) { setErr("Couldn't save: " + error.message); return false; }
    setErr(""); setSets(next); return true;
  }
  const patch = (id: string, fn: (s: NeckLabelSet) => NeckLabelSet) => save((cur) => cur.map((s) => (s.id === id ? fn({ ...s }) : s)));
  async function upload(f: File): Promise<NeckFile | null> {
    setBusy(`Uploading ${f.name}…`);
    const stem = `brand-guides/${customerId}/neck/${Date.now().toString(36)}-`;
    const path = `${stem}${f.name.replace(/[^\w.\-]+/g, "_").slice(-90)}`;
    const { error } = await sb.storage.from("proofs").upload(path, f, { contentType: f.type || undefined });
    if (error) { setBusy(""); setErr(`${f.name}: ${error.message}`); return null; }
    const out: NeckFile = { path, name: f.name, type: f.type || "" };
    // a PDF / AI / EPS: a picture of it to draw (the file itself stays as uploaded)
    if (!isPicture(out)) {
      setBusy(`Making a picture of ${f.name}…`);
      const png = await makePreview(f, 1600).catch(() => null);
      if (png) {
        const pp = `${stem}preview.png`;
        const { error: e2 } = await sb.storage.from("proofs").upload(pp, png, { contentType: "image/png" });
        if (!e2) out.preview = pp;
      }
    }
    setBusy("");
    return out;
  }
  const add = () => save((cur) => [...cur, { id: uid(), name: cur.length ? "" : "Neck tag", content: "", mode: "one", files: {}, widthIn: 2.5, at: new Date().toISOString(), by: email || "" }]);

  if (!sets) return null;
  const live = sets.filter((s) => !s.archived), off = sets.filter((s) => s.archived);
  return (
    <section className="nl-sec">
      <div className="nl-sec-h">
        <div><b>Neck labels</b><span className="faint"> · we cut the maker&apos;s tag out and print theirs inside the neck (Private Label, $1/pc)</span></div>
        <button type="button" className="btn sm" onClick={add}>+ Add label set</button>
      </div>
      {err && <p className="err" style={{ margin: "6px 0" }}>{err}</p>}
      {busy && <p className="faint" style={{ margin: "6px 0", fontSize: 12.5 }}>{busy}</p>}
      {!live.length && <p className="faint" style={{ fontSize: 13, margin: "6px 0 0" }}>None yet. Add their tag: one file for every size, or one for each size.</p>}
      {live.map((s) => <SetCard key={s.id} set={s} patch={(fn) => patch(s.id, fn)} upload={upload} onOff={() => patch(s.id, (x) => ({ ...x, archived: true }))} />)}
      {off.length > 0 && (
        <div className="nl-off">
          <button type="button" className="linkbtn" onClick={() => setShowOff((x) => !x)}>{showOff ? "Hide" : "Show"} {off.length} taken off</button>
          {showOff && off.map((s) => <div key={s.id} className="nl-off-row"><span>{s.name || "Label set"}{s.content ? ` · ${s.content}` : ""}</span><button type="button" className="btn sm ghost" onClick={() => patch(s.id, (x) => ({ ...x, archived: undefined }))}>Put back</button></div>)}
        </div>
      )}
    </section>
  );
}

function SetCard({ set, patch, upload, onOff }: { set: NeckLabelSet; patch: (fn: (s: NeckLabelSet) => NeckLabelSet) => Promise<boolean>; upload: (f: File) => Promise<NeckFile | null>; onOff: () => void }) {
  const [armed, setArmed] = useState(false);
  const [preview, setPreview] = useState("");
  // text fields save when you leave them
  const [d, setD] = useState({ name: set.name, widthIn: String(set.widthIn ?? 2.5), note: set.note || "" });
  useEffect(() => { setD({ name: set.name, widthIn: String(set.widthIn ?? 2.5), note: set.note || "" }); }, [set.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => patch((s) => ({ ...s, name: d.name.trim(), widthIn: Math.max(0.5, Math.min(6, +d.widthIn || 2.5)), note: d.note.trim() }));
  const order = SIZE_GROUPS.flatMap((g) => [...g.sizes]);
  const sized = order.filter((z) => set.files?.[z]);
  // the one tag for every size (older sets: the design the size was added to)
  const main = set.mode === "per_size" ? null : set.template || null;
  const pv = preview && (sized.includes(preview) || preview === "all") ? preview : main ? "all" : sized[0] || "M";
  const pvSize = pv === "all" ? "M" : pv;
  const shown: NeckLabelSet = pv === "all" ? { ...set, mode: "one", files: {} } : set;
  const [addSz, setAddSz] = useState("");
  const inks = [["", "Light gray (usual)"], ["White", "White"], ["Black", "Black"]] as const;
  const custom = !!set.ink && !inks.some(([k]) => k === set.ink);
  return (
    <div className="nl-card">
      <div className="nl-card-top">
        <div className="nl-fields">
          <label>Name<input type="text" value={d.name} placeholder="e.g. Little Groupies tag" onChange={(e) => setD({ ...d, name: e.target.value })} onBlur={commit} /></label>
          <div className="wide">
            <div className="nl-lbl">Tag art {sized.length > 0 || main ? <span className="faint">· as uploaded</span> : null}</div>
            <MainFile file={main} upload={upload} onSet={(f) => patch((s) => ({ ...s, mode: "one", template: f || undefined, sizeBox: undefined }))} />
            {set.mode === "template" && main && <p className="faint" style={{ fontSize: 12, margin: "4px 0 0" }}>This older setup writes the size on the tag. Replace the file to keep it as one tag for every size.</p>}
            {sized.length > 0 && (
              <div className="nl-own">
                {sized.map((z) => <SizedFile key={z} size={z} file={set.files![z]!} onRemove={() => patch((s) => { const f = { ...(s.files || {}) }; delete f[z]; return { ...s, files: f }; })} onShow={() => setPreview(z)} on={pv === z} />)}
              </div>
            )}
            <div className="nl-addsz">
              <select value={addSz} onChange={(e) => setAddSz(e.target.value)} aria-label="Size">
                <option value="">+ Add a tag for another size (optional)…</option>
                {SIZE_GROUPS.map((g) => <optgroup key={g.label} label={g.label}>{g.sizes.filter((z) => !set.files?.[z]).map((z) => <option key={z} value={z}>{z}</option>)}</optgroup>)}
              </select>
              {addSz && <PickFile label={`Upload the ${addSz} tag`} upload={upload} onDone={(f) => { void patch((s) => ({ ...s, mode: s.mode === "template" ? "template" : s.mode === "per_size" && !s.template ? "per_size" : "one", files: { ...(s.files || {}), [addSz]: f } })); setPreview(addSz); setAddSz(""); }} />}
            </div>
          </div>
          <label>Ink
            <span className="nl-ink">
              <select value={custom ? "other" : set.ink || ""} onChange={(e) => { const v = e.target.value; if (v !== "other") void patch((s) => ({ ...s, ink: v || undefined })); else void patch((s) => ({ ...s, ink: s.ink && !inks.some(([k]) => k === s.ink) ? s.ink : "PMS " })); }}>
                {inks.map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="other">Another ink…</option>
              </select>
              {custom && <input type="text" defaultValue={set.ink} placeholder="PMS 7543 C" onBlur={(e) => void patch((s) => ({ ...s, ink: e.target.value.trim() || undefined }))} />}
              <i className="nl-ink-sw" style={{ background: set.ink ? undefined : TAG_GRAY }} />
            </span>
          </label>
          <label>Printed width<span className="nl-in"><input type="number" step="0.25" min="0.5" max="6" value={d.widthIn} onChange={(e) => setD({ ...d, widthIn: e.target.value })} onBlur={commit} />&quot; <small className="faint">optional</small></span></label>
          <label className="wide">Note<input type="text" value={d.note} placeholder="Anything production should know" onChange={(e) => setD({ ...d, note: e.target.value })} onBlur={commit} /></label>
        </div>
        <div className="nl-prev">
          <div className="nl-pv"><NeckLabelView set={shown} size={pvSize} shirtHex="#1f1f22" width={170} caption={false} /><span className="nl-prev-cap">Inside neck · black shirt</span></div>
          <div className="nl-pv"><NeckLabelView set={shown} size={pvSize} shirtHex="#f3f3f1" width={170} caption={false} /><span className="nl-prev-cap">Inside neck · white shirt</span></div>
          {(sized.length > 0 && (main || sized.length > 1)) && <div className="nl-prev-sz">{main && <button type="button" className={"chip" + (pv === "all" ? " on" : "")} onClick={() => setPreview("all")}>Every size</button>}{sized.map((z) => <button key={z} type="button" className={"chip" + (z === pv ? " on" : "")} onClick={() => setPreview(z)}>{z}</button>)}</div>}
        </div>
      </div>
      <div className="nl-card-f">
        {armed ? <button type="button" className="btn sm danger" onClick={() => { setArmed(false); onOff(); }}>Take this tag off?</button>
          : <button type="button" className="btn sm ghost" onClick={() => { setArmed(true); setTimeout(() => setArmed(false), 3500); }}>Take this tag off</button>}
      </div>
    </div>
  );
}

function useUrl(f: NeckFile | null | undefined) {
  const [u, setU] = useState("");
  useEffect(() => { let off = false; if (f?.path && isPicture(f)) neckFileUrl(picturePath(f)).then((x) => { if (!off) setU(x); }); else setU(""); return () => { off = true; }; }, [f?.path, f?.preview]); // eslint-disable-line react-hooks/exhaustive-deps
  return u;
}

/** the one tag for every size: drop or upload, shown as uploaded */
function MainFile({ file, upload, onSet }: { file: NeckFile | null; upload: (f: File) => Promise<NeckFile | null>; onSet: (f: NeckFile | null) => void }) {
  const inp = useRef<HTMLInputElement>(null);
  const u = useUrl(file);
  const take = async (fs: FileList | File[] | null) => { const f = fs && Array.from(fs)[0]; if (!f) return; const up = await upload(f); if (up) onSet(up); };
  return (
    <div className={"nl-main" + (file ? " has" : "")} onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.stopPropagation(); } }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); void take(e.dataTransfer.files); }}>
      {file ? (
        <>
          <span className="nl-main-pic">{u ? <img src={u} alt="" /> : <span className="nl-ext">{(file.name.split(".").pop() || "").toUpperCase().slice(0, 4)}</span>}</span>
          <span className="nl-main-t"><b>{file.name}</b><span className="faint">One tag for every size</span>
            <span><button type="button" className="linkbtn" onClick={() => inp.current?.click()}>Replace</button> · <button type="button" className="linkbtn" onClick={() => onSet(null)}>Remove</button></span></span>
        </>
      ) : <button type="button" className="nl-main-add" onClick={() => inp.current?.click()}>+ Upload their tag (PDF, AI, PNG…) or drop it here</button>}
      <input ref={inp} type="file" hidden accept="image/*,.pdf,.ai,.eps,.svg" onChange={(e) => { void take(e.target.files); e.target.value = ""; }} />
    </div>
  );
}

/** a tag for one size */
function SizedFile({ size, file, onRemove, onShow, on }: { size: string; file: NeckFile; onRemove: () => void; onShow: () => void; on: boolean }) {
  const u = useUrl(file);
  return (
    <span className={"nl-szf" + (on ? " on" : "")}>
      <button type="button" className="nl-szf-pic" onClick={onShow} title={`${file.name}: show it`}>{u ? <img src={u} alt="" /> : <span className="nl-ext">{(file.name.split(".").pop() || "").toUpperCase().slice(0, 4)}</span>}</button>
      <b>{size}</b>
      <button type="button" className="nl-slot-x" aria-label={`Remove the ${size} tag`} onClick={onRemove}>×</button>
    </span>
  );
}

function PickFile({ label, upload, onDone }: { label: string; upload: (f: File) => Promise<NeckFile | null>; onDone: (f: NeckFile) => void }) {
  const inp = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="btn sm" onClick={() => inp.current?.click()}>{label}</button>
      <input ref={inp} type="file" hidden accept="image/*,.pdf,.ai,.eps,.svg" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; const up = await upload(f); if (up) onDone(up); }} />
    </>
  );
}
