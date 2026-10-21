"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSticky } from "@/lib/useSticky";
import type { AiMerge, AiSplit, Catalog, CatalogDesign, CatalogJob, Kind } from "@/lib/designCatalog";
import { coverJpeg, drawPic, isPdf, picRank } from "@/lib/pdfPic";
import { pdfPicture } from "@/lib/printavoArt";
import { isPsd } from "@/lib/psdPic";

/**
 * A customer's designs (Oct 20, Nick, Dear Heart Designs: "group orders by design… a master design and then all the
 * different ways it's printed… pull the order history of each design and see what we've done"). Built from their
 * orders (Printavo history and orders here); staff can rename, merge, hide, or move an order to another design.
 * Nothing to do with pricing.
 */
const fmtDate = (d: string) => { if (!d) return ""; const x = new Date(d.length === 10 ? d + "T12:00:00" : d); return x.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); };
const n0 = (n: number) => n.toLocaleString("en-US");
/** every word of the design's name is in the product's name ("The Bottles" → "The Bottles Baby Bodysuit") */
const words = (t: string) => t.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !["the", "a", "an", "and", "of", "tee", "shirt"].includes(w)).map((w) => w.replace(/s$/, ""));
const titleHas = (title: string, name: string) => { const t = new Set(words(title)), n = words(name); return n.length > 0 && n.every((w) => t.has(w)); };
const jobHref = (j: CatalogJob) => (j.src === "printavo" ? `/shop/archive/${j.id}` : `/shop/orders/${j.id}`);
// the catalog's tabs (lib/designCatalog KINDS; kept here so the client doesn't pull the server file)
const KIND_TABS: { k: Kind; label: string }[] = [
  { k: "tees", label: "T-shirts" }, { k: "sweats", label: "Sweatshirts & jackets" }, { k: "hats", label: "Hats" }, { k: "drink", label: "Koozies & cups" }, { k: "other", label: "Other items" },
];
/** a tiny fingerprint of a picture: the same mockup on two orders has (nearly) the same one */
function dhash(c: HTMLCanvasElement) {
  const o = document.createElement("canvas"); o.width = 9; o.height = 8;
  const x = o.getContext("2d")!; x.drawImage(c, 0, 0, 9, 8);
  const d = x.getImageData(0, 0, 9, 8).data; let bits = "";
  for (let y = 0; y < 8; y++) for (let i = 0; i < 8; i++) { const a = (y * 9 + i) * 4, b = a + 4; bits += d[a] + d[a + 1] + d[a + 2] > d[b] + d[b + 1] + d[b + 2] ? "1" : "0"; }
  return bits;
}
const near = (a: string, b: string) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++n > 5) return false; return true; };
const yr = (d: string) => d.slice(0, 4);

export default function CustomerDesigns({ customerId }: { customerId: string }) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useSticky<"recent" | "most" | "az">("designs.sort", "recent");
  const [open, setOpen] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useSticky<"all" | Kind>("designs.kind", "all");
  const [ai, setAi] = useState<{ step: string; done: number; of: number } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/designs?customer=${customerId}`).then((r) => r.json()).then((j) => { if (!live) return; if (j.error) setErr(j.error); else setCat(j); }).catch(() => live && setErr("Couldn't load the designs."));
    return () => { live = false; };
  }, [customerId]);

  // their website (saved, else their email's): design pictures come from it first (Oct 20, Nick: "it should use their
  // site, littlegroupies.com, all that stuff, and find the images")
  const [site, setSite] = useState<string | null>(null);
  useEffect(() => { fetch(`/api/designs?customer=${customerId}&site=1`).then((r) => r.json()).then((j) => setSite(j.site || j.guess || "")).catch(() => setSite("")); }, [customerId]);
  /** the picture of this design on their site: a product whose name has every word of the design's name */
  const fromSite = async (d: CatalogDesign): Promise<string> => {
    if (!site) return "";
    const j = await fetch(`/api/designs/site?customer=${customerId}&q=${encodeURIComponent(d.name)}`).then((r) => r.json()).catch(() => null) as { products?: { title: string; images: string[] }[] } | null;
    const p = (j?.products || []).find((x) => titleHas(x.title, d.name) && x.images.length);
    return p?.images[0] || "";
  };
  const saveSiteCover = async (d: CatalogDesign, src: string) => {
    const r = await fetch("/api/designs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer: customerId, op: "cover", key: d.key, src }) }).then((x) => x.json()).catch(() => null) as { ok?: boolean; url?: string } | null;
    if (r?.ok) setCat((c) => (c ? { ...c, designs: c.designs.map((x) => (x.key === d.key ? { ...x, coverSet: true, thumb: r.url || "" } : x)) } : c));
    return !!r?.ok;
  };

  // covers: for each design not done yet, its picture on their website, else its jobs' full-size files are drawn here
  // and the most picture-like one (a mockup or a photo, never an order page) is saved as its cover, once (Oct 20, Nick)
  const [making, setMaking] = useState<Set<string>>(new Set());
  const todo = useMemo(() => (site === null ? "" : (cat?.designs || []).filter((d) => !d.coverSet && (d.pics.length || site)).map((d) => d.key).join("|")), [cat, site]);
  useEffect(() => {
    if (!cat || !todo) return;
    let live = true;
    const queue = cat.designs.filter((d) => !d.coverSet && (d.pics.length || site));
    setMaking(new Set(queue.map((d) => d.key)));
    const one = async (d: CatalogDesign) => {
      const src = await fromSite(d).catch(() => "");
      if (!live) return;
      if (src && await saveSiteCover(d, src)) { setMaking((m) => { const n = new Set(m); n.delete(d.key); return n; }); return; }
      if (!d.pics.length) { setMaking((m) => { const n = new Set(m); n.delete(d.key); return n; }); return; }
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

  // Find pictures on their website: every design looked up again; a picture found there replaces the one it has
  const [sweep, setSweep] = useState<{ done: number; of: number; found: number } | null>(null);
  async function findAll() {
    if (!cat || !site) return;
    const ds = [...cat.designs];
    setSweep({ done: 0, of: ds.length, found: 0 });
    let found = 0, done = 0;
    const run = async () => { while (ds.length) { const d = ds.shift()!; const src = await fromSite(d).catch(() => ""); if (src && await saveSiteCover(d, src)) found++; done++; setSweep({ done, of: cat.designs.length, found }); } };
    await Promise.all([run(), run()]);
  }

  /**
   * Check with AI (Oct 20, Nick: "look at the mockups and see how they compare on each order"): every order's picture
   * is drawn small here; orders with the same mockup count as one picture. The AI is asked, a batch at a time, which
   * designs are really several artworks (to split) and which designs are the same artwork (to merge). The answers are
   * saved as suggestions for staff to take or turn down.
   */
  async function runAi() {
    if (!cat || ai) return;
    setErr("");
    const ds = cat.designs;
    const urls = [...new Set(ds.flatMap((d) => [...d.jobs.map((j) => j.pic || ""), d.thumb]).filter(Boolean))];
    const drawn = new Map<string, { hash: string; data: string } | null>();
    let done = 0;
    setAi({ step: "Looking at each order's mockup", done: 0, of: urls.length });
    const queue = [...urls];
    const draw = async () => {
      while (queue.length) {
        const u = queue.shift()!;
        const c = await drawPic(u, 360).catch(() => null);
        drawn.set(u, c && picRank(c) >= 0 ? { hash: dhash(c), data: coverJpeg(c, 280) } : null);
        setAi({ step: "Looking at each order's mockup", done: ++done, of: urls.length });
      }
    };
    await Promise.all([draw(), draw(), draw(), draw()]);

    // what each order was printed on
    const onOf = new Map<string, string>();
    for (const d of ds) for (const v of d.versions) for (const j of v.jobs) onOf.set(j.ref, [onOf.get(j.ref), [v.brand, v.style, v.color].filter(Boolean).join(" ")].filter(Boolean).join(", "));
    const jobLine = (j: CatalogJob) => `#${j.number} ${fmtDate(j.date)}, ${n0(j.qty)} pcs, "${j.title}"${onOf.get(j.ref) ? ` on ${onOf.get(j.ref)}` : ""}`;

    // split: each design's orders, one picture per different mockup
    type P = { id: string; refs: string[]; label: string; data?: string };
    const splitIn: { key: string; name: string; pics: P[] }[] = [];
    for (const d of ds) {
      if (d.jobs.length < 2) continue;
      const groups: { hash: string; data: string; jobs: CatalogJob[] }[] = [];
      for (const j of d.jobs) {
        const p = j.pic ? drawn.get(j.pic) : null;
        if (!p) continue;
        const g = groups.find((x) => near(x.hash, p.hash));
        if (g) g.jobs.push(j); else groups.push({ hash: p.hash, data: p.data, jobs: [j] });
      }
      if (groups.length < 2) continue;
      splitIn.push({ key: d.key, name: d.name, pics: groups.slice(0, 30).map((g, i) => ({ id: `P${i + 1}`, refs: g.jobs.map((j) => j.ref), data: g.data,
        label: `${g.jobs.length} order${g.jobs.length === 1 ? "" : "s"}: ${g.jobs.slice(0, 5).map(jobLine).join("; ")}${g.jobs.length > 5 ? ` and ${g.jobs.length - 5} more` : ""}` })) });
    }
    const batches: (typeof splitIn)[] = [];
    for (const d of splitIn) { const last = batches[batches.length - 1]; if (last && last.reduce((n, x) => n + x.pics.length, 0) + d.pics.length <= 32) last.push(d); else batches.push([d]); }
    const mergeBatches: CatalogDesign[][] = [];
    const byName = [...ds].sort((a, b) => a.name.localeCompare(b.name));
    for (let i = 0; i < byName.length; i += 80) mergeBatches.push(byName.slice(i, i + 80));
    const total = batches.length + mergeBatches.length;
    let asked = 0;
    setAi({ step: "Asking the AI", done: 0, of: total });
    const post = async (body: unknown) => {
      const r = await fetch("/api/designs/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
      const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
      setAi({ step: "Asking the AI", done: ++asked, of: total });
      if (!r?.ok || j.error) throw new Error(j.error || "The AI check didn't finish.");
      return j;
    };
    try {
      const splits: AiSplit[] = [], merges: AiMerge[] = [];
      const sq = [...batches];
      const runSplits = async () => { while (sq.length) { const j = await post({ customer: customerId, phase: "split", designs: sq.shift() }); splits.push(...(j.splits || [])); } };
      await Promise.all([runSplits(), runSplits()]);
      for (const mb of mergeBatches) {
        const j = await post({ customer: customerId, phase: "merge", designs: mb.map((d) => {
          const pic = (d.thumb && drawn.get(d.thumb)) || d.jobs.map((x) => (x.pic ? drawn.get(x.pic) : null)).find(Boolean) || null;
          const on = [...new Set(d.versions.map((v) => [v.brand, v.style].filter(Boolean).join(" ")).filter(Boolean))].slice(0, 4).join(", ");
          return { key: d.key, name: d.name, data: pic?.data, label: `${d.orders} order${d.orders === 1 ? "" : "s"} ${yr(d.first)}${yr(d.last) !== yr(d.first) ? `–${yr(d.last)}` : ""}; ordered as: ${d.names.slice(0, 5).map((x) => `"${x}"`).join(", ")}${on ? `; printed on ${on}` : ""}` };
        }) });
        merges.push(...(j.merges || []));
      }
      // the main design of a merge: the one ordered most
      const ordersOf = new Map(ds.map((d) => [d.key, d.orders] as const));
      for (const m of merges) m.into = [...m.keys].sort((a, b) => (ordersOf.get(b) || 0) - (ordersOf.get(a) || 0))[0];
      await change({ op: "review", review: { at: "", by: "", splits, merges } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The AI check didn't finish.");
    }
    setAi(null);
  }

  async function change(body: Record<string, unknown>) {
    setBusy(true); setErr("");
    const r = await fetch("/api/designs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer: customerId, ...body }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    setBusy(false);
    if (!r?.ok || j.error) { setErr(j.error || "That didn't save."); return; }
    setCat(j);
  }

  // the tabs: only kinds this customer has; a tab with nothing here shows everything
  const kindCount = useMemo(() => { const m = new Map<Kind, number>(); for (const d of cat?.designs || []) for (const k of d.kinds || []) m.set(k, (m.get(k) || 0) + 1); return m; }, [cat]);
  const kindNow: "all" | Kind = kind !== "all" && kindCount.get(kind) ? kind : "all";
  // the AI's suggestions still waiting, minus any that no longer fit the catalog
  const review = useMemo(() => {
    const rv = cat?.rules.review; if (!cat || !rv) return null;
    const byKey = new Map(cat.designs.map((d) => [d.key, d] as const));
    const merges = rv.merges.filter((m) => m.keys.filter((k) => byKey.has(k)).length >= 2).map((m) => ({ ...m, keys: m.keys.filter((k) => byKey.has(k)) })).map((m) => ({ ...m, into: m.keys.includes(m.into) ? m.into : m.keys[0] }));
    const splits = rv.splits.map((x) => { const d = byKey.get(x.key); if (!d) return null; const here = new Set(d.jobs.map((j) => j.ref)); const groups = x.groups.map((g) => ({ ...g, refs: g.refs.filter((r) => here.has(r)) })).filter((g) => g.refs.length); return groups.length >= 2 ? { ...x, groups } : null; }).filter((x): x is AiSplit => !!x);
    return { at: rv.at, merges, splits };
  }, [cat]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const ds = (cat?.designs || []).filter((d) => kindNow === "all" || (d.kinds || []).includes(kindNow)).filter((d) => !t || d.name.toLowerCase().includes(t) || d.names.some((n) => n.toLowerCase().includes(t)) || d.versions.some((v) => `${v.style} ${v.color} ${v.garment}`.toLowerCase().includes(t)));
    return [...ds].sort((a, b) => (sort === "most" ? b.orders - a.orders || b.pieces - a.pieces : sort === "az" ? a.name.localeCompare(b.name) : b.last.localeCompare(a.last)));
  }, [cat, q, sort, kindNow]);

  if (err && !cat) return <div className="panel"><div className="panel-b err">{err}</div></div>;
  if (!cat) return <div className="panel"><div className="panel-b faint">Gathering their designs from every order…</div></div>;
  const cur = cat.designs.find((d) => d.key === open) || null;
  const total = cat.designs.reduce((n, d) => n + d.orders, 0);

  return (
    <section className="panel dc">
      <div className="panel-h">
        <h2>Design catalog</h2>
        <span className="faint" style={{ fontSize: 12 }}>{cat.designs.length} designs · {n0(total)} orders · every way each one was printed</span>
      </div>
      <div className="panel-b">
        {err && <div className="err">{err}</div>}
        {cur ? <DesignDetail d={cur} all={cat.designs} customerId={customerId} busy={busy} change={change} back={() => setOpen("")} setCover={(url) => setCat((c) => (c ? { ...c, designs: c.designs.map((x) => (x.key === cur.key ? { ...x, coverSet: true, thumb: url } : x)) } : c))} /> : <>
          <div className="dc-bar" data-toolbar>
            <input className="dc-q" placeholder="Find a design" value={q} onChange={(e) => setQ(e.target.value)} />
            {site ? (sweep && sweep.done < sweep.of
              ? <span className="faint dc-sweep">Looking on {site.replace(/^https?:\/\/(www\.)?/, "")}… {sweep.done} of {sweep.of} · {sweep.found} found</span>
              : <button type="button" className="btn sm" title={`Look up every design on ${site.replace(/^https?:\/\//, "")} and use its picture there`} onClick={() => void findAll()}>{sweep ? `Found ${sweep.found} of ${sweep.of} · again` : "Find pictures on their website"}</button>) : null}
            {ai ? <span className="faint dc-sweep">AI: {ai.step}… {ai.done} of {ai.of}</span>
              : <button type="button" className="btn sm" disabled={busy} title="The AI compares every order's mockup: designs that are really different artwork get split, and the same artwork under different names gets merged. You approve each one." onClick={() => void runAi()}>{review ? "Check with AI again" : "Check with AI"}</button>}
            <div className="chips" role="radiogroup" aria-label="Sort">
              {([["recent", "Last ordered"], ["most", "Most ordered"], ["az", "A–Z"]] as const).map(([k, l]) => <button key={k} type="button" className={"chip" + (sort === k ? " on" : "")} aria-pressed={sort === k} onClick={() => setSort(k)}>{l}</button>)}
            </div>
          </div>
          {kindCount.size > 1 && (
            <div className="chips dc-kinds" role="tablist" aria-label="What it's printed on" data-toolbar>
              <button type="button" role="tab" className={"chip" + (kindNow === "all" ? " on" : "")} aria-selected={kindNow === "all"} onClick={() => setKind("all")}>All <span className="faint">{cat.designs.length}</span></button>
              {KIND_TABS.filter((t) => kindCount.get(t.k)).map((t) => <button key={t.k} type="button" role="tab" className={"chip" + (kindNow === t.k ? " on" : "")} aria-selected={kindNow === t.k} onClick={() => setKind(t.k)}>{t.label} <span className="faint">{kindCount.get(t.k)}</span></button>)}
            </div>
          )}
          {review && <AiReviewPanel review={review} cat={cat} busy={busy} change={change} />}
          {list.length === 0 && <div className="faint" style={{ padding: 12 }}>{q ? "No design matches." : "No orders yet."}</div>}
          <div className="dc-grid">
            {list.map((d) => (
              <button key={d.key} type="button" className="dc-card" onClick={() => setOpen(d.key)}>
                <span className="dc-pic">{making.has(d.key) ? <span className="faint">Finding a picture…</span> : d.thumb ? <img src={d.thumb} alt="" loading="lazy" /> : <span className="faint">No mockup</span>}</span>
                <span className="dc-name">{d.name}</span>
                <span className="dc-meta">{d.orders} order{d.orders === 1 ? "" : "s"} · {n0(d.pieces)} pcs</span>
                <span className="dc-meta">{d.versions.length} version{d.versions.length === 1 ? "" : "s"} · last {fmtDate(d.last)}</span>
                {d.jobs.some((j) => j.split?.length) && <span className="dc-split" title="Some of its orders also had other designs on them">{(() => { const n = d.jobs.filter((j) => j.split?.length).length; return `${n} split order${n === 1 ? "" : "s"}`; })()}</span>}
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

function DesignDetail({ d, all, customerId, busy, change, back, setCover }: { d: CatalogDesign; all: CatalogDesign[]; customerId: string; busy: boolean; change: (b: Record<string, unknown>) => Promise<void>; back: () => void; setCover: (url: string) => void }) {
  const [picking, setPicking] = useState(false);
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
        <button type="button" className={"btn sm" + (picking ? " primary" : "")} onClick={() => setPicking((x) => !x)} title="Pick the picture shown for this design">Thumbnail</button>
        <button type="button" className="btn sm ghost dc-del" disabled={busy} onClick={() => setAskDel(true)} title="Take this grouping off the designs (a placeholder, a one-off, a sample). The orders aren't touched.">Delete design</button>
      </div>
      {askDel && (
        <div className="dc-ask">
          <span>Delete the design <b>{d.name}</b>? Only the grouping goes: its {d.orders} order{d.orders === 1 ? "" : "s"} stay as they are. It can be brought back under &ldquo;Deleted designs&rdquo; at the bottom.</span>
          <button type="button" className="btn sm danger" disabled={busy} onClick={() => { void change({ op: "hide", key: d.key }); back(); }}>Delete design</button>
          <button type="button" className="btn sm ghost" onClick={() => setAskDel(false)}>Cancel</button>
        </div>
      )}
      {picking && <ThumbPicker d={d} customerId={customerId} onSet={(url) => { setCover(url); setPicking(false); }} onClose={() => setPicking(false)} />}
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
              <div className="dc-ver-jobs">{[...v.jobs].reverse().map((j) => <Link key={j.ref} href={jobHref(j)} className={"dc-job" + (j.split?.length ? " split" : "")} title={j.split?.length ? `${j.title}\nSplit order: also ${j.split.join(", ")}` : j.title}>#{j.number} · {fmtDate(j.date)} · {n0(j.pieces || j.qty)}{j.split?.length ? " · split" : ""}</Link>)}</div>
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

/**
 * Thumbnail: every picture on the design's jobs (mockups, photos, art; PDFs drawn here), or one uploaded, to pick the
 * design's thumbnail from (Oct 20, Nick: "give it all the possible images, and I can set the thumbnail").
 */
function ThumbPicker({ d, customerId, onSet, onClose }: { d: CatalogDesign; customerId: string; onSet: (url: string) => void; onClose: () => void }) {
  const urls = useMemo(() => [...new Set([...d.pics, ...d.versions.map((v) => v.full).filter((u) => u && /\.(pdf|png|jpe?g|webp|gif)$/i.test(u.split("?")[0]))])], [d]);
  const [pics, setPics] = useState<{ url: string; jpg: string; form: boolean }[]>([]);
  const [left, setLeft] = useState(urls.length);
  const [saving, setSaving] = useState(""), [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    setPics([]); setLeft(urls.length);
    (async () => {
      const q = [...urls];
      const run = async () => {
        while (live && q.length) {
          const u = q.shift()!;
          const c = await drawPic(u, 1000);
          if (!live) return;
          if (c) { const form = picRank(c) < 0; setPics((p) => [...p, { url: u, jpg: coverJpeg(c, 900), form }]); }
          setLeft((n) => n - 1);
        }
      };
      await Promise.all([run(), run(), run()]);
    })();
    return () => { live = false; };
  }, [urls]);
  // their website (Oct 20, Nick: "try to find from customer site"): a search of the site's products, or a pasted link
  const [web, setWeb] = useState<null | { busy?: boolean; site?: string; error?: string; products: { title: string; url: string; images: string[] }[] }>(null);
  const [link, setLink] = useState(""), [siteIn, setSiteIn] = useState("");
  async function findWeb(url?: string) {
    setWeb((w) => ({ products: w?.products || [], site: w?.site, busy: true }));
    const qs = new URLSearchParams({ customer: customerId, ...(url ? { url } : { q: d.name }) });
    const j = await fetch(`/api/designs/site?${qs}`).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the server." }));
    setWeb({ site: j.site || "", error: j.error, products: j.products || [] });
  }
  async function saveSite() {
    const j = await fetch("/api/designs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer: customerId, op: "site", site: siteIn }) }).then((x) => x.json()).catch(() => null);
    if (j?.ok && j.site) void findWeb(); else setErr("That website address doesn't look right.");
  }
  async function save(jpg: string, key: string, src?: string) {
    setSaving(key); setErr("");
    const r = await fetch("/api/designs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer: customerId, op: "cover", key: d.key, ...(src ? { src } : { data: jpg }) }) }).then((x) => x.json()).catch(() => null) as { ok?: boolean; url?: string; error?: string } | null;
    setSaving("");
    if (!r?.ok) return setErr(r?.error || "That didn't save.");
    onSet(r.url || jpg);
  }
  async function upload(f: File | undefined) {
    if (!f) return;
    let c: HTMLCanvasElement | null = null;
    if (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name)) c = await pdfPicture(await f.arrayBuffer(), 1000).catch(() => null);
    else { const u = URL.createObjectURL(f); c = await drawPic(u, 1000).finally(() => URL.revokeObjectURL(u)); }
    if (!c) return setErr("That file couldn't be read. Use a picture (JPG, PNG) or a PDF.");
    await save(coverJpeg(c, 900), "upload");
  }
  // order forms and S&S sheets last
  const shown = [...pics].sort((a, b) => Number(a.form) - Number(b.form));
  return (
    <div className="dc-tp">
      <div className="dc-tp-h">
        <b>Pick the thumbnail</b>
        <span className="faint">{left > 0 ? `Loading ${left} more picture${left === 1 ? "" : "s"} from the orders…` : `${pics.length} picture${pics.length === 1 ? "" : "s"} from the orders`}</span>
        <button type="button" className="btn sm" disabled={web?.busy} onClick={() => void findWeb()} title="Search the customer's own website for this design's pictures">{web?.busy ? "Searching their site…" : "Find on their website"}</button>
        <label className="btn sm">Upload a picture<input type="file" accept="image/*,application/pdf" hidden onChange={(e) => void upload(e.target.files?.[0])} /></label>
        <button type="button" className="btn sm ghost" onClick={onClose}>Close</button>
      </div>
      {err && <div className="err">{err}</div>}
      {web && !web.busy && (
        <div className="dc-tp-web">
          {web.error && <div className="faint">{web.error}</div>}
          {web.site === "" && <div className="dc-tp-row"><input placeholder="Their website, e.g. dearheartdesigns.com" value={siteIn} onChange={(e) => setSiteIn(e.target.value)} /><button type="button" className="btn sm" disabled={!siteIn.trim()} onClick={() => void saveSite()}>Save and search</button></div>}
          {web.products.map((p) => (
            <div key={p.url} className="dc-tp-prod">
              <a href={p.url} target="_blank" rel="noreferrer" className="dc-tp-pt">{p.title} ›</a>
              <div className="dc-tp-grid">
                {p.images.map((u) => (
                  <button key={u} type="button" className="dc-tp-it" disabled={!!saving} onClick={() => void save("", u, u)} title="Use this as the thumbnail">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u.replace(/([?&])width=\d+/, "$1width=400")} alt="" loading="lazy" />
                    <span>{saving === u ? "Saving…" : "Use this"}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="dc-tp-row"><input placeholder="Or paste a link to the product page" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && link.trim()) void findWeb(link.trim()); }} /><button type="button" className="btn sm" disabled={!link.trim()} onClick={() => void findWeb(link.trim())}>Get pictures</button></div>
        </div>
      )}
      {(pics.length > 0 || left > 0 || urls.length === 0) && <div className="dc-tp-sub faint">From their orders</div>}
      <div className="dc-tp-grid">
        {shown.map((p) => (
          <button key={p.url} type="button" className={"dc-tp-it" + (p.form ? " form" : "")} disabled={!!saving} onClick={() => void save(p.jpg, p.url)} title={p.form ? "Looks like an order form" : "Use this as the thumbnail"}>
            <img src={p.jpg} alt="" />
            <span>{saving === p.url ? "Saving…" : p.form ? "Order form" : "Use this"}</span>
          </button>
        ))}
        {urls.length === 0 && <span className="faint">No pictures on this design&apos;s orders. Upload one.</span>}
      </div>
    </div>
  );
}

/** a version's picture: Printavo kept only a 100 px thumbnail, so a PDF mockup is drawn here at full size */
function VerPic({ thumb, full }: { thumb: string; full: string }) {
  const [big, setBig] = useState("");
  useEffect(() => {
    if (!full || !(isPdf(full) || isPsd(full))) return;
    let live = true;
    void drawPic(full, 700).then((c) => { if (live && c) setBig(picRank(c) > 0 ? coverJpeg(c, 500) : "-"); });
    return () => { live = false; };
  }, [full]);
  // an order page, not a mockup: nothing rather than the S&S sheet
  const src = big === "-" ? "" : big || thumb;
  return src ? <img src={src} alt="" loading="lazy" /> : <span className="faint">No mockup</span>;
}

function JobRow({ j, all, here, busy, change }: { j: CatalogJob; all: CatalogDesign[]; here?: string; busy: boolean; change: (b: Record<string, unknown>) => Promise<void> }) {
  return (
    <div className="dc-jr">
      <Link href={jobHref(j)}>#{j.number}</Link>
      <span className="dc-jr-t">{j.title || "(no name)"}{j.split?.length ? <span className="dc-split" title={`One order, several designs: this part is ${n0(j.qty)} pcs`}>Split · also {j.split.join(", ")}</span> : null}</span>
      <span className="faint">{fmtDate(j.date)} · {n0(j.qty)} pcs{j.src === "printavo" ? " · Printavo" : ""}</span>
      <select value="" disabled={busy} aria-label="Move to another design" onChange={(e) => { if (e.target.value !== "") void change({ op: "move", ref: j.ref, into: e.target.value === "-" ? "" : e.target.value }); }}>
        <option value="">{here ? "Move to…" : "Add to a design…"}</option>
        {all.filter((x) => x.key !== here).sort((a, b) => a.name.localeCompare(b.name)).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
        {here && <option value="-">Not a design (leave it out)</option>}
      </select>
    </div>
  );
}

/**
 * The AI's suggestions (Check with AI): designs to merge (the same artwork under different names) and designs to split
 * (one name, different artwork, like Peticolas's koozies). Each one is taken or turned down by hand; what's turned
 * down is remembered and told to the AI next time.
 */
function AiReviewPanel({ review, cat, busy, change }: { review: { at: string; merges: AiMerge[]; splits: AiSplit[] }; cat: Catalog; busy: boolean; change: (b: Record<string, unknown>) => Promise<void> }) {
  const byKey = new Map(cat.designs.map((d) => [d.key, d] as const));
  const n = review.merges.length + review.splits.length;
  return (
    <details className="dc-ai" open={n > 0}>
      <summary>
        <b>AI suggestions</b> <span className="faint">{n ? `${review.splits.length} to split · ${review.merges.length} to merge` : "nothing left to look at"}{review.at ? ` · checked ${fmtDate(review.at)}` : ""}</span>
      </summary>
      {n === 0 && <div className="faint dc-ai-none">Every suggestion has been answered. Check with AI again after new orders come in.</div>}
      {review.splits.map((x) => { const d = byKey.get(x.key); return d ? <AiSplitCard key={x.sig} x={x} d={d} busy={busy} change={change} /> : null; })}
      {review.merges.map((m) => <AiMergeCard key={m.sig} m={m} ds={m.keys.map((k) => byKey.get(k)!).filter(Boolean)} busy={busy} change={change} />)}
    </details>
  );
}

function AiSplitCard({ x, d, busy, change }: { x: AiSplit; d: CatalogDesign; busy: boolean; change: (b: Record<string, unknown>) => Promise<void> }) {
  const [names, setNames] = useState(x.groups.map((g) => g.name));
  const jobs = new Map(d.jobs.map((j) => [j.ref, j] as const));
  return (
    <div className="dc-ai-card">
      <div className="dc-ai-h"><span className="dc-ai-tag split">Split</span><b>{d.name}</b><span className="faint">looks like {x.groups.length} different designs</span></div>
      <div className="dc-ai-groups">
        {x.groups.map((g, i) => {
          const js = g.refs.map((r) => jobs.get(r)).filter((j): j is CatalogJob => !!j);
          const pics = [...new Set(js.map((j) => j.pic || "").filter(Boolean))].slice(0, 4);
          return (
            <div key={i} className="dc-ai-g">
              <div className="dc-ai-pics">{pics.length ? pics.map((p) => <span key={p} className="dc-ai-pic"><VerPic thumb={isPdf(p) || isPsd(p) ? "" : p} full={p} /></span>) : <span className="dc-ai-pic faint">No mockup</span>}</div>
              <input value={names[i] || ""} aria-label="Name for this design" onChange={(e) => setNames((a) => a.map((v, k) => (k === i ? e.target.value : v)))} />
              {g.why && <div className="faint dc-ai-why">{g.why}</div>}
              <div className="dc-ai-jobs">{js.map((j) => <Link key={j.ref} href={jobHref(j)} className="dc-job" title={j.title}>#{j.number} · {fmtDate(j.date)}</Link>)}</div>
            </div>
          );
        })}
      </div>
      <div className="dc-ai-f">
        <button type="button" className="btn sm primary" disabled={busy} onClick={() => void change({ op: "split", key: d.key, sig: x.sig, groups: x.groups.map((g, i) => ({ name: (names[i] || g.name).trim(), refs: g.refs })) })}>Split into {x.groups.length} designs</button>
        <button type="button" className="btn sm ghost" disabled={busy} onClick={() => void change({ op: "aiNo", sig: x.sig, text: `"${d.name}": staff said all its orders are one design, though the AI saw ${x.groups.map((g) => `"${g.name}"`).join(" and ")}${x.groups[0]?.why ? ` (${x.groups.map((g) => g.why).filter(Boolean).join("; ")})` : ""}` })}>Keep together</button>
      </div>
    </div>
  );
}

function AiMergeCard({ m, ds, busy, change }: { m: AiMerge; ds: CatalogDesign[]; busy: boolean; change: (b: Record<string, unknown>) => Promise<void> }) {
  const [name, setName] = useState(m.name || ds.find((d) => d.key === m.into)?.name || "");
  return (
    <div className="dc-ai-card">
      <div className="dc-ai-h"><span className="dc-ai-tag">Merge</span><b>The same design?</b>{m.why && <span className="faint">{m.why}</span>}</div>
      <div className="dc-ai-groups">
        {ds.map((d) => (
          <div key={d.key} className="dc-ai-g">
            <div className="dc-ai-pics"><span className="dc-ai-pic">{d.thumb ? <img src={d.thumb} alt="" loading="lazy" /> : <span className="faint">No mockup</span>}</span></div>
            <b className="dc-ai-n">{d.name}</b>
            <div className="faint dc-ai-why">{d.orders} order{d.orders === 1 ? "" : "s"} · {n0(d.pieces)} pcs · {yr(d.first)}{yr(d.last) !== yr(d.first) ? `–${yr(d.last)}` : ""}</div>
          </div>
        ))}
      </div>
      <div className="dc-ai-f">
        <input value={name} aria-label="Name to keep" onChange={(e) => setName(e.target.value)} />
        <button type="button" className="btn sm primary" disabled={busy || !name.trim()} onClick={() => void change({ op: "mergeMany", keys: ds.map((d) => d.key), into: ds.some((d) => d.key === m.into) ? m.into : ds[0].key, name: name.trim(), sig: m.sig })}>Merge into one</button>
        <button type="button" className="btn sm ghost" disabled={busy} onClick={() => void change({ op: "aiNo", sig: m.sig, text: `${ds.map((d) => `"${d.name}"`).join(" and ")} are different designs (staff said so${m.why ? `; the AI had thought: ${m.why}` : ""})` })}>They&apos;re different</button>
      </div>
    </div>
  );
}
