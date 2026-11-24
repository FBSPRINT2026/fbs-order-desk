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
import Icon from "./icons";
import { DesignTab, FermentTab, MashTab, MineItem, NotesTab, WaterTab } from "./RecipeTabs";
import BrewDay from "./BrewDay";

const TABS = ["Ingredients", "Mash", "Water", "Fermentation", "Brew day", "Notes"] as const;
type Tab = (typeof TABS)[number];
const TYPES: [RecipeType, string][] = [["all_grain", "All Grain"], ["biab", "Biab"], ["partial_mash", "Partial Mash"], ["extract", "Extract"], ["mead", "Mead"], ["cider", "Cider"], ["wine", "Wine"]];

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
  const [tab, setTab] = useState<Tab>("Ingredients");
  const [dirty, setDirty] = useState(false);
  const [scaleTo, setScaleTo] = useState("");
  const [scaleOpen, setScaleOpen] = useState(false);
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
        else toast(error?.message || "Couldn't start a recipe");
        return;
      }
      const { data } = await sb.from("dp_recipes").select("owner_id, name, style_id, visibility, data").eq("id", id).maybeSingle();
      if (!data) { toast("Recipe not found"); return; }
      setOwner(data.owner_id === userId);
      setVisibility(data.visibility as "private" | "club");
      setR(normalize({ ...(data.data as Recipe), name: data.name as string, styleId: (data.style_id as string) || (data.data as Recipe)?.styleId }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const c = useMemo(() => (r ? calcRecipe(r) : null), [r]);
  // the page takes on the beer's color (its SRM): the glow behind everything and the pint in the numbers card
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(".dp-app");
    if (el && c) el.style.setProperty("--dp-beer", c.color);
    return () => { el?.style.removeProperty("--dp-beer"); };
  }, [c]);
  const style = styleById(r?.styleId);

  const save = useCallback(async (rec: Recipe | null = r, vis = visibility) => {
    if (!rec || !owner || id === "new" || saving.current) return;
    saving.current = true;
    const { error } = await createClient().from("dp_recipes").update({ name: rec.name || "Untitled", style_id: rec.styleId || null, visibility: vis, data: rec, calc: calcSummary(calcRecipe(rec)), updated_at: new Date().toISOString() }).eq("id", id);
    saving.current = false;
    if (error) toast(`Not saved: ${error.message}`); else setDirty(false);
  }, [r, owner, id, visibility, toast]);

  // save a moment after the last change, and on F2
  useEffect(() => { if (!dirty) return; const t = setTimeout(() => save(), 1200); return () => clearTimeout(t); }, [dirty, r, save]);
  useEffect(() => { const on = () => { save().then(() => toast("Saved")); }; window.addEventListener("dp-save", on); return () => window.removeEventListener("dp-save", on); }, [save, toast]);

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
    if (data) router.push(`/draftpunk/brews/${data.id}`); else toast(error?.message || "Couldn't start the log");
  };
  const exportXml = () => {
    if (!r) return;
    const blob = new Blob([toBeerXml([r])], { type: "application/xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${(r.name || "recipe").replace(/[^\w -]+/g, "")}.xml`; a.click();
  };

  if (!r || !c) return <p className="dp-dim">Loading recipe…{toastNode}</p>;
  const ro = !owner;
  // one line of the style guide panel: the number, where it sits in the style's range, and the range
  const kpi = (k: string, v: string, n: number, range?: [number, number], min = 0, max = 1, fmt = (x: number) => String(x)) => (
    <div className="dp-kpi">
      <b>{k}</b><span className="dp-v">{v}{k === "Color" && <span className="dp-swatch" style={{ background: c.color }} />}</span>
      <StyleBar v={n} lo={range?.[0]} hi={range?.[1]} min={min} max={max} />
      {range && <span className="dp-range"><span>{fmt(range[0])}</span><span>{fmt(range[1])}</span></span>}
    </div>
  );
  const sg = (x: number) => x.toFixed(3);

  return (
    <>
      {/* the toolbar, like BeerSmith's ribbon */}
      <div className="dp-toolbar dp-noprint" role="toolbar" aria-label="Recipe">
        {ro ? (
          <button className="dp-tool dp-tool-go" onClick={copyToMine}><Icon name="copy" />Copy to mine</button>
        ) : (
          <button className="dp-tool" onClick={() => save().then(() => toast("Saved"))}><Icon name="save" />Save</button>
        )}
        <button className="dp-tool" onClick={() => setTab("Brew day")}><Icon name="brewday" />Brew day</button>
        <button className="dp-tool" onClick={startBrew}><Icon name="brews" />Start log</button>
        {!ro && <button className="dp-tool" onClick={() => setScaleOpen((v) => !v)}><Icon name="scale" />Scale</button>}
        <span className="dp-sep" />
        <button className="dp-tool" onClick={() => window.print()}><Icon name="print" />Print</button>
        <button className="dp-tool" onClick={exportXml}><Icon name="export" />BeerXML</button>
        {!ro && <button className="dp-tool" onClick={copyToMine}><Icon name="copy" />Duplicate</button>}
        {!ro && <button className="dp-tool" onClick={() => { const v = visibility === "club" ? "private" : "club"; setVisibility(v); save(r, v).then(() => toast(v === "club" ? "Shared with the club" : "Private again")); }}><Icon name="share" />{visibility === "club" ? "Shared" : "Share"}</button>}
        <span className="dp-status">{ro ? "Club recipe · read only" : dirty ? "Saving…" : "All changes saved"}</span>
      </div>

      <div className="dp-recipe">
        <div>
          <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <input className="dp-title" aria-label="Recipe name" value={r.name} onChange={(e) => set((x) => ({ ...x, name: e.target.value }))} />
            <div className="dp-row" style={{ margin: "6px 0 18px", gap: 8 }}>
              <span className="dp-chip dp-beer">{style ? styleLabel(style) : "No style"}</span>
              <span className="dp-chip">{TYPES.find(([v]) => v === r.type)?.[1]}</span>
              <span className="dp-chip">{r1(r.equipment.batchGal, 2)} gal</span>
              <span className="dp-chip">{r.equipment.name}</span>
            </div>
            {scaleOpen && !ro && (
              <Win title="Scale this recipe">
                <div className="dp-row">
                  <F label="To equipment" grow="1 1 260px">
                    <select value={scaleTo} onChange={(e) => setScaleTo(e.target.value)}>
                      <option value="">Pick equipment (set its batch size on the Equipment page)</option>
                      {equip.map((q) => <option key={q.e.name} value={q.e.name}>{q.e.name} · {q.e.batchGal} gal</option>)}
                    </select>
                  </F>
                  <button className="dp-btn dp-go" disabled={!scaleTo} onClick={() => { const p = equip.find((q) => q.e.name === scaleTo); if (p) { set((x) => scaleRecipe(x, p.e)); setScaleTo(""); setScaleOpen(false); toast("Scaled"); } }}>Scale</button>
                </div>
                <p className="dp-dim" style={{ marginBottom: 0 }}>Grain scales by volume and mash efficiency, hops to keep the same IBU.</p>
              </Win>
            )}
            <Win title="Recipe setup">
              <div className="dp-row">
                <F label="Style" grow="2 1 260px">
                  <select value={r.styleId || ""} onChange={(e) => set((x) => ({ ...x, styleId: e.target.value || undefined }))}>
                    <option value="">(none)</option>
                    {STYLE_GROUPS.map((g) => <optgroup key={g.key} label={g.label}>{g.styles.map((s) => <option key={s.id} value={s.id}>{styleLabel(s)}</option>)}</optgroup>)}
                  </select>
                </F>
                <F label="Type" grow="1 1 140px">
                  <select value={r.type} onChange={(e) => set((x) => ({ ...x, type: e.target.value as RecipeType }))}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                </F>
                <F label="Equipment" grow="2 1 260px">
                  <select value={r.equipment.name} onChange={(e) => { const p = equip.find((q) => q.e.name === e.target.value); if (p) set((x) => ({ ...x, equipment: { ...p.e } })); }}>
                    {!equip.some((q) => q.e.name === r.equipment.name) && <option>{r.equipment.name}</option>}
                    {equip.map((q) => <option key={q.e.name} value={q.e.name}>{q.e.name}{q.id ? "" : " (starter)"}</option>)}
                  </select>
                </F>
              </div>
              <div className="dp-row" style={{ marginTop: 10 }}>
                <F label="Batch gal"><Num value={r.equipment.batchGal} onChange={(n) => setE({ batchGal: n })} /></F>
                <F label="Boil min"><Num value={r.equipment.boilMin} onChange={(n) => setE({ boilMin: n })} /></F>
                <F label="Mash eff %"><Num value={r.equipment.mashEff} onChange={(n) => setE({ mashEff: n })} /></F>
                <F label="Boil-off gal/hr"><Num value={r.equipment.boilOffGal} onChange={(n) => setE({ boilOffGal: n })} /></F>
                <F label="IBU formula">
                  <select value={r.ibuMethod} onChange={(e) => set((x) => ({ ...x, ibuMethod: e.target.value as IbuMethod }))}>
                    <option value="tinseth">Tinseth</option><option value="rager">Rager</option><option value="garetz">Garetz</option>
                  </select>
                </F>
              </div>
            </Win>
          </fieldset>

          <div className="dp-tabs" role="tablist">
            {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}
          </div>
          <fieldset disabled={ro && tab !== "Brew day"} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            {tab === "Ingredients" && <DesignTab r={r} c={c} set={set} mine={mine} />}
            {tab === "Mash" && <MashTab r={r} c={c} set={set} />}
            {tab === "Water" && <WaterTab r={r} c={c} set={set} />}
            {tab === "Fermentation" && <FermentTab r={r} c={c} set={set} />}
            {tab === "Brew day" && <BrewDay r={r} storeKey={id} onStartLog={startBrew} onWeather={(w) => set((x) => ({ ...x, weather: w }))} />}
            {tab === "Notes" && <NotesTab r={r} set={set} visibility={visibility} onVisibility={(v) => { setVisibility(v); save(r, v).then(() => toast(v === "club" ? "Shared with the club" : "Private")); }} onExport={exportXml} />}
          </fieldset>
        </div>

        {/* the style guide panel, pinned while you work */}
        <aside className="dp-aside">
          <section className="dp-card dp-glasscard">
            <div className="dp-glass" role="img" aria-label={`Beer color, SRM ${r1(c.srm, 1)}`}><i /></div>
            <div>
              <div className="dp-dim" style={{ fontSize: 12, fontWeight: 600 }}>Est. original gravity</div>
              <div className="dp-big">{sgFmt(c.og)}</div>
              <div className="dp-dim" style={{ marginTop: 4 }}>{r1(c.abv, 1)}% ABV · {r1(c.ibu, 0)} IBU · SRM {r1(c.srm, 1)}</div>
            </div>
          </section>
          <section className="dp-card">
            <h2 className="dp-card-t">Style guide<small>{style ? style.name : "pick a style to compare"}</small></h2>
            <div className="dp-kpis">
              {kpi("Original gravity", sgFmt(c.og), c.og, style?.og, 1.0, 1.13, sg)}
              {kpi("Final gravity", sgFmt(c.fg), c.fg, style?.fg, 0.99, 1.04, sg)}
              {kpi("Alcohol", `${r1(c.abv, 1)}%`, c.abv, style?.abv, 0, 14, (x) => `${x}%`)}
              {kpi("Bitterness", `${r1(c.ibu, 0)} IBU`, c.ibu, style?.ibu, 0, 120)}
              {kpi("Color", `${r1(c.srm, 1)} SRM`, c.srm, style?.srm, 0, 40)}
              {kpi("BU:GU", `${r1(c.buGu, 2)}`, c.buGu, undefined, 0, 2)}
            </div>
          </section>
          <section className="dp-card">
            <h2 className="dp-card-t">Brew numbers</h2>
            <div className="dp-facts">
              <span>Pre-boil</span><span>{r1(c.preBoilGal, 2)} gal @ {sgFmt(c.preBoilGravity)}</span>
              <span>Boil-off{r.weather ? " (weather)" : ""}</span><span>{r1(c.boilOffGal, 2)} gal/hr</span>
              <span>Into fermenter</span><span>{r1(c.intoFermGal, 2)} gal</span>
              <span>Total water</span><span>{r1(c.mashWaterGal + c.spargeWaterGal, 2)} gal</span>
              <span>Mash pH</span><span>{c.mashPh ? r1(c.mashPh, 2).toFixed(2) : "-"}</span>
              <span>Mash efficiency</span><span>{r.equipment.mashEff}%</span>
              <span>Brewhouse eff. (result)</span><span>{r1(c.brewhouseEff, 0)}%</span>
              <span>Calories / 12 oz</span><span>{r1(c.calories, 0)}</span>
            </div>
            {c.notes.map((n) => <div key={n} className="dp-note">{n}</div>)}
          </section>
        </aside>
      </div>
      <p className="dp-dim dp-noprint" style={{ marginTop: 18 }}><Link href="/draftpunk">← All recipes</Link></p>
      {toastNode}
    </>
  );
}
