"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import PrintavoSync from "@/components/PrintavoSync";
import SearchInput from "@/components/SearchInput";

type Hit = { id: string; companyName: string; contact: string; email: string; phone: string; orderCount: number; customerId: string | null };
type Step = { at: string; text: string; bad?: boolean };

async function call<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j as T;
}

/**
 * Import a customer from Printavo with all their old invoices and quotes (archived, read-only, shown the way Printavo showed them),
 * and copy their mockups and artwork files into our storage.
 */
export default function ImportPage() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState("");
  const [running, setRunning] = useState<Hit | null>(null);
  const [log, setLog] = useState<Step[]>([]);
  const [prog, setProg] = useState({ orders: 0, ordersTotal: 0, files: 0, filesTotal: 0 });
  const [done, setDone] = useState<{ customerId: string; company: string } | null>(null);
  const [skipDone, setSkipDone] = useState(true);
  const stop = useRef(false);

  const say = (text: string, bad = false) => setLog((l) => [{ at: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }), text, bad }, ...l].slice(0, 400));

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (q.trim().length < 2) return;
    setSearching(true); setErr("");
    try { setHits((await call<{ hits: Hit[] }>(`/api/printavo/search?q=${encodeURIComponent(q.trim())}`)).hits); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setSearching(false);
  }

  async function run(h: Hit) {
    stop.current = false;
    setRunning(h); setDone(null); setLog([]); setProg({ orders: 0, ordersTotal: 0, files: 0, filesTotal: 0 });
    try {
      say(`Reading ${h.companyName || h.contact} from Printavo…`);
      const c = await call<{ customerId: string; how: string; company: string; orders: { id: string; visualId: string; kind: string }[]; imported: string[] }>("/api/printavo/customer", { printavoId: h.id });
      say(`Customer ${c.how === "new customer" ? "created" : c.how === "matched by email" ? "matched to an existing customer by email" : "already imported, updated"}: ${c.company}. ${c.orders.length} Printavo order${c.orders.length === 1 ? "" : "s"} found.`);
      const todo = skipDone ? c.orders.filter((o) => !c.imported.includes(o.id)) : c.orders;
      if (skipDone && c.imported.length) say(`${c.orders.length - todo.length} already imported; skipping those.`);
      setProg((p) => ({ ...p, ordersTotal: todo.length }));
      const archived: { id: string; visualId: string; files: number }[] = [];
      for (const [i, o] of todo.entries()) {
        if (stop.current) { say("Stopped. Run it again to pick up where it left off."); break; }
        try {
          const r = await call<{ id: string; visualId: string; filesLeft: number; warnings: string[] }>("/api/printavo/order", { printavoId: o.id, customerId: c.customerId });
          archived.push({ id: r.id, visualId: r.visualId, files: r.filesLeft });
          setProg((p) => ({ ...p, orders: i + 1, filesTotal: p.filesTotal + r.filesLeft }));
          say(`${o.kind === "quote" ? "Quote" : "Invoice"} #${r.visualId} imported${r.filesLeft ? ` (${r.filesLeft} file${r.filesLeft === 1 ? "" : "s"} to copy)` : ""}.`);
          r.warnings.forEach((w) => say(`#${r.visualId}: couldn't read part of it (${w})`, true));
        } catch (e) { say(`#${o.visualId}: ${e instanceof Error ? e.message : e}`, true); setProg((p) => ({ ...p, orders: i + 1 })); }
      }
      // artwork: copy each order's files into our storage
      for (const a of archived.filter((x) => x.files > 0)) {
        for (let pass = 0; pass < 20 && !stop.current; pass++) {
          try {
            const r = await call<{ copied: number; total: number; left: number; failed: string[] }>("/api/printavo/files", { id: a.id });
            r.failed.forEach((f) => say(`#${a.visualId}: a file couldn't be copied (${f}). It still shows from Printavo for now.`, true));
            setProg((p) => ({ ...p, files: p.files + (a.files - r.left) }));
            a.files = r.left;
            if (!r.left) break;
          } catch (e) { say(`#${a.visualId} files: ${e instanceof Error ? e.message : e}`, true); break; }
        }
      }
      if (!stop.current) say("Done.");
      setDone({ customerId: c.customerId, company: c.company });
      setHits((hs) => hs?.map((x) => (x.id === h.id ? { ...x, customerId: c.customerId } : x)) || hs);
    } catch (e) { say(e instanceof Error ? e.message : String(e), true); }
    setRunning(null);
  }

  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  return (
    <>
      <Link className="back" href="/shop/customers">← Customers</Link>
      <div className="page-head" style={{ marginTop: 8 }}>
        <div><div className="eyebrow">Printavo</div><h1>Import from Printavo</h1></div>
      </div>
      <p className="faint" style={{ maxWidth: 720, marginTop: -6 }}>
        Brings a customer over with every old Printavo invoice and quote: line items, sizes, prices, imprints, mockups, fees, payments, notes, files, tasks and messages.
        Old orders are kept as <b>archived orders</b>: read-only, shown the way Printavo showed them, and separate from new orders. Nothing in Printavo is changed.
        Running it again for the same customer is safe.
      </p>

      <PrintavoSync />

      <h2 style={{ marginTop: 22, fontSize: 16 }}>Import one customer now</h2>
      <p className="faint" style={{ margin: "2px 0 0", fontSize: 13 }}>Jumps the line for a customer you need right away. The sync would bring them over anyway.</p>
      <form className="toolbar" onSubmit={search} style={{ marginTop: 8 }}>
        <SearchInput placeholder="Search Printavo by company, contact name or email…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary" type="submit" disabled={searching || q.trim().length < 2}>{searching ? "Searching…" : "Search Printavo"}</button>
      </form>
      {err && <div className="pv-err">{err}</div>}

      {hits && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Printavo customer</th><th>Contact</th><th className="r">Orders</th><th /></tr></thead>
            <tbody>
              {hits.length ? hits.map((h) => (
                <tr key={h.id} style={{ cursor: "default" }}>
                  <td><b>{h.companyName || h.contact || "(no name)"}</b></td>
                  <td>{h.contact}<div className="faint" style={{ fontSize: 12.5 }}>{[h.email, h.phone].filter(Boolean).join(" · ")}</div></td>
                  <td className="r">{h.orderCount}</td>
                  <td className="r" style={{ whiteSpace: "nowrap" }}>
                    {h.customerId && <Link className="btn ghost" href={`/shop/customers/${h.customerId}?area=orders`}>Open</Link>}{" "}
                    <button className="btn primary" type="button" disabled={!!running} onClick={() => run(h)}>{h.customerId ? "Import again" : "Import"}</button>
                  </td>
                </tr>
              )) : <tr><td colSpan={4}><div className="empty">No Printavo customers match “{q}”.</div></td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <label className="check" style={{ marginTop: 10 }}><input type="checkbox" checked={skipDone} onChange={(e) => setSkipDone(e.target.checked)} /> Skip orders already imported (untick to refresh them all from Printavo)</label>

      {(running || log.length > 0) && (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="panel-h"><h2>{running ? `Importing ${running.companyName || running.contact}…` : done ? `Imported ${done.company}` : "Import"}</h2>
            {running ? <button className="btn" type="button" onClick={() => { stop.current = true; }}>Stop</button> : done && <Link className="btn primary" href={`/shop/customers/${done.customerId}?area=orders`}>Open customer →</Link>}
          </div>
          <div className="panel-b stack" style={{ gap: 10 }}>
            <div className="pv-prog"><span>Orders {prog.orders} / {prog.ordersTotal}</span><i style={{ ["--p" as string]: pct(prog.orders, prog.ordersTotal) + "%" }} /></div>
            <div className="pv-prog"><span>Artwork files {prog.files} / {prog.filesTotal}</span><i style={{ ["--p" as string]: pct(prog.files, prog.filesTotal) + "%" }} /></div>
            <ol className="pv-log">{log.map((l, i) => <li key={i} className={l.bad ? "bad" : ""}><span>{l.at}</span>{l.text}</li>)}</ol>
          </div>
        </section>
      )}
    </>
  );
}
