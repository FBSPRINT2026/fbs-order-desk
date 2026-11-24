"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { atSize, calcRecipe, calcSummary, fromPercents, r1, scaleRecipe, sgFmt } from "@/lib/draftpunk/calc";
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
import Assistant from "./Assistant";
import Versions, { type Status } from "./Versions";
import BringIn from "./BringIn";
import Overview, { type PlannedBrew } from "./Overview";
import BrewIt from "./BrewIt";
import { applyProposal, type Proposal } from "@/lib/draftpunk/proposal";
import { saveVersion, versionsOf } from "@/lib/draftpunk/recipeStore";
import { diffRecipes, recipeChanges } from "@/lib/draftpunk/versions";
import { bitternessAdvice, gravityAdvice, styleTarget, type Point } from "@/lib/draftpunk/targets";
import { entryScore, type Sheet } from "@/lib/draftpunk/judging";

const TABS = ["Overview", "Ingredients", "Mash", "Water", "Fermentation", "Brew day", "Versions", "Notes"] as const;
type Tab = (typeof TABS)[number];
const TYPES: [RecipeType, string][] = [["all_grain", "All Grain"], ["biab", "Biab"], ["partial_mash", "Partial Mash"], ["extract", "Extract"], ["mead", "Mead"], ["cider", "Cider"], ["wine", "Wine"]];

/**
 * The recipe builder: equipment, ingredients, mash, water, fermentation and the brew day sheet, with every number
 * worked out as you type and checked against the style. Saves itself a moment after each change (and on F2). A club
 * member's shared recipe opens read-only with a Copy button.
 */
export default function RecipeEditor({ id, userId, brewerName, archive = false }: { id: string; userId: string; brewerName: string; archive?: boolean }) {
  // archive: a recipe as it was in BeerSmith (dp_archive), read only, brought into DraftPunk from the toolbar
  const [arch, setArch] = useState<{ folder: string; brewed_on: string | null; brought_to: string | null } | null>(null);
  const [bringOpen, setBringOpen] = useState(false);
  const router = useRouter();
  const { toast, node: toastNode } = useToast();
  const [r, setR] = useState<Recipe | null>(null);
  const [owner, setOwner] = useState(true);
  const [visibility, setVisibility] = useState<"private" | "club">("private");
  const [equip, setEquip] = useState<{ id: string | null; e: Equipment }[]>(DEFAULT_EQUIPMENT.map((e) => ({ id: null, e })));
  const [mine, setMine] = useState<MineItem[]>([]);
  const [tab, setTab] = useState<Tab>("Overview");
  // Brew it (the planner) and this recipe's planned brews
  const [brewAt, setBrewAt] = useState<number | null>(null);
  const [brewWhen, setBrewWhen] = useState<string | undefined>(undefined);
  // a recipe is locked once it has a version (Nick, Nov 24 2026: "you enter the ingredients and then you lock it… make
  // it as is or make changes… we're gonna save this as version two, and here's the changes"): Make changes opens it,
  // and saving the changes makes the next version
  const [lastVer, setLastVer] = useState<{ id: string; num: number; data: Recipe } | null | undefined>(undefined);
  const [editMode, setEditMode] = useState(false);
  const [verNote, setVerNote] = useState("");
  // Brew it's "Make changes first": the plan waits until the new version is saved
  const [planAfter, setPlanAfter] = useState<{ when: string; gal: number } | null>(null);
  const [planned, setPlanned] = useState<PlannedBrew[]>([]);
  const [dirty, setDirty] = useState(false);
  const [scaleTo, setScaleTo] = useState("");
  const [scaleOpen, setScaleOpen] = useState(false);
  const saving = useRef(false);
  const [status, setStatus] = useState<Status>("developing");
  const [goal, setGoal] = useState<"house" | "competition">("house");
  const [asstOpen, setAsstOpen] = useState(false);
  const [verKey, setVerKey] = useState(0);
  const [points, setPoints] = useState<Point[]>([]);

  // load (or make) the recipe, the brewer's equipment and their own ingredients
  useEffect(() => {
    const sb = createClient();
    (async () => {
      const [{ data: eq }, { data: ing }] = await Promise.all([
        sb.from("dp_equipment").select("id, name, data").eq("owner_id", userId).order("name"),
        sb.from("dp_ingredients").select("id, kind, name, data, in_stock").eq("owner_id", userId),
      ]);
      const myEq = (eq || []).map((x) => ({ id: x.id as string, e: { ...(x.data as Equipment), name: x.name as string } }));
      // the brewer's own systems; the starter profiles only until they have one of their own
      setEquip(myEq.length ? myEq : DEFAULT_EQUIPMENT.map((e) => ({ id: null, e })));
      setMine((ing || []) as MineItem[]);
      if (id === "new") {
        const fresh = newRecipe(myEq[0]?.e || DEFAULT_EQUIPMENT[0], brewerName);
        const { data: made, error } = await sb.from("dp_recipes").insert({ owner_id: userId, name: fresh.name, data: fresh, calc: calcSummary(calcRecipe(fresh)) }).select("id").single();
        if (made) router.replace(`/draftpunk/r/${made.id}`);
        else toast(error?.message || "Couldn't start a recipe");
        return;
      }
      if (archive) {
        const { data: a } = await sb.from("dp_archive").select("name, folder, brewed_on, brought_to, data").eq("id", id).maybeSingle();
        if (!a) { toast("Recipe not found"); return; }
        setOwner(false);
        setArch({ folder: a.folder as string, brewed_on: a.brewed_on as string | null, brought_to: a.brought_to as string | null });
        const ar = a.data as Recipe;
        setR(normalize({ ...ar, name: a.name as string, imported: ar.imported || ar.equipment }));
        return;
      }
      const { data } = await sb.from("dp_recipes").select("owner_id, name, style_id, visibility, data, status, goal").eq("id", id).maybeSingle();
      if (!data) { toast("Recipe not found"); return; }
      setOwner(data.owner_id === userId);
      setVisibility(data.visibility as "private" | "club");
      setStatus((data.status as Status) || "developing");
      setGoal((data.goal as "house" | "competition") || "house");
      setR(normalize({ ...(data.data as Recipe), name: data.name as string, styleId: (data.style_id as string) || (data.data as Recipe)?.styleId }));
      const { data: pl } = await sb.from("dp_brews").select("id, brewed_on, plan").eq("recipe_id", id).eq("status", "planned").order("brewed_on");
      setPlanned((pl || []) as PlannedBrew[]);
      if (data.owner_id === userId) {
        const vs = await versionsOf(id), lv = vs[vs.length - 1];
        setLastVer(lv ? { id: lv.id, num: lv.num, data: normalize(lv.data) } : null);
        // a new recipe opens on its ingredients
        if (!lv) setTab("Ingredients");
      }
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

  // how this style's beers have done (entries anyone in the club scored, recipes marked dialed in): the targets learn from them
  useEffect(() => {
    if (!style) { setPoints([]); return; }
    const sb = createClient();
    (async () => {
      const [{ data: ents }, { data: dialed }] = await Promise.all([
        sb.from("dp_entries").select("recipe_id, version_id, scores, place").eq("style_id", style.id).limit(200),
        sb.from("dp_recipes").select("id, calc").eq("style_id", style.id).eq("status", "dialed").limit(50),
      ]);
      const vids = (ents || []).map((e) => e.version_id).filter(Boolean) as string[], rids = (ents || []).map((e) => e.recipe_id).filter(Boolean) as string[];
      const [{ data: vs }, { data: rs }] = await Promise.all([
        vids.length ? sb.from("dp_recipe_versions").select("id, calc").in("id", vids) : Promise.resolve({ data: [] as { id: string; calc: unknown }[] }),
        rids.length ? sb.from("dp_recipes").select("id, calc").in("id", rids) : Promise.resolve({ data: [] as { id: string; calc: unknown }[] }),
      ]);
      const cv = new Map((vs || []).map((v) => [v.id as string, v.calc as { buGu?: number; og?: number }])), cr = new Map((rs || []).map((v) => [v.id as string, v.calc as { buGu?: number; og?: number }]));
      const pts: Point[] = [];
      for (const e of ents || []) { const k = (e.version_id && cv.get(e.version_id as string)) || (e.recipe_id && cr.get(e.recipe_id as string)); if (k?.buGu) pts.push({ buGu: Number(k.buGu), og: Number(k.og), score: entryScore((e.scores || []) as Sheet[]), medal: !!e.place && e.place !== "hm" }); }
      for (const d of dialed || []) { const k = d.calc as { buGu?: number; og?: number }; if (k?.buGu && d.id !== id) pts.push({ buGu: Number(k.buGu), og: Number(k.og), dialed: true }); }
      setPoints(pts);
    })();
  }, [style, id]);
  const target = useMemo(() => (style ? styleTarget(style, goal, points) : null), [style, goal, points]);

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

  // a recipe designed by grain percentages gets its pounds worked out again after every change (equipment, efficiency…)
  const set = useCallback((fn: (x: Recipe) => Recipe) => { setR((x) => (x ? fromPercents(fn(structuredClone(x))) : x)); if (owner) setDirty(true); }, [owner]);
  const setE = (patch: Partial<Equipment>) => set((x) => ({ ...x, equipment: { ...x.equipment, ...patch } }));

  const copyToMine = async () => {
    if (!r) return;
    const { data } = await createClient().from("dp_recipes").insert({ owner_id: userId, name: `${r.name} (copy)`, style_id: r.styleId || null, data: { ...r, name: `${r.name} (copy)`, brewer: brewerName }, calc: calcSummary(calcRecipe(r)), copied_from: id }).select("id").single();
    if (data) router.push(`/draftpunk/r/${data.id}`);
  };
  // every way to start a brew opens the Brew it planner (components/draftpunk/BrewIt.tsx)
  const startBrew = (gal?: number) => { if (!r) return; save(); setTab("Overview"); setBrewAt(gal ?? r.equipment.batchGal); };
  const setMeta = async (patch: { status?: Status; goal?: "house" | "competition" }) => {
    if (patch.status) setStatus(patch.status);
    if (patch.goal) setGoal(patch.goal);
    const { error } = await createClient().from("dp_recipes").update(patch).eq("id", id);
    if (error) toast(error.message);
  };
  const applyP = (p: Proposal) => { setEditMode(true); set((x) => applyProposal(x, p)); setAsstOpen(false); setTab("Versions"); toast("On the working copy: see the changes under Versions"); };
  const restore = (data: Recipe, num: number) => { const back = normalize(data); setR(back); setDirty(true); toast(`Working copy is v${num} again`); };
  const exportXml = () => {
    if (!r) return;
    const blob = new Blob([toBeerXml([r])], { type: "application/xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${(r.name || "recipe").replace(/[^\w -]+/g, "")}.xml`; a.click();
  };

  // what's changed since the last version, the same beer at another size not counted (size is picked when it's viewed
  // or brewed): the version at this size against the working copy
  const pending = r && lastVer ? recipeChanges(diffRecipes(lastVer.data.equipment.name === r.equipment.name && Math.abs(lastVer.data.equipment.batchGal - r.equipment.batchGal) < 0.05 ? lastVer.data : scaleRecipe(lastVer.data, r.equipment), r)) : [];
  const editing = owner && !archive && lastVer !== undefined && (lastVer === null || editMode || pending.length > 0);
  const locked = owner && !archive && !!lastVer && !editing;
  const lockIn = async () => {
    if (!r) return;
    await save();
    const res = await saveVersion(id, userId, r, verNote.trim() || (lastVer ? "" : "First version"));
    if (!res.version) { toast(res.error || "Not saved"); return; }
    setLastVer({ id: res.version.id, num: res.version.num, data: normalize(res.version.data) });
    setEditMode(false); setVerNote(""); setVerKey((k) => k + 1); setTab("Overview");
    toast(lastVer ? `Saved as v${res.version.num}` : `Locked in as v${res.version.num}`);
    if (planAfter) { setBrewWhen(planAfter.when); setBrewAt(planAfter.gal); setPlanAfter(null); }
  };
  const discard = () => { if (!lastVer) return; setR(lastVer.data); setDirty(true); setEditMode(false); setPlanAfter(null); toast(`Back to v${lastVer.num}`); };
  if (!r || !c) return <p className="dp-dim">Loading recipe…{toastNode}</p>;
  const ro = !owner || locked;
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
        {archive ? (
          <button className={`dp-tool dp-tool-go${bringOpen ? " on" : ""}`} onClick={() => setBringOpen((v) => !v)}><Icon name="import" />Bring into DraftPunk</button>
        ) : !owner ? (
          <button className="dp-tool dp-tool-go" onClick={copyToMine}><Icon name="copy" />Copy to mine</button>
        ) : (
          <button className="dp-tool" onClick={() => save().then(() => toast("Saved"))}><Icon name="save" />Save</button>
        )}
        <button className="dp-tool" onClick={() => setTab("Brew day")}><Icon name="brewday" />Brew day</button>
        <button className={`dp-tool${asstOpen ? " on" : ""}`} onClick={() => setAsstOpen((v) => !v)}><Icon name="spark" />Assistant</button>
        {owner && !archive && <button className={`dp-tool dp-tool-go${brewAt != null ? " on" : ""}`} disabled={editing} title={editing ? "Save the changes as a version first" : undefined} onClick={() => startBrew()}><Icon name="brews" />Brew it</button>}
        {locked && <button className="dp-tool" onClick={() => { setEditMode(true); setTab("Ingredients"); }}><Icon name="scale" />Make changes</button>}
        {!ro && <button className="dp-tool" onClick={() => setScaleOpen((v) => !v)}><Icon name="scale" />Scale</button>}
        <span className="dp-sep" />
        <button className="dp-tool" onClick={() => window.print()}><Icon name="print" />Print</button>
        <button className="dp-tool" onClick={exportXml}><Icon name="export" />BeerXML</button>
        {owner && <button className="dp-tool" onClick={copyToMine}><Icon name="copy" />Duplicate</button>}
        {owner && <button className="dp-tool" onClick={() => { const v = visibility === "club" ? "private" : "club"; setVisibility(v); save(r, v).then(() => toast(v === "club" ? "Shared with the club" : "Private again")); }}><Icon name="share" />{visibility === "club" ? "Shared" : "Share"}</button>}
        <span className="dp-status">{archive ? `From BeerSmith · ${arch?.folder || ""}${arch?.brought_to ? " · in DraftPunk" : ""}` : locked ? `v${lastVer!.num} · locked` : !owner ? "Club recipe · read only" : dirty ? "Saving…" : "All changes saved"}</span>
      </div>

      <div className="dp-recipe">
        <div>
          <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <input className="dp-title" aria-label="Recipe name" value={r.name} onChange={(e) => set((x) => ({ ...x, name: e.target.value }))} />
            <div className="dp-row" style={{ margin: "6px 0 18px", gap: 8 }}>
              <span className="dp-chip dp-beer">{style ? styleLabel(style) : "No style"}</span>
              <span className="dp-chip">{TYPES.find(([v]) => v === r.type)?.[1]}</span>
              {(() => {
                // "Brew it at": the recipe is its percents and targets; each size works out the pounds and ounces
                const sys = equip.find((q) => q.e.name === r.equipment.name && q.e.sizes?.length) || equip.find((q) => q.e.sizes?.length);
                // locked, the size is picked when it's viewed (Overview) or brewed (Brew it), never changed on the recipe
                if (!sys?.e.sizes || locked) return <span className="dp-chip">{sys?.e.sizes?.find((s) => Math.abs(s.batchGal - r.equipment.batchGal) < 0.05)?.label || `${r1(r.equipment.batchGal, 2)} gal`}</span>;
                const onSys = r.equipment.name === sys.e.name;
                return (
                  <span className="dp-seg dp-noprint" role="group" aria-label="Brew it at">
                    {sys.e.sizes.map((s) => {
                      const on = onSys && Math.abs(r.equipment.batchGal - s.batchGal) < 0.05;
                      return <button key={s.label} type="button" disabled={ro} className={on ? "on" : ""} title={`Brew it at ${s.label} on ${sys.e.name}`} onClick={() => !on && set((x) => ({ ...scaleRecipe(x, atSize(sys.e, s.batchGal)), imported: x.imported || (equip.some((q) => q.e.name === x.equipment.name) ? undefined : x.equipment) }))}>Brew it at {s.label}</button>;
                    })}
                  </span>
                );
              })()}
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
                  <EquipPick r={r} equip={equip} onPick={(to) => set((x) => ({ ...scaleRecipe(x, to), imported: x.imported || (equip.some((q) => q.e.name === x.equipment.name) ? undefined : x.equipment) }))} />
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

          {archive && bringOpen && arch && <BringIn archiveId={id} r={r} folder={arch.folder} date={arch.brewed_on} userId={userId} onDone={() => setBringOpen(false)} />}
          {archive && arch?.brought_to && !bringOpen && <p className="dp-note">Already in DraftPunk: <Link href={`/draftpunk/r/${arch.brought_to}`}>open it</Link>. Bring it in again to add it as another version.</p>}
          {asstOpen && (
            <Win title="Brewing assistant" note="knows the style, what wins and how your beers scored">
              <Assistant recipe={r} goal={goal} onApply={!owner || archive ? undefined : applyP} />
            </Win>
          )}
          {editing && (
            <div className="dp-edit">
              {lastVer ? <>
                <div><b>Making changes to v{lastVer.num}</b>{planAfter ? <span className="dp-dim"> · then plan the brew</span> : null}</div>
                {pending.length ? <ul className="dp-list">{pending.map((l) => <li key={l}>{l}</li>)}</ul> : <p className="dp-dim" style={{ margin: "4px 0" }}>Change the ingredients, mash, water or fermentation below.</p>}
                <div className="dp-row" style={{ gap: 8 }}>
                  <input value={verNote} onChange={(e) => setVerNote(e.target.value)} placeholder="Why (optional): more oats for body" aria-label="Why this version" style={{ flex: "1 1 220px" }} />
                  <button className="dp-btn dp-go" disabled={!pending.length} onClick={lockIn}>Save as v{lastVer.num + 1}</button>
                  <button className="dp-btn" onClick={pending.length ? discard : () => { setEditMode(false); setPlanAfter(null); }}>{pending.length ? "Discard changes" : "Done"}</button>
                </div>
              </> : <>
                <div><b>New recipe</b><span className="dp-dim"> · add the ingredients, then lock it in</span></div>
                <div className="dp-row" style={{ gap: 8, marginTop: 6 }}><button className="dp-btn dp-go" onClick={lockIn}>Lock it in as v1</button></div>
              </>}
            </div>
          )}
          <div className="dp-tabs" role="tablist">
            {TABS.filter((t) => !(archive && t === "Versions")).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}
          </div>
          <fieldset disabled={(!owner && tab !== "Brew day" && tab !== "Overview") || (locked && !["Brew day", "Overview", "Versions", "Notes"].includes(tab))} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            {tab === "Overview" && brewAt != null && owner && <BrewIt recipeId={id} userId={userId} r={r} equip={equip} shelf={mine} gal0={brewAt} when0={brewWhen} onClose={() => { setBrewAt(null); setBrewWhen(undefined); }}
              onChangeFirst={(when, gal) => { setPlanAfter({ when, gal }); setBrewAt(null); setEditMode(true); setTab("Ingredients"); }} />}
            {tab === "Overview" && <Overview r={r} equip={equip} planned={planned} canBrew={owner && !archive && brewAt == null && !editing} onBrew={(g) => startBrew(g)} />}
            {tab === "Ingredients" && <DesignTab r={r} c={c} set={set} mine={mine} />}
            {tab === "Mash" && <MashTab r={r} c={c} set={set} />}
            {tab === "Water" && <WaterTab r={r} c={c} set={set} />}
            {tab === "Fermentation" && <FermentTab r={r} c={c} set={set} />}
            {tab === "Brew day" && <BrewDay r={r} storeKey={id} set={ro ? undefined : set} mine={mine} onStartLog={() => startBrew()} onWeather={(w) => set((x) => ({ ...x, weather: w }))} />}
            {tab === "Versions" && <Versions recipeId={id} userId={userId} r={r} owner={owner} status={status} goal={goal} refreshKey={verKey} onStatus={(s) => setMeta({ status: s })} onGoal={(g) => setMeta({ goal: g })} onRestore={restore} onApply={applyP} />}
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
              {kpi("Original gravity", sgFmt(c.og), c.og, target?.og || style?.og, 1.0, 1.13, sg)}
              {kpi("Final gravity", sgFmt(c.fg), c.fg, style?.fg, 0.99, 1.04, sg)}
              {kpi("Alcohol", `${r1(c.abv, 1)}%`, c.abv, style?.abv, 0, 14, (x) => `${x}%`)}
              {kpi("Bitterness", `${r1(c.ibu, 0)} IBU`, c.ibu, style?.ibu, 0, 120)}
              {kpi("Color", `${r1(c.srm, 1)} SRM`, c.srm, style?.srm, 0, 40)}
              {kpi("BU:GU", `${r1(c.buGu, 2)}`, c.buGu, target ? [r1(target.band[0], 2), r1(target.band[1], 2)] : undefined, 0, 1.6, (x) => x.toFixed(2))}
            </div>
            {target && (
              <div className="dp-target">
                <div><b>{goal === "competition" ? "Competition" : "House"} target</b> · BU:GU {r1(target.buGu, 2)} · OG {target.og[0].toFixed(3)}–{target.og[1].toFixed(3)}</div>
                <div>{bitternessAdvice(c.og, c.ibu, target)}. {gravityAdvice(c.og, target, goal)}.</div>
                <div className="dp-dim">{target.from === "learned" ? `Learned from ${target.n} scored or dialed-in beer${target.n === 1 ? "" : "s"} in this style` : "From the style's middle; it learns as your beers score"}</div>
              </div>
            )}
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
      <p className="dp-dim dp-noprint" style={{ marginTop: 18 }}><Link href={archive ? "/draftpunk?tab=beersmith" : "/draftpunk"}>← {archive ? "From BeerSmith" : "All recipes"}</Link></p>
      {toastNode}
    </>
  );
}

/**
 * Which system it's brewed on (Nick, Nov 24 2026): the equipment it came with ("As imported"), then each of the
 * brewer's own systems at each of its batch sizes (BrewBuilt RIMS · 3, 5, 10 gal). Picking one scales the recipe to it
 * (grain for the volume and efficiency, hops to keep the IBU), so it stays the same beer.
 */
function EquipPick({ r, equip, onPick }: { r: Recipe; equip: { id: string | null; e: Equipment }[]; onPick: (e: Equipment) => void }) {
  const same = (a: Equipment, b: Equipment) => a.name === b.name && Math.abs(a.batchGal - b.batchGal) < 0.05;
  const opts: { key: string; label: string; e: Equipment; group?: string }[] = [];
  if (r.imported) opts.push({ key: "imp", label: `As imported · ${r.imported.name} · ${r1(r.imported.batchGal, 2)} gal`, e: r.imported });
  for (const [i, q] of equip.entries()) {
    if (q.e.sizes?.length) for (const [j, s] of q.e.sizes.entries()) opts.push({ key: `${i}:${j}`, label: s.label, e: atSize(q.e, s.batchGal), group: q.e.name });
    else opts.push({ key: `${i}`, label: `${q.e.name} · ${r1(q.e.batchGal, 2)} gal`, e: q.e });
  }
  const cur = opts.find((o) => same(o.e, r.equipment));
  const groups = [...new Set(opts.filter((o) => o.group).map((o) => o.group!))];
  return (
    <select value={cur?.key || "cur"} onChange={(ev) => { const o = opts.find((x) => x.key === ev.target.value); if (o && !same(o.e, r.equipment)) onPick(o.e); }}>
      {!cur && <option value="cur">{equip.some((q) => q.e.name === r.equipment.name) ? "" : "As imported · "}{r.equipment.name} · {r1(r.equipment.batchGal, 2)} gal</option>}
      {opts.filter((o) => !o.group).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      {groups.map((g) => <optgroup key={g} label={g}>{opts.filter((o) => o.group === g).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</optgroup>)}
    </select>
  );
}
