"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { readAll } from "@/lib/readAll";
import { calcRecipe, calcSummary, r1 } from "@/lib/draftpunk/calc";
import { fromBeerXml } from "@/lib/draftpunk/beerxml";
import { type BsLibrary, type BsRead, dedupeLib, readBsTables, readBsmx, recipeKey } from "@/lib/draftpunk/beersmith";
import { createRecipe } from "@/lib/draftpunk/recipeStore";
import { styleById } from "@/lib/draftpunk/styles";
import { fmtDate } from "@/lib/draftpunk/defaults";
import type { Recipe } from "@/lib/draftpunk/types";
import { addToLibrary } from "@/app/draftpunk/actions";
import { resetClubLib } from "./RecipeTabs";
import { Win } from "./ui";
import { ProposalView } from "./Assistant";
import { useRouter } from "next/navigation";
import { buildRecipe, type Proposal } from "@/lib/draftpunk/proposal";
import { myEquipment } from "@/lib/draftpunk/recipeStore";

type Copy = Recipe & { from: string; folder?: string; sample?: boolean; date?: string; cloud?: boolean };
/** one BeerSmith recipe as it was there: its own name, its folder (My Recipes' folders, or Cloud), its date */
type Found = Copy & { key: string; place: string; take: boolean; here?: boolean };
/** where it sat in BeerSmith, as BeerSmith showed it */
const placeOf = (r: Copy) => { const f = (r.folder || "").replace(/^\/+|\/+$/g, "").replace(/\//g, " › "); return r.cloud ? (f ? `Cloud › ${f}` : "Cloud") : f || "My Recipes"; };
/** the same recipe read twice (the same backup picked twice, two backups that both hold it) */
const sameKey = (name: string, place: string, date: string | undefined | null, r: Recipe) => `${place}|${name.trim().toLowerCase()}|${date || ""}|${recipeKey(r)}`;
const KINDS: [keyof BsLibrary, string][] = [["fermentable", "fermentables"], ["hop", "hops"], ["yeast", "yeasts"], ["misc", "misc"], ["water", "water profiles"]];

/** a BeerSmith file's text: its .bsmx files are Windows text (1252), not UTF-8 */
const bsText = (bytes: Uint8Array) => new TextDecoder("windows-1252").decode(bytes);
const mergeReads = (rs: BsRead[]): BsRead => ({
  recipes: rs.flatMap((r) => r.recipes),
  library: dedupeLib(rs.reduce<BsLibrary>((a, l) => ({ fermentable: [...a.fermentable, ...l.library.fermentable], hop: [...a.hop, ...l.library.hop], yeast: [...a.yeast, ...l.library.yeast], misc: [...a.misc, ...l.library.misc], water: [...a.water, ...l.library.water] }), { fermentable: [], hop: [], yeast: [], misc: [], water: [] })),
});

/**
 * A BeerSmith backup, whichever kind it is (Nick, Nov 24 2026: one backup was BeerSmith 3's database, another the
 * older set of .bsmx files with his 292 local recipes): a .zip holding .sqlite and/or .bsmx files, or a BeerSmith.sqlite
 * on its own. Everything is read here in the browser; nothing is uploaded.
 */
async function readBackup(file: File): Promise<BsRead> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let dbs: Uint8Array[] = [], xmls: Uint8Array[] = [];
  if (/\.zip$/i.test(file.name)) {
    const { unzipSync } = await import("fflate");
    const files = unzipSync(bytes, { filter: (f) => /\.(sqlite|bsmx)$/i.test(f.name) });
    const entries = Object.entries(files);
    dbs = entries.filter(([n]) => /\.sqlite$/i.test(n)).sort(([a], [b]) => Number(/beersmith\.sqlite$/i.test(b)) - Number(/beersmith\.sqlite$/i.test(a))).map(([, v]) => v);
    // the recipes and ingredient lists; the backup's other .bsmx files are settings and profiles
    xmls = entries.filter(([n]) => /(?:^|\/)(recipe|cloud|grain|hops|yeast|misc|water)\.bsmx$/i.test(n)).map(([, v]) => v);
  } else dbs = [bytes];
  const reads: BsRead[] = xmls.map((x) => readBsmx(bsText(x)));
  if (dbs.length) {
    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs({ locateFile: (_f: string) => "/draftpunk-sql-wasm.wasm" } as unknown as Parameters<typeof initSqlJs>[0]);
    const tables: Record<string, Record<string, unknown>[]> = {};
    for (const buf of dbs) {
      const db = new SQL.Database(buf);
      const names = (db.exec("select name from sqlite_master where type='table'")[0]?.values || []).map((v) => String(v[0]));
      for (const t of names.filter((x) => /^M_(CLOUD_)?(RECIPE|GRAIN|HOPS|YEAST|MISC|WATER)$|^M_CLOUD$/.test(x))) {
        const res = db.exec(`select * from "${t}"`)[0];
        if (res) tables[t] = [...(tables[t] || []), ...res.values.map((v) => Object.fromEntries(res.columns.map((c, i) => [c, v[i]])))];
      }
      db.close();
      if (tables.M_CLOUD || tables.M_RECIPE) break;
    }
    reads.push(readBsTables(tables));
  }
  return mergeReads(reads);
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
    const recipes: Copy[] = [];
    const libs: BsLibrary[] = [];
    for (const f of Array.from(files)) {
      try {
        let got: BsRead;
        if (/\.(zip|sqlite)$/i.test(f.name)) got = await readBackup(f);
        else {
          const text = /\.bsmx$/i.test(f.name) ? bsText(new Uint8Array(await f.arrayBuffer())) : await f.text();
          got = /<F_[A-Z]_NAME>/.test(text) ? readBsmx(text) : { recipes: fromBeerXml(text), library: { fermentable: [], hop: [], yeast: [], misc: [], water: [] } };
        }
        recipes.push(...got.recipes.map((r) => ({ ...r, from: f.name })));
        libs.push(got.library);
      } catch (e) { setMsg(`Couldn't read ${f.name}${e instanceof Error ? `: ${e.message}` : ""}`); }
    }
    // every recipe on its own, as BeerSmith had it; only the same one read twice, or already brought in, is skipped
    const had = await readAll<{ name: string; folder: string; brewed_on: string | null; data: Recipe }>((x, y) => createClient().from("dp_archive").select("name, folder, brewed_on, data").eq("owner_id", userId).order("id").range(x, y)).catch(() => []);
    const have = new Set(had.map((h) => { try { return sameKey(h.name, h.folder, h.brewed_on, h.data); } catch { return ""; } }));
    const seen = new Set<string>();
    const all: Found[] = [];
    for (const r of recipes) {
      const place = placeOf(r), key = sameKey(r.name, place, r.date, r);
      if (seen.has(key)) continue;
      seen.add(key);
      const here = have.has(key);
      all.push({ ...r, name: r.name.trim(), key, place, here, take: !here && !r.sample });
    }
    all.sort((x, y) => x.place.localeCompare(y.place) || x.name.localeCompare(y.name));
    const merged = dedupeLib(libs.reduce<BsLibrary>((a, l) => ({ fermentable: [...a.fermentable, ...l.fermentable], hop: [...a.hop, ...l.hop], yeast: [...a.yeast, ...l.yeast], misc: [...a.misc, ...l.misc], water: [...a.water, ...l.water] }), { fermentable: [], hop: [], yeast: [], misc: [], water: [] }));
    setFound(all);
    setLib(KINDS.some(([k]) => merged[k].length) ? merged : null);
    const samples = all.filter((r) => r.sample).length, here = all.filter((r) => r.here).length;
    const folders = new Set(all.map((r) => r.place)).size;
    setMsg(all.length ? `${all.length} recipe${all.length === 1 ? "" : "s"} in ${folders} folder${folders === 1 ? "" : "s"}${samples ? `, ${samples} of them BeerSmith's samples` : ""}${here ? `, ${here} already brought over` : ""}. They go on Recipes → From BeerSmith, just as they were.` : lib ? "" : "No recipes in that file.");
    setBusy(false);
  };

  // to From BeerSmith: each recipe as it was (name, folder, date), for bringing into DraftPunk one at a time
  const saveRecipes = async () => {
    setBusy(true);
    let saved = 0, err = "";
    const todo = found.filter((r) => r.take);
    for (let i = 0; i < todo.length && !err; i += 50) {
      setMsg(`Saving ${i + 1}–${Math.min(i + 50, todo.length)} of ${todo.length}…`);
      const rows = todo.slice(i, i + 50).map(({ take: _t, from, folder: _d, sample: _s, date, cloud: _c, key: _k, place, here: _h, ...r }) => ({ owner_id: userId, name: r.name, folder: place, brewed_on: date || null, source: from, data: r, calc: calcSummary(calcRecipe(r)) }));
      const { error } = await createClient().from("dp_archive").insert(rows);
      if (error) err = error.message; else saved += rows.length;
    }
    setBusy(false);
    setMsg(err ? `${saved} saved, then stopped: ${err}` : `${saved} recipe${saved === 1 ? "" : "s"} saved to Recipes → From BeerSmith.`);
    const done = new Set(todo.slice(0, saved).map((r) => r.key));
    setFound((xs) => xs.map((x) => (done.has(x.key) ? { ...x, here: true, take: false } : x)));
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

  const shown = useMemo(() => { const w = q.toLowerCase().split(/\s+/).filter(Boolean); return found.map((r, i) => ({ r, i })).filter(({ r }) => w.every((x) => `${r.name} ${r.place} ${r.brewer || ""} ${styleById(r.styleId)?.name || ""}`.toLowerCase().includes(x))); }, [found, q]);
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
      <PhotoImport userId={userId} />
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
                <tr key={r.key} style={r.here || r.sample ? { opacity: 0.6 } : undefined}>
                  <td><input type="checkbox" checked={r.take} onChange={(e) => tick(i, e.target.checked)} aria-label={`Bring in ${r.name}`} /></td>
                  <td><div className="dp-namecell">{r.name}<span className="dp-sub">{[r.place, r.date ? fmtDate(r.date) : "", r.here ? "Already brought over" : r.sample ? "BeerSmith sample" : ""].filter(Boolean).join(" · ")}</span></div></td>
                  <td>{styleById(r.styleId)?.name || "-"}</td>
                  <td className="dp-num">{c.og.toFixed(3)}</td><td className="dp-num">{r1(c.ibu, 0)}</td><td className="dp-num">{r1(r.equipment.batchGal, 1)}</td>
                </tr>
              ); })}
            </tbody>
          </table>
          <p className="dp-row"><button className="dp-btn dp-go" disabled={busy || !taking} onClick={saveRecipes}>Save {taking} recipe{taking === 1 ? "" : "s"}</button><Link className="dp-btn" href="/draftpunk?tab=beersmith">See From BeerSmith</Link></p>
        </Win>
      )}
    </>
  );
}

/**
 * A recipe from photos (a page of a brewing book the brewer owns, a printout, a card): read by the AI into a recipe in
 * this brewer's own account, on their equipment, with where it came from in its notes.
 */
function PhotoImport({ userId }: { userId: string }) {
  const router = useRouter();
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [got, setGot] = useState<{ proposal: Proposal; unread: string } | null>(null);
  const read = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setErr(""); setGot(null);
    const fd = new FormData();
    Array.from(files).slice(0, 4).forEach((f) => fd.append("photo", f));
    fd.append("source", source);
    try { const res = await fetch("/api/draftpunk/read-recipe", { method: "POST", body: fd }); const j = await res.json(); if (!res.ok) setErr(j.error || "Couldn't read it"); else setGot(j); } catch { setErr("Couldn't send the photos"); }
    setBusy(false);
  };
  const make = async () => {
    if (!got) return;
    const r = buildRecipe(got.proposal, await myEquipment(userId));
    const res = await createRecipe(userId, [{ data: r, note: source ? `From ${source}` : "From a photo" }]);
    if (res.id) router.push(`/draftpunk/r/${res.id}`); else setErr(res.error || "Not saved");
  };
  return (
    <Win title="From photos of a recipe" note="a book you own, a printout, a recipe card">
      <div className="dp-row">
        <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Where it's from (e.g. Brewing Classic Styles, p. 74)" style={{ flex: "1 1 260px" }} aria-label="Where the recipe is from" />
        <label className="dp-btn dp-go">{busy ? "Reading…" : "Take or pick photos"}<input type="file" accept="image/*" capture="environment" multiple hidden disabled={busy} onChange={(e) => read(e.target.files)} /></label>
      </div>
      <p className="dp-dim">Up to 4 photos for a recipe that runs over pages. It reads only what&apos;s printed, works the grain out as percents, and builds it on your equipment. It stays private to you.</p>
      {err && <p className="dp-red">{err}</p>}
      {got && (
        <>
          <ProposalView p={got.proposal} />
          {got.unread && <p className="dp-dim">Couldn&apos;t read: {got.unread}</p>}
          <p className="dp-row"><button className="dp-btn dp-go" onClick={make}>Make it my recipe</button></p>
        </>
      )}
    </Win>
  );
}
