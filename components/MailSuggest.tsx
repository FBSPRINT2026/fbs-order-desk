"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Email search suggestions (Oct 15, Nick: "if I search Cheri, come back and ask: find all emails from Cheri Ong?").
 * While you type: the people (customer contacts, and people in your Inbox) and the customers (all their people at once)
 * whose name or address matches, then "Search all mail for …". Picking a person or customer searches by their email
 * addresses, so only conversations with them come back, not every email that mentions the word.
 */
export type Pick = { label: string; emails: string[] };
type Sug = { key: string; kind: "person" | "company"; label: string; sub: string; emails: string[] };

const clean = (s: string) => s.replace(/[%,()"'\\]/g, " ").trim();
const FREE = /@(gmail|yahoo|hotmail|outlook|aol|icloud|live|msn|me|comcast|att|sbcglobal)\./i;

export default function MailSuggest({ q, senders, onPick, onText }: {
  q: string;
  /** people in the Inbox now (name, address) */ senders: { name: string; email: string }[];
  onPick: (p: Pick) => void; onText: (q: string) => void;
}) {
  const sb = useMemo(() => createClient(), []);
  const [list, setList] = useState<Sug[]>([]);
  const term = clean(q);
  useEffect(() => {
    if (term.length < 2) { setList([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      const like = `%${term}%`;
      const [{ data: cts }, { data: cs }] = await Promise.all([
        sb.from("customer_contacts").select("name, email, customer_id").or(`name.ilike.${like},email.ilike.${like}`).not("email", "is", null).limit(8),
        sb.from("customers").select("id, company, name, email, contact2_email").or(`company.ilike.${like},name.ilike.${like},email.ilike.${like}`).limit(5),
      ]);
      const ids = [...new Set([...(cts || []).map((c) => c.customer_id as string), ...(cs || []).map((c) => c.id as string)])].filter(Boolean);
      const [{ data: names }, { data: allCts }] = ids.length ? await Promise.all([
        sb.from("customers").select("id, company, name, email, contact2_email").in("id", ids),
        sb.from("customer_contacts").select("email, customer_id").in("customer_id", ids).not("email", "is", null),
      ]) : [{ data: [] }, { data: [] }];
      const co = new Map(((names || []) as { id: string; company: string; name: string; email: string | null; contact2_email: string | null }[]).map((c) => [c.id, c]));
      const out: Sug[] = [], seen = new Set<string>();
      const lc = (e: string | null | undefined) => String(e || "").trim().toLowerCase();
      // people: customer contacts, then people in the Inbox
      for (const c of (cts || []) as { name: string; email: string; customer_id: string }[]) {
        const e = lc(c.email); if (!e.includes("@") || seen.has(e)) continue;
        seen.add(e);
        const cust = co.get(c.customer_id);
        out.push({ key: "p" + e, kind: "person", label: c.name || e, sub: [cust?.company || cust?.name, e].filter(Boolean).join(" · "), emails: [e] });
      }
      for (const s of senders) {
        const e = lc(s.email); if (!e.includes("@") || seen.has(e)) continue;
        if (!`${s.name} ${e}`.toLowerCase().includes(term.toLowerCase())) continue;
        seen.add(e);
        out.push({ key: "p" + e, kind: "person", label: s.name || e, sub: e, emails: [e] });
      }
      // customers: everyone there at once
      const people = out.slice(0, 4);
      const companies: Sug[] = [];
      for (const c of [...((cs || []) as { id: string }[]).map((x) => co.get(x.id)), ...ids.map((id) => co.get(id))]) {
        if (!c || companies.some((x) => x.key === "c" + c.id)) continue;
        const emails = [...new Set([lc(c.email), lc(c.contact2_email), ...((allCts || []) as { email: string; customer_id: string }[]).filter((x) => x.customer_id === c.id).map((x) => lc(x.email))].filter((e) => e.includes("@")))];
        if (!emails.length) continue;
        // anyone at their company (Oct 15, Nick: "anyone with @peticolasbrewing.com"); free mail (gmail…) only by address
        const domains = [...new Set(emails.filter((e) => !FREE.test(e)).map((e) => "@" + e.split("@")[1]))];
        const free = emails.filter((e) => FREE.test(e));
        companies.push({ key: "c" + c.id, kind: "company", label: c.company || c.name, sub: [domains.length ? `Anyone ${domains.join(", ")}` : "", free.length ? free.join(", ") : ""].filter(Boolean).join(" · "), emails: [...domains, ...free] });
        if (companies.length >= 2) break;
      }
      if (live) setList([...people, ...companies]);
    }, 180);
    return () => { live = false; clearTimeout(t); };
  }, [term]); // eslint-disable-line react-hooks/exhaustive-deps

  if (term.length < 2) return null;
  return (
    <div className="msug" role="listbox" aria-label="Search suggestions" onMouseDown={(e) => e.preventDefault()}>
      {list.map((s) => (
        <button key={s.key} type="button" role="option" aria-selected={false} className="msug-i" onClick={() => onPick({ label: s.label, emails: s.emails })}>
          <span className={"msug-av " + s.kind} aria-hidden>{s.kind === "company" ? <svg viewBox="0 0 24 24"><path d="M4 21V8l8-5 8 5v13M9 21v-6h6v6" /></svg> : s.label.replace(/[^A-Za-z ]/g, " ").trim().split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() || "").join("") || "@"}</span>
          <span className="msug-t"><span>{s.kind === "company" ? <>All emails with the customer <b>{s.label}</b></> : <>Emails from or to <b>{s.label}</b></>}</span><small>{s.sub}</small></span>
        </button>
      ))}
      <button type="button" role="option" aria-selected={false} className="msug-i all" onClick={() => onText(q.trim())}>
        <span className="msug-av" aria-hidden><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg></span>
        <span className="msug-t"><span>Search all mail for “<b>{q.trim()}</b>”</span><small>Every email that mentions it</small></span>
      </button>
    </div>
  );
}
