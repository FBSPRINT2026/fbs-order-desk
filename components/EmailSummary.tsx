"use client";
import Link from "next/link";

/**
 * My Day → Email (Oct 26, Nick: the red Replies box "looks like anxiety in a box… just maybe like a nice email summary.
 * Hey, there's these people to get back to. You got these new customers coming in… ignore anything that's not a
 * customer… one new quote from the website"; he picked the graphic version). Three count tiles, then the people
 * under each: initials, first name, one short line of what they need, how long ago. Vendors and newsletters
 * (the AI's "not a customer") never show.
 */
export type EmailItem = { k: string; who: string; initials: string; text: string; at: string; href: string; rush?: boolean };
export type EmailGroups = { back: EmailItem[]; fresh: EmailItem[]; web: EmailItem[] };

const ago = (t: string) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(t)) / 60000)); return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
const KINDS = [
  { k: "back" as const, label: "Get back to", icon: <path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11" /> },
  { k: "fresh" as const, label: "New customers", icon: <><circle cx="9" cy="8" r="4" /><path d="M2 21v-1a7 7 0 0114 0v1M19 8v6M16 11h6" /></> },
  { k: "web" as const, label: "Website quotes", icon: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" /></> },
];

export default function EmailSummary({ groups, loading }: { groups: EmailGroups; loading: boolean }) {
  if (loading) return <div className="md-empty">Loading…</div>;
  const total = groups.back.length + groups.fresh.length + groups.web.length;
  const row = (x: EmailItem, k: string) => (
    <Link key={x.k} href={x.href} className="es-row">
      <span className={"es-av " + k} aria-hidden>{x.initials}</span>
      <span className="es-x"><span className="es-n" data-notranslate>{x.who}</span><span className="es-t">{x.text}</span></span>
      <span className="es-w">{x.rush && <i className="es-rush" title="They need it soon" />}{ago(x.at)}</span>
    </Link>
  );
  return (
    <div className="md-scroll es">
      <div className="es-tiles">
        {KINDS.map((t) => (
          <a key={t.k} href={`#es-${t.k}`} className={"es-tile " + t.k + (groups[t.k].length ? "" : " zero")}>
            <svg viewBox="0 0 24 24" aria-hidden>{t.icon}</svg>
            <b>{groups[t.k].length}</b><span>{t.label}</span>
          </a>
        ))}
      </div>
      {!total ? <div className="es-none">You&apos;re caught up. Customer emails land here the moment one needs you.</div> : KINDS.filter((t) => groups[t.k].length).map((t, i) => (
        <div key={t.k} id={`es-${t.k}`} className="es-grp">
          {(i > 0 || t.k !== "back") && <div className="es-h">{t.label}</div>}
          {groups[t.k].map((x) => row(x, t.k))}
        </div>
      ))}
    </div>
  );
}
