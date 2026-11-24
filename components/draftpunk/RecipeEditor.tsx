"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { calcRecipe, calcSummary, r1, scaleRecipe, sgFmt } from "@/lib/draftpunk/calc";
import { normalize, newRecipe } from "@/lib/draftpunk/defaults";
import { DEFAULT_EQUIPMENT } from "@/lib/draftpunk/library";
import { STYLE_GROUPS, styleById, styleLabel } from "@/lib/draftpunk/styles";
import { toBeerXml } from "@/lib/draftpunk/beerxml";
import type { Equipment, IbuMethod, Recipe, RecipeType } from "@/lib/draftpunk/types";
import { useToast } from "./Shell";
import { F, Num, StyleBar, Win } from "./ui";
import { DesignTab, FermentTab, MashTab, MineItem, NotesTab, WaterTab } from "./RecipeTabs";
import BrewDay from "./BrewDay";

const TABS = ["DESIGN", "MASH", "WATER", "FERMENT", "BREW DAY", "NOTES"] as const;
type Tab = (typeof TABS)[number];
const TYPES: [RecipeType, string][] = [["all_grain", "All Grain"], ["biab", "BIAB"], ["partial_mash", "Partial Mash"], ["extract", "Extract"], ["mead", "Mead"], ["cider", "Cider"], ["wine", "Wine"]];

/**
 * The recipe builder: equipment, ingredients, mash, water, fermentation and the brew day sheet, with every number
 * worked out as you type and checked against the style. Saves itself a moment after each change (and on F2). A club
 * member's shared recipe opens read-only with a Copy button.
 */
export default function RecipeEditor({ id, userId, brewerName }: { id: string; userId: string; brewerName: string }) {
  const router = useRouter();
  const { toast, node: toastNode } = useToast();
  const [r, setR] = useState<Recipe | null>(null);
  const [owner, setOwner] = useState(true);
  const [visibility, setVisibility] = useState<"private" | "club">("private");
  const [equip, setEquip] = useState<{ id: string | null; e: Equipment }[]>(DEFAULT_EQUIPMENT.map((e) => ({ id: null, e })));
  const [mine, setMine] = useState<MineItem[]>([]);
  const [tab, setTab] = useState<Tab>("DESIGN");
  const [dirty, setDirty] = useState(false);
  const [scaleTo, setScaleTo] = useState("");
  const saving = useRef(false);

  // load (or make) the recipe, the brewer's equipment and their own ingredients
  useEffect(() => {
    const sb = createClient();
    (async () => {
      const [{ data: eq }, { data: ing }] = await Promise.all([
        sb.from("dp_equipment").select("id, name, data").eq("owner_id", userId).order("name"),
        sb.from("dp_ingredients").select("id, kind, name, data, in_stock").eq("owner_id", userId),
      ]);
      const myEq = (eq || []).map((x) => ({ id: x.id as string, e: { ...(x.data as Equipment), name: x.name as string } }));
      setEquip([...myEq, ...DEFAULT_EQUIPMENT.filter((d) => !myEq.some((m) => m.e.name === d.name)).map((e) => ({ id: null, e }))]);
      setMine((ing || []) as MineItem[]);
      if (id === "new") {
        const fresh = newRecipe(myEq[0]?.e || DEFAULT_EQUIPMENT[0], brewerName);
        const { data: made, error } = await sb.from("dp_recipes").insert({ owner_id: userId, name: fresh.name, data: fresh, calc: calcSummary(calcRecipe(fresh)) }).select("id").single();
        if (made) router.replace(`/draftpunk/r/${made.id}`);
        else toast(error?.message || "COULDN'T START A RECIPE");
        return;
      }
      const { data } = await sb.from("dp_recipes").select("owner_id, name, style_id, visibility, data").eq("id", id).maybeSingle();
      if (!data) { toast("RECIPE NOT FOUND"); return; }
      setOwner(data.owner_id === userId);
      setVisibility(data.visibility as "private" | "club");
      setR(normalize({ ...(data.data as Recipe), name: data.name as string, styleId: (data.style_id as string) || (data.data as Recipe)?.styleId }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const c = useMemo(() => (r ? calcRecipe(r) : null), [r]);
  const style = styleById(r?.styleId);

  const save = useCallback(async (rec: Recipe | null = r, vis = visibility) => {
    if (!rec || !owner || id === "new" || saving.current) return;
    saving.current = true;
    const { error } = await createClient().from("dp_recipes").update({ name: rec.name || "Untitled", style_id: rec.styleId || null, visibility: vis, data: rec, calc: calcSummary(calcRecipe(rec)), updated_at: new Date().toISOString() }).eq("id", id);
    saving.current = false;
    if (error) toast(`NOT SAVED: ${error.message}`); else setDirty(false);
  }, [r, owner, id, visibility, toast]);

  // save a moment after the last change, and on F2
  useEffect(() => { if (!dirty) return; const t = setTimeout(() => save(), 1200); return () => clearTimeout(t); }, [dirty, r, save]);
  useEffect(() => { const on = () => { save().then(() => toast("SAVED")); }; window.addEventListener("dp-save", on); return () => window.removeEventListener("dp-save", on); }, [save, toast]);

  const set = useCallback((fn: (x: Recipe) => Recipe) => { setR((x) => (x ? fn(structuredClone(x)) : x)); if (owner) setDirty(true); }, [owner]);
  const setE = (patch: Partial<Equipment>) => set((x) => ({ ...x, equipment: { ...x.equipment, ...patch } }));

  const copyToMine = async () => {
    if (!r) return;
    const { data } = await createClient().from("dp_recipes").insert({ owner_id: userId, name: `${r.name} (copy)`, style_id: r.styleId || null, data: { ...r, name: `${r.name} (copy)`, brewer: brewerName }, calc: calcSummary(calcRecipe(r)), copied_from: id }).select("id").single();
    if (data) router.push(`/draftpunk/r/${data.id}`);
  };
  const startBrew = async () => {
    if (!r || !c) return;
    await save();
    const { data, error } = await createClient().from("dp_brews").insert({ owner_id: userId, recipe_id: owner ? id : null, recipe_snapshot: r, measured: {}, notes: "" }).select("id").single();
    if (data) router.push(`/draftpunk/brews/${data.id}`); else toast(error?.message || "COULDN'T START THE LOG");
  };
  const exportXml = () => {
    if (!r) return;
    const blob = new Blob([toBeerXml([r])], { type: "application/xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${(r.name || "recipe").replace(/[^\w -]+/g, "")}.xml`; a.click();
  };

  if (!r || !c) return <p>LOADING RECIPE...<span className="dp-blink">█</span>{toastNode}</p>;
  const ro = !owner;
  const stat = (k: string, v: string, n: number, range?: [number, number], min = 0, max = 1) => (
    <div className="dp-stat">
      <b>{k}</b><span className="dp-v">{v}{k === "SRM" && <span className="dp-swatch" style={{ background: c.color }} />}</span>
      <StyleBar v={n} lo={range?.[0]} hi={range?.[1]} min={min} max={max} />
    </div>
  );

  return (
    <>
      <div className="dp-row" style={{ justifyContent: "space-between" }}>
        <h1 className="dp-h1" style={{ margin: 0 }}>{ro ? "VIEW" : "EDIT"}: {r.name.toUpperCase()}</h1>
        <span className="dp-dim">{ro ? "CLUB RECIPE · READ ONLY" : dirty ? "UNSAVED..." : "SAVED"}</span>
      </div>
      {ro && <p><button className="dp-btn dp-go" onClick={copyToMine}>COPY TO MY RECIPES</button> <span className="dp-dim">to brew it or change it</span></p>}

      <Win title="RECIPE">
        <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="dp-row">
            <F label="NAME" grow="2 1 240px"><input value={r.name} onChange={(e) => set((x) => ({ ...x, name: e.target.value }))} /></F>
            <F label="STYLE" grow="2 1 240px">
              <select value={r.styleId || ""} onChange={(e) => set((x) => ({ ...x, styleId: e.target.value || undefined }))}>
                <option value="">(none)</option>
                {STYLE_GROUPS.map((g) => <optgroup key={g.key} label={g.label}>{g.styles.map((s) => <option key={s.id} value={s.id}>{styleLabel(s)}</option>)}</optgroup>)}
              </select>
            </F>
            <F label="TYPE" grow="1 1 140px">
              <select value={r.type} onChange={(e) => set((x) => ({ ...x, type: e.target.value as RecipeType }))}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </F>
          </div>
          <div className="dp-row" style={{ marginTop: 8 }}>
            <F label="EQUIPMENT" grow="2 1 260px">
              <select value={r.equipment.name} onChange={(e) => { const p = equip.find((q) => q.e.name === e.target.value); if (p) set((x) => ({ ...x, equipment: { ...p.e } })); }}>
                {!equip.some((q) => q.e.name === r.equipment.name) && <option>{r.equipment.name}</option>}
                {equip.map((q) => <option key={q.e.name} value={q.e.name}>{q.e.name}{q.id ? "" : " (starter)"}</option>)}
              </select>
            </F>
            <F label="BATCH GAL"><Num value={r.equipment.batchGal} onChange={(n) => setE({ batchGal: n })} /></F>
            <F label="BOIL MIN"><Num value={r.equipment.boilMin} onChange={(n) => setE({ boilMin: n })} /></F>
            <F label="MASH EFF %"><Num value={r.equipment.mashEff} onChange={(n) => setE({ mashEff: n })} /></F>
            <F label="BOIL-OFF GAL/HR"><Num value={r.equipment.boilOffGal} onChange={(n) => setE({ boilOffGal: n })} /></F>
            <F label="IBU FORMULA">
              <select value={r.ibuMethod} onChange={(e) => set((x) => ({ ...x, ibuMethod: e.target.value as IbuMethod }))}>
                <option value="tinseth">Tinseth</option><option value="rager">Rager</option><option value="garetz">Garetz</option>
              </select>
            </F>
          </div>
        </fieldset>
        {!ro && (
          <div className="dp-row" style={{ marginTop: 8 }}>
            <F label="SCALE TO" grow="1 1 260px">
              <select value={scaleTo} onChange={(e) => setScaleTo(e.target.value)}>
                <option value="">(pick equipment; set its batch size on the Equipment screen)</option>
                {equip.map((q) => <option key={q.e.name} value={q.e.name}>{q.e.name} · {q.e.batchGal} gal</option>)}
              </select>
            </F>
            <button className="dp-btn" disabled={!scaleTo} onClick={() => { const p = equip.find((q) => q.e.name === scaleTo); if (p) { set((x) => scaleRecipe(x, p.e)); setScaleTo(""); toast("SCALED"); } }}>SCALE</button>
          </div>
        )}
      </Win>

      <Win title={style ? `NUMBERS vs ${style.name.toUpperCase()}` : "NUMBERS"}>
        <div className="dp-stats">
          {stat("OG", sgFmt(c.og), c.og, style?.og, 1.0, 1.13)}
          {stat("FG", sgFmt(c.fg), c.fg, style?.fg, 0.99, 1.04)}
          {stat("ABV", `${r1(c.abv, 1)}%`, c.abv, style?.abv, 0, 14)}
          {stat("IBU", `${r1(c.ibu, 0)}`, c.ibu, style?.ibu, 0, 120)}
          {stat("SRM", `${r1(c.srm, 1)}`, c.srm, style?.srm, 0, 40)}
          {stat("BU:GU", `${r1(c.buGu, 2)}`, c.buGu, undefined, 0, 2)}
        </div>
        <div className="dp-row dp-dim" style={{ marginTop: 6, fontSize: 18 }}>
          <span>PRE-BOIL {r1(c.preBoilGal, 2)} GAL @ {sgFmt(c.preBoilGravity)}</span>
          <span>INTO FERMENTER {r1(c.intoFermGal, 2)} GAL</span>
          <span>BOIL-OFF {r1(c.boilOffGal, 2)} GAL/HR{r.weather ? ` (${r.weather.tempF}°F ${r.weather.rh}%)` : ""}</span>
          <span>MASH pH {c.mashPh ? r1(c.mashPh, 2) : "-"}</span>
          <span>BREWHOUSE EFF {r1(c.brewhouseEff, 0)}% (RESULT)</span>
          <span>{r1(c.calories, 0)} CAL/12oz</span>
        </div>
        {c.notes.map((n) => <div key={n} className="dp-note">{n}</div>)}
      </Win>

      <div className="dp-tabs" role="tablist">
        {TABS.map((t) => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      <fieldset disabled={ro && tab !== "BREW DAY"} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {tab === "DESIGN" && <DesignTab r={r} c={c} set={set} mine={mine} />}
        {tab === "MASH" && <MashTab r={r} c={c} set={set} />}
        {tab === "WATER" && <WaterTab r={r} c={c} set={set} />}
        {tab === "FERMENT" && <FermentTab r={r} c={c} set={set} />}
        {tab === "BREW DAY" && <BrewDay r={r} onStartLog={startBrew} onWeather={(w) => set((x) => ({ ...x, weather: w }))} />}
        {tab === "NOTES" && <NotesTab r={r} set={set} visibility={visibility} onVisibility={(v) => { setVisibility(v); save(r, v).then(() => toast(v === "club" ? "SHARED WITH THE CLUB" : "PRIVATE")); }} onExport={exportXml} />}
      </fieldset>
      <p className="dp-dim dp-noprint" style={{ marginTop: 18 }}><Link href="/draftpunk">&lt;&lt; BACK TO RECIPES</Link></p>
      {toastNode}
    </>
  );
}
