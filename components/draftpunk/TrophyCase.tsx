"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addAward, removeAward } from "@/app/draftpunk/actions";
import { PLACES } from "@/lib/draftpunk/judging";
import { F, Win } from "./ui";

export type Award = { id: string; title: string; year: number | null; place: string; image: string; notes: string };

/** the club's awards, each with the picture it was given to use; club admins add them */
export default function TrophyCase({ admin, onAwards }: { admin: boolean; onAwards?: (a: Award[]) => void }) {
  const [awards, setAwards] = useState<Award[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState("");
  const load = async () => {
    const { data } = await createClient().from("dp_awards").select("id, title, year, place, image, notes").order("year", { ascending: false });
    const a = (data || []) as Award[];
    setAwards(a); onAwards?.(a);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  if (!awards || (!awards.length && !admin)) return null;
  return (
    <Win title="Trophy case" note={admin ? <button className="dp-linkbtn" onClick={() => setAdding((v) => !v)}>{adding ? "Close" : "+ Add an award"}</button> : undefined}>
      {!awards.length && !adding && <p className="dp-dim" style={{ margin: 0 }}>Add an award the club won, with the picture you were given to use.</p>}
      <div className="dp-trophies">
        {awards.map((a) => (
          <figure key={a.id} className="dp-trophy">
            {a.image ? <img src={a.image} alt={a.title} /> : <div className="dp-trophy-blank" aria-hidden="true" />}
            <figcaption><b>{a.title}</b>{a.year ? <span>{a.year}</span> : null}{a.notes && <small>{a.notes}</small>}</figcaption>
            {admin && <button className="dp-linkbtn dp-dim" onClick={async () => { if (!confirm(`Take "${a.title}" out of the trophy case?`)) return; const r = await removeAward(a.id); if (r.ok) load(); else setMsg(r.msg || ""); }}>Remove</button>}
          </figure>
        ))}
      </div>
      {adding && admin && (
        <form className="dp-row" style={{ marginTop: 12 }} onSubmit={async (e) => { e.preventDefault(); setMsg(""); const r = await addAward(new FormData(e.currentTarget)); if (r.ok) { setAdding(false); load(); } else setMsg(r.msg || "Not saved"); }}>
          <F label="Award" grow="2 1 220px"><input name="title" required defaultValue="Ninkasi Award" /></F>
          <F label="Year"><input name="year" type="number" defaultValue={2017} style={{ width: 90 }} /></F>
          <F label="Shown on entries that won"><select name="place" defaultValue="ninkasi">{PLACES.map(([v, l]) => <option key={v} value={v}>{v ? l : "(none)"}</option>)}</select></F>
          <F label="Picture (PNG, JPEG or WebP)" grow="2 1 220px"><input name="image" type="file" accept="image/png,image/jpeg,image/webp" /></F>
          <F label="Note" grow="2 1 220px"><input name="notes" placeholder="e.g. National Homebrew Competition · used with the AHA's permission" /></F>
          <button className="dp-btn dp-go">Add</button>
        </form>
      )}
      {msg && <p className="dp-red">{msg}</p>}
    </Win>
  );
}
