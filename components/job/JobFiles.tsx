"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A job's shop-only production files and notes (never shown to customers): photos of the printed piece and notes like
 * press setup or ink changes. The same list on the job's phone menu and on the job page in the shop.
 */
export type JobFile = { id: string; kind: "note" | "photo" | "file"; tag: string; body: string; url: string; file_name: string; file_type: string; by_name: string; created_at: string; archived: boolean; job?: string };
export const NOTE_TAGS = ["Press setup", "Ink / colors", "Print issue", "Approved print", "General"];
const when = (d: string) => new Date(d).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Shrink a phone photo before it goes up (long side 2000px, JPEG): faster on shop Wi-Fi. Keeps the original if it can't. */
export async function shrinkPhoto(f: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp|heic|heif)/i.test(f.type) || f.size < 600_000) return f;
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const b = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.85));
    return b ? new File([b], f.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : f;
  } catch { return f; }
}

export function useJobFiles(job: { kind: "o" | "a"; id: string } | null, customer?: string) {
  const [items, setItems] = useState<JobFile[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    if (!job && !customer) return;
    const r = await fetch(`/api/jobs/files?${job ? `kind=${job.kind}&id=${job.id}` : `customer=${customer}`}`, { cache: "no-store" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Offline" };
    if (!r?.ok) setErr(j.error || "Couldn't load the job's files."); else { setErr(""); setItems(j.items || []); }
  }, [job?.kind, job?.id, customer]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return { items, err, load, setItems };
}

export async function addNote(job: { kind: "o" | "a"; id: string }, body: string, tag: string) {
  const r = await fetch("/api/jobs/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...job, body, tag }) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : { error: "Offline. Try again." };
  return r?.ok ? { ok: true as const, item: j.item as JobFile } : { ok: false as const, error: (j.error as string) || "Couldn't save the note." };
}
export async function addPhoto(job: { kind: "o" | "a"; id: string }, file: File, caption: string, tag: string) {
  const fd = new FormData();
  fd.set("kind", job.kind); fd.set("id", job.id); fd.set("file", await shrinkPhoto(file)); fd.set("body", caption); fd.set("tag", tag);
  const r = await fetch("/api/jobs/files", { method: "POST", body: fd }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : { error: "Offline. Try again." };
  return r?.ok ? { ok: true as const } : { ok: false as const, error: (j.error as string) || "Couldn't save the photo." };
}

/** The panel on the shop's job page: notes and photos, add either, archive (nothing is deleted). */
export default function JobFiles({ job, staff = true, bump = 0 }: { job: { kind: "o" | "a"; id: string }; staff?: boolean; /** change it to reload (a file was added elsewhere) */ bump?: number }) {
  const { items, err, load } = useJobFiles(job);
  useEffect(() => { if (bump) load(); }, [bump]); // eslint-disable-line react-hooks/exhaustive-deps
  const [note, setNote] = useState(""), [tag, setTag] = useState("General"), [busy, setBusy] = useState(""), [msg, setMsg] = useState("");
  const [big, setBig] = useState<JobFile | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const photos = (items || []).filter((x) => x.kind !== "note"), notes = (items || []).filter((x) => x.kind === "note");
  return (
    <section className="panel jf">
      <div className="panel-h"><h2>Production files &amp; notes</h2><span className="jf-staff">Shop only</span></div>
      <div className="panel-b stack" style={{ gap: 12 }}>
        <p className="faint" style={{ margin: 0, fontSize: 13 }}>Photos of the printed piece and notes like press setup or ink changes, for next time. Add them here or by scanning the QR code on the work order or a box label with a phone.</p>
        <div className="jf-add">
          <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Kind of note">{NOTE_TAGS.map((t) => <option key={t}>{t}</option>)}</select>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (e.g. moved white to head 3, 156 mesh)" aria-label="Note"
            onKeyDown={async (e) => { if (e.key === "Enter" && note.trim()) { setBusy("note"); const r = await addNote(job, note, tag); setBusy(""); if (r.ok) { setNote(""); load(); } else setMsg(r.error); } }} />
          <button type="button" className="btn primary" disabled={!note.trim() || !!busy} onClick={async () => { setBusy("note"); const r = await addNote(job, note, tag); setBusy(""); if (r.ok) { setNote(""); load(); } else setMsg(r.error); }}>{busy === "note" ? "Saving…" : "Add note"}</button>
          <button type="button" className="btn" disabled={!!busy} onClick={() => file.current?.click()}>{busy === "photo" ? "Uploading…" : "+ Photo / file"}</button>
          <input ref={file} type="file" multiple hidden onChange={async (e) => {
            const fs = [...(e.target.files || [])]; e.target.value = ""; if (!fs.length) return;
            setBusy("photo"); setMsg("");
            for (const f of fs.slice(0, 10)) { const r = await addPhoto(job, f, "", tag === "General" ? "" : tag); if (!r.ok) { setMsg(r.error); break; } }
            setBusy(""); load();
          }} />
        </div>
        {(err || msg) && <div className="pv-err">{err || msg}</div>}
        {items === null ? <div className="faint">Loading…</div> : !items.length ? <div className="faint" style={{ fontSize: 13 }}>Nothing yet.</div> : (
          <>
            {photos.length > 0 && <div className="jf-grid">{photos.map((p) => (
              <figure key={p.id} className="jf-ph">
                {p.kind === "photo" && p.url ? <button type="button" onClick={() => setBig(p)}><img src={p.url} alt={p.body || p.file_name} loading="lazy" /></button> : <a href={p.url} target="_blank" rel="noreferrer" className="jf-fileic">{p.file_name}</a>}
                <figcaption>{p.tag && <b>{p.tag}</b>}{p.body && <span>{p.body}</span>}<small>{p.by_name} · {when(p.created_at)}</small></figcaption>
                {staff && <button type="button" className="jf-arch" title="Archive" onClick={async () => { await fetch("/api/jobs/files", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, archived: true }) }); load(); }}>Archive</button>}
              </figure>
            ))}</div>}
            {notes.length > 0 && <ul className="jf-notes">{notes.map((n) => (
              <li key={n.id}>{n.tag && <span className="jf-tag">{n.tag}</span>}<span className="jf-body">{n.body}</span><small>{n.by_name} · {when(n.created_at)}</small>
                {staff && <button type="button" className="linkbtn" onClick={async () => { await fetch("/api/jobs/files", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: n.id, archived: true }) }); load(); }}>Archive</button>}</li>
            ))}</ul>}
          </>
        )}
      </div>
      {big && <div className="pp-modal" role="dialog" aria-modal="true" aria-label="Photo" onMouseDown={(e) => { if (e.target === e.currentTarget) setBig(null); }}><div className="jf-big"><img src={big.url} alt={big.body || ""} /><button type="button" className="btn" onClick={() => setBig(null)}>Close</button></div></div>}
    </section>
  );
}
