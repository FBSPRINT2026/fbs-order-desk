"use client";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { STATES, serviceName, serviceRank } from "@/lib/transit";
import { money } from "@/lib/format";
import { decodeArcs, polygons, pathD, centroid, FIPS, GEO_URL, MAP_W, MAP_H, type Topo } from "@/lib/usmap";
import type { TransitBox } from "@/lib/pricing";

/**
 * Transit time map, like the UPS map: the real US, every county shaded by how many business days UPS or FedEx takes
 * from our shop to its 3-digit ZIP area (so west Texas can be a day slower than Dallas). Darker = more days; point at
 * an area for the days and the price; the legend and list give the same numbers without relying on color.
 * Built from EasyPost rates for one box (size, weight and from ZIP shown and editable; nothing is bought).
 */
type Area = { zip3: string; st: string; zip: string; city: string; x: number; y: number };
type Row = { zip3: string; days: number | null; cost: number | null; sig: string; updated_at: string };
type Legacy = { state: string; carrier: string; service: string; days: number | null; cost: number | null; updated_at: string; from_zip: string };
type Data = { ready: boolean; box: TransitBox; fromZip: string; sig: string; carrier: string; service: string; areas: Area[]; services: { carrier: string; service: string }[]; rows: Row[]; legacy: Legacy[]; priced: number; total: number };
type Detail = { carrier: string; service: string; days: number | null; cost: number | null; zip: string };
type County = { id: string; st: string; d: string; cx: number; cy: number };
type Geo = { counties: County[]; states: { st: string; d: string; cx: number; cy: number; area: number }[] };
type Val = { days: number | null; cost: number | null; src: "area" | "near" | "state" | "none" };

let geoP: Promise<Geo | null> | null = null;
function loadGeo() {
  geoP ||= fetch("/api/shipping/geo").then((r) => (r.ok ? r.json() : fetch(GEO_URL).then((x) => x.json()))).then((t: Topo) => {
    const arcs = decodeArcs(t);
    const counties: County[] = [];
    for (const g of t.objects.counties.geometries) {
      const id = String(g.id).padStart(5, "0"), st = FIPS[id.slice(0, 2)];
      if (!st) continue;
      const ps = polygons(arcs, g), c = centroid(ps);
      counties.push({ id, st, d: pathD(ps), cx: c.x, cy: c.y });
    }
    const states = t.objects.states.geometries.map((g) => { const st = FIPS[String(g.id).padStart(2, "0")]; const ps = polygons(arcs, g); const c = centroid(ps); return st ? { st, d: pathD(ps), cx: c.x, cy: c.y, area: c.area } : null; }).filter(Boolean) as Geo["states"];
    return { counties, states };
  }).catch(() => { geoP = null; return null; });
  return geoP;
}

const shade = (d: number | null | undefined) => (d == null ? "na" : "d" + Math.min(5, Math.max(1, d)));
const ago = (t: string | null) => { if (!t) return ""; const d = Math.round((Date.now() - Date.parse(t)) / 86400000); return d < 1 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; };
const SMALL = new Set(["RI", "DE", "DC", "CT", "NJ", "MA", "NH", "VT", "MD", "HI"]);
const post = (body: unknown) => fetch("/api/shipping/transit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** The county layer only re-renders when the colors change (3,000+ shapes). */
const Counties = memo(function Counties({ counties, cls }: { counties: County[]; cls: string[] }) {
  return <g className="tm-cty">{counties.map((c, i) => <path key={c.id} d={c.d} data-i={i} className={"tmc-" + (cls[i] || "na")} />)}</g>;
});

export default function TransitMap({ compact = false }: { compact?: boolean }) {
  const [geo, setGeo] = useState<Geo | null | undefined>(undefined);
  const [d, setD] = useState<Data | null>(null);
  const [carrier, setCarrier] = useState<"UPS" | "FedEx">("UPS");
  const [service, setService] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  const [pin, setPin] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail[] | null>(null);
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const [list, setList] = useState(false);
  const [box, setBox] = useState<TransitBox | null>(null);

  useEffect(() => { loadGeo().then(setGeo); }, []);
  const load = useCallback(async () => {
    const q = new URLSearchParams({ carrier }); if (service) q.set("service", service);
    const r = await fetch("/api/shipping/transit?" + q, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error || "Couldn't load the map."); return null; }
    setD(j); setBox((b) => b || j.box);
    return j as Data;
  }, [carrier, service]);
  useEffect(() => { load(); }, [load]);

  // which 3-digit ZIP area each county belongs to: the nearest area center in the same state
  const areas = useMemo(() => d?.areas || [], [d?.areas]);
  const countyArea = useMemo(() => {
    if (!geo || !areas.length) return [] as (Area | null)[];
    const by: Record<string, Area[]> = {};
    for (const a of areas) (by[a.st] ||= []).push(a);
    return geo.counties.map((c) => { let best: Area | null = null, bd = Infinity; for (const a of by[c.st] || []) { const k = (a.x - c.cx) ** 2 + (a.y - c.cy) ** 2; if (k < bd) { bd = k; best = a; } } return best; });
  }, [geo, areas]);

  // days per area for the chosen service (priced for the current box), with fallbacks while it's still filling in
  const svc = d?.service || "";
  const sig = d?.sig || "";
  const rowBy = useMemo(() => new Map((d?.rows || []).map((r) => [r.zip3, r])), [d?.rows]);
  const legacyBy = useMemo(() => new Map((d?.legacy || []).filter((r) => r.carrier === carrier && r.service === svc).map((r) => [r.state, r])), [d?.legacy, carrier, svc]);
  const value = useMemo<Val[]>(() => {
    if (!geo) return [];
    const cur = (r?: Row) => !!r && r.sig === sig && r.days != null;
    const pricedBy: Record<string, Area[]> = {};
    for (const a of areas) if (cur(rowBy.get(a.zip3))) (pricedBy[a.st] ||= []).push(a);
    return geo.counties.map((c, i) => {
      const a = countyArea[i]; const r = a ? rowBy.get(a.zip3) : undefined;
      if (r && cur(r)) return { days: r.days, cost: r.cost, src: "area" };
      let best: Area | null = null, bd = Infinity;
      for (const p of pricedBy[c.st] || []) { const k = (p.x - c.cx) ** 2 + (p.y - c.cy) ** 2; if (k < bd) { bd = k; best = p; } }
      if (best) { const rr = rowBy.get(best.zip3)!; return { days: rr.days, cost: rr.cost, src: "near" }; }
      if (r && r.days != null) return { days: r.days, cost: r.cost, src: "near" };
      const l = legacyBy.get(c.st);
      return l && l.days != null ? { days: l.days, cost: l.cost, src: "state" } : { days: null, cost: null, src: "none" };
    });
  }, [geo, countyArea, rowBy, legacyBy, areas, sig]);
  const cls = useMemo(() => value.map((v) => shade(v.days)), [value]);

  const services = useMemo(() => [...new Set((d?.services || []).filter((x) => x.carrier === carrier).map((x) => x.service))].sort((a, b) => serviceRank(a) - serviceRank(b) || a.localeCompare(b)), [d?.services, carrier]);
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const a of areas) { const r = rowBy.get(a.zip3); if (r?.days != null && r.sig === sig) { const k = String(Math.min(5, r.days)); c[k] = (c[k] || 0) + 1; } } return c; }, [areas, rowBy, sig]);
  const origin = useMemo(() => areas.find((a) => a.zip3 === (d?.fromZip || "").slice(0, 3)), [areas, d?.fromZip]);
  const updated = (d?.rows || []).reduce((m, r) => (r.sig === sig && r.updated_at > m ? r.updated_at : m), "");

  const focus = pin ?? hover;
  const fArea = focus != null ? countyArea[focus] || null : null;
  const fVal = focus != null ? value[focus] || null : null;
  const areaPath = useMemo(() => (geo && fArea ? geo.counties.filter((_, i) => countyArea[i]?.zip3 === fArea.zip3).map((c) => c.d).join("") : ""), [geo, fArea, countyArea]);
  const pinZip3 = pin != null ? countyArea[pin]?.zip3 : undefined;
  useEffect(() => {
    setDetail(null);
    if (!pinZip3) return;
    fetch("/api/shipping/transit?zip3=" + pinZip3).then((r) => r.json()).then((j) => setDetail(((j.rows || []) as Detail[]).filter((r) => r.days != null).sort((a, b) => (a.carrier === carrier ? -1 : 1) - (b.carrier === carrier ? -1 : 1) || serviceRank(a.service) - serviceRank(b.service)))).catch(() => {});
  }, [pinZip3, carrier]);

  async function build() {
    setErr("");
    let cur = d;
    for (let guard = 0; guard < 40; guard++) {
      setBusy(`Pricing ZIP areas… ${cur ? Math.min(cur.total, cur.priced) : 0} of ${cur?.total || "~900"}`);
      const r = await post({ action: "build" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error || "Couldn't price the map."); break; }
      cur = (await load()) || cur;
      if (!j.priced && j.failedCount) { setErr(`EasyPost didn't answer for ${j.failedCount} areas: ${j.failed?.[0]?.error || ""}`); break; }
      if (!j.left || !j.priced) break;
    }
    setBusy("");
  }
  async function saveBox() {
    if (!box) return;
    setErr("");
    const r = await post({ action: "box", box });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error || "Couldn't save."); return; }
    setBox(j.box); await load();
    await build();
  }

  const boxChanged = !!(box && d && (box.length !== d.box.length || box.width !== d.box.width || box.height !== d.box.height || box.weightLb !== d.box.weightLb || (box.fromZip || "") !== (d.box.fromZip || "")));
  const left = d ? Math.max(0, d.total ? d.total - d.priced : 1) : 0;
  const boxTxt = d ? `${d.box.length}×${d.box.width}×${d.box.height} in, ${d.box.weightLb} lb` : "";

  if (geo === undefined || !d) return <div className="db-empty">{err || "Loading the transit map…"}</div>;

  const map = geo ? (
    <svg className={"tm-svg" + (compact ? " sm" : "")} viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label={`${carrier} ${serviceName(carrier, svc)} business days across the US`}
      onMouseMove={(e) => { if (compact) return; const i = (e.target as Element).getAttribute("data-i"); setHover(i != null ? +i : null); }} onMouseLeave={() => setHover(null)}
      onClick={(e) => { if (compact) return; const i = (e.target as Element).getAttribute("data-i"); setPin(i != null && +i !== pin ? +i : null); }}>
      <Counties counties={geo.counties} cls={cls} />
      <g className="tm-st">{geo.states.map((s) => <path key={s.st} d={s.d} />)}</g>
      {areaPath && <path className="tm-hl" d={areaPath} />}
      {!compact && <g className="tm-lbl">{geo.states.filter((s) => !SMALL.has(s.st) && s.area > 900).map((s) => <text key={s.st} x={s.cx} y={s.cy}>{s.st}</text>)}</g>}
      {origin && <g className="tm-origin" transform={`translate(${origin.x},${origin.y})`}><circle r={compact ? 8 : 6} />{!compact && <text y={-10}>FBS</text>}</g>}
    </svg>
  ) : <div className="pv-err">The map shapes didn&apos;t load. The list still works.</div>;

  return (
    <div className={"tm" + (compact ? " tm-compact" : "")}>
      <div className="tm-bar">
        <div className="rv-seg" role="group" aria-label="Carrier">
          {(["UPS", "FedEx"] as const).map((c) => <button key={c} type="button" className={carrier === c ? "on" : ""} onClick={() => { setCarrier(c); setService(""); setPin(null); }}>{c}</button>)}
        </div>
        {!compact && services.length > 0 && (
          <select value={svc} onChange={(e) => setService(e.target.value)} aria-label="Service">
            {services.map((s) => <option key={s} value={s}>{serviceName(carrier, s)}</option>)}
          </select>
        )}
        {compact && <span className="faint tm-svc">{svc ? serviceName(carrier, svc) : ""}</span>}
        <span className="spacer" />
        {!compact && <button type="button" className="linkbtn" onClick={() => setList((x) => !x)}>{list ? "Show map" : "Show as list"}</button>}
      </div>

      {!compact && box && (
        <div className="tm-box">
          <div className="tm-box-h"><b>What the map is priced on</b><span className="faint">One box, our cost (no markup). Change it and re-price.</span></div>
          <div className="tm-box-f">
            <label><span>Length</span><input type="number" min={1} value={box.length} onChange={(e) => setBox({ ...box, length: +e.target.value })} /><em>in</em></label>
            <label><span>Width</span><input type="number" min={1} value={box.width} onChange={(e) => setBox({ ...box, width: +e.target.value })} /><em>in</em></label>
            <label><span>Height</span><input type="number" min={1} value={box.height} onChange={(e) => setBox({ ...box, height: +e.target.value })} /><em>in</em></label>
            <label><span>Weight</span><input type="number" min={0.1} step={0.5} value={box.weightLb} onChange={(e) => setBox({ ...box, weightLb: +e.target.value })} /><em>lb</em></label>
            <label className="zip"><span>Ship from ZIP</span><input type="text" inputMode="numeric" maxLength={5} placeholder={`${d.fromZip} shop`} value={box.fromZip} onChange={(e) => setBox({ ...box, fromZip: e.target.value.replace(/\D/g, "") })} /></label>
            <div className="tm-box-a">
              {boxChanged ? (<><button type="button" className="btn sm primary" onClick={saveBox}>Save &amp; Re-price</button><button type="button" className="btn sm ghost" onClick={() => setBox(d.box)}>Cancel</button></>)
                : left > 0 ? <button type="button" className="btn sm primary" disabled={!!busy || !d.ready} onClick={build}>{busy || (d.priced ? `Price the other ${left} ZIP areas` : "Price the map")}</button>
                : <span className="tm-ok">✓ All {d.total} ZIP areas priced{updated ? ` ${ago(updated)}` : ""}</span>}
            </div>
          </div>
        </div>
      )}
      {!compact && !d.ready && <div className="pv-err">EasyPost isn&apos;t connected, so the map can&apos;t be priced yet.</div>}
      {!compact && d.priced > 0 && left > 0 && !busy && <div className="faint tm-note">{d.priced} of {d.total} ZIP areas priced for this box. Areas not priced yet show their nearest priced neighbor. Pricing the rest takes a few minutes.</div>}
      {!compact && boxChanged && <div className="faint tm-note">Saving re-prices the whole map for the new box (a few minutes; nothing is bought).</div>}

      {list ? (
        <div className="tm-list"><table className="rv-tbl">
          <thead><tr><th>State</th><th className="r">Business days</th><th className="r">Cost ({boxTxt})</th><th className="r">ZIP areas</th></tr></thead>
          <tbody>{STATES.slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) => {
            const rs = areas.filter((a) => a.st === s.st).map((a) => rowBy.get(a.zip3)).filter((r): r is Row => !!r && r.days != null && r.sig === sig);
            const l = legacyBy.get(s.st);
            const ds = rs.map((r) => r.days!), cs = rs.map((r) => r.cost ?? 0);
            const dTxt = ds.length ? (Math.min(...ds) === Math.max(...ds) ? String(ds[0]) : `${Math.min(...ds)}–${Math.max(...ds)}`) : l?.days != null ? `${l.days}*` : "—";
            const cTxt = cs.length ? (Math.min(...cs) === Math.max(...cs) ? money(cs[0]) : `${money(Math.min(...cs))}–${money(Math.max(...cs))}`) : l?.cost != null ? `${money(l.cost)}*` : "—";
            return <tr key={s.st}><td><b>{s.name}</b></td><td className="r">{dTxt}</td><td className="r">{cTxt}</td><td className="r faint">{rs.length || ""}</td></tr>;
          })}</tbody>
        </table>{d.legacy.length > 0 && <div className="faint tm-note">* one main city only (older pricing). Price the ZIP areas for the full picture.</div>}</div>
      ) : map}

      <div className="tm-legend" aria-label="Business days">
        {[1, 2, 3, 4, 5].map((n) => <span key={n}><i className={"tm-d" + n} />{n === 5 ? "5+" : n} day{n === 1 ? "" : "s"}{!compact && counts[n] ? <em> · {counts[n]} area{counts[n] === 1 ? "" : "s"}</em> : null}</span>)}
        {origin && <span><i className="tm-o" />Our shop</span>}
      </div>

      {!compact && (
        <div className="tm-detail">
          {fArea && fVal ? (
            <>
              <div className="tm-dh"><b>{fArea.city}, {fArea.st} area</b><span className="faint">ZIPs {fArea.zip3}xx · priced to {fArea.zip}{d.fromZip ? ` from ${d.fromZip}` : ""}</span></div>
              <div className="tm-big"><b>{fVal.days != null ? `${fVal.days} business day${fVal.days === 1 ? "" : "s"}` : "No rate"}</b>{fVal.cost != null && <span> · {money(fVal.cost)}</span>}<span className="faint"> · {carrier} {serviceName(carrier, svc)}{fVal.src === "near" ? " · nearest priced area" : fVal.src === "state" ? " · state's main city (older pricing)" : ""}</span></div>
              {pin != null && detail && <ul>{detail.slice(0, 12).map((r) => (
                <li key={r.carrier + r.service} className={r.carrier === carrier && r.service === svc ? "cur" : ""}><span><b>{r.carrier}</b> {serviceName(r.carrier, r.service)}</span><span>{r.days} day{r.days === 1 ? "" : "s"}</span><span className="num">{r.cost != null ? money(r.cost) : ""}</span></li>
              ))}</ul>}
              {pin == null && <span className="faint">Click to pin this area and compare every UPS and FedEx service.</span>}
            </>
          ) : <span className="faint">Point at any area for its business days and price. Click to pin it and compare every service.</span>}
        </div>
      )}
      <div className="faint tm-foot">From {d.fromZip || "our ZIP"} · {boxTxt} box · business days by 3-digit ZIP area{updated ? ` · updated ${ago(updated)}` : ""}</div>
      {err && <div className="pv-err">{err}</div>}
    </div>
  );
}
