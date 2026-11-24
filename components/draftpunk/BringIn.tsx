"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { atSize, calcRecipe, fromPercents, isAid, r1, scaleRecipe, toPercents, volumes } from "@/lib/draftpunk/calc";
import type { Equipment } from "@/lib/draftpunk/types";
import { createRecipe, saveVersion } from "@/lib/draftpunk/recipeStore";
import type { Recipe } from "@/lib/draftpunk/types";
import { groupKey } from "@/lib/draftpunk/versions";
import { F, Win } from "./ui";

/**
 * A BeerSmith recipe into DraftPunk (Nick, Nov 24 2026: "bring in each recipe into the new system… Witstanbul… the real
 * version made for my three different brew systems, 3, 5 and 10 gallon"): as a new recipe, or as the next version of
 * one already here. The version keeps its own equipment and batch, so each brew system's real version sits in the
 * recipe and brewing on that system uses it. The BeerSmith copy remembers where it went.
 */
export default function BringIn({ archiveId, r, folder, date, userId, onDone }: { archiveId: string; r: Recipe; folder: string; date?: string | null; userId: string; onDone: () => void }) {
  const router = useRouter();
  const [mine, setMine] = useState<{ id: string; name: string }[]>([]);
  const [how, setHow] = useState<"new" | "version">("new");
  const [name, setName] = useState(r.name);
  const [into, setInto] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // the brewer's system with its sizes (BrewBuilt RIMS · 3.5, 5, 10 gal)
  const [sys, setSys] = useState<Equipment | null>(null);
  useEffect(() => { createClient().from("dp_equipment").select("name, data").eq("owner_id", userId).order("name").then(({ data }) => { const e = (data || []).map((x) => ({ ...(x.data as Equipment), name: x.name as string })); setSys(e.find((x) => x.sizes?.length) || e[0] || null); }); }, [userId]);
  /**
   * The recipe as it's designed (Nick, Nov 24 2026: "just look at the percentages, ignore rice hulls… I'm adding this
   * hop to get this IBU"): the grist by percent with BeerSmith's OG as the target, rice hulls by weight beside it, hops
   * as they were (scaling keeps each one's IBU), brewed at the size of the brewer's system nearest the one it was made at.
   */
  const design = (() => {
    const og = Math.round(calcRecipe(r).og * 1000) / 1000;
    const d = { ...toPercents(r), byPercent: { on: true, targetOg: og }, imported: r.imported || r.equipment };
    if (!sys) return d;
    // the size whose wort at the end of the boil is nearest this recipe's (BeerSmith's 7 gal with no trub is the 5 gal)
    const wort = (e: Equipment) => volumes(e).postBoilCold, want = wort(r.equipment);
    const size = sys.sizes?.length ? sys.sizes.reduce((a, b) => (Math.abs(wort(atSize(sys, b.batchGal)) - want) < Math.abs(wort(atSize(sys, a.batchGal)) - want) ? b : a)) : null;
    return fromPercents({ ...scaleRecipe(d, size ? atSize(sys, size.batchGal) : sys), imported: d.imported });
  })();
  const dc = calcRecipe(design);
  useEffect(() => {
    createClient().from("dp_recipes").select("id, name").eq("owner_id", userId).order("name").then(({ data }) => {
      const list = (data || []) as { id: string; name: string }[];
      setMine(list);
      // a recipe of the same name is most likely where it goes (Witstanbul for "Witstanbul (NHC 2022)")
      const match = list.find((x) => groupKey(x.name) === groupKey(r.name));
      if (match) { setHow("version"); setInto(match.id); }
    });
  }, [userId, r.name]);
  const label = `${r.name}${folder ? ` · ${folder}` : ""} · ${r1(r.equipment.batchGal, 2)} gal ${r.equipment.name}`;
  const go = async () => {
    setBusy(true); setErr("");
    let id = into;
    if (how === "new") {
      const res = await createRecipe(userId, [{ data: { ...design, name: name.trim() || r.name }, date: date || undefined, note: note || `From BeerSmith: ${label}` }]);
      if (!res.id) { setErr(res.error || "Not saved"); setBusy(false); return; }
      id = res.id;
    } else {
      if (!into) { setErr("Pick the recipe it's a version of"); setBusy(false); return; }
      const target = mine.find((m) => m.id === into);
      const res = await saveVersion(into, userId, { ...design, name: target?.name || r.name }, note || `From BeerSmith: ${label}`);
      if (!res.version) { setErr(res.error || "Not saved"); setBusy(false); return; }
    }
    await createClient().from("dp_archive").update({ brought_to: id }).eq("id", archiveId);
    onDone();
    router.push(`/draftpunk/r/${id}`);
  };
  return (
    <Win title="Bring into DraftPunk" note={`${r1(r.equipment.batchGal, 2)} gal · ${r.equipment.name}`}>
      <div className="dp-bring">
        <p style={{ marginTop: 0 }}>It comes in as this recipe{sys ? <>, brewed at <b>{r1(design.equipment.batchGal, 2)} gal</b> on {sys.name} (from {r1(r.equipment.batchGal, 2)} gal on {r.equipment.name})</> : null}:</p>
        <ul className="dp-list">
          <li><b>Target OG {design.byPercent!.targetOg.toFixed(3)}</b> · {r1(dc.ibu, 0)} IBU · BU:GU {r1(dc.buGu, 2)}</li>
          {[...design.ferms].filter((f) => !isAid(f)).sort((a, b) => (b.pct || 0) - (a.pct || 0)).map((f) => <li key={f.lid}><b>{r1(f.pct || 0, 1)}%</b> {f.name}</li>)}
          {design.ferms.filter(isAid).map((f) => <li key={f.lid} className="dp-dim">{r1(f.lb, 2)} lb {f.name} (process aid, not in the percents)</li>)}
          {design.hops.map((h) => <li key={h.lid}>{h.name} {h.use === "dry_hop" ? `dry hop ${h.days || 4} d` : h.use === "whirlpool" ? `whirlpool ${h.min} min` : h.use === "first_wort" ? "first wort" : `${h.min} min`}: {r1(h.oz, 2)} oz{dc.hopIbus[h.lid] ? <> for <b>{r1(dc.hopIbus[h.lid], 1)} IBU</b></> : null}</li>)}
          {design.yeasts.map((y) => <li key={y.lid}>Yeast: {[y.lab, y.code, y.name].filter(Boolean).join(" ")}</li>)}
          {design.miscs.map((m) => <li key={m.lid} className="dp-dim">{m.name} {r1(m.amount, 2)} {m.unit}</li>)}
        </ul>
      </div>
      <span className="dp-seg" role="group" aria-label="How">
        <button type="button" className={how === "new" ? "on" : ""} onClick={() => setHow("new")}>As a new recipe</button>
        <button type="button" className={how === "version" ? "on" : ""} onClick={() => setHow("version")}>As a version of…</button>
      </span>
      <div className="dp-row" style={{ marginTop: 12 }}>
        {how === "new"
          ? <F label="Name" grow="2 1 240px"><input value={name} onChange={(e) => setName(e.target.value)} /></F>
          : <F label="Version of" grow="2 1 240px"><select value={into} onChange={(e) => setInto(e.target.value)}><option value="">Pick a recipe…</option>{mine.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></F>}
        <F label="Note" grow="2 1 240px"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={`From BeerSmith: ${r.name}`} /></F>
        <button className="dp-btn dp-go" disabled={busy} onClick={go}>{busy ? "Bringing it in…" : "Bring it in"}</button>
      </div>
      <p className="dp-dim" style={{ marginBottom: 0 }}>It keeps its own equipment and batch size: bring in each brew system&apos;s real version (3, 5, 10 gal) and the recipe holds all of them.</p>
      {err && <p className="dp-red">{err}</p>}
    </Win>
  );
}
