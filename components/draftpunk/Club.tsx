"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { styleById } from "@/lib/draftpunk/styles";
import { fmtDate } from "@/lib/draftpunk/defaults";
import { addMember, removeMember } from "@/app/draftpunk/actions";
import { F, Win } from "./ui";

type Member = { user_id: string; name: string; club_role: string };
type Shared = { id: string; owner_id: string; name: string; style_id: string | null; calc: { og?: number; ibu?: number; abv?: number; srm?: number; color?: string }; updated_at: string };

/** the club: everyone's shared recipes (open to view, copy to brew) and, for admins, adding members */
export default function Club({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [shared, setShared] = useState<Shared[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const load = async () => {
    const sb = createClient();
    const [{ data: m }, { data: s }] = await Promise.all([
      sb.from("dp_brewers").select("user_id, name, club_role").order("name"),
      sb.from("dp_recipes").select("id, owner_id, name, style_id, calc, updated_at").eq("visibility", "club").order("updated_at", { ascending: false }),
    ]);
    setMembers((m || []) as Member[]);
    setShared((s || []) as Shared[]);
  };
  useEffect(() => { load(); }, []);
  const who = (id: string) => members.find((m) => m.user_id === id)?.name || "?";
  return (
    <>
      <h1 className="dp-h1">The club</h1>
      <Win title={`Shared recipes (${shared.length})`}>
        {!shared.length ? <p className="dp-dim">Nobody has shared a recipe yet. Open one of yours, go to notes, and tick share with the club.</p> : (
          <table className="dp-tbl" data-nofit>
            <thead><tr><th>Recipe</th><th>Brewer</th><th>Style</th><th className="dp-num">OG</th><th className="dp-num">IBU</th><th className="dp-num">ABV</th><th>Saved</th></tr></thead>
            <tbody>
              {shared.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/draftpunk/r/${r.id}`}>{r.name}</Link>{r.owner_id === userId && <span className="dp-dim"> (Mine)</span>}</td>
                  <td>{who(r.owner_id)}</td>
                  <td>{styleById(r.style_id || "")?.name || "-"}</td>
                  <td className="dp-num">{r.calc?.og?.toFixed(3) || "-"}</td>
                  <td className="dp-num">{r.calc?.ibu ?? "-"}</td>
                  <td className="dp-num">{r.calc?.abv != null ? `${r.calc.abv}%` : "-"}</td>
                  <td>{fmtDate(r.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Win>
      <div className="dp-grid">
        <Win title={`Members (${members.length})`}>
          <table className="dp-tbl" data-nofit>
            <tbody>
              {members.map((m) => (
                <tr key={m.user_id}>
                  <td>{m.name}</td><td className="dp-dim">{m.club_role}</td>
                  <td className="dp-num">{isAdmin && m.user_id !== userId && <button className="dp-btn dp-x" onClick={async () => { if (confirm(`Remove ${m.name} from the club?`)) { const r = await removeMember(m.user_id); setMsg(r.msg); load(); } }}>X</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Win>
        {isAdmin && (
          <Win title="Add a member">
            <form className="dp-row" onSubmit={async (e) => { e.preventDefault(); setMsg("Adding..."); const r = await addMember(email, name); setMsg(r.msg); if (r.ok) { setEmail(""); setName(""); load(); } }}>
              <F label="Name" grow="1 1 160px"><input value={name} onChange={(e) => setName(e.target.value)} /></F>
              <F label="Email" grow="2 1 220px"><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></F>
              <button className="dp-btn dp-go">Add</button>
            </form>
            {msg && <p>{msg}</p>}
            <p className="dp-dim">No email goes out from here: Tell them to sign in at portal.fbsprint.com/draftpunk with that email.</p>
          </Win>
        )}
      </div>
    </>
  );
}
