"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { r1, volumes } from "@/lib/draftpunk/calc";
import { fmtDate } from "@/lib/draftpunk/defaults";
import { DEFAULT_EQUIPMENT } from "@/lib/draftpunk/library";
import type { Equipment } from "@/lib/draftpunk/types";
import { useToast } from "./Shell";
import { F, Num, Win } from "./ui";

type Row = { id: string | null; e: Equipment };
const FIELDS: [keyof Equipment, string][] = [
  ["batchGal", "INTO FERMENTER GAL"], ["boilMin", "BOIL MIN"], ["boilOffGal", "BOIL-OFF GAL/HR (CALM 70°F)"], ["mashEff", "MASH EFFICIENCY %"],
  ["trubGal", "LEFT IN KETTLE GAL"], ["fermLossGal", "FERMENTER LOSS GAL"], ["tunDeadGal", "MASH TUN DEAD SPACE GAL"], ["absorbGalPerLb", "GRAIN ABSORBS GAL/LB"],
  ["mashEvapGalPerHr", "MASH EVAPORATION GAL/HR"], ["shrinkPct", "COOLING SHRINK %"], ["hopUtilPct", "HOP UTILIZATION %"], ["elevationFt", "ELEVATION FT"],
  ["kettleGal", "KETTLE SIZE GAL"], ["fermenterGal", "FERMENTER SIZE GAL"],
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
    toast(error ? `NOT SAVED: ${error.message}` : "SAVED TO MY EQUIPMENT");
    const all = await load();
    setSel(Math.max(0, all.findIndex((x) => x.e.name === draft.name)));
  };
  useEffect(() => { const on = () => save(); window.addEventListener("dp-save", on); return () => window.removeEventListener("dp-save", on); });
  if (!draft || !v) return <p>LOADING...</p>;
  return (
    <>
      <h1 className="dp-h1">C:\DRAFTPUNK\EQUIPMENT&gt;<span className="dp-blink">_</span></h1>
      <div className="dp-row">
        <F label="PROFILE" grow="1 1 320px">
          <select value={sel} onChange={(e) => { const i = Number(e.target.value); setSel(i); setDraft(structuredClone(rows[i].e)); }}>
            {rows.map((r, i) => <option key={r.e.name} value={i}>{r.e.name}{r.id ? "" : " (starter)"}</option>)}
          </select>
        </F>
        <button className="dp-btn dp-go" onClick={save}>SAVE</button>
        <button className="dp-btn" onClick={() => { setDraft({ ...draft, name: `${draft.name} (copy)`, boilLog: [] }); setSel(-1); }}>SAVE AS NEW</button>
      </div>
      <div className="dp-grid">
        <Win title="SETUP">
          <F label="NAME"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></F>
          <div className="dp-row" style={{ marginTop: 8 }}>
            {FIELDS.map(([k, l]) => <F key={k} label={l}><Num value={draft[k] as number} onChange={(n) => setDraft({ ...draft, [k]: n })} /></F>)}
          </div>
          <div className="dp-row" style={{ marginTop: 8 }}>
            <label className="dp-row"><input type="checkbox" checked={!!draft.lodo} onChange={(e) => setDraft({ ...draft, lodo: e.target.checked })} /> I BREW LODO (NEW RECIPES START WITH IT ON)</label>
          </div>
          <div className="dp-row" style={{ marginTop: 8 }}>
            <F label="BREWING PLACE (FOR WEATHER)" grow="1 1 200px"><input value={draft.place?.name || ""} onChange={(e) => setDraft({ ...draft, place: { lat: draft.place?.lat ?? 0, lon: draft.place?.lon ?? 0, name: e.target.value } })} /></F>
            <F label="LAT"><Num className="dp-nw" value={draft.place?.lat} onChange={(n) => setDraft({ ...draft, place: { name: draft.place?.name || "", lon: draft.place?.lon ?? 0, lat: n } })} /></F>
            <F label="LON"><Num className="dp-nw" value={draft.place?.lon} onChange={(n) => setDraft({ ...draft, place: { name: draft.place?.name || "", lat: draft.place?.lat ?? 0, lon: n } })} /></F>
          </div>
          <F label="NOTES"><textarea value={draft.notes || ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></F>
        </Win>
        <Win title="VOLUMES">
          <table className="dp-tbl" data-nofit>
            <tbody>
              <tr><td>Pre-boil (hot)</td><td className="dp-num">{r1(v.preBoil, 2)} gal</td></tr>
              <tr><td>End of boil (hot)</td><td className="dp-num">{r1(v.postBoilHot, 2)} gal</td></tr>
              <tr><td>End of boil (cooled)</td><td className="dp-num">{r1(v.postBoilCold, 2)} gal</td></tr>
              <tr><td>Into the fermenter</td><td className="dp-num">{r1(v.intoFerm, 2)} gal</td></tr>
              <tr><td>Packaged</td><td className="dp-num">{r1(v.bottled, 2)} gal</td></tr>
            </tbody>
          </table>
          {draft.kettleGal && v.preBoil > draft.kettleGal ? <p className="dp-note">PRE-BOIL IS MORE THAN THE KETTLE HOLDS.</p> : null}
          <p className="dp-dim">GRAVITY FOLLOWS THE SUGAR: MASH EFFICIENCY SETS HOW MUCH REACHES THE KETTLE; BOIL-OFF AND LOSSES ONLY MOVE VOLUME. BREWHOUSE EFFICIENCY IS SHOWN AS A RESULT, NEVER ENTERED.</p>
        </Win>
      </div>
      {!!draft.boilLog?.length && (
        <Win title="WHAT YOUR BREW DAYS SHOWED">
          <table className="dp-tbl">
            <thead><tr><th>DATE</th><th className="dp-num">BOIL-OFF</th><th>WEATHER</th></tr></thead>
            <tbody>{draft.boilLog.map((b) => <tr key={b.date}><td>{fmtDate(b.date)}</td><td className="dp-num">{b.galHr} gal/hr</td><td>{b.weather ? `${b.weather.tempF}°F · ${b.weather.rh}% · ${b.weather.windMph} mph` : "-"}</td></tr>)}</tbody>
          </table>
        </Win>
      )}
      {node}
    </>
  );
}
