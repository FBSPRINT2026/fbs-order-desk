"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { abvOf, boilOffReached, brewhouseReached, calcRecipe, calmBoilOff, mashEffReached, r1, sgFmt } from "@/lib/draftpunk/calc";
import { fmtDate, normalize } from "@/lib/draftpunk/defaults";
import type { Equipment, Recipe, Weather } from "@/lib/draftpunk/types";
import { useToast } from "./Shell";
import { F, Num, Win } from "./ui";
import TiltPanel from "./TiltPanel";
import Autopilot from "./Autopilot";
import type { Alarm, AutoState } from "@/lib/draftpunk/autopilot";

type Measured = {
  weather?: Weather; mashPh?: number; preBoilSg?: number; preBoilGal?: number; boilMin?: number; postBoilGal?: number;
  og?: number; intoFermGal?: number; fg?: number; packagedGal?: number; pitchedF?: number;
  /** the Tilt hydrometer in this batch (readings with this color go to the newest brew set to it) */
  tiltColor?: string;
  /** the fermentation chamber it's in, and the autopilot (run by the cron; app/api/cron/draftpunk) */
  chamberId?: string; autopilot?: AutoState; alarms?: Alarm[]; lastCheck?: string; beerTolF?: number;
};
type Tasting = { rating?: number; appearance?: string; aroma?: string; flavor?: string; mouthfeel?: string; overall?: string };

/** the calm-day boil-off learned from the logged brews: newer brews count more */
export function learnedBoilOff(log: NonNullable<Equipment["boilLog"]>, fallback: number) {
  const xs = log.slice(0, 6).map((b, i) => ({ v: calmBoilOff(b.galHr, b.weather), w: 1 / (i + 1) }));
  const tw = xs.reduce((a, x) => a + x.w, 0);
  return tw ? xs.reduce((a, x) => a + x.v * x.w, 0) / tw : fallback;
}

/** one brew session: what was measured, what that means (efficiency, boil-off, ABV), and teaching the equipment */
export default function BrewLog({ id, userId }: { id: string; userId: string }) {
  const { toast, node } = useToast();
  const [row, setRow] = useState<{ brewed_on: string; recipe_id: string | null; notes: string } | null>(null);
  const [r, setR] = useState<Recipe | null>(null);
  const [m, setM] = useState<Measured>({});
  const [t, setT] = useState<Tasting>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    createClient().from("dp_brews").select("brewed_on, recipe_id, notes, recipe_snapshot, measured, tasting").eq("id", id).maybeSingle().then(({ data }) => {
      if (!data) return;
      const rec = normalize(data.recipe_snapshot as Recipe);
      setRow({ brewed_on: data.brewed_on as string, recipe_id: data.recipe_id as string | null, notes: (data.notes as string) || "" });
      setR(rec);
      setM({ weather: rec.weather, boilMin: rec.equipment.boilMin, ...(data.measured as Measured) });
      setT((data.tasting as Tasting) || {});
    });
  }, [id]);
  const c = useMemo(() => (r ? calcRecipe(r) : null), [r]);
  const [autoTouched, setAutoTouched] = useState(false);
  const save = useCallback(async () => {
    if (!row) return;
    const sb = createClient();
    // the autopilot (every 15 min) writes measured.autopilot, alarms and lastCheck: keep its latest unless changed here
    const { data: cur } = await sb.from("dp_brews").select("measured").eq("id", id).maybeSingle();
    const server = (cur?.measured || {}) as Measured;
    const merged: Measured = { ...m, alarms: server.alarms, lastCheck: server.lastCheck, autopilot: autoTouched ? m.autopilot : server.autopilot ?? m.autopilot };
    const { error } = await sb.from("dp_brews").update({ brewed_on: row.brewed_on, notes: row.notes, measured: merged, tasting: t }).eq("id", id);
    if (!error) { setAutoTouched(false); setM((x) => ({ ...x, alarms: server.alarms, lastCheck: server.lastCheck, autopilot: merged.autopilot })); }
    if (error) toast(`Not saved: ${error.message}`); else setDirty(false);
  }, [row, m, t, id, toast, autoTouched]);
  useEffect(() => { if (!dirty) return; const k = setTimeout(save, 1200); return () => clearTimeout(k); }, [dirty, save]);
  useEffect(() => { const on = () => { save().then(() => toast("Saved")); }; window.addEventListener("dp-save", on); return () => window.removeEventListener("dp-save", on); }, [save, toast]);

  if (!r || !c || !row) return <p className="dp-dim">Loading…</p>;
  const e = r.equipment;
  const setMv = (patch: Partial<Measured>) => { setM((x) => ({ ...x, ...patch })); setDirty(true); };
  const shrink = 1 - (e.shrinkPct || 0) / 100;
  // what the day really did
  const mashEff = m.preBoilSg && m.preBoilGal ? mashEffReached(r, m.preBoilSg, m.preBoilGal * shrink) : 0;
  const boilOff = m.preBoilGal && m.postBoilGal ? boilOffReached(m.preBoilGal, m.postBoilGal, m.boilMin || e.boilMin) : 0;
  const calm = boilOff ? calmBoilOff(boilOff, m.weather) : 0;
  const bh = m.og && m.intoFermGal ? brewhouseReached(r, m.og, m.intoFermGal) : 0;
  const abv = m.og && m.fg ? abvOf(m.og, m.fg) : 0;
  const att = m.og && m.fg ? ((m.og - m.fg) / (m.og - 1)) * 100 : 0;
  const trub = m.postBoilGal && m.intoFermGal ? m.postBoilGal * shrink - m.intoFermGal : 0;

  // teach the brewer's equipment profile what this brew day showed (their own copy, made if it's a starter profile)
  const teach = async () => {
    const sb = createClient();
    const { data: found } = await sb.from("dp_equipment").select("id, data").eq("owner_id", userId).eq("name", e.name).maybeSingle();
    const cur = { ...e, ...((found?.data as Equipment) || {}) };
    const log = boilOff ? [{ date: row.brewed_on, galHr: r1(boilOff, 3), weather: m.weather }, ...(cur.boilLog || []).filter((b) => b.date !== row.brewed_on)].slice(0, 20) : cur.boilLog || [];
    const next: Equipment = { ...cur, boilLog: log };
    if (mashEff) next.mashEff = r1(mashEff, 1);
    if (log.length) next.boilOffGal = r1(learnedBoilOff(log, cur.boilOffGal), 2);
    if (trub > 0 && trub < 3) next.trubGal = r1(trub, 2);
    const { error } = found
      ? await sb.from("dp_equipment").update({ data: next, updated_at: new Date().toISOString() }).eq("id", found.id)
      : await sb.from("dp_equipment").insert({ owner_id: userId, name: e.name, data: next });
    toast(error ? `Not saved: ${error.message}` : `${e.name} updated: mash eff ${next.mashEff}% · boil-off ${next.boilOffGal} gal/hr (calm day)`);
  };

  const cmp = (label: string, planned: string, actual: string) => <tr><td>{label}</td><td className="dp-num dp-dim">{planned}</td><td className="dp-num" style={{ fontWeight: 700 }}>{actual || "-"}</td></tr>;
  return (
    <>
      <h1 className="dp-h1">Brew log: {r.name}</h1>
      <div className="dp-row">
        <F label="Brewed on"><input type="date" value={row.brewed_on} onChange={(ev) => { setRow({ ...row, brewed_on: ev.target.value }); setDirty(true); }} /></F>
        {row.recipe_id && <Link className="dp-btn" href={`/draftpunk/r/${row.recipe_id}`}>Open recipe</Link>}
        <span className="dp-dim">{dirty ? "Unsaved..." : "Saved"}</span>
      </div>
      <div className="dp-grid">
        <Win title="Measured">
          <div className="dp-row">
            <F label="Air °F"><Num value={m.weather?.tempF} onChange={(n) => setMv({ weather: { tempF: n, rh: m.weather?.rh ?? 50, windMph: m.weather?.windMph ?? 0 } })} /></F>
            <F label="Humid %"><Num value={m.weather?.rh} onChange={(n) => setMv({ weather: { tempF: m.weather?.tempF ?? 70, rh: n, windMph: m.weather?.windMph ?? 0 } })} /></F>
            <F label="Wind mph"><Num value={m.weather?.windMph} onChange={(n) => setMv({ weather: { tempF: m.weather?.tempF ?? 70, rh: m.weather?.rh ?? 50, windMph: n } })} /></F>
          </div>
          <div className="dp-row" style={{ marginTop: 8 }}>
            <F label="Mash pH"><Num value={m.mashPh} onChange={(n) => setMv({ mashPh: n })} /></F>
            <F label="Pre-boil sg"><Num className="dp-nw" value={m.preBoilSg} onChange={(n) => setMv({ preBoilSg: n })} /></F>
            <F label="Pre-boil gal (hot)"><Num value={m.preBoilGal} onChange={(n) => setMv({ preBoilGal: n })} /></F>
            <F label="Boil min"><Num value={m.boilMin} onChange={(n) => setMv({ boilMin: n })} /></F>
            <F label="End of boil gal (hot)"><Num value={m.postBoilGal} onChange={(n) => setMv({ postBoilGal: n })} /></F>
          </div>
          <div className="dp-row" style={{ marginTop: 8 }}>
            <F label="OG"><Num className="dp-nw" value={m.og} onChange={(n) => setMv({ og: n })} /></F>
            <F label="Into fermenter gal"><Num value={m.intoFermGal} onChange={(n) => setMv({ intoFermGal: n })} /></F>
            <F label="Pitched °F"><Num value={m.pitchedF} onChange={(n) => setMv({ pitchedF: n })} /></F>
            <F label="FG"><Num className="dp-nw" value={m.fg} onChange={(n) => setMv({ fg: n })} /></F>
            <F label="Packaged gal"><Num value={m.packagedGal} onChange={(n) => setMv({ packagedGal: n })} /></F>
          </div>
        </Win>
        <Win title="Planned vs actual">
          <table className="dp-tbl" data-nofit>
            <thead><tr><th /><th className="dp-num">Plan</th><th className="dp-num">Actual</th></tr></thead>
            <tbody>
              {cmp("Mash pH", r1(c.mashPh, 2).toFixed(2), m.mashPh ? m.mashPh.toFixed(2) : "")}
              {cmp("Pre-boil", `${r1(c.preBoilGal, 2)} gal @ ${sgFmt(c.preBoilGravity)}`, m.preBoilGal ? `${m.preBoilGal} gal @ ${sgFmt(m.preBoilSg || 0)}` : "")}
              {cmp("Mash efficiency", `${e.mashEff}%`, mashEff ? `${r1(mashEff, 1)}%` : "")}
              {cmp("Boil-off", `${r1(c.boilOffGal, 2)} gal/hr`, boilOff ? `${r1(boilOff, 2)} gal/hr` : "")}
              {cmp("Boil-off, calm-day", `${e.boilOffGal}`, calm ? `${r1(calm, 2)}` : "")}
              {cmp("Left in kettle", `${e.trubGal} gal`, trub ? `${r1(trub, 2)} gal` : "")}
              {cmp("OG", sgFmt(c.og), m.og ? sgFmt(m.og) : "")}
              {cmp("Brewhouse eff (result)", `${r1(c.brewhouseEff, 0)}%`, bh ? `${r1(bh, 1)}%` : "")}
              {cmp("FG", sgFmt(c.fg), m.fg ? sgFmt(m.fg) : "")}
              {cmp("Attenuation", `${r1(c.attenuation, 0)}%`, att ? `${r1(att, 1)}%` : "")}
              {cmp("ABV", `${r1(c.abv, 1)}%`, abv ? `${r1(abv, 2)}%` : "")}
            </tbody>
          </table>
          <p style={{ marginTop: 10 }}>
            <button className="dp-btn dp-go" disabled={!mashEff && !boilOff} onClick={teach}>Save to my equipment</button>
          </p>
          <p className="dp-dim">Updates {e.name} with this brew&apos;s mash efficiency, kettle loss and boil-off (turned back to a calm 70°F day from the weather, averaged with your last brews).</p>
        </Win>
      </div>
      <Autopilot r={r} userId={userId} chamberId={m.chamberId} auto={m.autopilot} alarms={m.alarms} lastCheck={m.lastCheck} beerTolF={m.beerTolF}
        onChange={(p) => { if (p.autopilot) setAutoTouched(true); setMv(p); }} />
      <TiltPanel brewId={id} r={r} og={m.og || c.og} color={m.tiltColor} chamberId={m.chamberId} onColor={(tc) => setMv({ tiltColor: tc || undefined })} />
      <div className="dp-grid">
        <Win title="Notes">
          <textarea value={row.notes} onChange={(ev) => { setRow({ ...row, notes: ev.target.value }); setDirty(true); }} placeholder="what happened today" />
        </Win>
        <Win title="Tasting">
          <div className="dp-row">
            <F label="Rating (1-5)"><Num value={t.rating} onChange={(n) => { setT({ ...t, rating: Math.max(0, Math.min(5, n)) }); setDirty(true); }} /></F>
            <span className="dp-clock" style={{ fontSize: 20 }}>{"★".repeat(Math.round(t.rating || 0))}{"☆".repeat(5 - Math.round(t.rating || 0))}</span>
          </div>
          {(["appearance", "aroma", "flavor", "mouthfeel", "overall"] as const).map((k) => (
            <F key={k} label={k[0].toUpperCase() + k.slice(1)}><input value={t[k] || ""} onChange={(ev) => { setT({ ...t, [k]: ev.target.value }); setDirty(true); }} /></F>
          ))}
        </Win>
      </div>
      <p className="dp-dim"><Link href="/draftpunk/brews">&lt;&lt; ALL BREWS</Link> · Started from the recipe as it was on {fmtDate(row.brewed_on)}</p>
      {node}
    </>
  );
}
