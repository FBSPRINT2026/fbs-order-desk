"use client";
import { useState } from "react";
import { importStaxMethod } from "@/app/shop/stax-import-actions";
import { useCan } from "@/components/RoleContext";

/** Bring a card saved in Stax onto this customer (app/shop/stax-import-actions.ts): search Stax, add the card. */
type SM = { id: string; method: "card" | "bank"; brand: string; last4: string; exp: string; holder: string; nickname: string };
type SC = { id: string; name: string; company: string; email: string; methods: SM[] };
export default function StaxCardImport({ customerId, search0 }: { customerId: string; search0: string }) {
  const can = useCan("takePayments");
  const [q, setQ] = useState(search0), [list, setList] = useState<SC[] | null>(null), [busy, setBusy] = useState(""), [msg, setMsg] = useState("");
  if (!can) return null;
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
  };
  return (
    <section className="panel sci">
      <div className="panel-h"><h2>Cards saved in Stax</h2><span className="faint">Bring one onto this customer</span></div>
      <div className="panel-b stack" style={{ gap: 8 }}>
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
