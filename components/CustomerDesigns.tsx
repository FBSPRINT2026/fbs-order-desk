"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSticky } from "@/lib/useSticky";
import type { Catalog, CatalogDesign, CatalogJob } from "@/lib/designCatalog";
import { coverJpeg, drawPic, isPdf, picRank } from "@/lib/pdfPic";

/**
 * A customer's designs (Oct 20, Nick, Dear Heart Designs: "group orders by design… a master design and then all the
 * different ways it's printed… pull the order history of each design and see what we've done"). Built from their
 * orders (Printavo history and orders here); staff can rename, merge, hide, or move an order to another design.
 * Nothing to do with pricing.
 */
const fmtDate = (d: string) => { if (!d) return ""; const x = new Date(d.length === 10 ? d + "T12:00:00" : d); return x.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); };
const n0 = (n: number) => n.toLocaleString("en-US");
const jobHref = (j: CatalogJob) => (j.src === "printavo" ? `/shop/archive/${j.id}` : `/shop/orders/${j.id}`);

export default function CustomerDesigns({ customerId }: { customerId: string }) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useSticky<"recent" | "most" | "az">("designs.sort", "recent");
  const [open, setOpen] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/designs?customer=${customerId}`).then((r) => r.json()).then((j) => { if (!live) return; if (j.error) setErr(j.error); else setCat(j); }).catch(() => live && setErr("Couldn't load the designs."));
    return () => { live = false; };
  }, [customerId]);

  // covers: for each design not done yet, its jobs' full-size files are drawn here and the most picture-like one (a
  // mockup or a photo, never an order page) is saved as its cover, once (Oct 20, Nick)
  const [making, setMaking] = useState<Set<string>>(new Set());
  const todo = useMemo(() => (cat?.designs || []).filter((d) => !d.coverSet && d.pics.length).map((d) => d.key).join("|"), [cat]);
  useEffect(() => {
    if (!cat || !todo) return;
    let live = true;
    const queue = cat.designs.filter((d) => !d.coverSet && d.pics.length);
    setMaking(new Set(queue.map((d) => d.key)));
    const one = async (d: CatalogDesign) => {
      let best: { c: HTMLCanvasElement; s: number } | null = null;
      for (const u of d.pics.slice(0, 6)) {
        if (!live) return;
        const c = await drawPic(u, 1000);
        if (!c) continue;
        const sc = picRank(c);
        if (!best || sc > best.s) best = { c, s: sc };
        if (sc >= 2) break; // a mockup or photo: the newest such one
      }
      if (!live) return;
      const good = best && best.s > 0 ? best : null;
      const r = await fetch("/api/designs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer: customerId, op: "cover", key: d.key, ...(good ? { data: coverJpeg(good.c, 900) } : {}) }) }).then((x) => x.json()).catch(() => null) as { ok?: boolean; url?: string } | null;
      if (!live) return;
      if (r?.ok) setCat((c) => (c ? { ...c, designs: c.designs.map((x) => (x.key === d.key ? { ...x, coverSet: true, thumb: r.url || "" } : x)) } : c));
      setMaking((m) => { const n = new Set(m); n.delete(d.key); return n; });
    };
    (async () => { const q = [...queue]; const run = async () => { while (live && q.length) await one(q.shift()!); }; await Promise.all([run(), run()]); })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todo, customerId]);

  async function change(body: Record<string, string>) {
    setBusy(true); setErr("");
    const r = await fetch("/api/designs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer: customerId, ...body }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    setBusy(false);
    if (!r?.ok || j.error) { setErr(j.error || "That didn't save."); return; }
    setCat(j);
  }

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const ds = (cat?.designs || []).filter((d) => !t || d.name.toLowerCase().includes(t) || d.names.some((n) => n.toLowerCase().includes(t)) || d.versions.some((v) => `${v.style} ${v.color} ${v.garment}`.toLowerCase().includes(t)));
    return [...ds].sort((a, b) => (sort === "most" ? b.orders - a.orders || b.pieces - a.pieces : sort === "az" ? a.name.localeCompare(b.name) : b.last.localeCompare(a.last)));
  }, [cat, q, sort]);

  if (err && !cat) return <div className="panel"><div className="panel-b err">{err}</div></div>;
  if (!cat) return <div className="panel"><div className="panel-b faint">Gathering their designs from every order…</div></div>;
  const cur = cat.designs.find((d) => d.key === open) || null;
  const total = cat.designs.reduce((n, d) => n + d.orders, 0);

  return (
    <section className="panel dc">
      <div className="panel-h">
        <h2>Designs</h2>
        <span className="faint" style={{ fontSize: 12 }}>{cat.designs.length} designs · {n0(total)} orders · every way each one was printed</span>
      </div>
      <div className="panel-b">
        {err && <div className="err">{err}</div>}
        {cur ? <DesignDetail d={cur} all={cat.designs} customerId={customerId} busy={busy} change={change} back={() => setOpen("")} /> : <>
          <div className="dc-bar" data-toolbar>
            <input className="dc-q" placeholder="Find a design, garment or color" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="chips" role="radiogroup" aria-label="Sort">
              {([["recent", "Last ordered"], ["most", "Most ordered"], ["az", "A–Z"]] as const).map(([k, l]) => <button key={k} type="button" className={"chip" + (sort === k ? " on" : "")} aria-pressed={sort === k} onClick={() => setSort(k)}>{l}</button>)}
            </div>
          </div>
          {list.length === 0 && <div className="faint" style={{ padding: 12 }}>{q ? "No design matches." : "No orders yet."}</div>}
          <div className="dc-grid">
            {list.map((d) => (
              <button key={d.key} type="button" className="dc-card" onClick={() => setOpen(d.key)}>
                <span className="dc-pic">{making.has(d.key) ? <span className="faint">Finding the mockup…</span> : d.thumb ? <img src={d.thumb} alt="" loading="lazy" /> : <span className="faint">No mockup</span>}</span>
                <span className="dc-name">{d.name}</span>
                <span className="dc-meta">{d.orders} order{d.orders === 1 ? "" : "s"} · {n0(d.pieces)} pcs</span>
                <span className="dc-meta">{d.versions.length} version{d.versions.length === 1 ? "" : "s"} · last {fmtDate(d.last)}</span>
              </button>
            ))}
          </div>
          {cat.hidden.length > 0 && (
            <details className="dc-other">
              <summary>Deleted designs ({cat.hidden.length})</summary>
              {cat.hidden.map((h) => <div key={h.key} className="dc-jr"><span className="dc-jr-t">{h.name}</span><span className="faint">{h.orders} order{h.orders === 1 ? "" : "s"}</span><button type="button" className="btn sm" disabled={busy} onClick={() => void change({ op: "show", key: h.key })}>Bring back</button></div>)}
            </details>
          )}
          {cat.other.length > 0 && (
            <details className="dc-other">
              <summary>Orders not matched to a design ({cat.other.length})</summary>
              {cat.other.map((j) => <JobRow key={j.ref} j={j} all={cat.designs} busy={busy} change={change} />)}
            </details>
          )}
        </>}
      </div>
    </section>
  );
}

function DesignDetail({ d, all, customerId, busy, change, back }: { d: CatalogDesign; all: CatalogDesign[]; customerId: string; busy: boolean; change: (b: Record<string, string>) => Promise<void>; back: () => void }) {
  const [name, setName] = useState(d.name);
  const [into, setInto] = useState("");
  const [askDel, setAskDel] = useState(false);
  useEffect(() => { setName(d.name); }, [d.name]);
  return (
    <div className="dc-d">
      <div className="dc-d-h">
        <button type="button" className="btn sm ghost" onClick={back}>‹ All designs</button>
        <input className="dc-d-name" value={name} aria-label="Design name" onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name.trim() !== d.name) void change({ op: "rename", key: d.key, name: name.trim() }); }} />
        <Link className="btn sm" href={`/shop/history?${new URLSearchParams({ customer: customerId, q: d.name })}`}>Full history with emails ›</Link>
        <button type="button" className="btn sm ghost dc-del" disabled={busy} onClick={() => setAskDel(true)} title="Take this grouping off the designs (a placeholder, a one-off, a sample). The orders aren't touched.">Delete design</button>
      </div>
      {askDel && (
        <div className="dc-ask">
          <span>Delete the design <b>{d.name}</b>? Only the grouping goes: its {d.orders} order{d.orders === 1 ? "" : "s"} stay as they are. It can be brought back under &ldquo;Deleted designs&rdquo; at the bottom.</span>
          <button type="button" className="btn sm danger" disabled={busy} onClick={() => { void change({ op: "hide", key: d.key }); back(); }}>Delete design</button>
          <button type="button" className="btn sm ghost" onClick={() => setAskDel(false)}>Cancel</button>
        </div>
      )}
      <div className="dc-d-sum">
        <span><b>{d.orders}</b> order{d.orders === 1 ? "" : "s"}</span><span><b>{n0(d.pieces)}</b> pieces</span>
        <span>First {fmtDate(d.first)}</span><span>Last {fmtDate(d.last)}</span>
        {d.names.length > 1 && <span className="faint" title={d.names.join("\n")}>Ordered as: {d.names.slice(0, 4).join(" · ")}{d.names.length > 4 ? ` +${d.names.length - 4}` : ""}</span>}
      </div>

      <h3 className="dc-h">Every way we&apos;ve printed it</h3>
      <ol className="dc-vers">
        {d.versions.map((v) => (
          <li key={v.key} className="dc-ver">
            <a className="dc-ver-pic" href={v.full || undefined} target="_blank" rel="noreferrer" title={v.full ? "Open the mockup" : undefined}><VerPic thumb={v.thumb} full={v.full} /></a>
            <div className="dc-ver-b">
              <div className="dc-ver-t"><span className={"dc-ver-n" + (v.n === 1 ? " orig" : "")}>{v.label}</span><b>{[v.brand, v.style].filter(Boolean).join(" ") || "Garment"}</b>{v.color && <> · {v.color}</>}</div>
              {v.garment && <div className="faint dc-ver-g">{v.garment}</div>}
              <div className="dc-ver-m">Printed {v.times}× · {n0(v.pieces)} pcs · first {fmtDate(v.first)}{v.last !== v.first ? ` · last ${fmtDate(v.last)}` : ""}</div>
              {v.prints.length > 0 && <div className="dc-ver-p">{v.prints.map((p, i) => <span key={i}>{p}</span>)}</div>}
              <div className="dc-ver-jobs">{[...v.jobs].reverse().map((j) => <Link key={j.ref} href={jobHref(j)} className="dc-job" title={j.title}>#{j.number} · {fmtDate(j.date)} · {n0(j.pieces || j.qty)}</Link>)}</div>
            </div>
          </li>
        ))}
      </ol>

      <h3 className="dc-h">Orders <span className="faint">newest first · move one if it&apos;s a different design</span></h3>
      <div className="dc-jobs">{d.jobs.map((j) => <JobRow key={j.ref} j={j} all={all} here={d.key} busy={busy} change={change} />)}</div>

      <div className="dc-d-f">
        <span className="faint">Same design under two names?</span>
        <select value={into} onChange={(e) => setInto(e.target.value)} aria-label="Merge into">
          <option value="">Merge this into…</option>
          {all.filter((x) => x.key !== d.key).sort((a, b) => a.name.localeCompare(b.name)).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
        </select>
        <button type="button" className="btn sm" disabled={!into || busy} onClick={() => { void change({ op: "merge", key: d.key, into }); back(); }}>Merge</button>
      </div>
    </div>
  );
}

/** a version's picture: Printavo kept only a 100 px thumbnail, so a PDF mockup is drawn here at full size */
function VerPic({ thumb, full }: { thumb: string; full: string }) {
  const [big, setBig] = useState("");
  useEffect(() => {
    if (!full || !isPdf(full)) return;
    let live = true;
    void drawPic(full, 700).then((c) => { if (live && c) setBig(picRank(c) > 0 ? coverJpeg(c, 500) : "-"); });
    return () => { live = false; };
  }, [full]);
  // an order page, not a mockup: nothing rather than the S&S sheet
  const src = big === "-" ? "" : big || thumb;
  return src ? <img src={src} alt="" loading="lazy" /> : <span className="faint">No mockup</span>;
}

function JobRow({ j, all, here, busy, change }: { j: CatalogJob; all: CatalogDesign[]; here?: string; busy: boolean; change: (b: Record<string, string>) => Promise<void> }) {
  return (
    <div className="dc-jr">
      <Link href={jobHref(j)}>#{j.number}</Link>
      <span className="dc-jr-t">{j.title || "(no name)"}</span>
      <span className="faint">{fmtDate(j.date)} · {n0(j.qty)} pcs{j.src === "printavo" ? " · Printavo" : ""}</span>
      <select value="" disabled={busy} aria-label="Move to another design" onChange={(e) => { if (e.target.value !== "") void change({ op: "move", ref: j.ref, into: e.target.value === "-" ? "" : e.target.value }); }}>
        <option value="">{here ? "Move to…" : "Add to a design…"}</option>
        {all.filter((x) => x.key !== here).sort((a, b) => a.name.localeCompare(b.name)).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
        {here && <option value="-">Not a design (leave it out)</option>}
      </select>
    </div>
  );
}
