"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { r1, volumes } from "@/lib/draftpunk/calc";
import { fmtDate } from "@/lib/draftpunk/defaults";
import { DEFAULT_EQUIPMENT } from "@/lib/draftpunk/library";
import type { Equipment } from "@/lib/draftpunk/types";
import { useToast } from "./Shell";
import { F, Num, Win } from "./ui";
import Chambers from "./Chambers";

type Row = { id: string | null; e: Equipment };
const FIELDS: [keyof Equipment, string][] = [
  ["batchGal", "Into fermenter gal"], ["boilMin", "Boil min"], ["boilOffGal", "Boil-off gal/hr (calm 70°F)"], ["mashEff", "Mash efficiency %"],
  ["trubGal", "Left in kettle gal"], ["fermLossGal", "Fermenter loss gal"], ["tunDeadGal", "Mash tun dead space gal"], ["absorbGalPerLb", "Grain absorbs gal/lb"],
  ["mashEvapGalPerHr", "Mash evaporation gal/hr"], ["shrinkPct", "Cooling shrink %"], ["hopUtilPct", "Hop utilization %"], ["elevationFt", "Elevation ft"],
  ["kettleGal", "Kettle size gal"], ["fermenterGal", "Fermenter size gal"], ["fermenterMaxPsi", "Fermenter max PSI"],
];

/** equipment profiles: the brewer's own (saved) and the starter ones (copied when changed) */
export default function EquipmentEditor({ userId }: { userId: string }) {
  const { toast, node } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState(0);
  const [draft, setDraft] = useState<Equipment | null>(null);
  const load = async () => {
    const { data } = await createClient().from("dp_equipment").select("id, name, data").eq("owner_id", userId).order("name");
    const mine = (data || []).map((x) => ({ id: x.id as string, e: { ...(x.data as Equipment), name: x.name as string } }));
    const all = [...mine, ...DEFAULT_EQUIPMENT.filter((d) => !mine.some((m) => m.e.name === d.name)).map((e) => ({ id: null, e }))];
    setRows(all);
    return all;
  };
  useEffect(() => { load().then((all) => setDraft(structuredClone(all[0]?.e || DEFAULT_EQUIPMENT[0]))); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const v = useMemo(() => (draft ? volumes(draft) : null), [draft]);
  const save = async () => {
    if (!draft) return;
    const sb = createClient();
    const cur = rows[sel];
    const { error } = cur?.id && cur.e.name === draft.name
      ? await sb.from("dp_equipment").update({ name: draft.name, data: draft, updated_at: new Date().toISOString() }).eq("id", cur.id)
      : await sb.from("dp_equipment").insert({ owner_id: userId, name: draft.name, data: draft });
    toast(error ? `Not saved: ${error.message}` : "Saved to my equipment");
    const all = await load();
    setSel(Math.max(0, all.findIndex((x) => x.e.name === draft.name)));
  };
  useEffect(() => { const on = () => save(); window.addEventListener("dp-save", on); return () => window.removeEventListener("dp-save", on); });
  if (!draft || !v) return <p>Loading...</p>;
  return (
    <>
      <h1 className="dp-h1">Equipment</h1>
      <div className="dp-row">
        <F label="Profile" grow="1 1 320px">
          <select value={sel} onChange={(e) => { const i = Number(e.target.value); setSel(i); setDraft(structuredClone(rows[i].e)); }}>
            {rows.map((r, i) => <option key={r.e.name} value={i}>{r.e.name}{r.id ? "" : " (starter)"}</option>)}
          </select>
        </F>
        <button className="dp-btn dp-go" onClick={save}>Save</button>
        <button className="dp-btn" onClick={() => { setDraft({ ...draft, name: `${draft.name} (copy)`, boilLog: [] }); setSel(-1); }}>Save as new</button>
      </div>
      <div className="dp-grid">
        <Win title="Setup">
          <F label="Name"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></F>
          <div className="dp-row" style={{ marginTop: 8 }}>
            {FIELDS.map(([k, l]) => <F key={k} label={l}><Num value={draft[k] as number} onChange={(n) => setDraft({ ...draft, [k]: n })} /></F>)}
          </div>
          <SizesField sizes={draft.sizes} batchGal={draft.batchGal} onChange={(sizes) => setDraft({ ...draft, sizes })} />
          <div className="dp-row" style={{ marginTop: 8 }}>
            <label className="dp-row"><input type="checkbox" checked={!!draft.lodo} onChange={(e) => setDraft({ ...draft, lodo: e.target.checked })} /> I brew LODO (new recipes start with it on)</label>
          </div>
          <div className="dp-row" style={{ marginTop: 8 }}>
            <F label="Brewing place (for weather)" grow="1 1 200px"><input value={draft.place?.name || ""} onChange={(e) => setDraft({ ...draft, place: { lat: draft.place?.lat ?? 0, lon: draft.place?.lon ?? 0, name: e.target.value } })} /></F>
            <F label="Lat"><Num className="dp-nw" value={draft.place?.lat} onChange={(n) => setDraft({ ...draft, place: { name: draft.place?.name || "", lon: draft.place?.lon ?? 0, lat: n } })} /></F>
            <F label="Lon"><Num className="dp-nw" value={draft.place?.lon} onChange={(n) => setDraft({ ...draft, place: { name: draft.place?.name || "", lat: draft.place?.lat ?? 0, lon: n } })} /></F>
          </div>
          <F label="Notes"><textarea value={draft.notes || ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></F>
        </Win>
        <Win title="Volumes">
          <table className="dp-tbl" data-nofit>
            <tbody>
              <tr><td>Pre-boil (hot)</td><td className="dp-num">{r1(v.preBoil, 2)} gal</td></tr>
              <tr><td>End of boil (hot)</td><td className="dp-num">{r1(v.postBoilHot, 2)} gal</td></tr>
              <tr><td>End of boil (cooled)</td><td className="dp-num">{r1(v.postBoilCold, 2)} gal</td></tr>
              <tr><td>Into the fermenter</td><td className="dp-num">{r1(v.intoFerm, 2)} gal</td></tr>
              <tr><td>Packaged</td><td className="dp-num">{r1(v.bottled, 2)} gal</td></tr>
            </tbody>
          </table>
          {draft.kettleGal && v.preBoil > draft.kettleGal ? <p className="dp-note">Pre-boil is more than the kettle holds.</p> : null}
          <p className="dp-dim">Gravity follows the sugar: Mash efficiency sets how much reaches the kettle; boil-off and losses only move volume. Brewhouse efficiency is shown as a result, never entered.</p>
        </Win>
      </div>
      {!!draft.boilLog?.length && (
        <Win title="What your brew days showed">
          <table className="dp-tbl" data-nofit>
            <thead><tr><th>Date</th><th className="dp-num">Boil-off</th><th>Weather</th></tr></thead>
            <tbody>{draft.boilLog.map((b) => <tr key={b.date}><td>{fmtDate(b.date)}</td><td className="dp-num">{b.galHr} gal/hr</td><td>{b.weather ? `${b.weather.tempF}°F · ${b.weather.rh}% · ${b.weather.windMph} mph` : "-"}</td></tr>)}</tbody>
          </table>
        </Win>
      )}
      <Chambers userId={userId} />
      {node}
    </>
  );
}

/** the batch sizes this system brews (3, 5, 10 gal): each one a choice under the system in a recipe's Equipment */
function SizesField({ sizes, onChange }: { sizes?: { label: string; batchGal: number; aidLb?: number }[]; batchGal?: number; onChange: (s: { label: string; batchGal: number; aidLb?: number }[] | undefined) => void }) {
  const [text, setText] = useState((sizes || []).map((s) => s.label.replace(/\s*gal$/, "")).join(", "));
  const commit = () => {
    // "3, 5, 10" are packaged gallons; into the fermenter is 10% more (5 gal → 5.5)
    const list = text.split(/[,\s]+/).map(Number).filter((n) => n > 0).map((n) => ({ label: `${n} gal`, batchGal: Math.round(n * 1.1 * 100) / 100, aidLb: sizes?.find((s) => s.label === `${n} gal`)?.aidLb ?? Math.round(n * 0.15 * 2) / 2 }));
    onChange(list.length ? list : undefined);
  };
  return (
    <div className="dp-row" style={{ marginTop: 8 }}>
      <F label="Batch sizes I brew (gal)" grow="1 1 220px"><input value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} placeholder="e.g. 3, 5, 10" /></F>
      <span className="dp-dim" style={{ alignSelf: "flex-end", paddingBottom: 8 }}>{(sizes || []).map((s) => `${s.label} → ${s.batchGal} gal into the fermenter`).join(" · ")}</span>
    </div>
  );
}
