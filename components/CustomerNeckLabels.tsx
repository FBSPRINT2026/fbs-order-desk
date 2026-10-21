"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/components/RoleContext";
import { useSticky } from "@/lib/useSticky";
import { uid } from "@/lib/pricing";
import { DEFAULT_BOX, SIZE_GROUPS, isPicture, type NeckFile, type NeckLabelSet } from "@/lib/neckLabels";
import NeckLabelView, { neckFileUrl } from "@/components/NeckLabelView";

/**
 * Neck labels (customer → Artwork → Brand standards), Oct 20, Nick: "we take the manufacturer's tag… cut it out, and
 * then we print in custom art for the client that has their brand… each size gets its own neck label… sometimes the
 * art can change based on material" (a 60/40 one and a generic one). Each label set: its name, the fabric content it's
 * for, the art (a file for each size, or one design with the size dropped into a box on it), the ink and the printed
 * width, and a preview inside the neck. Kept on customers.neck_labels; files in proofs/brand-guides/<customer>/neck/.
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
    const path = `brand-guides/${customerId}/neck/${Date.now().toString(36)}-${f.name.replace(/[^\w.\-]+/g, "_").slice(-90)}`;
    const { error } = await sb.storage.from("proofs").upload(path, f, { contentType: f.type || undefined });
    setBusy("");
    if (error) { setErr(`${f.name}: ${error.message}`); return null; }
    return { path, name: f.name, type: f.type || "" };
  }
  const add = () => save((cur) => [...cur, { id: uid(), name: cur.length ? "" : "Neck label", content: "", mode: "per_size", files: {}, widthIn: 2.5, at: new Date().toISOString(), by: email || "" }]);

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
      {!live.length && <p className="faint" style={{ fontSize: 13, margin: "6px 0 0" }}>None yet. Add a label set with their label art: a file for each size, or one design and we add the size.</p>}
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
  const [more, setMore] = useSticky<boolean>("neck.moreSizes", false);
  const [armed, setArmed] = useState(false);
  const [preview, setPreview] = useState("M");
  // text fields save when you leave them
  const [d, setD] = useState({ name: set.name, content: set.content || "", ink: set.ink || "", widthIn: String(set.widthIn ?? 2.5), note: set.note || "" });
  useEffect(() => { setD({ name: set.name, content: set.content || "", ink: set.ink || "", widthIn: String(set.widthIn ?? 2.5), note: set.note || "" }); }, [set.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => patch((s) => ({ ...s, name: d.name.trim(), content: d.content.trim(), ink: d.ink.trim(), widthIn: Math.max(0.5, Math.min(6, +d.widthIn || 2.5)), note: d.note.trim() }));
  const groups = SIZE_GROUPS.filter((g, i) => i === 0 || more || g.sizes.some((z) => set.files?.[z]));
  // in size order (S, M, L, XL…), not the order they were uploaded
  const order = SIZE_GROUPS.flatMap((g) => [...g.sizes]);
  const sizesSet = set.mode === "template" ? ["S", "M", "L", "XL"] : order.filter((z) => set.files?.[z]);
  const pv = sizesSet.includes(preview) ? preview : sizesSet[0] || "M";
  return (
    <div className="nl-card">
      <div className="nl-card-top">
        <div className="nl-fields">
          <label>Name<input type="text" value={d.name} placeholder="e.g. Tee label" onChange={(e) => setD({ ...d, name: e.target.value })} onBlur={commit} /></label>
          <label>Fabric content<input type="text" value={d.content} placeholder="e.g. 60% cotton / 40% polyester (blank = generic)" onChange={(e) => setD({ ...d, content: e.target.value })} onBlur={commit} /></label>
          <label>Ink<input type="text" value={d.ink} placeholder="White on dark, black on light" onChange={(e) => setD({ ...d, ink: e.target.value })} onBlur={commit} /></label>
          <label>Printed width<span className="nl-in"><input type="number" step="0.25" min="0.5" max="6" value={d.widthIn} onChange={(e) => setD({ ...d, widthIn: e.target.value })} onBlur={commit} />&quot;</span></label>
          <label className="wide">Note<input type="text" value={d.note} placeholder="Anything production should know" onChange={(e) => setD({ ...d, note: e.target.value })} onBlur={commit} /></label>
        </div>
        <div className="nl-prev">
          <NeckLabelView set={set} size={pv} shirtHex="#1f1f22" width={170} />
          <NeckLabelView set={set} size={pv} shirtHex="#f3f3f1" width={170} />
          {sizesSet.length > 1 && <div className="nl-prev-sz">{sizesSet.slice(0, 12).map((z) => <button key={z} type="button" className={"chip" + (z === pv ? " on" : "")} onClick={() => setPreview(z)}>{z}</button>)}</div>}
        </div>
      </div>
      <div className="nl-mode" role="group" aria-label="Label art">
        <button type="button" className={"chip" + (set.mode === "per_size" ? " on" : "")} onClick={() => patch((s) => ({ ...s, mode: "per_size" }))}>A file for each size</button>
        <button type="button" className={"chip" + (set.mode === "template" ? " on" : "")} onClick={() => patch((s) => ({ ...s, mode: "template", sizeBox: s.sizeBox || DEFAULT_BOX }))}>One design, we add the size</button>
      </div>
      {set.mode === "per_size" ? (
        <div className="nl-sizes">
          {groups.map((g) => (
            <div key={g.label} className="nl-sg">
              <div className="nl-sg-h">{g.label}</div>
              <div className="nl-sg-row">{g.sizes.map((z) => <SizeSlot key={z} size={z} file={set.files?.[z] || null} upload={upload}
                onSet={(f) => patch((s) => ({ ...s, files: { ...(s.files || {}), [z]: f || undefined } }))} />)}</div>
            </div>
          ))}
          <button type="button" className="linkbtn" onClick={() => setMore(!more)}>{more ? "Fewer sizes" : "Youth, toddler and infant sizes"}</button>
        </div>
      ) : (
        <TemplateEditor set={set} upload={upload} patch={patch} />
      )}
      <div className="nl-card-f">
        {armed ? <button type="button" className="btn sm danger" onClick={() => { setArmed(false); onOff(); }}>Take this set off?</button>
          : <button type="button" className="btn sm ghost" onClick={() => { setArmed(true); setTimeout(() => setArmed(false), 3500); }}>Take this set off</button>}
      </div>
    </div>
  );
}

function useUrl(f: NeckFile | null | undefined) {
  const [u, setU] = useState("");
  useEffect(() => { let off = false; if (f?.path && isPicture(f)) neckFileUrl(f.path).then((x) => { if (!off) setU(x); }); else setU(""); return () => { off = true; }; }, [f?.path]); // eslint-disable-line react-hooks/exhaustive-deps
  return u;
}

function SizeSlot({ size, file, upload, onSet }: { size: string; file: NeckFile | null; upload: (f: File) => Promise<NeckFile | null>; onSet: (f: NeckFile | null) => void }) {
  const inp = useRef<HTMLInputElement>(null);
  const u = useUrl(file);
  const take = async (fs: FileList | File[] | null) => { const f = fs && Array.from(fs)[0]; if (!f) return; const up = await upload(f); if (up) onSet(up); };
  return (
    <div className={"nl-slot" + (file ? " has" : "")} onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.stopPropagation(); } }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); void take(e.dataTransfer.files); }}>
      <button type="button" className="nl-slot-pic" title={file ? `${file.name}: click to replace` : `Upload the ${size} label`} onClick={() => inp.current?.click()}>
        {file ? (u ? <img src={u} alt="" /> : <span className="nl-ext">{(file.name.split(".").pop() || "").toUpperCase().slice(0, 4)}</span>) : <span className="nl-plus">+</span>}
      </button>
      <span className="nl-slot-z">{size}</span>
      {file && <button type="button" className="nl-slot-x" aria-label={`Remove the ${size} label`} onClick={() => onSet(null)}>×</button>}
      <input ref={inp} type="file" hidden accept="image/*,.pdf,.ai,.eps,.svg" onChange={(e) => { void take(e.target.files); e.target.value = ""; }} />
    </div>
  );
}

/** one design: upload it, then drag the size box where the size goes (drag the corner to size it) */
function TemplateEditor({ set, upload, patch }: { set: NeckLabelSet; upload: (f: File) => Promise<NeckFile | null>; patch: (fn: (s: NeckLabelSet) => NeckLabelSet) => Promise<boolean> }) {
  const inp = useRef<HTMLInputElement>(null), box = useRef<HTMLDivElement>(null);
  const u = useUrl(set.template);
  const [b, setB] = useState(set.sizeBox || DEFAULT_BOX);
  useEffect(() => { setB(set.sizeBox || DEFAULT_BOX); }, [set.sizeBox]);
  const drag = useRef<{ mode: "move" | "size"; x: number; y: number; b: typeof b } | null>(null);
  const take = async (fs: FileList | File[] | null) => { const f = fs && Array.from(fs)[0]; if (!f) return; const up = await upload(f); if (up) await patch((s) => ({ ...s, template: up })); };
  const move = (e: React.PointerEvent) => {
    const d = drag.current, r = box.current?.getBoundingClientRect();
    if (!d || !r) return;
    const dx = (e.clientX - d.x) / r.width, dy = (e.clientY - d.y) / r.height;
    const c = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    setB(d.mode === "move" ? { ...d.b, x: c(d.b.x + dx, 0, 1 - d.b.w), y: c(d.b.y + dy, 0, 1 - d.b.h) } : { ...d.b, w: c(d.b.w + dx, 0.06, 1 - d.b.x), h: c(d.b.h + dy, 0.05, 1 - d.b.y) });
  };
  const end = () => { if (!drag.current) return; drag.current = null; void patch((s) => ({ ...s, sizeBox: b })); };
  return (
    <div className="nl-tpl" onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.stopPropagation(); } }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); void take(e.dataTransfer.files); }}>
      {set.template ? (
        <>
          {u ? (
            <div className="nl-tpl-art" ref={box} onPointerMove={move} onPointerUp={end} onPointerLeave={end}>
              <img src={u} alt="" draggable={false} />
              <div className="nl-tpl-box" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
                onPointerDown={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { mode: "move", x: e.clientX, y: e.clientY, b }; }}>
                <span>SIZE</span>
                <i onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); (e.currentTarget.parentElement as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { mode: "size", x: e.clientX, y: e.clientY, b }; }} />
              </div>
            </div>
          ) : <div className="nl-tpl-file">{set.template.name}{!isPicture(set.template) ? " · upload a PNG or JPG to place the size and show it on mockups" : ""}</div>}
          <p className="faint" style={{ fontSize: 12.5, margin: "6px 0 0" }}>Drag the blue box to where the size goes; drag its corner to size it. Each size prints with its own size in that spot.</p>
          <button type="button" className="btn sm ghost" onClick={() => inp.current?.click()}>Replace the design</button>
        </>
      ) : (
        <button type="button" className="nl-tpl-add" onClick={() => inp.current?.click()}>+ Upload the label design (or drop it here)</button>
      )}
      <input ref={inp} type="file" hidden accept="image/*,.pdf,.ai,.eps,.svg" onChange={(e) => { void take(e.target.files); e.target.value = ""; }} />
    </div>
  );
}
