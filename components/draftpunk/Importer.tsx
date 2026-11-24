"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { readAll } from "@/lib/readAll";
import { calcRecipe, calcSummary, r1 } from "@/lib/draftpunk/calc";
import { fromBeerXml } from "@/lib/draftpunk/beerxml";
import { type BsLibrary, type BsRead, dedupe, dedupeLib, readBsTables, readBsmx, recipeKey } from "@/lib/draftpunk/beersmith";
import { styleById } from "@/lib/draftpunk/styles";
import type { Recipe } from "@/lib/draftpunk/types";
import { addToLibrary } from "@/app/draftpunk/actions";
import { resetClubLib } from "./RecipeTabs";
import { Win } from "./ui";

type Found = Recipe & { take: boolean; from: string; folder?: string; sample?: boolean; here?: boolean };
const KINDS: [keyof BsLibrary, string][] = [["fermentable", "fermentables"], ["hop", "hops"], ["yeast", "yeasts"], ["misc", "misc"], ["water", "water profiles"]];

/** BeerSmith 3's backup (.zip) or its BeerSmith.sqlite: every table read in the browser (sql.js), nothing uploaded */
async function readBackup(file: File): Promise<BsRead> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let dbs: Uint8Array[] = [bytes];
  if (/\.zip$/i.test(file.name)) {
    const { unzipSync } = await import("fflate");
    const files = unzipSync(bytes, { filter: (f) => /\.sqlite$/i.test(f.name) });
    dbs = Object.entries(files).sort(([a], [b]) => Number(/beersmith\.sqlite$/i.test(b)) - Number(/beersmith\.sqlite$/i.test(a))).map(([, v]) => v);
  }
  const initSqlJs = (await import("sql.js")).default;
  const SQL = await initSqlJs({ locateFile: (_f: string) => "/draftpunk-sql-wasm.wasm" } as unknown as Parameters<typeof initSqlJs>[0]);
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const buf of dbs) {
    const db = new SQL.Database(buf);
    const names = (db.exec("select name from sqlite_master where type='table'")[0]?.values || []).map((v) => String(v[0]));
    // the recipes and the ingredient lists, from whichever file holds them (the backup's other files are settings)
    for (const t of names.filter((x) => /^M_(CLOUD_)?(RECIPE|GRAIN|HOPS|YEAST|MISC|WATER)$|^M_CLOUD$/.test(x))) {
      const res = db.exec(`select * from "${t}"`)[0];
      if (res && !/DefRecipe/i.test(t)) tables[t] = [...(tables[t] || []), ...res.values.map((v) => Object.fromEntries(res.columns.map((c, i) => [c, v[i]])))];
    }
    db.close();
    if (tables.M_CLOUD || tables.M_RECIPE) break;
  }
  return readBsTables(tables);
}

/**
 * Bring in recipes and ingredient lists from BeerSmith (Nick, Nov 24 2026: his BeerSmith 3 backup and its exports) or any
 * BeerXML file: read here in the browser, checked, then the ticked recipes saved to this brewer and the lists to the
 * club's library. BeerSmith's own samples and recipes already here start unticked.
 */
export default function Importer({ userId, admin }: { userId: string; admin: boolean }) {
  const [found, setFound] = useState<Found[]>([]);
  const [lib, setLib] = useState<BsLibrary | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  const read = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setMsg("Reading…");
    const recipes: Found[] = [];
    const libs: BsLibrary[] = [];
    for (const f of Array.from(files)) {
      try {
        let got: BsRead;
        if (/\.(zip|sqlite)$/i.test(f.name)) got = await readBackup(f);
        else {
          const text = await f.text();
          got = /<F_[A-Z]_NAME>/.test(text) ? readBsmx(text) : { recipes: fromBeerXml(text), library: { fermentable: [], hop: [], yeast: [], misc: [], water: [] } };
        }
        recipes.push(...got.recipes.map((r) => ({ ...r, take: true, from: f.name })));
        libs.push(got.library);
      } catch (e) { setMsg(`Couldn't read ${f.name}${e instanceof Error ? `: ${e.message}` : ""}`); }
    }
    // what this brewer already has (the same name and lines) isn't brought in twice
    const mine = await readAll<{ data: Recipe }>((a, b) => createClient().from("dp_recipes").select("data").eq("owner_id", userId).order("id").range(a, b)).catch(() => []);
    const have = new Set(mine.map((m) => { try { return recipeKey(m.data); } catch { return ""; } }));
    const all = dedupe(recipes).map((r) => { const here = have.has(recipeKey(r)); return { ...r, here, take: !here && !r.sample }; });
    const merged = dedupeLib(libs.reduce<BsLibrary>((a, l) => ({ fermentable: [...a.fermentable, ...l.fermentable], hop: [...a.hop, ...l.hop], yeast: [...a.yeast, ...l.yeast], misc: [...a.misc, ...l.misc], water: [...a.water, ...l.water] }), { fermentable: [], hop: [], yeast: [], misc: [], water: [] }));
    setFound(all);
    setLib(KINDS.some(([k]) => merged[k].length) ? merged : null);
    const samples = all.filter((r) => r.sample).length, here = all.filter((r) => r.here).length;
    setMsg(all.length ? `${all.length} recipe${all.length === 1 ? "" : "s"} found${samples ? `, ${samples} of them BeerSmith's samples` : ""}${here ? `, ${here} already here` : ""}. Tick the ones to keep.` : lib ? "" : "No recipes in that file.");
    setBusy(false);
  };

  const saveRecipes = async () => {
    setBusy(true);
    const rows = found.filter((r) => r.take).map(({ take: _t, from: _f, folder: _d, sample: _s, here: _h, ...r }) => ({ owner_id: userId, name: r.name, style_id: r.styleId || null, data: r, calc: calcSummary(calcRecipe(r)) }));
    let saved = 0, err = "";
    for (let i = 0; i < rows.length && !err; i += 40) {
      const { error } = await createClient().from("dp_recipes").insert(rows.slice(i, i + 40));
      if (error) err = error.message; else saved += Math.min(40, rows.length - i);
    }
    setBusy(false);
    setMsg(err ? `${saved} saved, then stopped: ${err}` : `${saved} recipe${saved === 1 ? "" : "s"} saved. See them under Recipes.`);
    if (!err) setFound((xs) => xs.map((x) => (x.take ? { ...x, here: true, take: false } : x)));
  };

  const saveLib = async () => {
    if (!lib) return;
    setBusy(true);
    let added = 0, updated = 0, err = "";
    for (const [k, label] of KINDS) for (let i = 0; i < lib[k].length && !err; i += 400) {
      setMsg(`Adding ${label}… ${i} of ${lib[k].length}`);
      const res = await addToLibrary(k, lib[k].slice(i, i + 400) as { name: string }[]);
      if (!res.ok) err = res.msg || "Not saved"; added += res.added; updated += res.updated;
    }
    resetClubLib();
    setBusy(false);
    setMsg(err ? `Stopped: ${err}` : `The club's library has ${added} new ingredient${added === 1 ? "" : "s"}${updated ? ` and ${updated} updated` : ""}. They're in every recipe's Add pickers.`);
    if (!err) setLib(null);
  };

  const shown = useMemo(() => { const w = q.toLowerCase().split(/\s+/).filter(Boolean); return found.map((r, i) => ({ r, i })).filter(({ r }) => w.every((x) => `${r.name} ${r.brewer || ""} ${styleById(r.styleId)?.name || ""}`.toLowerCase().includes(x))); }, [found, q]);
  const tick = (i: number, on: boolean) => setFound((xs) => xs.map((x, j) => (j === i ? { ...x, take: on } : x)));
  const taking = found.filter((r) => r.take).length;

  return (
    <>
      <h1 className="dp-h1">Import</h1>
      <Win title="From BeerSmith or BeerXML">
        <p>Pick any of these (several at once is fine):</p>
        <ul className="dp-list">
          <li><b>BeerSmith 3 backup</b>: the <b>.zip</b> from File → Backup. Brings every recipe (your cloud ones too) and BeerSmith&apos;s ingredient lists.</li>
          <li><b>BeerSmith files</b>: <b>.bsmx</b> recipe files, or the Hops / Fermentables / Yeast / Misc / Water lists exported from its ingredient pages.</li>
          <li><b>BeerXML</b> (.xml) from Brewfather, Grainfather and most other apps.</li>
        </ul>
        <input type="file" accept=".zip,.sqlite,.bsmx,.xml,.beerxml" multiple disabled={busy} onChange={(e) => read(e.target.files)} />
        {msg && <p>{msg}</p>}
        <p className="dp-dim">BeerSmith&apos;s efficiency is brewhouse efficiency; each recipe comes in with the mash efficiency that gives the same OG BeerSmith showed, so the numbers match. Pick your own equipment in a recipe and your brew logs dial it in.</p>
      </Win>
      {lib && (
        <Win title="Ingredient lists">
          <p>{KINDS.filter(([k]) => lib[k].length).map(([k, label]) => `${lib[k].length.toLocaleString()} ${label}`).join(", ")}.</p>
          {admin
            ? <p className="dp-row"><button className="dp-btn dp-go" disabled={busy} onClick={saveLib}>Add to the club&apos;s library</button><span className="dp-dim">Every member gets them in the Add pickers. Ones already there are updated, not doubled.</span></p>
            : <p className="dp-dim">A club admin can add these to the club&apos;s library.</p>}
        </Win>
      )}
      {!!found.length && (
        <Win title={`Recipes (${found.length})`}>
          <div className="dp-row">
            <input placeholder="Search recipes" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: "1 1 220px" }} />
            <button className="dp-btn" onClick={() => setFound((xs) => xs.map((x) => (shown.some((s) => s.r === x) && !x.here ? { ...x, take: true } : x)))}>Tick all</button>
            <button className="dp-btn" onClick={() => setFound((xs) => xs.map((x) => (shown.some((s) => s.r === x) ? { ...x, take: false } : x)))}>Untick all</button>
          </div>
          <table className="dp-tbl">
            <thead><tr><th /><th>Recipe</th><th>Style</th><th className="dp-num">OG</th><th className="dp-num">IBU</th><th className="dp-num">Gal</th></tr></thead>
            <tbody>
              {shown.map(({ r, i }) => { const c = calcRecipe(r); return (
                <tr key={i} style={r.here || r.sample ? { opacity: 0.6 } : undefined}>
                  <td><input type="checkbox" checked={r.take} onChange={(e) => tick(i, e.target.checked)} /></td>
                  <td><div className="dp-namecell">{r.name}<span className="dp-sub">{[r.brewer, r.here ? "Already here" : r.sample ? "BeerSmith sample" : "", r.from].filter(Boolean).join(" · ")}</span></div></td>
                  <td>{styleById(r.styleId)?.name || "-"}</td>
                  <td className="dp-num">{c.og.toFixed(3)}</td><td className="dp-num">{r1(c.ibu, 0)}</td><td className="dp-num">{r1(r.equipment.batchGal, 1)}</td>
                </tr>
              ); })}
            </tbody>
          </table>
          <p className="dp-row"><button className="dp-btn dp-go" disabled={busy || !taking} onClick={saveRecipes}>Save {taking} recipe{taking === 1 ? "" : "s"}</button><Link className="dp-btn" href="/draftpunk">Done</Link></p>
        </Win>
      )}
    </>
  );
}
