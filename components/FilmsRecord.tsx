"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { openZips } from "@/lib/sepZip";
import { filmRecord, saveFinalFilms, type MadeBy, type SepFilm } from "@/app/shop/sep-film-actions";

/**
 * Films · what went on press, on every separation (Nick, Nov 23 2026: "at the end, hey, what did we use? We used my
 * own Illustrator… a download and then an upload button… here was the art, here's what I made… link it back to the
 * Dropbox… every night you can learn"). Every try is listed (our Studio's Print Films, checked in the corner card) and
 * one set is marked used on press, with its files kept on the job, whoever made them. The nightly coach
 * (/api/cron/sep-coach) learns from the difference.
 */
const WHO: { k: MadeBy; label: string }[] = [
  { k: "studio", label: "Our Studio" }, { k: "separo", label: "Separo" }, { k: "illustrator", label: "Illustrator (by hand)" }, { k: "customer", label: "Customer's films" },
];
export const madeByText = (k: string) => WHO.find((w) => w.k === k)?.label || "Other";
const fmt = (v: number | null) => (v == null ? "" : (+v).toFixed(2).replace(/\.?0+$/, ""));
const when = (d: string) => new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function FilmsRecord({ sepId, origUrl, illustrator, size, pick }: {
  sepId: string; origUrl: string;
  /** downloads our separation as an Illustrator-ready file (layers per ink, at size) */
  illustrator: () => Promise<void>;
  size: { w: number; h: number; colors: number };
  /** ?films=separo|illustrator: opened from the corner card's "Something's wrong" */
  pick?: MadeBy | null;
}) {
  const sb = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<SepFilm[] | null>(null);
  const [open, setOpen] = useState(!!pick), [who, setWho] = useState<MadeBy>(pick || "separo");
  const [files, setFiles] = useState<File[]>([]), [dropbox, setDropbox] = useState(""), [note, setNote] = useState("");
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [over, setOver] = useState(false);
  const load = useCallback(async () => { const r = await filmRecord(sepId); if (r.ok) setRows(r.rows); }, [sepId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (pick) { setWho(pick); setOpen(true); } }, [pick]);
  const used = rows?.find((r) => r.used) || null;

  const take = async (fs: File[]) => { if (!fs.length) return; const all = await openZips(fs); setFiles((x) => [...x, ...all]); };
  const openFile = async (path: string) => { const { data } = await sb.storage.from("proofs").createSignedUrl(path, 600); if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener"); };
  async function save() {
    setErr("");
    if (who !== "studio" && !files.length && !dropbox.trim()) { setErr("Upload the films you printed, or paste their Dropbox link."); return; }
    setBusy("Saving…");
    try {
      const up: { path: string; name: string; size: number }[] = [];
      for (const f of files) {
        setBusy(`Uploading ${f.name}…`);
        const path = `separations/${sepId}/final-${Date.now()}-${f.name.replace(/[^\w.-]+/g, "_")}`;
        const r = await sb.storage.from("proofs").upload(path, f, { upsert: true, contentType: f.type || "application/octet-stream" });
        if (r.error) throw new Error(r.error.message);
        up.push({ path, name: f.name, size: f.size });
      }
      const r = await saveFinalFilms(sepId, { madeBy: who, files: up, dropbox, note, width: size.w || null, height: size.h || null, colors: size.colors || null });
      if (!r.ok) throw new Error(r.error);
      setFiles([]); setDropbox(""); setNote(""); setOpen(false); await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy("");
  }

  return (
    <section className="sep-card frc">
      <h3>Films · what went on press</h3>
      {used ? (
        <div className="frc-used">
          <span className="frc-k">✓ Used on press</span>
          <b>{madeByText(used.made_by)}</b><span className="faint"> · {used.width_in ? `${fmt(used.width_in)}" × ${fmt(used.height_in)}" · ` : ""}{when(used.checked_at || used.created_at)}{used.checked_by ? ` · ${used.checked_by.split("@")[0]}` : ""}</span>
          {(used.files.length > 0 || used.dropbox) && <div className="frc-files">
            {used.files.map((f) => <button key={f.path} type="button" className="frc-file" onClick={() => void openFile(f.path)} data-notranslate>{f.name}</button>)}
            {used.dropbox && <a className="frc-file" href={used.dropbox} target="_blank" rel="noreferrer">Dropbox ↗</a>}
          </div>}
          {used.note && <small className="frc-note">{used.note}</small>}
        </div>
      ) : <p className="faint frc-none">Not recorded yet. Once the films are on press, say which ones you used.</p>}
      {!open ? <button type="button" className="btn sm" onClick={() => setOpen(true)}>{used ? "Used different films" : "Record the films we used"}</button> : (
        <div className="frc-form">
          <span className="frc-k">Who made the films that went on press?</span>
          <div className="frc-seg">{WHO.map((w) => <button key={w.k} type="button" className={who === w.k ? "on" : ""} onClick={() => setWho(w.k)}>{w.label}</button>)}</div>
          {who === "studio" ? <p className="faint">Our Studio&apos;s last Print Films went on press as they were.</p> : <>
            <div className="frc-step">
              <span className="frc-n">1</span>
              <span>Get the art{who === "separo" ? ", then separate it in Separo" : who === "illustrator" ? " or our separation, then fix the films in Illustrator" : ""}</span>
              <span className="frc-btns">
                {origUrl && <a className="btn sm" href={origUrl} target="_blank" rel="noreferrer">Download the art</a>}
                {who === "separo" && <a className="btn sm" href="https://separo.io" target="_blank" rel="noreferrer">Open Separo ↗</a>}
                {who === "illustrator" && <button type="button" className="btn sm" onClick={() => { setBusy("Making the Illustrator file…"); void illustrator().catch((e) => setErr(e instanceof Error ? e.message : String(e))).finally(() => setBusy("")); }}>Download our separation (.pdf for Illustrator)</button>}
              </span>
            </div>
            <div className="frc-step">
              <span className="frc-n">2</span>
              <span>Upload the films you printed{who === "separo" ? " (Separo's zip is fine)" : ""}, or link them in Dropbox</span>
            </div>
            <label className={"tmx-drop frc-drop" + (over ? " over" : "")} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); void take([...(e.dataTransfer.files || [])]); }}>
              <input type="file" multiple accept=".eps,.pdf,.ai,.psd,.tif,.tiff,.png,.jpg,.jpeg,.zip" onChange={(e) => { void take([...(e.target.files || [])]); e.target.value = ""; }} />
              <b>{files.length ? files.map((f) => f.name).join(", ") : "Drop the films here or choose them (EPS, PDF, AI, PSD, TIFF, PNG, ZIP)"}</b>
            </label>
            <label className="frc-f"><span>Dropbox link (optional)</span><input value={dropbox} onChange={(e) => setDropbox(e.target.value)} placeholder="https://www.dropbox.com/…" /></label>
          </>}
          <label className="frc-f"><span>What you changed or why (optional: it&apos;s learned from)</span><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Merged the two reds, choked the underbase, 3 colors instead of 5…" /></label>
          <div className="frc-act">
            {err && <span className="frc-err">{err}</span>}
            <button type="button" className="btn" onClick={() => { setOpen(false); setErr(""); }}>Cancel</button>
            <button type="button" className="btn primary" disabled={!!busy} onClick={() => void save()}>{busy || "These went on press"}</button>
          </div>
        </div>
      )}
      {rows && rows.length > 0 && (
        <table className="tbl frc-tries">
          <thead><tr><th>Try</th><th>Made by</th><th>Size</th><th>Result</th></tr></thead>
          <tbody>{rows.slice().reverse().map((r, i) => (
            <tr key={r.id}>
              <td>{i + 1} · {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
              <td>{madeByText(r.made_by)}{r.used ? " ✓" : ""}</td>
              <td>{r.width_in ? `${fmt(r.width_in)}" × ${fmt(r.height_in)}"` : "—"}</td>
              <td>{r.result === "ok" ? <span className="frc-ok">Printed right</span> : r.result === "bad" ? <span className="frc-bad" title={r.note}>✗ {r.problems.join(", ") || "Something's wrong"}</span> : <span className="faint">Not checked</span>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}
