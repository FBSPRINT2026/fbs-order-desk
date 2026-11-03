"use client";
import { useEffect, useState } from "react";
import { cardsOnFile, importStaxMethod, removeCardOnFile } from "@/app/shop/stax-import-actions";
import { useCan } from "@/components/RoleContext";

/** Bring a card saved in Stax onto this customer (app/shop/stax-import-actions.ts): search Stax, add the card. */
type SM = { id: string; method: "card" | "bank"; brand: string; last4: string; exp: string; holder: string; nickname: string };
type SC = { id: string; name: string; company: string; email: string; methods: SM[] };
export default function StaxCardImport({ customerId, search0 }: { customerId: string; search0: string }) {
  const can = useCan("takePayments");
  const [q, setQ] = useState(search0), [list, setList] = useState<SC[] | null>(null), [busy, setBusy] = useState(""), [msg, setMsg] = useState("");
  // what's on file now, each with Remove (Nov 3, Nick: "can you delete a card I just put on file?")
  const [onFile, setOnFile] = useState<{ id: string; method: string; brand: string; last4: string; exp: string; holder: string; ok: boolean; from: string }[] | null>(null), [armed, setArmed] = useState("");
  const loadFile = () => void cardsOnFile(customerId).then((r) => { if (r.ok) setOnFile(r.list); });
  useEffect(() => { if (can) loadFile(); }, [customerId, can]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!can) return null;
  const remove = async (id: string) => {
    if (armed !== id) { setArmed(id); setTimeout(() => setArmed((a) => (a === id ? "" : a)), 3500); return; }
    setArmed(""); setBusy(id);
    const r = await removeCardOnFile(id);
    setBusy("");
    if (!r.ok) return setMsg(r.error);
    loadFile();
  };
  const find = async () => {
    setBusy("find"); setMsg("");
    const r = await fetch(`/api/stax/customers?${new URLSearchParams({ q })}`).then((x) => x.json()).catch(() => null) as { customers?: SC[]; error?: string } | null;
    setBusy("");
    if (!r?.customers) return setMsg(r?.error || "Couldn't reach Stax.");
    setList(r.customers);
  };
  const add = async (pm: SM) => {
    setBusy(pm.id); setMsg("");
    const r = await importStaxMethod(customerId, pm.id);
    setBusy("");
    setMsg(r.ok ? `${pm.brand} ending ${pm.last4} is on this customer now, OK to charge when they ask.` : r.error);
    if (r.ok) loadFile();
  };
  return (
    <section className="panel sci">
      <div className="panel-h"><h2>Cards on file</h2><span className="faint">Nick and Amanda only</span></div>
      <div className="panel-b stack" style={{ gap: 8 }}>
        {onFile && (onFile.length ? onFile.map((m) => (
          <div key={m.id} className="sci-pm sci-file">
            <span><b>{m.method === "bank" ? `${m.brand || "Bank account"} ending ${m.last4}` : `${m.brand} ending ${m.last4}`}</b>{m.exp ? ` · exp ${m.exp}` : ""}<span className="sub">{m.from}{m.ok ? " · OK to charge when they ask" : ""}</span></span>
            <button type="button" className={"btn sm" + (armed === m.id ? " danger" : " ghost")} disabled={busy === m.id} onClick={() => void remove(m.id)}>{armed === m.id ? "Remove it?" : "Remove"}</button>
          </div>
        )) : <div className="faint">No cards on file.</div>)}
        <div className="sci-l">Bring in a card saved in Stax</div>
        <div className="sci-row"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void find(); }} placeholder="Name, company or email in Stax" aria-label="Search Stax" /><button type="button" className="btn" disabled={busy === "find" || !q.trim()} onClick={() => void find()}>{busy === "find" ? "Looking…" : "Find in Stax"}</button></div>
        {msg && <div className="faint" role="status">{msg}</div>}
        {list && !list.length && <div className="faint">No one in Stax matches that.</div>}
        {list?.map((c) => (
          <div key={c.id} className="sci-cu">
            <b>{c.company || c.name || c.email}</b><span className="sub">{[c.name, c.email].filter(Boolean).join(" · ")}</span>
            {!c.methods.length ? <span className="sub">No saved cards</span> : c.methods.map((m) => (
              <div key={m.id} className="sci-pm"><span>{m.brand} ending {m.last4}{m.exp ? ` · exp ${m.exp.length === 6 ? `${m.exp.slice(0, 2)}/${m.exp.slice(4)}` : m.exp}` : ""}{m.holder ? ` · ${m.holder}` : ""}</span><button type="button" className="btn sm" disabled={!!busy} onClick={() => void add(m)}>{busy === m.id ? "Adding…" : "Add to customer"}</button></div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
