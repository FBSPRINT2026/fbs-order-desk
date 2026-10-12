"use client";
import { useEffect, useRef, useState } from "react";
import { ccTeam } from "@/app/shop/mail-actions";
import { ccFromWords, type TeamMember } from "@/lib/mail/ccWords";

/**
 * Cc on a reply (Oct 12, Nick: "there's not actually a way for me to CC someone right now… and when the AI writes
 * 'I'm copying Amanda' it should copy amanda@fbsprint.com"). People as chips; type a name or an address (the team is
 * suggested), Enter or comma adds it. The reply's text is watched: "copying Amanda", "I've cc'd Claudia", "looping in
 * Amanda" adds them by itself (a chip you remove stays removed).
 */
let teamMem: TeamMember[] | null = null;
export function useTeam() {
  const [team, setTeam] = useState<TeamMember[]>(teamMem || []);
  useEffect(() => { if (teamMem) return; void ccTeam().then((r) => { if (r.ok) { teamMem = r.team; setTeam(r.team); } }); }, []);
  return team;
}

export default function CcField({ value, onChange, text }: { value: string[]; onChange: (v: string[]) => void; /** the reply being written: names it says to copy are added */ text?: string }) {
  const team = useTeam();
  const [open, setOpen] = useState(value.length > 0), [typed, setTyped] = useState("");
  const removed = useRef(new Set<string>());
  const valRef = useRef(value); valRef.current = value;
  // "copying Amanda" in the reply → Amanda on Cc
  useEffect(() => {
    if (!text || !team.length) return;
    const add = ccFromWords(text, team).filter((e) => !valRef.current.includes(e) && !removed.current.has(e));
    if (add.length) { onChange([...valRef.current, ...add]); setOpen(true); }
  }, [text, team]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (value.length) setOpen(true); }, [value.length]);
  const nameOf = (e: string) => team.find((m) => m.email === e)?.name.split(/\s+/)[0] || e;
  const commit = (raw: string) => {
    const t = raw.trim().replace(/[,;]+$/, "");
    if (!t) return;
    const lc = t.toLowerCase();
    const hit = /@/.test(lc) ? lc : team.find((m) => m.name.toLowerCase().startsWith(lc) || m.email.startsWith(lc))?.email;
    if (hit && /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(hit) && !value.includes(hit)) { removed.current.delete(hit); onChange([...value, hit]); }
    setTyped("");
  };
  if (!open) return <button type="button" className="cc-add" onClick={() => setOpen(true)}>+ Cc</button>;
  const sugg = typed.trim() ? team.filter((m) => !value.includes(m.email) && (m.name.toLowerCase().includes(typed.trim().toLowerCase()) || m.email.includes(typed.trim().toLowerCase()))).slice(0, 5) : [];
  return (
    <div className="cc">
      <span className="cc-l">Cc</span>
      {value.map((e) => <span key={e} className="cc-chip" title={e}>{nameOf(e)}<button type="button" aria-label={`Remove ${e}`} onClick={() => { removed.current.add(e); onChange(value.filter((x) => x !== e)); }}>×</button></span>)}
      <span className="cc-in">
        <input value={typed} onChange={(e) => { const v = e.target.value; if (/[,;]$/.test(v)) commit(v); else setTyped(v); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(typed); } if (e.key === "Backspace" && !typed && value.length) { const last = value[value.length - 1]; removed.current.add(last); onChange(value.slice(0, -1)); } }} onBlur={() => commit(typed)}
          placeholder={value.length ? "" : "Name or email"} aria-label="Cc" />
        {sugg.length > 0 && <span className="cc-sugg" role="listbox">{sugg.map((m) => <button key={m.email} type="button" role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); commit(m.email); }}><b>{m.name}</b> {m.email}</button>)}</span>}
      </span>
    </div>
  );
}
