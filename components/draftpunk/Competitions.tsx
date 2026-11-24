"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { r1 } from "@/lib/draftpunk/calc";
import { fmtDate } from "@/lib/draftpunk/defaults";
import { descriptor, entryScore, MEDAL_LABEL, PLACES, SECTIONS, sheetTotal, type Sheet } from "@/lib/draftpunk/judging";
import { STYLE_GROUPS, styleById, styleLabel } from "@/lib/draftpunk/styles";
import { useToast } from "./Shell";
import { F, Num, Win } from "./ui";
import TrophyCase, { type Award } from "./TrophyCase";

type Entry = { id: string; owner_id: string; competition: string; held_on: string | null; style_id: string | null; entry_name: string; recipe_id: string | null; brew_id: string | null; version_id?: string | null; scores: Sheet[]; place: string; mini_bos: boolean; notes: string };
type Opt = { id: string; name: string };

/**
 * Competitions (Nick, Nov 24 2026): every entry with its category, the recipe and batch it came from, each judge's
 * scoresheet and the result; the medal count and how each style scores; and the club's medal wall.
 */
export default function Competitions({ userId, admin = false }: { userId: string; admin?: boolean }) {
  const [awards, setAwards] = useState<Award[]>([]);
  const awardFor = (place: string) => awards.find((a) => a.place && a.place === place && a.image);
  const { toast, node } = useToast();
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [recipes, setRecipes] = useState<Opt[]>([]);
  const [brews, setBrews] = useState<(Opt & { recipe_id: string | null; version_id: string | null })[]>([]);
  const [members, setMembers] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<"mine" | "club">("mine");
  const load = async () => {
    const sb = createClient();
    const [{ data: e }, { data: rc }, { data: bw }, { data: m }] = await Promise.all([
      sb.from("dp_entries").select("*").order("held_on", { ascending: false, nullsFirst: true }),
      sb.from("dp_recipes").select("id, name").eq("owner_id", userId).order("name"),
      sb.from("dp_brews").select("id, brewed_on, recipe_id, version_id, recipe_snapshot->name").eq("owner_id", userId).order("brewed_on", { ascending: false }).limit(200),
      sb.from("dp_brewers").select("user_id, name"),
    ]);
    setRows((e || []) as Entry[]);
    setRecipes((rc || []) as Opt[]);
    setBrews(((bw || []) as unknown as { id: string; brewed_on: string; recipe_id: string | null; version_id: string | null; name: string }[]).map((b) => ({ id: b.id, recipe_id: b.recipe_id, version_id: b.version_id, name: `${fmtDate(b.brewed_on)} · ${b.name}` })));
    setMembers(Object.fromEntries(((m || []) as { user_id: string; name: string }[]).map((x) => [x.user_id, x.name])));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const mine = useMemo(() => (rows || []).filter((r) => r.owner_id === userId), [rows, userId]);
  const shown = view === "mine" ? mine : rows || [];
  const medals = (list: Entry[]) => list.filter((r) => r.place && r.place !== "hm").length;

  // how each style has scored for this brewer
  const byStyle = useMemo(() => {
    const m = new Map<string, { n: number; sum: number; medals: number }>();
    for (const e of mine) {
      const sc = entryScore(e.scores); if (!e.style_id) continue;
      const v = m.get(e.style_id) || { n: 0, sum: 0, medals: 0 };
      if (sc) { v.n++; v.sum += sc; }
      if (e.place && e.place !== "hm") v.medals++;
      m.set(e.style_id, v);
    }
    return [...m.entries()].map(([id, v]) => ({ id, avg: v.n ? v.sum / v.n : 0, n: v.n, medals: v.medals })).sort((a, b) => b.avg - a.avg);
  }, [mine]);

  const add = async () => {
    const { data, error } = await createClient().from("dp_entries").insert({ owner_id: userId, competition: "New competition", held_on: new Date().toISOString().slice(0, 10), scores: [] }).select("*").single();
    if (error) { toast(error.message); return; }
    setRows((x) => [data as Entry, ...(x || [])]); setOpen((data as Entry).id); setView("mine");
  };
  const save = async (e: Entry) => {
    setRows((x) => (x || []).map((r) => (r.id === e.id ? e : r)));
    const { id, owner_id: _o, ...rest } = e;
    const { error } = await createClient().from("dp_entries").update(rest).eq("id", id);
    if (error) toast(`Not saved: ${error.message}`);
  };
  const remove = async (e: Entry) => { if (!confirm(`Delete the entry in ${e.competition}?`)) return; await createClient().from("dp_entries").delete().eq("id", e.id); load(); };

  return (
    <>
      <div className="dp-row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h1 className="dp-h1" style={{ margin: 0 }}>Competitions</h1>
        <button className="dp-btn dp-go" onClick={add}>+ New entry</button>
      </div>
      <TrophyCase admin={admin} onAwards={setAwards} />
      <div className="dp-kpi-row">
        <div className="dp-card dp-stat-tile"><span>Entries</span><b>{mine.length}</b></div>
        <div className="dp-card dp-stat-tile"><span>Medals</span><b>{medals(mine)}</b></div>
        <div className="dp-card dp-stat-tile"><span>Golds</span><b>{mine.filter((e) => e.place === "gold").length}</b></div>
        <div className="dp-card dp-stat-tile"><span>Average score</span><b>{r1(entryScore(mine.flatMap((e) => e.scores)), 1) || "–"}</b></div>
      </div>

      <div className="dp-row" style={{ margin: "6px 0 10px", alignItems: "center" }}>
        <span className="dp-seg"><button className={view === "mine" ? "on" : ""} onClick={() => setView("mine")}>My entries</button><button className={view === "club" ? "on" : ""} onClick={() => setView("club")}>Club medal wall</button></span>
      </div>

      {!rows ? <p className="dp-dim">Loading…</p> : !shown.length ? (
        <Win title="No entries yet"><p className="dp-dim" style={{ margin: 0 }}>Add an entry when you send beer to a competition; add the scoresheets when they come back.</p></Win>
      ) : (
        shown.filter((e) => view === "mine" || e.place).map((e) => {
          const sc = entryScore(e.scores);
          const st = styleById(e.style_id || undefined);
          const isOpen = open === e.id && e.owner_id === userId;
          return (
            <section key={e.id} className="dp-card">
              <div className="dp-row" style={{ alignItems: "center", justifyContent: "space-between", cursor: e.owner_id === userId ? "pointer" : "default" }} onClick={() => e.owner_id === userId && setOpen(isOpen ? null : e.id)}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 17 }}>{e.entry_name || recipes.find((r) => r.id === e.recipe_id)?.name || "Entry"} {e.place && <span className={`dp-medal dp-medal-${e.place}`}>{MEDAL_LABEL[e.place]}</span>}{e.place && awardFor(e.place) && <img className="dp-award-mark" src={awardFor(e.place)!.image} alt={awardFor(e.place)!.title} />}{e.mini_bos && <span className="dp-chip" style={{ marginLeft: 6 }}>Mini-BOS</span>}</div>
                  <div className="dp-dim" style={{ fontSize: 13 }}>{e.competition}{e.held_on ? ` · ${fmtDate(e.held_on)}` : ""}{st ? ` · ${styleLabel(st)}` : ""}{view === "club" ? ` · ${members[e.owner_id] || ""}` : ""}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="dp-big" style={{ fontSize: 30 }}>{sc ? r1(sc, 1) : "–"}</div>
                  <div className="dp-dim" style={{ fontSize: 12 }}>{descriptor(sc)}{e.scores.length ? ` · ${e.scores.length} judge${e.scores.length > 1 ? "s" : ""}` : ""}</div>
                </div>
              </div>
              {isOpen && <EntryEditor e={e} recipes={recipes} brews={brews} onChange={save} onDelete={() => remove(e)} />}
            </section>
          );
        })
      )}

      {view === "mine" && !!byStyle.length && (
        <Win title="How your styles score">
          <table className="dp-tbl" data-nofit>
            <thead><tr><th>Style</th><th className="dp-num">Scored entries</th><th className="dp-num">Average</th><th className="dp-num">Medals</th></tr></thead>
            <tbody>{byStyle.map((s) => { const st = styleById(s.id); return <tr key={s.id}><td>{st ? styleLabel(st) : s.id}</td><td className="dp-num">{s.n}</td><td className="dp-num">{s.avg ? r1(s.avg, 1) : "–"}</td><td className="dp-num">{s.medals}</td></tr>; })}</tbody>
          </table>
        </Win>
      )}
      {node}
    </>
  );
}

function EntryEditor({ e, recipes, brews, onChange, onDelete }: { e: Entry; recipes: Opt[]; brews: (Opt & { recipe_id: string | null; version_id: string | null })[]; onChange: (e: Entry) => void; onDelete: () => void }) {
  const [d, setD] = useState(e);
  // save a moment after typing stops
  useEffect(() => { if (d === e) return; const t = setTimeout(() => onChange(d), 800); return () => clearTimeout(t); }, [d, e, onChange]);
  const up = (p: Partial<Entry>) => setD((x) => ({ ...x, ...p }));
  const upSheet = (i: number, p: Partial<Sheet>) => up({ scores: d.scores.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  return (
    <div style={{ marginTop: 14, borderTop: "1px solid var(--dp-line)", paddingTop: 14 }}>
      <div className="dp-row">
        <F label="Competition" grow="2 1 220px"><input value={d.competition} onChange={(x) => up({ competition: x.target.value })} /></F>
        <F label="Date"><input type="date" value={d.held_on || ""} onChange={(x) => up({ held_on: x.target.value || null })} /></F>
        <F label="Entry name" grow="1 1 180px"><input value={d.entry_name} onChange={(x) => up({ entry_name: x.target.value })} /></F>
      </div>
      <div className="dp-row" style={{ marginTop: 10 }}>
        <F label="Category entered" grow="2 1 240px">
          <select value={d.style_id || ""} onChange={(x) => up({ style_id: x.target.value || null })}>
            <option value="">(pick)</option>
            {STYLE_GROUPS.map((g) => <optgroup key={g.key} label={g.label}>{g.styles.map((s) => <option key={s.id} value={s.id}>{styleLabel(s)}</option>)}</optgroup>)}
          </select>
        </F>
        <F label="Recipe" grow="1 1 200px">
          <select value={d.recipe_id || ""} onChange={(x) => up({ recipe_id: x.target.value || null, version_id: null })}>
            <option value="">(none)</option>{recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </F>
        <F label="Batch (brew log)" grow="1 1 200px">
          <select value={d.brew_id || ""} onChange={(x) => { const b = brews.find((y) => y.id === x.target.value); up({ brew_id: x.target.value || null, version_id: b?.version_id ?? d.version_id ?? null }); }}>
            <option value="">(none)</option>{brews.filter((b) => !d.recipe_id || b.recipe_id === d.recipe_id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </F>
        {d.recipe_id && <VersionPick recipeId={d.recipe_id} value={d.version_id || ""} onPick={(v) => up({ version_id: v || null })} />}
        <F label="Result">
          <select value={d.place} onChange={(x) => up({ place: x.target.value })}>{PLACES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </F>
        <label className="dp-row" style={{ alignItems: "center", gap: 6 }}><input type="checkbox" checked={d.mini_bos} onChange={(x) => up({ mini_bos: x.target.checked })} /> Went to mini-BOS</label>
      </div>

      <h3 className="dp-card-t" style={{ marginTop: 18 }}>Scoresheets <small>{SECTIONS.map(([, l, m]) => `${l} /${m}`).join(" · ")}</small></h3>
      {d.scores.map((s, i) => (
        <div key={i} className="dp-sheet">
          <div className="dp-row">
            <F label="Judge" grow="1 1 160px"><input value={s.judge} onChange={(x) => upSheet(i, { judge: x.target.value })} /></F>
            <F label="Rank"><select value={s.rank || ""} onChange={(x) => upSheet(i, { rank: x.target.value })}>{["", "Apprentice", "Provisional", "Recognized", "Certified", "National", "Master", "Grand Master", "Pro brewer", "Non-BJCP"].map((x) => <option key={x}>{x}</option>)}</select></F>
            {SECTIONS.map(([k, l, m]) => <F key={k} label={`${l} /${m}`}><Num value={s[k]} onChange={(n) => upSheet(i, { [k]: Math.min(m, Math.max(0, n)) })} /></F>)}
            <div style={{ alignSelf: "center", textAlign: "right", minWidth: 70 }}><div className="dp-v" style={{ fontSize: 24 }}>{sheetTotal(s)}</div><div className="dp-dim" style={{ fontSize: 11 }}>{descriptor(sheetTotal(s))}</div></div>
            <button className="dp-btn dp-x" aria-label="Remove this scoresheet" onClick={() => up({ scores: d.scores.filter((_, k) => k !== i) })}>✕</button>
          </div>
          <F label="What the judge said"><textarea style={{ minHeight: 70 }} value={s.notes || ""} onChange={(x) => upSheet(i, { notes: x.target.value })} /></F>
        </div>
      ))}
      <div className="dp-row" style={{ marginTop: 10 }}>
        <button className="dp-btn" onClick={() => up({ scores: [...d.scores, { judge: "" }] })}>+ Add a scoresheet</button>
        <button className="dp-btn dp-x" onClick={onDelete}>Delete entry</button>
        {d.recipe_id && <Link className="dp-btn dp-x" href={`/draftpunk/r/${d.recipe_id}`}>Open recipe</Link>}
        {d.brew_id && <Link className="dp-btn dp-x" href={`/draftpunk/brews/${d.brew_id}`}>Open brew log</Link>}
      </div>
      <F label="Notes"><textarea style={{ minHeight: 60 }} value={d.notes} onChange={(x) => up({ notes: x.target.value })} placeholder="what to change next time" /></F>
    </div>
  );
}

/** which version of the recipe was entered (a brew picked above fills it in) */
function VersionPick({ recipeId, value, onPick }: { recipeId: string; value: string; onPick: (id: string) => void }) {
  const [vs, setVs] = useState<{ id: string; num: number; note: string }[]>([]);
  useEffect(() => { createClient().from("dp_recipe_versions").select("id, num, note").eq("recipe_id", recipeId).order("num").then(({ data }) => setVs((data || []) as { id: string; num: number; note: string }[])); }, [recipeId]);
  if (!vs.length) return null;
  return (
    <F label="Version" grow="1 1 160px">
      <select value={value} onChange={(x) => onPick(x.target.value)}>
        <option value="">(pick)</option>{vs.map((v) => <option key={v.id} value={v.id}>v{v.num} · {v.note.slice(0, 40)}</option>)}
      </select>
    </F>
  );
}
