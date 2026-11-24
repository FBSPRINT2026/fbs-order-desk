"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { styleById } from "@/lib/draftpunk/styles";
import { fmtDate } from "@/lib/draftpunk/defaults";
import BeerSmithList from "./BeerSmithList";

type Row = { id: string; name: string; style_id: string | null; visibility: string; status?: string; versions?: number; brewed?: string; calc: { og?: number; fg?: number; abv?: number; ibu?: number; srm?: number; color?: string }; updated_at: string; data: { type?: string; equipment?: { batchGal?: number } } };

type SortBy = "name" | "style" | "og" | "ibu" | "abv" | "srm" | "brewed";

/** the brewer's recipes: search, sort, open, copy, share with the club */
export default function RecipeList({ userId }: { userId: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");
  const load = async () => {
    const { data } = await createClient().from("dp_recipes").select("id, name, style_id, visibility, status, calc, updated_at, data->type, data->equipment, dp_recipe_versions(made_on), dp_brews(brewed_on)").eq("owner_id", userId).order("updated_at", { ascending: false });
    // when it was last brewed: its newest brew log, else its newest version's date (BeerSmith's brew date)
    setRows(((data || []) as unknown as (Row & { type?: string; equipment?: { batchGal?: number }; dp_recipe_versions?: { made_on: string }[]; dp_brews?: { brewed_on: string }[] })[]).map((r) => {
      const dates = [...(r.dp_recipe_versions || []).map((v) => v.made_on), ...(r.dp_brews || []).map((b) => b.brewed_on)].filter(Boolean).sort();
      return { ...r, versions: r.dp_recipe_versions?.length || 0, brewed: dates[dates.length - 1], data: { type: r.type, equipment: r.equipment } };
    }));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  // where each recipe is: the ones being worked on and dialed in show; retired ones wait under their own tab
  const [st, setSt] = useState<"active" | "dialed" | "retired" | "all">("active");
  // sorted by any column; newest brew first to start, remembered on this device
  const [sort, setSort] = useState<{ by: SortBy; desc: boolean }>({ by: "brewed", desc: true });
  useEffect(() => { try { const s = JSON.parse(localStorage.getItem("dp:recipes-sort") || "null"); if (s?.by) setSort(s); } catch { /* fine */ } }, []);
  const sortBy = (by: SortBy) => setSort((s) => { const n = { by, desc: s.by === by ? !s.desc : by === "brewed" || by === "og" || by === "ibu" || by === "abv" || by === "srm" }; try { localStorage.setItem("dp:recipes-sort", JSON.stringify(n)); } catch { /* fine */ } return n; });
  const shown = useMemo(() => {
    const list = (rows || []).filter((r) => (st === "all" || (st === "active" ? r.status !== "retired" : r.status === st)) && (!q || `${r.name} ${styleById(r.style_id || "")?.name || ""}`.toLowerCase().includes(q.toLowerCase())));
    const val = (r: Row): string | number => sort.by === "name" ? r.name.toLowerCase() : sort.by === "style" ? (styleById(r.style_id || "")?.name || "~").toLowerCase() : sort.by === "brewed" ? r.brewed || "" : Number(r.calc?.[sort.by]) || 0;
    return [...list].sort((a, b) => { const x = val(a), y = val(b); const c = x < y ? -1 : x > y ? 1 : 0; return sort.desc ? -c : c; });
  }, [rows, q, st, sort]);
  const th = (by: SortBy, label: string, num = false) => <th className={num ? "dp-num" : undefined} aria-sort={sort.by === by ? (sort.desc ? "descending" : "ascending") : "none"}><button type="button" className="dp-sortbtn" onClick={() => sortBy(by)}>{label}{sort.by === by ? (sort.desc ? " ↓" : " ↑") : ""}</button></th>;
  const sub = (r: Row) => [styleById(r.style_id || "")?.name || "No style", r.versions ? `v${r.versions}` : "", r.status === "dialed" ? "Dialed in" : r.status === "retired" ? "Retired" : "", r.visibility === "club" ? "shared" : ""].filter(Boolean).join(" · ");
  const copy = async (id: string) => {
    const sb = createClient();
    const { data } = await sb.from("dp_recipes").select("name, style_id, data, calc").eq("id", id).single();
    if (!data) return;
    const { data: made } = await sb.from("dp_recipes").insert({ owner_id: userId, name: `${data.name} (copy)`, style_id: data.style_id, data: { ...data.data, name: `${data.name} (copy)` }, calc: data.calc, copied_from: id }).select("id").single();
    if (made) router.push(`/draftpunk/r/${made.id}`);
  };
  const remove = async (r: Row) => {
    if (!confirm(`Delete "${r.name}"? Its brew logs stay.`)) return;
    await createClient().from("dp_recipes").delete().eq("id", r.id);
    load();
  };
  const [view, setView] = useState<"cards" | "list">("cards");
  // DraftPunk's own recipes, or the BeerSmith recipes as they were
  const [src, setSrc] = useState<"mine" | "beersmith">("mine");
  const [bsCount, setBsCount] = useState(0);
  useEffect(() => {
    try { const s = new URLSearchParams(window.location.search).get("tab") || localStorage.getItem("dp:recipes-src"); if (s === "beersmith" || s === "mine") setSrc(s); } catch { /* fine */ }
    createClient().from("dp_archive").select("id", { count: "exact", head: true }).eq("owner_id", userId).then(({ count }) => setBsCount(count || 0));
  }, [userId]);
  const pickSrc = (s: "mine" | "beersmith") => { setSrc(s); try { localStorage.setItem("dp:recipes-src", s); } catch { /* fine */ } };
  useEffect(() => { try { const v = localStorage.getItem("dp:recipes-view"); if (v === "list" || v === "cards") setView(v); } catch { /* fine */ } }, []);
  const pickView = (v: "cards" | "list") => { setView(v); try { localStorage.setItem("dp:recipes-view", v); } catch { /* fine */ } };
  return (
    <>
      <div className="dp-row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h1 className="dp-h1" style={{ margin: 0 }}>Recipes</h1>
        <div className="dp-row" style={{ alignItems: "center" }}>
          <Link href="/draftpunk/import" className="dp-btn">Import</Link>
          <Link href="/draftpunk/assistant" className="dp-btn">Ask the assistant</Link>
          <Link href="/draftpunk/r/new" className="dp-btn dp-go">+ New recipe</Link>
        </div>
      </div>
      <div className="dp-tabs" role="tablist" style={{ marginTop: 0 }}>
        <button role="tab" aria-selected={src === "mine"} className={src === "mine" ? "on" : ""} onClick={() => pickSrc("mine")}>My recipes{rows ? ` (${rows.length})` : ""}</button>
        <button role="tab" aria-selected={src === "beersmith"} className={src === "beersmith" ? "on" : ""} onClick={() => pickSrc("beersmith")}>From BeerSmith{bsCount ? ` (${bsCount})` : ""}</button>
      </div>
      {src === "beersmith" ? <BeerSmithList userId={userId} /> : <>
      <div className="dp-row" style={{ alignItems: "center", marginBottom: 16 }}>
        <input style={{ flex: "1 1 260px", maxWidth: 420 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or style" aria-label="Search recipes" />
        <span className="dp-seg" role="group" aria-label="Which recipes">{([["active", "Active"], ["dialed", "Dialed in"], ["retired", "Retired"], ["all", "All"]] as const).map(([k, l]) => <button key={k} className={st === k ? "on" : ""} onClick={() => setSt(k)}>{l}</button>)}</span>
        <span className="dp-seg"><button className={view === "cards" ? "on" : ""} onClick={() => pickView("cards")}>Cards</button><button className={view === "list" ? "on" : ""} onClick={() => pickView("list")}>List</button></span>
        {rows && <span className="dp-dim" style={{ fontSize: 13 }}>{shown.length} of {rows.length}</span>}
      </div>
      {!rows ? <p className="dp-dim">Loading…</p> : !rows.length ? (
        <section className="dp-card dp-empty">
          <h2 className="dp-card-t">No recipes yet</h2>
          <p className="dp-dim">Start one from scratch, or bring your BeerSmith recipes over.</p>
          <div className="dp-row"><Link href="/draftpunk/r/new" className="dp-btn dp-go">+ New recipe</Link><Link href="/draftpunk/import" className="dp-btn">Import from BeerSmith</Link></div>
        </section>
      ) : view === "cards" ? (
        <div className="dp-cards">
          {shown.map((r) => (
            <article key={r.id} className="dp-card dp-rcard" style={{ ["--dp-beer" as string]: r.calc?.color || "#e58500" }} onClick={() => router.push(`/draftpunk/r/${r.id}`)}>
              <div className="dp-glass dp-glass-sm" aria-hidden="true"><i /></div>
              <div style={{ minWidth: 0 }}>
                <h3>{r.name}</h3>
                <div className="dp-dim" style={{ fontSize: 13 }}>{sub(r)}</div>
                <div className="dp-rnums">
                  <span><b>{r.calc?.og?.toFixed(3) || "–"}</b>OG</span>
                  <span><b>{r.calc?.ibu ?? "–"}</b>IBU</span>
                  <span><b>{r.calc?.abv != null ? `${r.calc.abv}%` : "–"}</b>ABV</span>
                  <span><b>{r.calc?.srm ?? "–"}</b>SRM</span>
                </div>
              </div>
              <div className="dp-rfoot" onClick={(e) => e.stopPropagation()}>
                <span className="dp-dim">{r.brewed ? `Brewed ${fmtDate(r.brewed)}` : ""}</span>
                <span><button className="dp-btn dp-sm dp-x" onClick={() => copy(r.id)}>Copy</button><button className="dp-btn dp-sm dp-x" onClick={() => remove(r)}>Delete</button></span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="dp-card">
          <table className="dp-tbl" data-nofit>
            <thead><tr>{th("name", "Name")}{th("style", "Style")}{th("og", "OG", true)}{th("ibu", "IBU", true)}{th("abv", "ABV", true)}{th("srm", "SRM", true)}{th("brewed", "Brewed")}<th /></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="dp-pick" onClick={() => router.push(`/draftpunk/r/${r.id}`)}>
                  <td><b>{r.name}</b>{(r.versions || r.status !== "developing") && <span className="dp-dim"> · {[r.versions ? `v${r.versions}` : "", r.status === "dialed" ? "dialed in" : r.status === "retired" ? "retired" : ""].filter(Boolean).join(" · ")}</span>}{r.visibility === "club" && <span className="dp-dim"> · shared</span>}</td>
                  <td>{styleById(r.style_id || "")?.name || <span className="dp-dim">–</span>}</td>
                  <td className="dp-num">{r.calc?.og?.toFixed(3) || "–"}</td>
                  <td className="dp-num">{r.calc?.ibu ?? "–"}</td>
                  <td className="dp-num">{r.calc?.abv != null ? `${r.calc.abv}%` : "–"}</td>
                  <td className="dp-num">{r.calc?.srm ?? "–"}<span className="dp-swatch" style={{ background: r.calc?.color || "transparent" }} /></td>
                  <td>{r.brewed ? fmtDate(r.brewed) : <span className="dp-dim">–</span>}</td>
                  <td className="dp-num" onClick={(e) => e.stopPropagation()}><button className="dp-btn dp-sm dp-x" onClick={() => copy(r.id)}>Copy</button><button className="dp-btn dp-sm dp-x" onClick={() => remove(r)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>}
    </>
  );
}
