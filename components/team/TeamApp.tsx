"use client";
import { fullName } from "@/lib/timeclock";
import type { TeamData } from "./types";

/** How people get into the employee app: their employee number and a PIN (set on Time Clock → Employees). */
export default function TeamApp({ d }: { d: TeamData }) {
  const list = d.employees.filter((e) => e.active);
  return (
    <div className="tmx">
      <section className="db-card db-blue">
        <div className="db-card-h"><h2>Employee App</h2></div>
        <ol className="tmx-steps">
          <li>On their phone, open <b>portal.fbsprint.com/work</b> and add it to the home screen (Share → Add to Home Screen on iPhone; ⋮ → Add to Home screen on Android).</li>
          <li>Sign in with their <b>employee #</b> (below) and <b>PIN</b>. They stay signed in on that phone.</li>
          <li>Each day it shows their plan (Today&apos;s Plan tab). They tap a job, or <b>Scan Job</b> (the barcode on the work order or box label), pick what they&apos;re starting (Front, Back, Setup…), Start, then Finish.</li>
          <li>English or Español, their choice. This only logs job time; pay time stays on the time clock.</li>
        </ol>
        <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>PINs are set on <a href="/shop/time?tab=employees">Time Clock → Employees</a>.</p>
      </section>
      <section className="db-card db-teal">
        <div className="db-card-h"><h2>Employee Numbers</h2></div>
        {!list.length ? <div className="db-empty">No employees yet.</div> : (
          <ul className="db-list">{list.map((e) => (
            <li key={e.id} className="db-row"><span className="db-num">#{e.code ?? "—"}</span><span className="db-main"><b>{fullName(e)}</b><span className="faint">{e.department || "—"}{e.lang === "es" ? " · Español" : ""}</span></span>
              <span className="db-side">{e.has_pin ? <span className="tmx-tag ok">Can sign in</span> : <a className="tmx-tag warn" href="/shop/time?tab=employees">Needs a PIN</a>}</span></li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
