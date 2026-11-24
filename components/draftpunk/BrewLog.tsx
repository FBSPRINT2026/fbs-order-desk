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
import { saveVersion, type Version } from "@/lib/draftpunk/recipeStore";
import { diffRecipes } from "@/lib/draftpunk/versions";
import { applySubs, planLabel, shoppingList, shoppingText, starterDay, subText, type BrewPlan, type ShelfItem, type Sub } from "@/lib/draftpunk/brewPlan";
import { fromPercents } from "@/lib/draftpunk/calc";
import SwapPicker from "./SwapPicker";

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
  const [row, setRow] = useState<{ brewed_on: string; recipe_id: string | null; notes: string; status: "planned" | "brewed"; plan: BrewPlan } | null>(null);
  const [shelf, setShelf] = useState<ShelfItem[]>([]);
  const [ver, setVer] = useState<Version | null>(null);
  const [made, setMade] = useState(false);
  const [r, setR] = useState<Recipe | null>(null);
  const [m, setM] = useState<Measured>({});
  const [t, setT] = useState<Tasting>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    createClient().from("dp_ingredients").select("id, kind, name, data, in_stock").eq("owner_id", userId).then(({ data: inv }) => setShelf((inv || []) as ShelfItem[]));
    createClient().from("dp_brews").select("brewed_on, recipe_id, version_id, notes, recipe_snapshot, measured, tasting, status, plan").eq("id", id).maybeSingle().then(async ({ data }) => {
      if (!data) return;
      if (data.version_id) { const { data: v } = await createClient().from("dp_recipe_versions").select("*").eq("id", data.version_id).maybeSingle(); setVer((v as Version) || null); }
      const rec = normalize(data.recipe_snapshot as Recipe);
      setRow({ brewed_on: data.brewed_on as string, recipe_id: data.recipe_id as string | null, notes: (data.notes as string) || "", status: (data.status as "planned" | "brewed") || "brewed", plan: (data.plan as BrewPlan) || {} });
      setR(rec);
      setM({ weather: rec.weather, boilMin: rec.equipment.boilMin, ...(data.measured as Measured) });
      setT((data.tasting as Tasting) || {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // a swap made at the store or on brew day (Nick, Nov 24 2026): the brew becomes "v2 sub A"; the recipe never changes
  const swapTo = async (next: Sub[]) => {
    const base = row.plan.base || r;
    const sb = createClient();
    let label = row.plan.label || (ver ? `v${ver.num}` : "");
    if (ver && next.length && !/ sub /.test(label)) {
      const { data: others } = await sb.from("dp_brews").select("id, plan").eq("version_id", ver.id).neq("id", id);
      label = planLabel(ver.num, next, ((others || []) as { plan: BrewPlan }[]).filter((b) => b.plan?.subs?.length).length);
    } else if (ver && !next.length) label = `v${ver.num}`;
    const snap = { ...fromPercents(applySubs(base, next, shelf)), name: r.name };
    const plan: BrewPlan = { ...row.plan, base, subs: next, label };
    const { error } = await sb.from("dp_brews").update({ plan, recipe_snapshot: snap }).eq("id", id);
    if (error) { toast(error.message); return; }
    setRow({ ...row, plan }); setR(snap);
  };
  const canSwap = !row.plan.kept && (row.status === "planned" || row.brewed_on >= new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10));
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
      <h1 className="dp-h1">{row.status === "planned" ? "Planned brew" : "Brew log"}: {r.name}{row.plan.label ? <span className="dp-dim"> · {row.plan.label}</span> : null}</h1>
      <div className="dp-row">
        <F label={row.status === "planned" ? "Brewing on" : "Brewed on"}><input type="date" value={row.brewed_on} onChange={(ev) => { setRow({ ...row, brewed_on: ev.target.value }); setDirty(true); }} /></F>
        {row.recipe_id && <Link className="dp-btn" href={`/draftpunk/r/${row.recipe_id}`}>Open recipe</Link>}
        <span className="dp-dim">{dirty ? "Unsaved..." : "Saved"}</span>
      </div>
      {row.status === "planned" && (() => {
        // a planned brew (Nick, Nov 24 2026: "I'm gonna brew it Friday… so I gotta go to the store"): what it is, the
        // shopping list against the shelf as it is now, and Brewing it today when the day comes
        const shop = shoppingList(r, shelf), buy = shop.filter((l) => l.buy > 0), st = starterDay(r, row.brewed_on);
        const today = new Date(); const td = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        const brewNow = async () => { const { error } = await createClient().from("dp_brews").update({ status: "brewed", brewed_on: td }).eq("id", id); if (error) toast(error.message); else { setRow({ ...row, status: "brewed", brewed_on: td }); toast("Brew day: log it as you go"); } };
        const send = async () => { const text = shoppingText(r.name, fmtDate(row.brewed_on), shop); try { if (navigator.share) { await navigator.share({ title: `${r.name} shopping list`, text }); return; } } catch { return; } try { await navigator.clipboard.writeText(text); toast("Shopping list copied"); } catch { toast(text); } };
        return (
          <Win title={`Planned for ${fmtDate(row.brewed_on)}`} note={[row.plan.label, row.plan.sizeLabel].filter(Boolean).join(" · ")}>
            <div className="dp-bi-l">Store out of something? Swap it for this brew</div>
            <SwapPicker r={row.plan.base || r} subs={row.plan.subs || []} shelf={shelf} onChange={swapTo} />
            <div className="dp-bi-l" style={{ marginTop: 14 }}>Shopping list</div>
            <table className="dp-tbl"><tbody>
              {shop.map((l) => <tr key={l.kind + l.name}><td>{l.name}</td><td className="dp-num dp-dim">{l.want} {l.unit}</td><td className={`dp-num ${l.buy > 0 ? "dp-bi-buy" : "dp-grn"}`}>{l.buy > 0 ? (l.have > 0 ? `buy ${l.buy} ${l.unit}` : "buy") : "have it"}</td></tr>)}
            </tbody></table>
            {st && <p className="dp-note">Make a yeast starter {st <= td ? "today" : `by ${fmtDate(st)}`}.</p>}
            <p className="dp-row" style={{ marginBottom: 0, gap: 8 }}>
              <button className="dp-btn dp-go" onClick={brewNow}>Brewing it today</button>
              <button className="dp-btn" onClick={send}>Send the shopping list{buy.length ? ` (${buy.length})` : ""}</button>
            </p>
          </Win>
        );
      })()}
      {row.status === "brewed" && canSwap && !row.plan.subs?.length && (
        <Win title="Had to swap something?" note="for this brew only">
          <SwapPicker r={row.plan.base || r} subs={[]} shelf={shelf} onChange={swapTo} />
        </Win>
      )}
      {row.status === "brewed" && ver && !!row.plan.subs?.length && row.recipe_id && (() => {
        // after tasting it (Nick, Nov 24 2026: "I liked it better with the substitute… we'll call that version two"):
        // the swap becomes the next version, or stays a one-time change
        const decide = async (kept: "version" | "once") => {
          let keptNum: number | undefined;
          if (kept === "version") {
            const res = await saveVersion(row.recipe_id!, userId, r, `From ${row.plan.label || "the brew"} on ${fmtDate(row.brewed_on)}: ${(row.plan.subs || []).map(subText).join("; ")}`, id);
            if (!res.version) { toast(res.error || "Not saved"); return; }
            keptNum = res.version.num;
          }
          const plan = { ...row.plan, kept, keptNum };
          const { error } = await createClient().from("dp_brews").update({ plan }).eq("id", id);
          if (error) { toast(error.message); return; }
          setRow({ ...row, plan }); toast(kept === "version" ? `Saved as v${keptNum}` : `The recipe stays v${ver.num}`);
        };
        return (
          <Win title={`Brewed ${row.plan.label || `v${ver.num}`}`} note={ver.note}>
            {canSwap ? <SwapPicker r={row.plan.base || r} subs={row.plan.subs || []} shelf={shelf} onChange={swapTo} /> : <p style={{ marginTop: 0 }}>Swapped for this brew: {row.plan.subs!.map(subText).join("; ")}</p>}
            {row.plan.kept === "version" ? <p className="dp-grn" style={{ marginBottom: 0 }}>Kept: it&apos;s v{row.plan.keptNum} of the recipe now.</p>
              : row.plan.kept === "once" ? <p className="dp-dim" style={{ marginBottom: 0 }}>One time only: the recipe stays v{ver.num}. <button className="dp-btn" onClick={() => decide("version")}>Make it permanent after all</button></p>
              : <>
                <p style={{ fontWeight: 600 }}>Keep the swap?</p>
                <p className="dp-row" style={{ marginBottom: 0, gap: 8 }}>
                  <button className="dp-btn dp-go" onClick={() => decide("version")}>Make it permanent → next version</button>
                  <button className="dp-btn" onClick={() => decide("once")}>One time only · stay on v{ver.num}</button>
                </p>
              </>}
          </Win>
        );
      })()}
      {row.status === "brewed" && ver && !row.plan.subs?.length && (() => {
        // what this brew did differently from the version it brewed (a substitution, a tweak to try)
        const tweaks = diffRecipes(normalize(ver.data), r);
        return (
          <Win title={`Brewed v${ver.num}`} note={ver.note}>
            {tweaks.length ? (
              <>
                <p style={{ marginTop: 0 }}>Changed for this brew:</p>
                <ul className="dp-list">{tweaks.map((l) => <li key={l}>{l}</li>)}</ul>
                {row.recipe_id && !made && (
                  <p className="dp-row" style={{ marginBottom: 0 }}>
                    <button className="dp-btn dp-go" onClick={async () => { const res = await saveVersion(row.recipe_id!, userId, r, `From the ${fmtDate(row.brewed_on)} brew: ${tweaks.slice(0, 2).join("; ")}`, id); if (res.version) { setMade(true); toast(`Saved as v${res.version.num}`); } else toast(res.error || "Not saved"); }}>Make this the next version</button>
                    <span className="dp-dim">If it turned out better. If not, the recipe stays v{ver.num}.</span>
                  </p>
                )}
                {made && <p className="dp-grn" style={{ marginBottom: 0 }}>Saved as the recipe&apos;s next version.</p>}
              </>
            ) : <p className="dp-dim" style={{ margin: 0 }}>Brewed exactly as v{ver.num}.</p>}
          </Win>
        );
      })()}
      {row.status === "brewed" && <>
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
      </>}
      <p className="dp-dim"><Link href="/draftpunk/brews">&lt;&lt; ALL BREWS</Link> · Started from the recipe as it was on {fmtDate(row.brewed_on)}</p>
      {node}
    </>
  );
}
