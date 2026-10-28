"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { custLabel } from "@/lib/format";
import type { Customer, Design } from "@/lib/pricing";
import CustomerPick from "@/components/CustomerPick";
import SearchInput from "@/components/SearchInput";
import { uploadDesign } from "@/lib/designs";
import { nextSewCode, sewFilesOf, tajimaName, type Brand, type SewFile } from "@/lib/brands";
import { tajimaFile } from "@/components/CustomerBrands";

/**
 * Customer artwork builder, in Shop Tools (Oct 28, Nick: "call it customer artwork builder… select a customer from a
 * dropdown, have a search… once you check it, you would drop down all the files… then you can create their brand… the
 * easiest way for me to get clients onboarded"). First asked as (Oct 28, Nick: "how can we quickly bring in art… I want to be able to quickly look at all the artwork for
 * Embark… click the jobs… I select them and say, these are the arts I want you to bring in… name what type of file it is,
 * digitizing or whatever… without me having to go through and download and upload everything"). A client's Printavo jobs
 * with every attachment; tick a file, say what it is, and Bring in makes the logos (with a D-number, under the picked
 * brand) and files the sew files on them. A DST brings its EMB and sewing PDF with it (Nick: "attached to the DST is those
 * other two files… within the art you would store that").
 */
type Job = { id: string; visual_id: string; nickname: string; order_date: string; files: Record<string, string> | null };
type Item = { key: string; job: Job; path: string; name: string; ext: string; kind: "art" | "sew" | "other"; emb?: string; sheet?: string };
type Pick = { on: boolean; as: "logo" | "sew"; name: string; target: string };
type D = Design & { brand_id?: string | null };

const ART = /^(pdf|ai|png|jpe?g|svg|eps|psd|tiff?|webp)$/;
const PREVIEW = /^(pdf|ai|png|jpe?g|webp|svg)$/;
const extOf = (p: string) => (p.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
/** the file's own name: Printavo's copies start with a short code ("mukt3xws5-Embark-Logo.pdf") */
const nameOf = (p: string) => (p.split("/").pop() || p).replace(/^[a-z0-9]{6,12}-/, "");
const baseOf = (p: string) => nameOf(p).replace(/\.[^.]+$/, "").toLowerCase();
/** a name a person gave it (not a filepicker code like "qtTHnfKGTcCccaDxZY0w") */
const realName = (p: string) => { const b = nameOf(p).replace(/\.[^.]+$/, ""); return /^[A-Za-z0-9]{18,22}$/.test(b) ? "" : b.replace(/[_-]+/g, " ").trim(); };
const typeOf = (ext: string) => ({ pdf: "application/pdf", ai: "application/illustrator", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", eps: "application/postscript", psd: "image/vnd.adobe.photoshop", tif: "image/tiff", tiff: "image/tiff", webp: "image/webp" } as Record<string, string>)[ext] || "application/octet-stream";

/** a job's files: Printavo's thumbnails left out; each DST with its EMB and sewing PDF (same name) as one sew file */
function itemsOf(job: Job): Item[] {
  const paths = [...new Set(Object.entries(job.files || {}).filter(([k]) => !/resize=|output=format|ico-document/.test(k)).map(([, v]) => v))];
  const dsts = paths.filter((p) => extOf(p) === "dst");
  const used = new Set<string>();
  const out: Item[] = [];
  for (const d of dsts) {
    const b = baseOf(d);
    let emb = paths.find((p) => extOf(p) === "emb" && baseOf(p) === b);
    if (!emb && dsts.length === 1) { const embs = paths.filter((p) => extOf(p) === "emb"); if (embs.length === 1) emb = embs[0]; }
    const sheet = paths.find((p) => extOf(p) === "pdf" && baseOf(p) === b);
    if (emb) used.add(emb); if (sheet) used.add(sheet);
    out.push({ key: d, job, path: d, name: nameOf(d), ext: "dst", kind: "sew", ...(emb ? { emb } : {}), ...(sheet ? { sheet } : {}) });
  }
  for (const p of paths) {
    if (used.has(p) || extOf(p) === "dst") continue;
    const ext = extOf(p);
    out.push({ key: p, job, path: p, name: nameOf(p), ext, kind: ART.test(ext) ? "art" : "other" });
  }
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "art" ? -1 : b.kind === "art" ? 1 : a.kind === "sew" ? -1 : 1));
}

/* pictures of the files, a few at a time (PDF / AI drawn by pdf.js) */
const PICS = new Map<string, Promise<string>>();
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(f: () => Promise<T>): Promise<T> {
  if (running >= 3) await new Promise<void>((r) => waiting.push(r));
  running++;
  try { return await f(); } finally { running--; waiting.shift()?.(); }
}
function picOf(sb: ReturnType<typeof createClient>, path: string): Promise<string> {
  if (!PICS.has(path)) PICS.set(path, slot(async () => {
    const ext = extOf(path);
    if (/^(png|jpe?g|webp|svg)$/.test(ext)) { const { data } = await sb.storage.from("proofs").createSignedUrl(path, 3600); return data?.signedUrl || ""; }
    const { data } = await sb.storage.from("proofs").download(path);
    if (!data) return "";
    const { pdfPicture } = await import("@/lib/printavoArt");
    const c = await pdfPicture(await data.arrayBuffer(), 420);
    return c.toDataURL("image/jpeg", 0.8);
  }).catch(() => ""));
  return PICS.get(path)!;
}
function Pic({ sb, path }: { sb: ReturnType<typeof createClient>; path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let on = true;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); picOf(sb, path).then((u) => { if (on) setSrc(u); }); } }, { rootMargin: "300px" });
    if (el.current) io.observe(el.current);
    return () => { on = false; io.disconnect(); };
  }, [sb, path]);
  return <span className="bi-pic" ref={el}>{src ? <img src={src} alt="" /> : <span className="faint">{src === "" ? "No picture" : "Loading…"}</span>}</span>;
}
function DstInfo({ sb, path }: { sb: ReturnType<typeof createClient>; path: string }) {
  const [t, setT] = useState("");
  useEffect(() => {
    let on = true;
    (async () => {
      const { data } = await sb.storage.from("proofs").download(path);
      if (!data) return;
      const { readDst } = await import("@/lib/dst");
      const i = readDst(await data.arrayBuffer());
      if (on) setT(`${i.wIn}" × ${i.hIn}" · ${i.stitches.toLocaleString()} st · ${i.colors} color${i.colors === 1 ? "" : "s"}`);
    })().catch(() => null);
    return () => { on = false; };
  }, [sb, path]);
  return <span className="faint">{t || "Reading the DST…"}</span>;
}

export default function BringInArtPage() {
  return <Suspense fallback={<div className="aa-empty">Loading…</div>}><BringInArt /></Suspense>;
}

function BringInArt() {
  const sb = useMemo(() => createClient(), []);
  const qs = useSearchParams();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cust, setCust] = useState(qs.get("customer") || "");
  const [q, setQ] = useState(qs.get("q") || "");
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brand, setBrand] = useState(qs.get("brand") || "");
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [n, setN] = useState(15);
  const [designs, setDesigns] = useState<D[]>([]);
  const [picks, setPicks] = useState<Record<string, Pick>>({} as Record<string, Pick>);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  /** the jobs ticked open to show their files */
  const [openJobs, setOpenJobs] = useState<Set<string>>(new Set());
  const [newBrand, setNewBrand] = useState<string | null>(null);

  useEffect(() => { sb.from("customers").select("*").then(({ data }) => setCustomers(((data || []) as Customer[]).sort((a, b) => custLabel(a).localeCompare(custLabel(b))))); }, [sb]);
  const custOpts = useMemo(() => customers.map((c) => ({ id: c.id, label: custLabel(c), sub: c.company && c.name ? c.name : c.email || "" })), [customers]);
  async function loadDesigns(id: string) {
    const { data } = await sb.from("designs").select("*").eq("customer_id", id).eq("draft", false).order("number", { ascending: false });
    setDesigns((data || []) as D[]);
  }
  useEffect(() => {
    setJobs(null); setPicks({}); setN(15); setOpenJobs(new Set());
    if (!cust) { setBrands([]); setDesigns([]); return; }
    sb.from("brands").select("*").eq("customer_id", cust).is("archived_at", null).order("sort").then(({ data }) => { const bs = (data || []) as Brand[]; setBrands(bs); if (!bs.some((b) => b.id === brand)) setBrand(bs.find((b) => q && b.name.toLowerCase().includes(q.toLowerCase().trim()))?.id || ""); });
    void loadDesigns(cust);
  }, [cust]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!cust) return;
    const t = setTimeout(async () => {
      let r = sb.from("archived_orders").select("id, visual_id, nickname, order_date, files").eq("customer_id", cust).gt("files_total", 0).order("order_date", { ascending: false }).limit(300);
      // anything in the job: its name, PO, line items, notes (archived_orders.search_text)
      const w = q.trim().replace(/[%,()*]/g, " ").trim();
      if (w) r = r.or(`nickname.ilike.%${w}%,search_text.ilike.%${w}%`);
      const { data } = await r;
      setJobs((data || []) as Job[]); setN(15);
    }, 300);
    return () => clearTimeout(t);
  }, [cust, q, sb]);

  // what's already been brought in (each logo / sew file keeps the Printavo file it came from)
  const done = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of designs) {
      const src = (d.specs as { source?: { path?: string } } | null)?.source?.path;
      if (src) m.set(src, `D-${d.number}`);
      for (const f of sewFilesOf(d)) { const s = (f as SewFile & { source?: string }).source; if (s) m.set(s, `${tajimaName(d.number, Number((f.code || "E1").slice(1)) || 1)} on D-${d.number}`); }
    }
    return m;
  }, [designs]);

  const items = useMemo(() => (jobs || []).map((j) => ({ j, list: itemsOf(j) })).filter((x) => x.list.some((i) => i.kind !== "other")), [jobs]);
  const picked = (Object.entries(picks) as [string, Pick][]).filter(([, p]) => p.on);
  const newLogos = picked.filter(([, p]) => p.as === "logo");
  const set = (key: string, p: Partial<Pick>, it?: Item) => setPicks((x) => ({ ...x, [key]: { on: true, as: it?.kind === "sew" ? "sew" : "logo", name: it ? realName(it.path) || it.job.nickname.replace(/^[^a-z]*embark[^a-z]*/i, "").slice(0, 60) || it.name : "", target: "", ...x[key], ...p } }));
  const itemByKey = useMemo(() => new Map(items.flatMap((x) => x.list.map((i) => [i.key, i] as const))), [items]);

  async function makeBrand() {
    const name = (newBrand || "").trim();
    if (!name || !cust) return;
    const { data, error } = await sb.from("brands").insert({ customer_id: cust, name, sort: brands.length + 1 }).select("*").single();
    if (error) return setLog([`Couldn't make the brand: ${error.message}`]);
    setBrands([...brands, data as Brand]); setBrand((data as Brand).id); setNewBrand(null);
  }
  async function file(path: string): Promise<File> {
    const { data, error } = await sb.storage.from("proofs").download(path);
    if (!data) throw new Error(`Couldn't open ${nameOf(path)}: ${error?.message || "not found"}`);
    return new File([data], nameOf(path), { type: data.type && data.type !== "application/octet-stream" ? data.type : typeOf(extOf(path)) });
  }
  async function bringIn() {
    const missing = picked.filter(([, p]) => p.as === "sew" && !p.target);
    if (missing.length) return setLog([`Say which logo each sew file goes with (${missing.length} not set).`]);
    setBusy(true);
    const out: string[] = [];
    const made = new Map<string, D>();
    const { data: u } = await sb.auth.getUser();
    // the logos first, so a sew file can go on one made just now
    for (const [key, p] of newLogos) {
      const it = itemByKey.get(key); if (!it) continue;
      try {
        const d = (await uploadDesign(sb, { file: await file(it.path), customer_id: cust, name: p.name.trim() || it.name, by: u.user?.email || "", notes: `From Printavo #${it.job.visual_id} (${it.job.nickname})` })) as D;
        const specs = { ...((d.specs || {}) as object), source: { printavo: it.job.visual_id, path: it.path } };
        await sb.from("designs").update({ specs, ...(brand ? { brand_id: brand } : {}) }).eq("id", d.id);
        made.set(key, { ...d, specs, brand_id: brand || null } as D);
        out.push(`D-${d.number} ${p.name || it.name}${brand ? ` · ${brands.find((b) => b.id === brand)?.name}` : ""}`);
      } catch (e) { out.push(`${it.name}: ${e instanceof Error ? e.message : "couldn't bring it in"}`); }
    }
    for (const [key, p] of picked.filter(([, x]) => x.as === "sew")) {
      const it = itemByKey.get(key); if (!it) continue;
      try {
        const id = made.get(p.target)?.id || p.target;
        const { data: row } = await sb.from("designs").select("id, number, specs").eq("id", id).maybeSingle();
        if (!row) throw new Error("that logo isn't there");
        const sp = (row.specs || {}) as Record<string, unknown>, em = (sp.embroidery || {}) as { files?: SewFile[] };
        const code = nextSewCode(em.files || []), name = tajimaName(row.number as number, Number(code.slice(1)));
        const files = await Promise.all([it.path, it.emb, it.sheet].filter(Boolean).map((x) => file(x!)));
        const named = await Promise.all(files.map((f) => tajimaFile(f, name)));
        const { takeDigitized } = await import("@/lib/digitizedFiles");
        const { set: s } = await takeDigitized(sb, id, named);
        const sew = { ...s, code, kind: "flat", source: it.path } as SewFile & { source: string };
        const specs = { ...sp, embroidery: { ...em, files: [...(em.files || []), sew] } };
        const { error } = await sb.from("designs").update({ specs }).eq("id", id);
        if (error) throw new Error(error.message);
        out.push(`${name} on D-${row.number}: ${s.wIn}" × ${s.hIn}", ${s.stitches.toLocaleString()} stitches${s.emb ? ", with its EMB" : ""}${s.sheet ? " and sewing sheet" : ""}`);
      } catch (e) { out.push(`${it.name}: ${e instanceof Error ? e.message : "couldn't file the sew file"}`); }
    }
    setLog(out); setPicks({}); setBusy(false);
    void loadDesigns(cust);
  }

  const targets = [...newLogos.map(([k, p]) => ({ id: k, label: `New: ${p.name || itemByKey.get(k)?.name || "logo"}` })), ...designs.map((d) => ({ id: d.id, label: `D-${d.number} ${d.name || ""}`.trim() }))];

  return (
    <>
      <div className="page-head">
        <div><h1>Customer artwork builder</h1><div className="eyebrow">A client&apos;s Printavo jobs and their files. Tick a job, say what each file is, bring it in.</div></div>
        <div className="row"><Link className="btn" href="/shop/artwork">Artwork</Link><button type="button" className="btn primary" disabled={!picked.length || busy} onClick={() => void bringIn()}>{busy ? "Bringing in…" : `Bring in ${picked.length || ""}`.trim()}</button></div>
      </div>
      <div className="toolbar bi-tools">
        <CustomerPick compact value={cust || null} options={custOpts} placeholder="Client: type one" ariaLabel="Client" onPick={(v) => setCust(v || "")} />
        <label className="aa-search"><SearchInput placeholder="Jobs named… (embark)" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        {cust && (newBrand === null
          ? <label className="bi-brand"><span className="faint">Logos go under</span><select value={brand} onChange={(e) => (e.target.value === "+" ? setNewBrand("") : setBrand(e.target.value))}><option value="">No brand (the client itself)</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}<option value="+">+ New brand…</option></select></label>
          : <span className="bi-brand"><input type="text" autoFocus placeholder="Brand name (Embark)" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void makeBrand(); if (e.key === "Escape") setNewBrand(null); }} /><button type="button" className="btn sm" disabled={!newBrand.trim()} onClick={() => void makeBrand()}>Make brand</button><button type="button" className="btn sm ghost" onClick={() => setNewBrand(null)}>Cancel</button></span>)}
      </div>
      {log.length > 0 && <div className="panel bi-log"><div className="panel-b">{log.map((l, i) => <div key={i}>{l}</div>)}</div></div>}
      {!cust ? <div className="aa-empty">Pick a client to see their Printavo jobs.</div> : !jobs ? <div className="aa-empty">Loading their jobs…</div> : !items.length ? <div className="aa-empty">No jobs with files{q ? ` named "${q}"` : ""}.</div> : (
        <>
          <p className="faint" style={{ margin: "4px 0 10px" }}>{items.length} job{items.length === 1 ? "" : "s"} with files, newest first.</p>
          {items.slice(0, n).map(({ j, list }) => (
            <section key={j.id} className="panel bi-job">
              <label className="panel-h bi-jh"><input type="checkbox" checked={openJobs.has(j.id)} onChange={() => setOpenJobs((x) => { const m = new Set(x); if (m.has(j.id)) m.delete(j.id); else m.add(j.id); return m; })} />
                <h2><span className="ordno">#{j.visual_id}</span> {j.nickname}</h2><span className="faint">{j.order_date ? new Date(j.order_date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : ""} · {list.length} file{list.length === 1 ? "" : "s"}{list.some((i) => done.has(i.path)) ? " · some brought in" : ""}</span>
                {list.filter((i) => picks[i.key]?.on).length > 0 && <span className="bi-cnt">{list.filter((i) => picks[i.key]?.on).length} picked</span>}</label>
              {openJobs.has(j.id) && <div className="panel-b bi-files">
                {list.map((it) => {
                  const p = picks[it.key], had = done.get(it.path);
                  if (it.kind === "other") return <a key={it.key} className="bi-f other" href={`/api/files/open?${new URLSearchParams({ p: it.path })}`} target="_blank" rel="noreferrer"><span className="bi-pic"><span className="bi-ext">{it.ext.toUpperCase() || "FILE"}</span></span><span className="bi-n">{it.name}</span></a>;
                  return (
                    <div key={it.key} className={"bi-f" + (p?.on ? " on" : "") + (had ? " had" : "")}>
                      <label className="bi-top">
                        {it.kind === "sew" ? <span className="bi-pic"><span className="bi-ext">DST</span>{it.emb && <span className="bi-ext sm">EMB</span>}{it.sheet && <span className="bi-ext sm">PDF</span>}</span> : PREVIEW.test(it.ext) ? <Pic sb={sb} path={it.path} /> : <span className="bi-pic"><span className="bi-ext">{it.ext.toUpperCase()}</span></span>}
                        <span className="bi-n"><input type="checkbox" checked={!!p?.on} onChange={(e) => (e.target.checked ? set(it.key, { on: true }, it) : setPicks((x) => ({ ...x, [it.key]: { ...x[it.key], on: false } })))} /> {it.name}</span>
                      </label>
                      {it.kind === "sew" && <DstInfo sb={sb} path={it.path} />}
                      {it.kind === "sew" && (it.emb || it.sheet) && <span className="faint">with {[it.emb && nameOf(it.emb), it.sheet && nameOf(it.sheet)].filter(Boolean).join(" and ")}</span>}
                      {had && !p?.on && <span className="bi-had">Brought in: {had}</span>}
                      {p?.on && (it.kind === "sew" ? (
                        <select aria-label="Sew file for" value={p.target} onChange={(e) => set(it.key, { target: e.target.value })}>
                          <option value="">Sew file for which logo?</option>
                          {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                      ) : (
                        <input type="text" aria-label="Logo name" placeholder="Logo name" value={p.name} onChange={(e) => set(it.key, { name: e.target.value })} />
                      ))}
                    </div>
                  );
                })}
              </div>}
            </section>
          ))}
          {items.length > n && <button type="button" className="btn" style={{ display: "block", margin: "8px auto" }} onClick={() => setN(n + 15)}>Show more jobs ({items.length - n} more)</button>}
        </>
      )}
    </>
  );
}
