"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import { fmtDate } from "@/lib/format";
import { ARCHIVE_DAYS, ART_ACCEPT, ART_KINDS, SEP_STATUS, sepStage, prepareSepArt, readVector, uploadSepArt, type SepRow } from "@/components/SeparationStudio";
import { vartSvg } from "@/lib/epsVector";
import CustomerPick from "@/components/CustomerPick";
import { orderGroups } from "@/lib/pricing";
import { colorHex, deltaE, repaintLogo } from "@/lib/inkColors";
import { guessHex, shirtHex } from "@/lib/mockup";
import { shirtSets } from "@/lib/shirtSets";

/**
 * Separations queue (Production → Separations): one row per job (Oct 22, Nick: "you shouldn't separate the separations
 * by location. It should just be the jobs… with the front, the back… little label"). Each print is a small picture of
 * the art as on the mockup (its inks, on the shirt color); a print going on two shirt colors shows both. Art uploaded
 * here without an order is its own row.
 */
const TABS = [["working", "Working"], ["printed", "Printed"], ["archived", "Archived"], ["all", "All"]] as const;
type Tab = (typeof TABS)[number][0];
type OrderLite = { id: string; number: number; nickname: string; due_date: string | null; groups: unknown; lines: unknown };
/** print order: front ones, then back, then sleeves and the rest */
const locRank = (loc: string) => { const l = (loc || "").toLowerCase(); return /sleeve/.test(l) ? 3 : /back|yoke|shoulder/.test(l) ? 2 : /front|chest|pocket|vertical/.test(l) ? 1 : 4; };
const loadImg = (url: string) => new Promise<HTMLImageElement>((ok, no) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => ok(im); im.onerror = no; im.src = url; });

export default function SeparationsPage() {
  const sb = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<SepRow[] | null>(null);
  const [orders, setOrders] = useState<Record<string, OrderLite>>({});
  const [cust, setCust] = useState<Record<string, string>>({});
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [tab, setTab] = useSticky<Tab>("sep.tab.list2", "working");
  const [q, setQ] = useState("");
  // archive / restore straight from the list: the whole job's prints (the row moves tabs)
  async function setStage(rs: SepRow[], status: SepRow["status"]) {
    const ids = new Set(rs.map((r) => r.id)), at = new Date().toISOString();
    setRows((xs) => (xs || []).map((x) => (ids.has(x.id) ? { ...x, status, updated_at: at } : x)));
    const { error } = await sb.from("separations").update({ status, updated_at: at }).in("id", [...ids]);
    if (error) setRows((xs) => (xs || []).map((x) => rs.find((r) => r.id === x.id) || x));
  }

  useEffect(() => { (async () => {
    // archived ones show for ARCHIVE_DAYS days after they were archived
    const since = new Date(Date.now() - ARCHIVE_DAYS * 86400000).toISOString();
    const { data } = await sb.from("separations").select("*").or(`status.neq.cancelled,updated_at.gte.${since}`).order("created_at", { ascending: false }).limit(500);
    const list = (data || []) as SepRow[];
    setRows(list);
    const oids = [...new Set(list.map((r) => r.order_id).filter(Boolean))] as string[], cids = [...new Set(list.map((r) => r.customer_id).filter(Boolean))] as string[];
    const [{ data: o }, { data: c }] = await Promise.all([
      oids.length ? sb.from("orders").select("id, number, nickname, due_date, groups, lines").in("id", oids) : Promise.resolve({ data: [] }),
      cids.length ? sb.from("customers").select("id, company, name").in("id", cids) : Promise.resolve({ data: [] }),
    ]);
    const om = Object.fromEntries(((o || []) as OrderLite[]).map((x) => [x.id, x]));
    setOrders(om);
    setCust(Object.fromEntries(((c || []) as { id: string; company: string; name: string }[]).map((x) => [x.id, x.company || x.name])));
    // a small picture: the saved proof (how it prints), else the art repainted in the mockup's inks
    const upArt = (r: SepRow) => { const a = (r.settings as { art?: { path: string; preview?: string } }).art; return a?.preview || a?.path; };
    const dids = [...new Set(list.filter((r) => !r.preview_path && !upArt(r) && r.design_id).map((r) => r.design_id))] as string[];
    const { data: ds } = dids.length ? await sb.from("designs").select("id, preview_path, file_path").in("id", dids) : { data: [] };
    const pathOf = new Map<string, { p: string; art: boolean }>();
    for (const r of list) {
      const d = ((ds || []) as { id: string; preview_path: string; file_path: string }[]).find((x) => x.id === r.design_id);
      const p = r.preview_path || upArt(r) || d?.preview_path || d?.file_path;
      if (p) pathOf.set(r.id, { p, art: !r.preview_path && !upArt(r) });
    }
    const paths = [...new Set([...pathOf.values()].map((x) => x.p))];
    if (!paths.length) return;
    const { data: sg } = await sb.storage.from("proofs").createSignedUrls(paths, 3600);
    const m = new Map(paths.map((p, i) => [p, sg?.[i]?.signedUrl || ""]));
    setThumbs(Object.fromEntries([...pathOf].map(([id, x]) => [id, m.get(x.p) || ""])));
    // the design's art in the inks picked on the mockup (#40091: the black and white logo printed all white)
    for (const r of list) {
      const x = pathOf.get(r.id), url = x && m.get(x.p);
      if (!x?.art || !url || !r.order_id || !om[r.order_id]) continue;
      const im = orderGroups(om[r.order_id] as never).flatMap((g) => g.imprints).find((y) => y.id === r.imprint_id) as { inkMap?: { design: string; map: Record<string, { name: string; hex: string }> } } | undefined;
      const map = im?.inkMap && (!r.design_id || im.inkMap.design === r.design_id) ? im.inkMap.map : null;
      if (!map || !Object.keys(map).length) continue;
      try {
        const pic = await loadImg(url);
        const painted = repaintLogo(pic, Object.fromEntries(Object.entries(map).map(([src, v]) => [src, v.name === "none" ? "none" : v.hex])), 240);
        setThumbs((t) => ({ ...t, [r.id]: painted }));
      } catch { /* the plain art stays */ }
    }
  })(); }, [sb]);

  /** the shirt colors a print goes on: its group, and any group printing the same art in the same spot */
  const shirtsOf = (r: SepRow): { name: string; hex: string }[] => {
    const o = r.order_id ? orders[r.order_id] : null, out: { name: string; hex: string }[] = [];
    const add = (c: string) => { const hex = shirtHex(c) || colorHex(c) || guessHex(c); if (hex && !out.some((x) => deltaE(x.hex, hex) < 12)) out.push({ name: c, hex }); };
    if (o) {
      const gs = orderGroups(o as never).filter((g) => g.id === r.group_id || (!!r.design_id && g.imprints.some((im) => im.design_id === r.design_id && im.location === r.location)));
      for (const c of new Set(gs.flatMap((g) => g.lines).filter((l) => Object.values(l.sizes || {}).some((n) => +(n || 0) > 0)).map((l) => l.color).filter(Boolean))) add(c);
    }
    if (!out.length && r.garment_color) add(r.garment_color);
    return out;
  };
  // shirts that print alike are one (Violet and Purple); the split picture is only for really different shirts
  const setsOf = (r: SepRow) => shirtSets(shirtsOf(r));

  const inTab = (r: SepRow, t: Tab) => (t === "all" ? sepStage(r.status) !== "archived" : sepStage(r.status) === t);
  // one row per job: its prints in this tab, front first
  const jobs = useMemo(() => {
    const by = new Map<string, SepRow[]>();
    for (const r of (rows || []).filter((x) => inTab(x, tab))) { const k = r.order_id || r.id; by.set(k, [...(by.get(k) || []), r]); }
    return [...by.values()].map((rs) => rs.sort((a, b) => locRank(a.location) - locRank(b.location) || a.location.localeCompare(b.location)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, tab]);
  const shown = jobs.filter((rs) => {
    const s = q.trim().toLowerCase(); if (!s) return true;
    const r = rs[0], o = r.order_id ? orders[r.order_id] : null;
    return [o ? `#${o.number} ${o.nickname}` : "", cust[r.customer_id || ""] || "", ...rs.map((x) => `s-${x.number} ${x.location} ${x.garment_color}`)].join(" ").toLowerCase().includes(s);
  });
  const count = (t: Tab) => new Set((rows || []).filter((r) => inTab(r, t)).map((r) => r.order_id || r.id)).size;

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Production</div><h1>Separations</h1></div>
      </div>
      <NewFromArt />
      <div className="tmx-vbar">
        {tab === "archived" && <span className="faint" style={{ fontSize: 12.5 }}>Separations you&apos;re not using. They stay here {ARCHIVE_DAYS} days after they&apos;re archived; open one and Restore to work on it again.</span>}
        <div className="rv-seg">{TABS.map(([k, l]) => <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}{rows ? <span className="sep-cnt">{count(k)}</span> : null}</button>)}</div>
        <input className="tmx-q" type="search" placeholder="Order, customer, location…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search separations" />
      </div>
      {!rows ? <div className="empty">Loading…</div> : !shown.length ? <div className="empty">{tab === "working" ? "Nothing being worked on. Request separations from an approved order, or upload an image above." : tab === "archived" ? `Nothing archived in the last ${ARCHIVE_DAYS} days.` : "Nothing here."}</div> : (
        <div className="sep-q">{shown.map((rs) => {
          const r = rs[0], o = r.order_id ? orders[r.order_id] : null;
          const stage = rs.some((x) => sepStage(x.status) === "working") ? "working" : rs.some((x) => sepStage(x.status) === "printed") ? "printed" : "archived";
          const st = SEP_STATUS[stage === "working" ? "in_progress" : stage === "printed" ? "films" : "cancelled"];
          const due = rs.map((x) => x.due_date).find(Boolean) || o?.due_date;
          const screens = rs.reduce((n, x) => n + (x.channels?.length || 0), 0);
          const shirtNames = [...new Set(rs.flatMap((x) => shirtsOf(x).map((c) => c.name)))];
          // one set of films prints on every shirt: say so when the shirts really differ (Oct 22, Nick: "we're not actually
          // changing film… he just needs to know that somehow")
          const many = rs.map(setsOf).reduce((a, b) => (b.length > a.length ? b : a), [] as ReturnType<typeof setsOf>);
          return (
            <Link key={r.id} href={`/shop/separations/${r.id}`} className="sep-qi sep-qj">
              <span className="sep-qps">{rs.map((x) => {
                const sh = setsOf(x);
                const bg = sh.length > 1 ? `linear-gradient(90deg, ${sh.map((c, k) => `${c.hex} ${(k * 100) / sh.length}% ${((k + 1) * 100) / sh.length}%`).join(", ")})` : sh[0]?.hex || "var(--surface-2)";
                return (
                  <span key={x.id} className="sep-qp" title={`${x.location || "Print"}${sh.length ? ` on ${sh.flatMap((c) => c.names).join(", ")}` : ""}`}>
                    <span className="sep-qt" style={{ background: bg }}>
                      {thumbs[x.id] ? <img src={thumbs[x.id]} alt="" /> : <span className="faint">No art</span>}
                    </span>
                    <small>{x.location || "Print"}</small>
                  </span>
                );
              })}</span>
              <span className="sep-qb">
                <b>{o ? `#${o.number}${o.nickname ? ` ${o.nickname}` : ""}` : `S-${r.number} · ${r.location || "Uploaded art"}`}</b>
                <span>{cust[r.customer_id || ""] || (o ? "" : <span className="faint">Uploaded art · no order</span>)}</span>
                <small className="faint">{shirtNames.length ? shirtNames.join(", ") : "—"}{screens ? ` · ${screens} screen${screens === 1 ? "" : "s"}` : ""}{due ? ` · due ${fmtDate(due)}` : ""}</small>
                {many.length > 1 && <span className="sep-qsame" title={`One set of films prints on all of them: ${many.map((c) => c.names.join(" / ")).join(", ")}. Nothing is left to one shirt's color, and the underbase prints for the dark ones.`}>{many.map((c) => <i key={c.hex} style={{ background: c.hex }} />)}Same films on {many.length} shirt colors</span>}
              </span>
              <span className="sep-qr">
                <span className="pill" style={{ ["--sc" as string]: st.c }}>{st.label}</span>
                {stage === "archived"
                  ? <button type="button" className="btn sm ghost sep-qa" title="Back to Working" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setStage(rs, "in_progress"); }}>Restore</button>
                  : <button type="button" className="btn icon ghost sm sep-qa" title="Archive this job's separations (not using them): kept in Archived for 30 days" aria-label={o ? `Archive #${o.number}` : `Archive S-${r.number}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setStage(rs, "cancelled"); }}>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h18v4H3zM5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" /></svg>
                  </button>}
              </span>
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
  // the customer it's for (from a customer's Artwork: ?customer=…); it shows in their Artwork, under Separations
  const [cust, setCust] = useState<string | null>(null), [custLabel, setCustLabel] = useState("");
  useEffect(() => { const c = new URLSearchParams(location.search).get("customer"); if (c) setCust(c); }, []);
  const [name, setName] = useState(""), [shirt, setShirt] = useState(""); // none yet: every color prints
  // the print size comes first: a picture can only be made so big before it prints pixelated (vector art: any size)
  const [widthIn, setWidthIn] = useState(11), [dims, setDims] = useState<{ w: number; h: number; vector: boolean } | null>(null);
  const [over, setOver] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  useEffect(() => () => { if (thumb) URL.revokeObjectURL(thumb); }, [thumb]);
  const [orig, setOrig] = useState<File | null>(null), [note, setNote] = useState("");
  async function pickFile(f0?: File) {
    if (!f0) return;
    const prep = await prepareSepArt(f0); if ("error" in prep) { setErr(prep.error); return; }
    // an .ai / PDF with text, strokes or gradients comes back as a high-resolution picture (the original is kept)
    const f = prep.file; setOrig(prep.original || null); setNote(prep.note);
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
    const ins = await sb.from("separations").insert({ location: name.trim() || "Uploaded art", garment_color: shirt.trim(), status: "in_progress", requested_by: me, assigned_to: me, customer_id: cust }).select("*").single();
    if (ins.error) { setErr(ins.error.message); setBusy(false); return; }
    const row = ins.data as SepRow;
    try {
      const art = await uploadSepArt(sb, row.id, file, orig || undefined);
      if (note) art.note = note;
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
          <span className="sep-new-t"><b>Separate an image</b><small className="faint">No order needed. Drop art here or choose a file: {ART_KINDS}.{cust ? " It's saved to the customer you came from." : ""}</small></span>
          <span className="btn sm">Choose File</span>
        </label>
      ) : (
        <div className="sep-new-form">
          <span className="sep-new-th">{thumb && <img src={thumb} alt="" />}</span>
          <label className="sep-f">Name<input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="What is it?" autoFocus /></label>
          <label className="sep-f">Shirt color<input type="text" list="sep-shirts" value={shirt} placeholder="None yet: all colors print" onChange={(e) => setShirt(e.target.value)} /></label>
          <div className="sep-f">Customer <span className="faint">(optional)</span><CustomerPick value={cust} label={custLabel || undefined} placeholder="Save to a customer…" onPick={(id, l) => { setCust(id); setCustLabel(l); }} /></div>
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
      {note && !err && <div className="sep-art-note">{note}</div>}
    </section>
  );
}
