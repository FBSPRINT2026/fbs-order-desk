"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSticky } from "@/lib/useSticky";
import type { Catalog, CatalogJob, Kind } from "@/lib/designCatalog";
import { VerPic } from "@/components/CustomerDesigns";

/**
 * The design catalog in the customer's portal (Artwork → Design catalog), when staff turn it on for them (Oct 24, Nick:
 * "if we enable it, the customer should be able to see their design catalog… Dear Hearts"). Read-only: every design
 * they've ordered, each way it was printed, and the orders, which open in their portal. Grouping is staff's (shop side).
 */
const fmt = (d: string) => { if (!d) return ""; const x = new Date(d.length === 10 ? d + "T12:00:00" : d); return x.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); };
const n0 = (n: number) => n.toLocaleString("en-US");
const KINDS: { k: Kind; label: string }[] = [
  { k: "tees", label: "T-shirts" }, { k: "sweats", label: "Sweatshirts & jackets" }, { k: "hats", label: "Hats" }, { k: "drink", label: "Koozies & cups" }, { k: "other", label: "Other items" },
];

export default function PortalDesignCatalog({ customerId, qs, q: outerQ }: { customerId: string; qs: string; /** the search from the Artwork tab row (Oct 24): its own box is hidden then */ q?: string }) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [err, setErr] = useState("");
  const [ownQ, setQ] = useState("");
  const q = outerQ ?? ownQ;
  const [open, setOpen] = useState("");
  const [sort, setSort] = useSticky<"recent" | "most" | "az">("portal.designs.sort", "recent");
  const [kind, setKind] = useSticky<"all" | Kind>("portal.designs.kind", "all");
  useEffect(() => {
    let live = true;
    fetch(`/api/designs?customer=${customerId}`).then((r) => r.json()).then((j) => { if (!live) return; if (j.error) setErr(j.error); else setCat(j); }).catch(() => live && setErr("Couldn't load your designs."));
    return () => { live = false; };
  }, [customerId]);
  const jobHref = (j: CatalogJob) => (j.src === "printavo" ? `/portal/archive/${j.id}${qs}` : `/portal/orders/${j.id}${qs}`);
  const kindCount = useMemo(() => { const m = new Map<Kind, number>(); for (const d of cat?.designs || []) for (const k of d.kinds) m.set(k, (m.get(k) || 0) + 1); return m; }, [cat]);
  const kindNow = kind !== "all" && !kindCount.get(kind) ? "all" : kind;
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const l = (cat?.designs || []).filter((d) => (kindNow === "all" || d.kinds.includes(kindNow)) && (!t || [d.name, ...d.names].some((n) => n.toLowerCase().includes(t))));
    return [...l].sort((a, b) => (sort === "az" ? a.name.localeCompare(b.name) : sort === "most" ? b.orders - a.orders || b.last.localeCompare(a.last) : b.last.localeCompare(a.last)));
  }, [cat, q, sort, kindNow]);

  if (err && !cat) return <div className="aa-card"><div className="err" style={{ padding: 16 }}>{err}</div></div>;
  if (!cat) return <div className="aa-card"><div className="faint" style={{ padding: 16 }}>Gathering your designs from every order…</div></div>;
  const cur = cat.designs.find((d) => d.key === open) || null;

  if (cur) return (
    <section className="aa-card pdc">
      <div className="pdc-back"><button type="button" className="linkbtn" onClick={() => setOpen("")}>← All designs</button></div>
      <div className="aa-sec-h"><h3>{cur.name}</h3><span className="faint">{cur.orders} order{cur.orders === 1 ? "" : "s"} · {n0(cur.pieces)} pieces · first {fmt(cur.first)} · last {fmt(cur.last)}</span></div>
      <ol className="dc-vers">
        {cur.versions.map((v) => (
          <li key={v.key} className="dc-ver">
            <a className="dc-ver-pic" href={v.full || undefined} target="_blank" rel="noreferrer" title={v.full ? "Open the mockup" : undefined}><VerPic thumb={v.thumb} full={v.full} /></a>
            <div className="dc-ver-b">
              <div className="dc-ver-t"><b>{[v.brand, v.style].filter(Boolean).join(" ") || "Garment"}</b>{v.color && <> · {v.color}</>}</div>
              {v.garment && <div className="faint dc-ver-g">{v.garment}</div>}
              <div className="dc-ver-m">Printed {v.times}× · {n0(v.pieces)} pcs · last {fmt(v.last)}</div>
              {v.prints.length > 0 && <div className="dc-ver-p">{v.prints.map((p, i) => <span key={i}>{p}</span>)}</div>}
              <div className="dc-ver-jobs">{[...v.jobs].reverse().map((j) => <Link key={j.ref} href={jobHref(j)} className="dc-job">#{j.number} · {fmt(j.date)}</Link>)}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );

  return (
    <section className="pdc">
      <div className="toolbar aa-otabs" data-toolbar>
        <div className="chips" role="tablist" aria-label="What it's printed on">
          <button type="button" className={"chip" + (kindNow === "all" ? " on" : "")} onClick={() => setKind("all")}>All<span className="chip-n">{cat.designs.length}</span></button>
          {kindCount.size > 1 && KINDS.filter((t) => kindCount.get(t.k)).map((t) => <button key={t.k} type="button" className={"chip" + (kindNow === t.k ? " on" : "")} onClick={() => setKind(t.k)}>{t.label}<span className="chip-n">{kindCount.get(t.k)}</span></button>)}
        </div>
        <span className="spacer" />
        <select className="pdc-sort" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="recent">Last ordered</option><option value="most">Most ordered</option><option value="az">A–Z</option></select>
        {outerQ === undefined && <label className="aa-search aa-search-plain"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden><path d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM21 21l-4.3-4.3" /></svg><input type="search" placeholder="Search your designs" value={q} onChange={(e) => setQ(e.target.value)} /></label>}
      </div>
      {list.length === 0 ? <div className="aa-card"><div className="aa-empty">{q ? `No design matches “${q}”.` : "No designs yet."}</div></div> : (
        <div className="dc-grid pdc-grid">
          {list.map((d) => (
            <button key={d.key} type="button" className="dc-card" onClick={() => { setOpen(d.key); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
              <span className="dc-pic">{d.thumb ? <img src={d.thumb} alt="" loading="lazy" /> : <span className="faint">No picture</span>}</span>
              <span className="dc-name">{d.name}</span>
              <span className="dc-meta">{d.orders} order{d.orders === 1 ? "" : "s"} · {n0(d.pieces)} pcs</span>
              <span className="dc-meta">Last ordered {fmt(d.last)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
