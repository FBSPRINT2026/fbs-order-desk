"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import { fmtDate } from "@/lib/format";
import { ART_ACCEPT, ART_KINDS, SEP_STATUS, artProblem, readVector, uploadSepArt, type SepRow } from "@/components/SeparationStudio";
import { vartSvg } from "@/lib/epsVector";

/**
 * Separations queue (Production → Separations): every imprint waiting for films, from "Request Separations" on an
 * order, or from art uploaded right here (no order needed). Open one to separate it here, or upload what came back
 * from Separo.
 */
const TABS = [["open", "To do"], ["review", "Ready for review"], ["approved", "Approved"], ["all", "All"]] as const;
type Tab = (typeof TABS)[number][0];

export default function SeparationsPage() {
  const sb = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<SepRow[] | null>(null);
  const [orders, setOrders] = useState<Record<string, { number: number; nickname: string; due_date: string | null }>>({});
  const [cust, setCust] = useState<Record<string, string>>({});
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [tab, setTab] = useSticky<Tab>("sep.tab.list", "open");
  const [q, setQ] = useState("");

  useEffect(() => { (async () => {
    const { data } = await sb.from("separations").select("*").neq("status", "cancelled").order("created_at", { ascending: false }).limit(500);
    const list = (data || []) as SepRow[];
    setRows(list);
    const oids = [...new Set(list.map((r) => r.order_id).filter(Boolean))] as string[], cids = [...new Set(list.map((r) => r.customer_id).filter(Boolean))] as string[];
    const [{ data: o }, { data: c }] = await Promise.all([
      oids.length ? sb.from("orders").select("id, number, nickname, due_date").in("id", oids) : Promise.resolve({ data: [] }),
      cids.length ? sb.from("customers").select("id, company, name").in("id", cids) : Promise.resolve({ data: [] }),
    ]);
    setOrders(Object.fromEntries(((o || []) as { id: string; number: number; nickname: string; due_date: string | null }[]).map((x) => [x.id, x])));
    setCust(Object.fromEntries(((c || []) as { id: string; company: string; name: string }[]).map((x) => [x.id, x.company || x.name])));
    // a small picture: the saved proof, else the design
    const upArt = (r: SepRow) => { const a = (r.settings as { art?: { path: string; preview?: string } }).art; return a?.preview || a?.path; };
    const dids = [...new Set(list.filter((r) => !r.preview_path && !upArt(r) && r.design_id).map((r) => r.design_id))] as string[];
    const { data: ds } = dids.length ? await sb.from("designs").select("id, preview_path, file_path").in("id", dids) : { data: [] };
    const pathOf = new Map<string, string>();
    for (const r of list) { const d = ((ds || []) as { id: string; preview_path: string; file_path: string }[]).find((x) => x.id === r.design_id); const p = r.preview_path || upArt(r) || d?.preview_path || d?.file_path; if (p) pathOf.set(r.id, p); }
    const paths = [...new Set(pathOf.values())];
    if (paths.length) { const { data: sg } = await sb.storage.from("proofs").createSignedUrls(paths, 3600); const m = new Map(paths.map((p, i) => [p, sg?.[i]?.signedUrl || ""])); setThumbs(Object.fromEntries([...pathOf].map(([id, p]) => [id, m.get(p) || ""]))); }
  })(); }, [sb]);

  const shown = (rows || []).filter((r) => (tab === "all" ? true : tab === "open" ? r.status === "requested" || r.status === "in_progress" : tab === "review" ? r.status === "review" : r.status === "approved" || r.status === "films"))
    .filter((r) => { const s = q.trim().toLowerCase(); if (!s) return true; const o = r.order_id ? orders[r.order_id] : null; return [`s-${r.number}`, o ? `#${o.number} ${o.nickname}` : "", cust[r.customer_id || ""] || "", r.location, r.garment_color].join(" ").toLowerCase().includes(s); });
  const count = (t: Tab) => (rows || []).filter((r) => (t === "all" ? true : t === "open" ? r.status === "requested" || r.status === "in_progress" : t === "review" ? r.status === "review" : r.status === "approved" || r.status === "films")).length;

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Production</div><h1>Separations</h1></div>
      </div>
      <NewFromArt />
      <div className="tmx-vbar">
        <div className="rv-seg">{TABS.map(([k, l]) => <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}{rows ? <span className="sep-cnt">{count(k)}</span> : null}</button>)}</div>
        <input className="tmx-q" type="search" placeholder="Order, customer, location…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search separations" />
      </div>
      {!rows ? <div className="empty">Loading…</div> : !shown.length ? <div className="empty">{tab === "open" ? "Nothing waiting. Request separations from an approved order, or upload an image above." : "Nothing here."}</div> : (
        <div className="sep-q">{shown.map((r) => {
          const o = r.order_id ? orders[r.order_id] : null, st = SEP_STATUS[r.status];
          const due = r.due_date || o?.due_date;
          return (
            <Link key={r.id} href={`/shop/separations/${r.id}`} className="sep-qi">
              <span className="sep-qt" style={{ background: r.garment_color ? undefined : "var(--surface-2)" }}>{thumbs[r.id] ? <img src={thumbs[r.id]} alt="" /> : <span className="faint">No art</span>}</span>
              <span className="sep-qb">
                <b>{o ? `#${o.number}` : `S-${r.number}`} · {r.location || "Imprint"}</b>
                <span>{o ? <>{cust[r.customer_id || ""] || ""}{o.nickname ? ` · ${o.nickname}` : ""}</> : cust[r.customer_id || ""] || <span className="faint">Uploaded art · no order</span>}</span>
                <small className="faint">{r.garment_color || "—"}{r.channels.length ? ` · ${r.channels.length} screen${r.channels.length === 1 ? "" : "s"}` : ""}{due ? ` · due ${fmtDate(due)}` : ""}</small>
              </span>
              <span className="pill" style={{ ["--sc" as string]: st.c }}>{st.label}</span>
            </Link>
          );
        })}</div>
      )}
    </>
  );
}

const SHIRTS = ["Black", "White", "Navy", "Charcoal", "Sport Grey", "Heather Grey", "Royal", "Red", "Maroon", "Forest Green", "Kelly Green", "Orange", "Gold", "Purple", "Pink", "Natural", "Sand"];

/** Separate any image without an order: drop it, name it, pick the shirt, and it opens in the Studio. */
function NewFromArt() {
  const sb = useMemo(() => createClient(), []);
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null), [thumb, setThumb] = useState("");
  const [name, setName] = useState(""), [shirt, setShirt] = useState("Black");
  // the print size comes first: a picture can only be made so big before it prints pixelated (vector art: any size)
  const [widthIn, setWidthIn] = useState(11), [dims, setDims] = useState<{ w: number; h: number; vector: boolean } | null>(null);
  const [over, setOver] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  useEffect(() => () => { if (thumb) URL.revokeObjectURL(thumb); }, [thumb]);
  async function pickFile(f?: File) {
    if (!f) return;
    const bad = await artProblem(f); if (bad) { setErr(bad); return; }
    const v = await readVector(f, f.name, f.type);
    const url = URL.createObjectURL(v ? new Blob([vartSvg(v)], { type: "image/svg+xml" }) : f);
    setErr(""); setFile(f); setThumb(url); setName(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 60));
    const vector = !!v || /\.svg$/i.test(f.name) || /svg/i.test(f.type);
    const im = new Image(); im.onload = () => setDims({ w: im.naturalWidth, h: im.naturalHeight, vector }); im.src = url;
  }
  async function start() {
    if (!file) return;
    setBusy(true); setErr("");
    const { data: { user } } = await sb.auth.getUser(), me = (user?.email || "").toLowerCase();
    const ins = await sb.from("separations").insert({ location: name.trim() || "Uploaded art", garment_color: shirt.trim(), status: "in_progress", requested_by: me, assigned_to: me }).select("*").single();
    if (ins.error) { setErr(ins.error.message); setBusy(false); return; }
    const row = ins.data as SepRow;
    try {
      const art = await uploadSepArt(sb, row.id, file);
      const r = await sb.from("separations").update({ settings: { art, widthIn }, updated_at: new Date().toISOString() }).eq("id", row.id);
      if (r.error) throw new Error(r.error.message);
      router.push(`/shop/separations/${row.id}`);
    } catch (e) {
      // keep the record, but out of the way
      await sb.from("separations").update({ status: "cancelled", notes: "Upload failed", updated_at: new Date().toISOString() }).eq("id", row.id);
      setErr(e instanceof Error ? e.message : String(e)); setBusy(false);
    }
  }
  const reset = () => { setFile(null); setThumb(""); setName(""); setErr(""); setDims(null); };
  // how sharp the art is at this width (pixels per inch)
  const ppi = dims && !dims.vector ? Math.round(dims.w / widthIn) : 0, sharpTo = dims ? Math.floor((dims.w / 300) * 4) / 4 : 0;
  const lvl = !dims ? "" : dims.vector ? "ok" : ppi >= 250 ? "ok" : ppi >= 150 ? "warn" : "bad";
  return (
    <section className="sep-new">
      {!file ? (
        <label className={"sep-new-drop" + (over ? " over" : "")} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); pickFile(e.dataTransfer.files[0]); }}>
          <input type="file" accept={ART_ACCEPT} onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
          <span className="sep-new-ic" aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
          </span>
          <span className="sep-new-t"><b>Separate an image</b><small className="faint">No order needed. Drop art here or choose a file: {ART_KINDS}.</small></span>
          <span className="btn sm">Choose File</span>
        </label>
      ) : (
        <div className="sep-new-form">
          <span className="sep-new-th">{thumb && <img src={thumb} alt="" />}</span>
          <label className="sep-f">Name<input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="What is it?" autoFocus /></label>
          <label className="sep-f">Shirt color<input type="text" list="sep-shirts" value={shirt} onChange={(e) => setShirt(e.target.value)} /></label>
          <label className="sep-f" title="How wide the print is on the shirt">Print width (in)<input type="number" min={1} max={20} step={0.25} value={widthIn} onChange={(e) => setWidthIn(+e.target.value || 1)} /></label>
          <datalist id="sep-shirts">{SHIRTS.map((c) => <option key={c} value={c} />)}</datalist>
          <span className="sep-new-go">
            <button type="button" className="btn" disabled={busy} onClick={reset}>Cancel</button>
            <button type="button" className="btn primary" disabled={busy} onClick={start}>{busy ? "Uploading…" : lvl === "bad" ? "Start Anyway" : "Start Separating"}</button>
          </span>
          {dims && <div className={"sep-res " + lvl}>
            {dims.vector ? <>Vector art: sharp at any size. {widthIn}&quot; × {Math.round(widthIn * (dims.h / dims.w) * 100) / 100}&quot;.</>
              : <>{dims.w} × {dims.h} px → <b>{ppi} ppi</b> at {widthIn}&quot; × {Math.round(widthIn * (dims.h / dims.w) * 100) / 100}&quot;. {lvl === "ok" ? "Sharp." : lvl === "warn" ? `Usable, a little soft; sharp up to ${sharpTo}" (300 ppi).` : `Too small for ${widthIn}": it will print pixelated. Sharp up to ${sharpTo}". Get bigger art or vector (SVG / EPS) for this size.`}</>}
          </div>}
        </div>
      )}
      {err && <div className="pv-err">{err}</div>}
    </section>
  );
}
