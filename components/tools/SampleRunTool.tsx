"use client";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import MoneyField from "@/components/MoneyField";
import { uid, type Group, type GLine, type Order } from "@/lib/pricing";
import { SAMPLE_STAGES, SOURCE_LABEL, sampleCharged, sampleCredit, samplePieces, startCharges, type GroupSample, type SampleCharge, type SampleKind, type SampleSource, type SampleStage } from "@/lib/samples";

/**
 * THE Sample tool (Nov 11 2026, Nick): one pop-up for both kinds of sample (lib/samples.ts).
 *  - Order + sample: pick the pieces to sample off the order's garments (one of each size in a click), the prints,
 *    where the pieces come from, the charges, the day. It becomes its own "Sample run" group at the top of the order.
 *  - Sample only: a group of a Sample order gets its charges, day and note.
 * Charges are "anything goes" (Nick: "the rules on samples are… all over the map… it should be a very any option"):
 * rows of a name and an amount, each of which can be credited back on the full run.
 * Opened from the order's Production ▾ menu, the Order type's Order + sample, and a sample group's Edit.
 */
type Patch = (fn: (d: Order) => void) => void;
const PRESETS = ["Sample fee", "Screens / setup", "PMS / ink matching", "Pieces", "Shipping the sample"];
const sizeOrder = (z: string[]) => z;
const pcs = (sizes: Record<string, number | undefined>) => Object.values(sizes || {}).reduce<number>((a, v) => a + (+(v || 0)), 0);

export default function SampleRunTool({ o, patch, groupId, kind, onClose }: { o: Pick<Order, "groups" | "number" | "nickname">; patch: Patch;
  /** editing this sample group (else a new pre-production sample) */ groupId?: string; kind: SampleKind; onClose: () => void }) {
  const editing = groupId ? o.groups.find((g) => g.id === groupId) : undefined;
  const prod = o.groups.filter((g) => !g.sample);
  const s0: GroupSample = editing?.sample || { kind, source: "top", charges: startCharges(20), stage: "planned" };
  const [charges, setCharges] = useState<SampleCharge[]>(s0.charges.length ? s0.charges : startCharges(20));
  const [source, setSource] = useState<SampleSource>(s0.source);
  const [runOn, setRunOn] = useState(s0.runOn || "");
  const [note, setNote] = useState(s0.note || "");
  // the pieces picked, by the order line they come from (pre-production only)
  const [pick, setPick] = useState<Record<string, Record<string, number>>>(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const l of editing?.lines || []) if (l.sampleOf) m[l.sampleOf] = { ...(l.sizes as Record<string, number>) };
    return m;
  });
  const prints0 = useMemo(() => new Set((editing?.imprints || []).map((d) => d.fromPrint || d.id)), [editing]);
  const [prints, setPrints] = useState<Set<string>>(() => (editing ? prints0 : new Set(prod.flatMap((g) => g.imprints.map((d) => d.id)))));
  const lines = prod.flatMap((g) => g.lines.filter((l) => pcs(l.sizes as Record<string, number>) > 0 || (l.style || "").trim()).map((l) => ({ g, l })));
  const picked = Object.values(pick).reduce<number>((a, z) => a + pcs(z), 0);
  const total = sampleCharged({ kind, source, charges }), credit = sampleCredit({ kind, source, charges });
  const setSize = (lid: string, z: string, v: number) => setPick((p) => ({ ...p, [lid]: { ...(p[lid] || {}), [z]: Math.max(0, v) } }));
  const oneEach = () => setPick(() => { const m: Record<string, Record<string, number>> = {}; for (const { l } of lines) { const z: Record<string, number> = {}; for (const [k, v] of Object.entries(l.sizes || {})) if (+(v || 0) > 0) z[k] = 1; m[l.id] = z; } return m; });
  const setCharge = (id: string, p: Partial<SampleCharge>) => setCharges((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)));

  function save() {
    patch((d) => {
      const sample: GroupSample = { ...(editing?.sample || {}), kind, source, charges: charges.filter((c) => c.label.trim() || +(c.amount || 0)), runOn: runOn || undefined, note: note.trim() || undefined, stage: editing?.sample?.stage || "planned" };
      if (kind === "only") {
        const g = d.groups.find((x) => x.id === groupId);
        if (g) g.sample = sample;
        return;
      }
      // pre-production: the sample's own group, its lines copied from the order's with the sizes picked, its prints the ones ticked
      const srcGroups = d.groups.filter((g) => !g.sample);
      const sl: GLine[] = srcGroups.flatMap((g) => g.lines.filter((l) => pcs(pick[l.id] || {}) > 0).map((l) => ({ ...JSON.parse(JSON.stringify(l)), id: editing?.lines.find((x) => x.sampleOf === l.id)?.id || uid(), sizes: Object.fromEntries(Object.entries(pick[l.id] || {}).filter(([, v]) => v > 0)), priceOverride: null, sampleOf: l.id } as GLine)));
      const from = srcGroups.find((g) => g.lines.some((l) => pcs(pick[l.id] || {}) > 0)) || srcGroups[0];
      const seenLoc = new Set<string>();
      const imps = srcGroups.flatMap((g) => g.imprints).filter((p) => prints.has(p.id)).filter((p) => { const k = `${p.design_id || p.id}|${p.location}`; if (seenLoc.has(k)) return false; seenLoc.add(k); return true; })
        .map((p) => ({ ...JSON.parse(JSON.stringify(p)), id: editing?.imprints.find((x) => x.fromPrint === p.id)?.id || uid(), fromPrint: p.id, changeOf: undefined }));
      const base: Group = editing ? d.groups.find((g) => g.id === editing.id)! : { id: uid(), name: "Sample run", lines: [], imprints: [], ...(from?.mockupThumbs ? { mockupThumbs: [...from.mockupThumbs] } : {}), ...(from?.mockupArt ? { mockupArt: from.mockupArt } : {}) } as Group;
      base.lines = sl; base.imprints = imps; base.sample = sample;
      if (!editing) d.groups.unshift(base);
    });
    onClose();
  }
  const canSave = kind === "only" || picked > 0;
  return createPortal(
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet smr" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Sample run">
        <div className="pp-sheet-h"><b>{kind === "pre" ? "Pre-production sample" : "Sample"} <span className="faint smr-no">#{o.number} {o.nickname || ""}</span></b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="smr-b">
          {kind === "pre" && <>
            <div className="smr-row"><div className="smr-lab">What are we sampling?</div><button type="button" className="btn sm" onClick={oneEach}>One of each size</button></div>
            {!lines.length && <div className="faint">Add the order&apos;s garments first.</div>}
            {lines.map(({ l }) => {
              const sizes = sizeOrder(Object.keys(l.sizes || {}).filter((k) => +((l.sizes as Record<string, number>)[k] || 0) > 0));
              return (
                <div key={l.id} className="smr-line">
                  <div className="smr-ln"><b data-notranslate>{[l.brand, l.style].filter(Boolean).join(" ") || "Garment"}</b> <span className="faint" data-notranslate>{l.color}</span> <span className="faint">· {pcs(l.sizes as Record<string, number>)} ordered</span></div>
                  <div className="smr-sizes">{(sizes.length ? sizes : ["OS"]).map((z) => { const v = pick[l.id]?.[z] || 0; return (
                    <label key={z} className={"smr-sz" + (v ? " on" : "")}><span>{z}</span><input type="number" min={0} value={v || 0} onChange={(e) => setSize(l.id, z, +e.target.value || 0)} /></label>
                  ); })}</div>
                </div>
              );
            })}
            {prod.some((g) => g.imprints.length) && <>
              <div className="smr-lab">Prints</div>
              <div className="smr-prints">{prod.flatMap((g) => g.imprints).map((p) => (
                <label key={p.id} className="smr-chk"><input type="checkbox" checked={prints.has(p.id)} onChange={(e) => setPrints((x) => { const n = new Set(x); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} />{p.location}{p.method === "screen" ? ` · ${p.colors}c` : ""}</label>
              ))}</div>
            </>}
            <div className="smr-lab">Where the sample pieces come from</div>
            <div className="smr-seg" role="radiogroup">{(["top", "customer", "extra"] as SampleSource[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={source === k} className={source === k ? "on" : ""} onClick={() => setSource(k)}>{SOURCE_LABEL[k]}</button>
            ))}</div>
            <div className="faint smr-hint">{source === "top" ? `The full run prints ${picked || "the sample's"} fewer; the customer still gets the samples as part of the order.` : source === "customer" ? "The customer sent extra pieces for the sample (count them in when they arrive)." : "We order extra blanks for the sample, on top of the order's goods."}</div>
          </>}
          <div className="smr-lab">Charges <i>anything goes</i></div>
          {charges.map((c) => (
            <div key={c.id} className="smr-chg">
              <input className="smr-in" value={c.label} placeholder="What it's for" onChange={(e) => setCharge(c.id, { label: e.target.value })} />
              <MoneyField className="smr-in smr-amt" value={c.amount} placeholder="0.00" onChange={(e) => setCharge(c.id, { amount: e.target.value === "" ? "" : +e.target.value })} />
              <label className="smr-chk smr-cr" title="Paid on the sample and taken off the full run"><input type="checkbox" checked={!!c.credit} onChange={(e) => setCharge(c.id, { credit: e.target.checked })} />Credit on the full run</label>
              <button type="button" className="btn icon ghost" aria-label="Remove" onClick={() => setCharges((cs) => cs.filter((x) => x.id !== c.id))}>✕</button>
            </div>
          ))}
          <div className="smr-add">{PRESETS.filter((p) => !charges.some((c) => c.label === p)).map((p) => (
            <button key={p} type="button" className="btn sm ghost" onClick={() => setCharges((cs) => [...cs, { id: uid(), label: p, amount: "" }])}>+ {p}</button>
          ))}<button type="button" className="btn sm ghost" onClick={() => setCharges((cs) => [...cs, { id: uid(), label: "", amount: "" }])}>+ Other</button></div>
          <div className="smr-grid">
            <div className="field"><label>Run on</label><input type="date" value={runOn} onChange={(e) => setRunOn(e.target.value)} /></div>
            <div className="field"><label>Note</label><input value={note} placeholder="Ship to the customer for the photo shoot" onChange={(e) => setNote(e.target.value)} /></div>
          </div>
          <div className="smr-foot">
            <span className="faint">{kind === "pre" ? `${picked} pc${picked === 1 ? "" : "s"} · ` : ""}${total.toFixed(2)} on the sample{credit ? ` · $${credit.toFixed(2)} credited on the full run` : ""}{kind === "pre" ? " · the full run waits for their OK" : ""}</span>
            <button type="button" className="btn primary" disabled={!canSave} onClick={save}>{editing ? "Save" : kind === "pre" ? "Add sample" : "Save"}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** a sample group's strip on the order: its tag, what it charges, where it is (Planned → Pulled → Printed → Approved),
 *  Edit, and on a Sample only order, Make the order (or the order it became) */
export function SampleBar({ g, orderId, me, patch, onEdit, onMade }: { g: Group; orderId: string; me: string; patch: Patch; onEdit: () => void; onMade?: (id: string, number: number) => void }) {
  const s = g.sample!;
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const st = s.stage || "planned", ix = SAMPLE_STAGES.findIndex((x) => x.k === st);
  const setStage = (k: SampleStage) => patch((d) => { const x = d.groups.find((y) => y.id === g.id); if (!x) return; x.sample ||= { ...s }; x.sample.stage = k; x.sample.at = { ...(x.sample.at || {}), [k]: { at: new Date().toISOString(), by: me } }; });
  async function make() {
    setBusy(true); setErr("");
    const r = await fetch("/api/orders/from-sample", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: orderId, group: g.id }) }).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the server." }));
    setBusy(false);
    if (r.error && !r.id) { setErr(r.error); return; }
    patch((d) => { const x = d.groups.find((y) => y.id === g.id); if (x) x.sample = { ...(x.sample || s), made: { id: r.id, number: r.number } }; });
    onMade?.(r.id, r.number);
  }
  const charged = sampleCharged(s), credit = sampleCredit(s), n = samplePieces(g);
  return (
    <div className="smr-bar">
      <div className="smr-bar-t">
        <span className="smr-tag">{s.kind === "pre" ? "Sample" : "Sample only"}</span>
        <span className="smr-bar-s">{n} pc{n === 1 ? "" : "s"}{s.kind === "pre" ? ` · ${SOURCE_LABEL[s.source].toLowerCase()}` : ""}{s.runOn ? ` · runs ${new Date(s.runOn + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}` : ""} · {!s.charges.length && s.kind === "only" ? <span>priced by the customer&apos;s sample rule</span> : <><b className="nw">${(s.kind === "pre" ? charged - credit : charged).toFixed(2)}</b>{credit ? <span className="nw"> ({s.kind === "pre" ? `$${credit.toFixed(2)} credited` : `$${credit.toFixed(2)} credited on the full order`})</span> : null}</>}</span>
        <span className="smr-sp" />
        <span className="smr-steps" role="group" aria-label="Sample stage">{SAMPLE_STAGES.map((x, i) => (
          <button key={x.k} type="button" className={"smr-step" + (i < ix ? " done" : i === ix ? " cur" : "")} onClick={() => setStage(x.k)} title={s.at?.[x.k] ? `${x.label} ${new Date(s.at[x.k]!.at).toLocaleDateString()}${s.at[x.k]!.by ? ` by ${s.at[x.k]!.by}` : ""}` : `Mark ${x.label.toLowerCase()}`}><i>{i < ix ? "✓" : i + 1}</i>{x.label}</button>
        ))}</span>
        <button type="button" className="btn sm" onClick={onEdit}>Edit</button>
        {s.kind === "only" && (s.made ? <Link className="btn sm" href={`/shop/orders/${s.made.id}`}>Order #{s.made.number}</Link> : <button type="button" className="btn sm primary" disabled={busy} onClick={() => void make()}>{busy ? "Making…" : "Make the order"}</button>)}
      </div>
      {(s.charges.length > 0 || s.note) && <div className="smr-bar-c">{s.charges.map((c) => <span key={c.id} className="nw">{c.label || "Charge"} <b>${(+(c.amount || 0)).toFixed(2)}</b>{c.credit ? " · credited" : ""}</span>)}{s.note ? <span className="faint">{s.note}</span> : null}</div>}
      {s.kind === "pre" && st !== "approved" && <div className="smr-wait">The full run waits for the customer&apos;s OK on this sample.</div>}
      {err && <div className="smr-err">{err}</div>}
    </div>
  );
}
