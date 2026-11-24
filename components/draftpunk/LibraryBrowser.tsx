"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { readAll } from "@/lib/readAll";
import { r1 } from "@/lib/draftpunk/calc";
import { F, Win } from "./ui";

type Kind = "fermentable" | "hop" | "yeast" | "misc" | "water";
type Row = { id: string; name: string; supplier?: string; origin?: string; lab?: string; code?: string; color?: number; potential?: number; diastaticPower?: number; alpha?: number; beta?: number; form?: string; type?: string; use?: string; attenuation?: number; tempLow?: number; tempHigh?: number; ca?: number; so4?: number; cl?: number };
const KINDS: [Kind, string][] = [["fermentable", "Malts & sugars"], ["hop", "Hops"], ["yeast", "Yeast"], ["misc", "Misc"], ["water", "Water"]];
/** who makes it: a malt's maltster, a yeast's lab, a hop's country */
const brandOf = (k: Kind, r: Row) => (k === "fermentable" ? r.supplier || r.origin : k === "yeast" ? r.lab : k === "hop" ? r.origin : "") || "";
const cache: Partial<Record<Kind, Row[]>> = {};

/**
 * The club's ingredient library (BeerSmith's lists and add-ons, brought in on Import; Nick, Nov 24 2026: "how come I
 * don't see the brands… Ireks malts?"): every malt, hop, yeast by its maker, filtered by brand and searched, and put on
 * the shelf with one tap.
 */
export default function LibraryBrowser({ onAdd }: { onAdd: (kind: Exclude<Kind, "water">, name: string, data: Record<string, unknown>) => void }) {
  const [kind, setKind] = useState<Kind>("fermentable");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [brand, setBrand] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    setBrand(""); setRows(cache[kind] || null);
    if (cache[kind]) return;
    readAll<Row>((a, b) => createClient().from("dp_ingredients")
      .select("id, name, supplier:data->>supplier, origin:data->>origin, lab:data->>lab, code:data->>code, color:data->color, potential:data->potential, diastaticPower:data->diastaticPower, alpha:data->alpha, beta:data->beta, form:data->>form, type:data->>type, use:data->>use, attenuation:data->attenuation, tempLow:data->tempLow, tempHigh:data->tempHigh, ca:data->ca, so4:data->so4, cl:data->cl")
      .is("owner_id", null).eq("kind", kind).order("name").order("id").range(a, b)).then((r) => { cache[kind] = r; setRows(r); }).catch(() => setRows([]));
  }, [kind]);
  const brands = useMemo(() => { const m = new Map<string, number>(); for (const r of rows || []) { const b = brandOf(kind, r); if (b) m.set(b, (m.get(b) || 0) + 1); } return [...m].sort((a, b) => a[0].localeCompare(b[0])); }, [rows, kind]);
  const shown = useMemo(() => {
    const w = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (rows || []).filter((r) => (!brand || brandOf(kind, r) === brand) && w.every((x) => `${r.name} ${brandOf(kind, r)} ${r.code || ""} ${r.type || ""}`.toLowerCase().includes(x)));
  }, [rows, brand, q, kind]);
  const add = async (r: Row) => {
    const { data } = await createClient().from("dp_ingredients").select("name, data").eq("id", r.id).maybeSingle();
    if (data && kind !== "water") onAdd(kind, data.name as string, { ...(data.data as Record<string, unknown>), notes: undefined });
  };
  const cols = (r: Row): string[] => kind === "fermentable" ? [`${r1(Number(r.color) || 0, 1)}°L`, r.potential ? `${r1((Number(r.potential) - 1) * 1000, 0)} ppg` : "", r.diastaticPower ? `${r.diastaticPower}°Lintner` : ""]
    : kind === "hop" ? [`${r.alpha ?? "–"}% AA`, r.beta ? `${r.beta}% beta` : "", r.use || ""]
    : kind === "yeast" ? [r.attenuation ? `${r1(Number(r.attenuation), 0)}% att.` : "", r.tempLow ? `${r.tempLow}–${r.tempHigh}°F` : "", r.form || ""]
    : kind === "water" ? [`Ca ${r.ca ?? "–"}`, `SO₄ ${r.so4 ?? "–"}`, `Cl ${r.cl ?? "–"}`] : [r.type || "", r.use || ""];
  return (
    <Win title="Library" note={rows ? `${shown.length.toLocaleString()} of ${rows.length.toLocaleString()}` : "loading…"}>
      <div className="dp-row" style={{ marginBottom: 10 }}>
        <span className="dp-seg" role="group" aria-label="Kind">{KINDS.map(([k, l]) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{l}</button>)}</span>
      </div>
      <div className="dp-row" style={{ marginBottom: 10 }}>
        {brands.length > 1 && (
          <F label={kind === "fermentable" ? "Maltster" : kind === "yeast" ? "Lab" : kind === "hop" ? "Country" : "Brand"} grow="1 1 200px">
            <select value={brand} onChange={(e) => setBrand(e.target.value)}><option value="">All ({(rows || []).length.toLocaleString()})</option>{brands.map(([b, n]) => <option key={b} value={b}>{b} ({n})</option>)}</select>
          </F>
        )}
        <F label="Search" grow="2 1 220px"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, code or type" /></F>
      </div>
      {!rows ? <p className="dp-dim">Loading…</p> : !rows.length ? <p className="dp-dim">Nothing here yet: bring BeerSmith&apos;s ingredient lists in on Import.</p> : (
        <table className="dp-tbl">
          <thead><tr><th>Name</th><th>Numbers</th>{kind !== "water" && <th />}</tr></thead>
          <tbody>
            {shown.slice(0, 300).map((r) => (
              <tr key={r.id}>
                <td><div className="dp-namecell">{kind === "yeast" && r.code ? `${r.code} ` : ""}{r.name}<span className="dp-sub">{[brandOf(kind, r), kind === "fermentable" && r.supplier ? r.origin : "", r.type].filter(Boolean).join(" · ")}</span></div></td>
                <td className="dp-dim">{cols(r).filter(Boolean).join(" · ")}</td>
                {kind !== "water" && <td className="dp-num"><button className="dp-btn dp-sm" onClick={() => add(r)}>+ Shelf</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {shown.length > 300 && <p className="dp-dim">Showing 300; pick a {kind === "fermentable" ? "maltster" : "brand"} or search to see the rest.</p>}
    </Win>
  );
}
