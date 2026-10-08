"use client";
import { useEffect, useState } from "react";

/**
 * The customer's film folder in Dropbox (FBS Film Folder/<customer>): linked here, or found by their name. Its films
 * are where reorders get their real print sizes; each can be opened from here.
 */
type Film = { id: string; name: string; modified: string; size: number };
type Res = { linked: string | null; folder: string | null; films: Film[]; folders: string[]; error?: string };

export default function FilmFolder({ customerId }: { customerId: string }) {
  const [r, setR] = useState<Res | null>(null), [err, setErr] = useState(""), [pick, setPick] = useState(""), [busy, setBusy] = useState(""), [open, setOpen] = useState(false);
  async function load() {
    const res = await fetch(`/api/dropbox/film?customer=${customerId}&folders=1`, { cache: "no-store" }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    if (!res?.ok) return setErr(j.error || "Couldn't read Dropbox.");
    setR(j); setPick(j.linked || j.folder || "");
  }
  useEffect(() => { load(); }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save(folder: string) {
    setBusy("save"); setErr("");
    const res = await fetch("/api/dropbox/film", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer: customerId, folder }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    setBusy("");
    if (!res?.ok) return setErr(j.error || "Couldn't save.");
    await load();
  }
  async function openFilm(f: Film) {
    const w = window.open("", "_blank");
    setBusy(f.id);
    const res = await fetch("/api/dropbox/film", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    setBusy("");
    if (j.url && w) w.location.href = j.url; else { w?.close(); setErr(j.error || "Couldn't open it."); }
  }
  if (err && !r) return <div className="ff faint">Film folder: {err}</div>;
  if (!r) return <div className="ff faint">Film folder: looking in Dropbox…</div>;
  return (
    <div className="ff">
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <b>Film folder</b>
        {r.folder ? <span>{r.folder.replace(/^\/FBS Film Folder\//i, "")}</span> : <span className="faint">none found</span>}
        <span className="faint" style={{ fontSize: 12 }}>{r.linked ? "linked" : r.folder ? "found by their name" : ""}</span>
        {r.folder && <button type="button" className="linkbtn" onClick={() => setOpen((x) => !x)}>{open ? "Hide" : `${r.films.length} film${r.films.length === 1 ? "" : "s"}`}</button>}
        <select aria-label="Film folder" value={pick} onChange={(e) => setPick(e.target.value)} style={{ maxWidth: 240 }}>
          <option value="">Find by their name</option>
          {r.folders.map((f) => <option key={f} value={f}>{f.replace(/^\/FBS Film Folder\//i, "")}</option>)}
        </select>
        {(pick || "") !== (r.linked || "") && <button type="button" className="btn sm" disabled={!!busy} onClick={() => save(pick)}>{pick ? "Link" : "Unlink"}</button>}
      </div>
      {err && <div className="err">{err}</div>}
      {open && <ul className="ff-list">{r.films.map((f) => <li key={f.id}><button type="button" className="linkbtn" disabled={busy === f.id} onClick={() => openFilm(f)}>{f.name}</button> <span className="faint">{f.modified ? new Date(f.modified).toLocaleDateString() : ""}</span></li>)}</ul>}
    </div>
  );
}
