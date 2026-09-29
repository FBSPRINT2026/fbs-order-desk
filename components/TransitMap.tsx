"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { STATES, serviceName, serviceRank, type TransitRow } from "@/lib/transit";
import { money } from "@/lib/format";

/**
 * Transit time map: business days from our ZIP to the main city of every state, UPS or FedEx, by service.
 * One tile per state on a US-shaped grid, darker = more days (the number is on every tile, so it never relies on color).
 * Built from EasyPost rates (nothing is bought); "Refresh" re-prices it (about weekly is plenty).
 */
const COLS = 11, ROWS = 8;
const shade = (d: number | null) => (d == null ? "tm-na" : "tm-d" + Math.min(5, Math.max(1, d)));
const ago = (t: string | null) => { if (!t) return ""; const d = Math.round((Date.now() - Date.parse(t)) / 86400000); return d < 1 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; };

export default function TransitMap({ compact = false }: { compact?: boolean }) {
  const [rows, setRows] = useState<TransitRow[] | null>(null);
  const [carrier, setCarrier] = useState<"UPS" | "FedEx">("UPS");
  const [service, setService] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const [list, setList] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/shipping/transit", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error || "Couldn't load the map."); setRows([]); return; }
    setRows(j.rows || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function refresh() {
    setErr(""); let left: string[] | null = null, n = 0;
    do {
      setBusy(n ? `Pricing… ${STATES.length - (left?.length || 0)} of ${STATES.length} states` : "Pricing every state…");
      const r = await fetch("/api/shipping/transit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(left ? { states: left } : {}) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error || "Couldn't price the states."); break; }
      if (j.failed?.length && !j.done?.length) { setErr(`EasyPost didn't answer for ${j.failed.length} states: ${j.failed[0].error}`); break; }
      left = j.left || []; n++;
    } while (left && left.length && n < 6);
    setBusy(""); load();
  }

  const services = useMemo(() => {
    const s = [...new Set((rows || []).filter((r) => r.carrier === carrier && r.days != null).map((r) => r.service))];
    return s.sort((a, b) => serviceRank(a) - serviceRank(b) || a.localeCompare(b));
  }, [rows, carrier]);
  const svc = services.includes(service) ? service : services[0] || "";
  const byState = useMemo(() => new Map((rows || []).filter((r) => r.carrier === carrier && r.service === svc).map((r) => [r.state, r])), [rows, carrier, svc]);
  const updated = (rows || []).reduce((m, r) => (r.updated_at > m ? r.updated_at : m), "");
  const fromZip = rows?.[0]?.from_zip || "";
  const sel = pick ? STATES.find((s) => s.st === pick) : null;
  const selAll = pick ? (rows || []).filter((r) => r.state === pick && r.days != null).sort((a, b) => (a.carrier === carrier ? -1 : 1) - (b.carrier === carrier ? -1 : 1) || serviceRank(a.service) - serviceRank(b.service)) : [];
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const r of byState.values()) if (r.days != null) { const k = String(Math.min(5, r.days)); c[k] = (c[k] || 0) + 1; } return c; }, [byState]);

  if (rows === null) return <div className="db-empty">Loading the transit map…</div>;
  if (!rows.length) return (
    <div className="tm-empty">
      <p>See how many business days UPS and FedEx take from our shop to every state, and what a standard box costs.</p>
      {err && <div className="pv-err">{err}</div>}
      <button type="button" className="btn primary" disabled={!!busy} onClick={refresh}>{busy || "Build the transit map"}</button>
      <small className="faint">Prices one 12×10×8 box, 10 lb, to a main city in each state. Nothing is bought.</small>
    </div>
  );

  return (
    <div className={"tm" + (compact ? " tm-compact" : "")}>
      <div className="tm-bar">
        <div className="rv-seg" role="group" aria-label="Carrier">
          {(["UPS", "FedEx"] as const).map((c) => <button key={c} type="button" className={carrier === c ? "on" : ""} onClick={() => { setCarrier(c); setService(""); }}>{c}</button>)}
        </div>
        {!compact && services.length > 1 && (
          <select value={svc} onChange={(e) => setService(e.target.value)} aria-label="Service">
            {services.map((s) => <option key={s} value={s}>{serviceName(carrier, s)}</option>)}
          </select>
        )}
        {compact && <span className="faint tm-svc">{svc ? serviceName(carrier, svc) : ""}</span>}
        <span className="spacer" />
        {!compact && <button type="button" className="linkbtn" onClick={() => setList((x) => !x)}>{list ? "Show map" : "Show as list"}</button>}
        {!compact && <button type="button" className="btn sm" disabled={!!busy} onClick={refresh}>{busy || "Refresh"}</button>}
      </div>

      {list ? (
        <div className="tm-list"><table className="rv-tbl">
          <thead><tr><th>State</th><th>To</th><th className="r">Business days</th><th className="r">Standard box</th></tr></thead>
          <tbody>{STATES.slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) => { const r = byState.get(s.st); return (
            <tr key={s.st}><td><b>{s.name}</b></td><td className="faint">{s.city} {s.zip}</td><td className="r">{r?.days ?? "—"}</td><td className="r">{r?.cost != null ? money(r.cost) : "—"}</td></tr>
          ); })}</tbody>
        </table></div>
      ) : (
        <div className="tm-map" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${ROWS}, auto)` }} role="img" aria-label={`${carrier} ${serviceName(carrier, svc)} business days by state`}>
          {STATES.map((s) => { const r = byState.get(s.st); return (
            <button key={s.st} type="button" className={"tm-t " + shade(r?.days ?? null) + (pick === s.st ? " on" : "")} style={{ gridColumn: s.col + 1, gridRow: s.row + 1 }}
              onClick={() => setPick(pick === s.st ? null : s.st)} onMouseEnter={() => !compact && setPick(s.st)}
              title={`${s.name} (${s.city} ${s.zip}): ${r?.days != null ? `${r.days} business day${r.days === 1 ? "" : "s"}` : "no rate"}${r?.cost != null ? ` · ${money(r.cost)}` : ""}`}>
              <b>{s.st}</b><span>{r?.days ?? "–"}</span>
            </button>
          ); })}
        </div>
      )}

      <div className="tm-legend" aria-label="Business days">
        {[1, 2, 3, 4, 5].map((d) => <span key={d}><i className={"tm-d" + d} />{d === 5 ? "5+" : d} day{d === 1 ? "" : "s"}{counts[d] ? <em> · {counts[d]}</em> : null}</span>)}
      </div>

      {!compact && (
        <div className="tm-detail">
          {sel ? (
            <>
              <div className="tm-dh"><b>{sel.name}</b><span className="faint">to {sel.city} {sel.zip}{fromZip ? ` from ${fromZip}` : ""}</span></div>
              <ul>{selAll.slice(0, 10).map((r) => (
                <li key={r.carrier + r.service} className={r.carrier === carrier && r.service === svc ? "cur" : ""}>
                  <span><b>{r.carrier}</b> {serviceName(r.carrier, r.service)}</span><span>{r.days} day{r.days === 1 ? "" : "s"}</span><span className="num">{r.cost != null ? money(r.cost) : ""}</span>
                </li>
              ))}</ul>
            </>
          ) : <span className="faint">Point at a state (or tap it) to see every service and price. Prices are our cost for one 12×10×8 box at 10 lb.</span>}
        </div>
      )}
      <div className="faint tm-foot">From {fromZip || "our ZIP"} · business days to each state&apos;s main city · updated {ago(updated)}{err ? ` · ${err}` : ""}</div>
    </div>
  );
}
