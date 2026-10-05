"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { SepRow } from "@/components/SeparationStudio";
import { ARCHIVE_DAYS, SEP_STATUS, sepStage } from "@/lib/sepStatus";

/**
 * A customer's production files, under their Artwork (staff only, never in the portal): what we print or sew from,
 * so it stays with the shop and a customer can't take it to another printer and get the same job.
 *   - Separations: made for their orders, or saved to them from Production → Separations.
 *   - Other files: digitized embroidery files (DST, EMB, PES…), films, anything else we keep for repeats. Stored in
 *     the staff-only "proofs" bucket at production/<customer id>/ (archived ones under _archived/, never deleted).
 * Both the separations table and the bucket are staff-only in the database (RLS is_staff()).
 */
const KIND: [RegExp, string][] = [
  [/\.(dst|exp|emb|pes|pec|jef|vp3|xxx|hus|vip|sew|pxf|dsb|tap|art)$/i, "Embroidery"],
  [/\.(pdf|eps|ai|svg)$/i, "Art / films"],
  [/\.(png|jpe?g|tiff?|psd|webp)$/i, "Image"],
];
const kindOf = (name: string) => KIND.find(([re]) => re.test(name))?.[1] || "File";
const size = (n?: number) => (!n ? "" : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
type F = { name: string; path: string; size?: number; at?: string };
/** stored as <timestamp>-<name>: show just the name */
const shown = (n: string) => n.replace(/^\d{10,}-/, "");

export default function CustomerProductionFiles({ customerId }: { customerId: string }) {
  const sb = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<SepRow[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [showArch, setShowArch] = useState(false);
  const [files, setFiles] = useState<F[] | null>(null), [archFiles, setArchFiles] = useState<F[]>([]), [showArchF, setShowArchF] = useState(false);
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [over, setOver] = useState(false);
  const dir = `production/${customerId}`;

  useEffect(() => { (async () => {
    const since = new Date(Date.now() - ARCHIVE_DAYS * 86400000).toISOString();
    const { data } = await sb.from("separations").select("*").eq("customer_id", customerId).or(`status.neq.cancelled,updated_at.gte.${since}`).order("created_at", { ascending: false }).limit(200);
    const list = (data || []) as SepRow[];
    setRows(list);
    const pathOf = new Map<string, string>();
    for (const r of list) { const a = (r.settings as { art?: { path: string; preview?: string } }).art; const p = r.preview_path || a?.preview || a?.path; if (p && /\.(png|jpe?g|webp|svg)$/i.test(p)) pathOf.set(r.id, p); }
    const paths = [...new Set(pathOf.values())];
    if (paths.length) { const { data: sg } = await sb.storage.from("proofs").createSignedUrls(paths, 3600); const m = new Map(paths.map((p, i) => [p, sg?.[i]?.signedUrl || ""])); setThumbs(Object.fromEntries([...pathOf].map(([id, p]) => [id, m.get(p) || ""]))); }
  })(); }, [sb, customerId]);

  const loadFiles = useCallback(async () => {
    const ls = async (d: string) => {
      const { data } = await sb.storage.from("proofs").list(d, { limit: 500, sortBy: { column: "created_at", order: "desc" } });
      return ((data || []) as { name: string; id: string | null; created_at?: string; metadata?: { size?: number } | null }[])
        .filter((o) => o.id && o.name !== ".emptyFolderPlaceholder").map((o) => ({ name: o.name, path: `${d}/${o.name}`, size: o.metadata?.size, at: o.created_at }));
    };
    const [live, old] = await Promise.all([ls(dir), ls(`${dir}/_archived`)]);
    setFiles(live); setArchFiles(old);
  }, [sb, dir]);
  useEffect(() => { loadFiles(); }, [loadFiles]);

  async function upload(list: FileList | File[] | null) {
    const fs = [...(list || [])]; if (!fs.length) return;
    setErr(""); setBusy(`Uploading ${fs.length} file${fs.length === 1 ? "" : "s"}…`);
    for (const f of fs) {
      const path = `${dir}/${Date.now()}-${f.name.replace(/[^\w.() -]+/g, "_")}`;
      const r = await sb.storage.from("proofs").upload(path, f, { contentType: f.type || "application/octet-stream" });
      if (r.error) { setErr(`${f.name}: ${r.error.message}`); break; }
    }
    setBusy(""); loadFiles();
  }
  async function open(f: F) {
    const { data } = await sb.storage.from("proofs").createSignedUrl(f.path, 600, { download: shown(f.name) });
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }
  // archive = move into _archived/ (nothing is deleted); restore moves it back
  async function move(f: F, archive: boolean) {
    setErr("");
    const to = archive ? `${dir}/_archived/${f.name}` : `${dir}/${f.name}`;
    const r = await sb.storage.from("proofs").move(f.path, to);
    if (r.error) setErr(r.error.message); else loadFiles();
  }

  const live = (rows || []).filter((r) => sepStage(r.status) !== "archived"), arch = (rows || []).filter((r) => sepStage(r.status) === "archived");
  const card = (r: SepRow) => {
    const st = SEP_STATUS[r.status];
    return (
      <Link key={r.id} href={`/shop/separations/${r.id}`} className="design-card csep">
        <span className="dc-img">{thumbs[r.id] ? <img src={thumbs[r.id]} alt="" loading="lazy" /> : <span>S-{r.number}</span>}</span>
        <span className="dc-b"><b>S-{r.number}</b><span>{r.location || "Separation"}</span>
          <span className="faint">{[r.garment_color, r.channels.length ? `${r.channels.length} screen${r.channels.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") || "—"}</span>
          <span className="pill" style={{ ["--sc" as string]: st.c, alignSelf: "flex-start", marginTop: 4 }}>{st.label}</span></span>
      </Link>
    );
  };
  const fileRow = (f: F, archived: boolean) => (
    <li key={f.path} className="pf-file">
      <span className="pf-kind">{kindOf(f.name)}</span>
      <button type="button" className="linkbtn pf-name" onClick={() => open(f)} title="Download" data-notranslate>{shown(f.name)}</button>
      <span className="faint pf-meta">{[size(f.size), f.at ? new Date(f.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""].filter(Boolean).join(" · ")}</span>
      <button type="button" className="btn sm ghost" onClick={() => move(f, !archived)} title={archived ? "Back to the files" : "Archive (kept, out of the list)"}>{archived ? "Restore" : "Archive"}</button>
    </li>
  );

  return (
    <div className="aa-card pf">
      <div className="aa-sec-h"><h3>Production files</h3><span className="pf-staff" title="Only shop staff see these. They never show in the customer's portal.">Staff only</span>
        <span className="faint">What we print and sew from. Kept with the shop: the customer never sees these.</span></div>

      <div className="pf-h"><h4>Separations</h4><span className="spacer" /><Link className="btn sm" href={`/shop/separations?customer=${customerId}`}>+ Separate New Art</Link></div>
      {!rows ? <div className="aa-empty">Loading…</div> : live.length ? <div className="design-grid aa-grid3">{live.map(card)}</div> : <div className="aa-empty">No separations for this customer yet. In a separation, pick the customer next to its number to save it here.</div>}
      {arch.length > 0 && (
        <div className="aa-arch">
          <button type="button" className="btn sm ghost" onClick={() => setShowArch(!showArch)}>{showArch ? "Hide archived separations" : `View archived separations (${arch.length})`}</button>
          {showArch && <div className="design-grid aa-grid3" style={{ marginTop: 10 }}>{arch.map(card)}</div>}
        </div>
      )}

      <div className="pf-h"><h4>Other files</h4><span className="faint">Digitized embroidery files (DST, EMB, PES…), films, anything kept for repeats.</span></div>
      <label className={"pf-drop" + (over ? " over" : "")} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}>
        <input type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        <span>{busy || <>Drop files here or <u>choose files</u></>}</span>
      </label>
      {err && <div className="pv-err">{err}</div>}
      {files === null ? <div className="aa-empty">Loading…</div> : files.length ? <ul className="pf-files">{files.map((f) => fileRow(f, false))}</ul> : <div className="aa-empty">No other production files yet.</div>}
      {archFiles.length > 0 && (
        <div className="aa-arch">
          <button type="button" className="btn sm ghost" onClick={() => setShowArchF(!showArchF)}>{showArchF ? "Hide archived files" : `View archived files (${archFiles.length})`}</button>
          {showArchF && <ul className="pf-files" style={{ marginTop: 8 }}>{archFiles.map((f) => fileRow(f, true))}</ul>}
        </div>
      )}
    </div>
  );
}
