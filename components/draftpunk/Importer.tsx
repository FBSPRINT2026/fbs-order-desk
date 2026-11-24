"use client";
import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { calcRecipe, calcSummary, r1 } from "@/lib/draftpunk/calc";
import { parseRecipes } from "@/lib/draftpunk/beerxml";
import { styleById } from "@/lib/draftpunk/styles";
import type { Recipe } from "@/lib/draftpunk/types";
import { Win } from "./ui";

/** bring recipes in from BeerSmith (.bsmx) or any BeerXML file: read, check, then save the ones ticked */
export default function Importer({ userId }: { userId: string }) {
  const [found, setFound] = useState<(Recipe & { take: boolean; from: string })[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const read = async (files: FileList | null) => {
    if (!files) return;
    const all: (Recipe & { take: boolean; from: string })[] = [];
    for (const f of Array.from(files)) {
      try { all.push(...parseRecipes(await f.text(), f.name).map((r) => ({ ...r, take: true, from: f.name }))); }
      catch { setMsg(`Couldn't read ${f.name}`); }
    }
    setFound(all);
    setMsg(all.length ? `${all.length} recipe${all.length === 1 ? "" : "s"} found. Tick the ones to keep.` : "No recipes found in that file.");
  };
  const save = async () => {
    setBusy(true);
    const rows = found.filter((r) => r.take).map(({ take: _t, from: _f, ...r }) => ({ owner_id: userId, name: r.name, style_id: r.styleId || null, data: r, calc: calcSummary(calcRecipe(r)) }));
    const { error } = await createClient().from("dp_recipes").insert(rows);
    setBusy(false);
    setMsg(error ? `Not saved: ${error.message}` : `${rows.length} recipe${rows.length === 1 ? "" : "s"} saved. See them under Recipes.`);
    if (!error) setFound([]);
  };
  return (
    <>
      <h1 className="dp-h1">Import recipes</h1>
      <Win title="Import recipes">
        <p>Pick a BeerSmith file (<b>Recipe.bsmx</b> from Documents/BeerSmith3) or a <b>BeerXML</b> export (.xml). You can pick several.</p>
        <input type="file" accept=".bsmx,.xml,.beerxml" multiple onChange={(e) => read(e.target.files)} />
        {msg && <p>{msg}</p>}
      </Win>
      {!!found.length && (
        <Win title="Found">
          <table className="dp-tbl" data-nofit>
            <thead><tr><th /><th>Recipe</th><th>Style</th><th className="dp-num">OG</th><th className="dp-num">IBU</th><th className="dp-num">Gal</th><th>From</th></tr></thead>
            <tbody>
              {found.map((r, i) => { const c = calcRecipe(r); return (
                <tr key={i}>
                  <td><input type="checkbox" checked={r.take} onChange={(e) => setFound((xs) => xs.map((x, j) => (j === i ? { ...x, take: e.target.checked } : x)))} /></td>
                  <td>{r.name}</td><td>{styleById(r.styleId)?.name || "-"}</td>
                  <td className="dp-num">{c.og.toFixed(3)}</td><td className="dp-num">{r1(c.ibu, 0)}</td><td className="dp-num">{r1(r.equipment.batchGal, 1)}</td>
                  <td className="dp-dim">{r.from}</td>
                </tr>
              ); })}
            </tbody>
          </table>
          <p className="dp-row"><button className="dp-btn dp-go" disabled={busy} onClick={save}>Save {found.filter((r) => r.take).length} recipes</button><Link className="dp-btn" href="/draftpunk">Cancel</Link></p>
          <p className="dp-dim">Their efficiency comes in as mash efficiency; pick your own equipment in each recipe (or scale to it) and your brew logs will dial it in.</p>
        </Win>
      )}
    </>
  );
}
