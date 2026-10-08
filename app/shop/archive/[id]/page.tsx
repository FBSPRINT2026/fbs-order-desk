"use client";
import JobLabor from "@/components/team/JobLabor";
import JobFiles from "@/components/job/JobFiles";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { ArchivedRow } from "@/lib/archive";
import ArchivedOrderView from "@/components/ArchivedOrderView";
import ArchiveReorder from "@/components/ArchiveReorder";
import { TRACK, trackWord, trackingUrl } from "@/lib/goods";

/** An archived Printavo invoice or quote (read-only). Artwork shows from our storage copies, or from Printavo until copied. */
export default function ArchivedOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [row, setRow] = useState<ArchivedRow | null>(null);
  const [company, setCompany] = useState("");
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [state, setState] = useState<"loading" | "missing" | "ok">("loading");

  useEffect(() => {
    const sb = createClient();
    (async () => {
      const { data } = await sb.from("archived_orders").select("*").eq("id", id).maybeSingle();
      if (!data) { setState("missing"); return; }
      const r = data as ArchivedRow;
      setRow(r); setState("ok");
      const { data: c } = await sb.from("customers").select("company, name").eq("id", r.customer_id).maybeSingle();
      setCompany(c?.company || c?.name || "Customer");
      const stored = Object.entries(r.files || {}).filter(([, p]) => p && !["failed", "too-big"].includes(p));
      if (stored.length) {
        const { data: s } = await sb.storage.from("proofs").createSignedUrls(stored.map(([, p]) => p), 3600);
        setSigned(Object.fromEntries(stored.map(([u], i) => [u, s?.[i]?.signedUrl || ""]).filter(([, v]) => v)));
      }
    })();
  }, [id]);

  if (state === "loading") return <div className="empty">Loading…</div>;
  if (!row) return <><Link className="back" href="/shop/customers">← Customers</Link><div className="empty">This archived order doesn&apos;t exist.</div></>;
  return (
    <>
      <Link className="back" href={`/shop/customers/${row.customer_id}?area=orders`}>← {company || "Customer"} · Orders</Link>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", margin: "6px 0 4px" }}>
        {row.kind === "invoice" && <ArchiveReorder archivedId={row.id} />}
        <a className="btn" href={`/print/job/${row.visual_id}`} target="_blank" rel="noreferrer" title="A sheet with the job's QR code, for the press">Job ticket (QR)</a>
        <a className="btn" href={`/j/${row.visual_id}`} target="_blank" rel="noreferrer" title="The job's phone menu: press setup, notes, photos, Zebra box labels">Phone menu</a>
      </div>
      <ArchivedGoods id={row.id} groups={(row.data as unknown as { groups?: PvGroup[] }).groups || []} />
      <div style={{ marginTop: 10 }}><JobLabor archivedId={row.id} qty={+(row as unknown as { qty?: number }).qty! || 0} total={+(row as unknown as { total?: number }).total! || 0} /></div>
      <div style={{ marginTop: 10 }}><JobFiles job={{ kind: "a", id: row.id }} /></div>
      <div style={{ marginTop: 10 }}>
        <ArchivedOrderView o={row.data} importedAt={row.imported_at} customerHref={`/shop/customers/${row.customer_id}`} fileUrl={(u) => signed[u] || u} />
      </div>
    </>
  );
}

type PvGroup = { lines?: { itemNumber?: string; color?: string; sizes?: Record<string, number> }[] };
type GLine = { id: string; supplier: string; supplier_order: string; style: string; color: string; size: string; qty_shipped: number; tracking: string; method: string; track_status: string; track_detail: string; est_delivery: string | null; ship_date: string | null; match_how: string };
const n = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "");
const day = (d: string | null) => (d ? new Date(d.slice(0, 10) + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "");

/** Customer goods tied to this Printavo order from supplier manifests: what shipped vs what the order lists, with tracking. */
function ArchivedGoods({ id, groups }: { id: string; groups: PvGroup[] }) {
  const [lines, setLines] = useState<GLine[] | null>(null);
  useEffect(() => { createClient().from("supplier_manifest_lines").select("*").eq("archived_order_id", id).in("kind", ["goods", "blanks"]).then(({ data }) => setLines((data || []) as GLine[])); }, [id]);
  if (!lines?.length) return null;
  const sz = (z: string) => z.replace(/^size_/, "").toUpperCase().replace(/^XXL$/, "2XL").replace(/^XXXL$/, "3XL");
  const want = groups.flatMap((g) => (g.lines || []).flatMap((l) => Object.entries(l.sizes || {}).filter(([, q]) => +q > 0).map(([z, q]) => ({ style: l.itemNumber || "", color: l.color || "", size: sz(z), qty: +q }))));
  const got = (w: { style: string; color: string; size: string }) => lines.filter((l) => (n(l.style) === n(w.style) || n(w.style).endsWith(n(l.style))) && (n(l.color) === n(w.color) || n(w.color).includes(n(l.color)) || n(l.color).includes(n(w.color))) && l.size.toUpperCase() === w.size).reduce((a, l) => a + l.qty_shipped, 0);
  const trk = [...new Map(lines.map((l) => [l.tracking || l.supplier_order, l])).values()];
  return (
    <section className="panel" style={{ marginTop: 10 }}>
      <div className="panel-h"><b>{lines.every((l) => (l as GLine & { kind?: string }).kind === "blanks") ? "Our blanks for this job" : "Customer goods on the way"}</b><span className="faint" style={{ fontSize: 12.5 }}>from {[...new Set(lines.map((l) => (l.supplier === "sanmar" ? "SanMar" : "S&S")))].join(" + ")} manifests · {lines.reduce((a, l) => a + l.qty_shipped, 0)} pcs</span></div>
      <div className="panel-b stack" style={{ gap: 8 }}>
        <ul className="rv-ships">{trk.map((l) => (
          <li key={l.id}>{l.tracking ? <a href={trackingUrl("", l.tracking)} target="_blank" rel="noreferrer">{l.tracking}</a> : <span>{l.method || "local truck"}</span>}
            <span className="rv-st" title={TRACK[l.track_status] || ""}> {trackWord(l.track_status)}</span>{l.est_delivery && l.track_status !== "delivered" ? <span className="faint"> · arrives {day(l.est_delivery)}</span> : null}{l.track_detail ? <span className="faint"> · {l.track_detail}</span> : null}</li>
        ))}</ul>
        {want.length > 0 && (
          <div style={{ overflowX: "auto" }}><table className="rv-tbl">
            <thead><tr><th>Garment</th><th>Color</th><th>Size</th><th className="r">On the order</th><th className="r">Shipped</th></tr></thead>
            <tbody>{want.map((w, i) => { const g = got(w); return (
              <tr key={i} className={g < w.qty ? "low" : ""}><td>{w.style}</td><td>{w.color}</td><td>{w.size}</td><td className="r">{w.qty}</td><td className="r">{g}{g < w.qty ? <span className="bad"> ({w.qty - g} not shipped)</span> : null}</td></tr>
            ); })}</tbody>
          </table></div>
        )}
        <small className="faint">Linked {lines[0].match_how ? `(${lines[0].match_how})` : ""}. This order is still worked in Printavo; nothing is sent back to Printavo.</small>
      </div>
    </section>
  );
}
