"use client";
import { useEffect, useRef, useState } from "react";

type Summary = {
  orders: number; customers: number; measured: number; errors: number;
  avg_bytes: number | null; median_bytes: number | null; avg_files: number | null; no_files: number; largest: number | null; over_45mb: number;
  estimate_bytes: number | null; margin_bytes: number | null;
  years: { year: number | null; orders: number; measured: number; avg_bytes: number | null }[] | null;
};

const size = (b: number | null | undefined) => {
  if (!b) return "0";
  const u = ["bytes", "KB", "MB", "GB", "TB"]; let i = 0, x = b;
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
  return `${x >= 100 || i === 0 ? Math.round(x) : x.toFixed(1)} ${u[i]}`;
};

async function call<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j as T;
}

const SAMPLE = 400;

/**
 * Before importing everything: count every Printavo order and measure the files on a random sample of them,
 * to estimate the storage a full import needs. Reads sizes only; nothing is downloaded or copied.
 */
export default function PrintavoCensus() {
  const [s, setS] = useState<Summary | null>(null);
  const [phase, setPhase] = useState<"" | "list" | "measure">("");
  const [note, setNote] = useState(""), [err, setErr] = useState("");
  const [listed, setListed] = useState(0), [total, setTotal] = useState<number | null>(null);
  const stop = useRef(false);
  const refresh = async () => { try { setS((await call<{ summary: Summary }>("/api/printavo/census")).summary); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  useEffect(() => { refresh(); }, []);

  async function run(listFirst: boolean) {
    stop.current = false; setErr("");
    try {
      if (listFirst) {
        setPhase("list"); setListed(0);
        let after: string | null = null, n = 0;
        do {
          const r: { after: string | null; listed: number; totalNodes: number | null } = await call("/api/printavo/census", { step: "list", after });
          n += r.listed; setListed(n); if (r.totalNodes) setTotal(r.totalNodes);
          after = r.after;
        } while (after && !stop.current);
        await refresh();
      }
      setPhase("measure");
      for (let pass = 0; pass < 200 && !stop.current; pass++) {
        const r = await call<{ measured: number }>("/api/printavo/census", { step: "measure" });
        const cur = (await call<{ summary: Summary }>("/api/printavo/census")).summary; setS(cur);
        if (!r.measured || (cur.measured + cur.errors) >= Math.min(SAMPLE, cur.orders)) break;
      }
      setNote(stop.current ? "Stopped. Start again any time; it picks up where it left off." : "Done.");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setPhase(""); refresh();
  }

  const done = (s?.measured || 0) + (s?.errors || 0);
  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <div className="panel-h"><h2>How big is a full import?</h2>
        {phase ? <button className="btn" type="button" onClick={() => { stop.current = true; }}>Stop</button>
          : <div className="row" style={{ gap: 8 }}>
            {!!s?.orders && <button className="btn" type="button" onClick={() => run(false)}>Measure more</button>}
            <button className="btn primary" type="button" onClick={() => run(true)}>{s?.orders ? "Count again" : "Count & measure"}</button>
          </div>}
      </div>
      <div className="panel-b stack" style={{ gap: 10 }}>
        <p className="faint" style={{ margin: 0, fontSize: 13.5 }}>
          Counts every order in Printavo, then checks the file sizes on {SAMPLE} randomly picked orders to estimate the storage everything would need.
          Sizes only: nothing is downloaded, copied or changed. Keep this tab open while it runs (about 20–30 minutes).
        </p>
        {phase === "list" && (total ? <div className="pv-prog"><span>Counting orders {listed.toLocaleString()} / {total.toLocaleString()}</span><i style={{ ["--p" as string]: Math.round((listed / total) * 100) + "%" }} /></div>
          : <div style={{ fontSize: 13 }}>Counting orders… <b>{listed.toLocaleString()}</b> so far</div>)}
        {phase === "measure" && s && <div className="pv-prog"><span>Measuring sample {done} / {Math.min(SAMPLE, s.orders)}</span><i style={{ ["--p" as string]: Math.round((done / Math.max(1, Math.min(SAMPLE, s.orders))) * 100) + "%" }} /></div>}
        {err && <div className="pv-err">{err}</div>}
        {note && !phase && <div className="faint" style={{ fontSize: 13 }}>{note}</div>}
        {s && s.orders > 0 && (
          <>
            <div className="pvc-kpis">
              <div><span>Printavo orders</span><b>{s.orders.toLocaleString()}</b><small>{s.customers.toLocaleString()} customers</small></div>
              <div><span>Measured</span><b>{s.measured}</b><small>{s.errors ? `${s.errors} couldn't be read` : "random sample"}</small></div>
              <div><span>Per order</span><b>{size(s.avg_bytes)}</b><small>average · median {size(s.median_bytes)}</small></div>
              <div className="hi"><span>Estimated total</span><b>{s.measured ? size(s.estimate_bytes) : "—"}</b><small>{s.measured >= 30 && s.margin_bytes ? `give or take ${size(s.margin_bytes)}` : "measuring…"}</small></div>
            </div>
            <div className="faint" style={{ fontSize: 12.5 }}>
              {s.avg_files != null && <>About {s.avg_files} files per order; {s.no_files} of the measured orders have none. </>}
              {s.largest ? <>Largest file seen: {size(s.largest)}. </> : null}
              {s.over_45mb ? <>{s.over_45mb} measured order{s.over_45mb === 1 ? " has" : "s have"} a file over 45 MB. </> : null}
            </div>
            {!!s.years?.length && (
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Year</th><th className="r">Orders</th><th className="r">Measured</th><th className="r">Per order</th><th className="r">Year total (est.)</th></tr></thead>
                <tbody>{s.years.map((y) => (
                  <tr key={String(y.year)} style={{ cursor: "default" }}>
                    <td>{y.year ?? "No date"}</td><td className="r">{y.orders.toLocaleString()}</td><td className="r">{y.measured}</td>
                    <td className="r">{y.avg_bytes != null ? size(y.avg_bytes) : "—"}</td>
                    <td className="r">{s.measured ? size(y.orders * ((y.measured >= 8 ? y.avg_bytes : s.avg_bytes) || 0)) : "—"}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
