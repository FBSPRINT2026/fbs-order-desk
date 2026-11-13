"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fullName } from "@/lib/timeclock";
import { mergeProduction } from "@/lib/production";
import { CREW_VIEWS, crewViewOf, type CrewView } from "@/lib/crewView";
import type { TeamData } from "./types";

/**
 * Phone logins (Nick, Nov 13 2026): how the crew gets in (the QR on the wall → portal.fbsprint.com/crew, employee # and
 * PIN once, on the shop's Wi-Fi) and what each person's phone shows first: Receiving, Press operator, Assistant, Catcher,
 * Fulfillment, Shipping or Office (lib/crewView.ts). Left on "From their press crew", their place on a press crew in
 * Production settings says it.
 */
export default function TeamApp({ d }: { d: TeamData }) {
  const list = d.employees.filter((e) => e.active);
  const [crews, setCrews] = useState<ReturnType<typeof mergeProduction>["crews"]>([]);
  const [saving, setSaving] = useState(""), [err, setErr] = useState("");
  useEffect(() => { createClient().from("settings").select("data").eq("id", 1).maybeSingle().then(({ data }) => setCrews(mergeProduction((data?.data as { production?: unknown } | null)?.production).crews)); }, []);
  async function setView(id: string, v: string) {
    setSaving(id); setErr("");
    const { error } = await createClient().from("employees").update({ phone_view: v || null }).eq("id", id);
    setSaving("");
    if (error) setErr(/phone_view/.test(error.message) ? "Phone views aren't set up in the database yet (migration 312)." : error.message);
    else await d.reload();
  }
  return (
    <div className="tmx">
      <section className="db-card db-blue">
        <div className="db-card-h"><h2>Phone logins</h2><a className="btn" href="/crew/sign" target="_blank" rel="noreferrer">Print the wall sign</a></div>
        <ol className="tmx-steps">
          <li>They scan the QR on the wall (or any work order) with their phone&apos;s camera: <b>portal.fbsprint.com/crew</b>.</li>
          <li>They sign in once with their <b>employee #</b> and <b>PIN</b>, on the shop&apos;s Wi-Fi. The phone stays signed in.</li>
          <li>Their main menu shows what their job needs: the job on their press, what to count in, what&apos;s coming off the oven, what to finish or ship. Scanning a work order opens that job, on the tool their job uses first.</li>
          <li>The time clock and fixes to their own time card are there too; fixes wait for a manager on the Time Clock. English or Español.</li>
        </ol>
        <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>PINs are set on <a href="/shop/time?tab=employees">Time Clock → Employees</a>. Press crews (operator, assistant, catcher) are set in Production settings.</p>
      </section>
      <section className="db-card db-teal">
        <div className="db-card-h"><h2>Who sees what</h2></div>
        {err && <div role="alert" style={{ color: "var(--danger)", fontWeight: 700, fontSize: 13.5 }}>{err}</div>}
        {!list.length ? <div className="db-empty">No employees yet.</div> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>#</th><th>Name</th><th>Phone view</th><th>Sign in</th></tr></thead>
            <tbody>{list.map((e) => {
              const auto = crewViewOf(null, e.id, crews);
              const label = (v: CrewView) => CREW_VIEWS.find((x) => x.id === v)?.label || v;
              return (
                <tr key={e.id}>
                  <td className="ordno">#{e.code ?? "—"}</td>
                  <td><b>{fullName(e)}</b><div className="sub">{e.department || "—"}{e.lang === "es" ? " · Español" : ""}</div></td>
                  <td><select value={e.phone_view || ""} disabled={saving === e.id} onChange={(x) => setView(e.id, x.target.value)} aria-label={`Phone view for ${fullName(e)}`}>
                    <option value="">From their press crew ({label(auto)})</option>
                    {CREW_VIEWS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                  </select></td>
                  <td>{e.has_pin ? <span className="tmx-tag ok">Can sign in</span> : <a className="tmx-tag warn" href="/shop/time?tab=employees">Needs a PIN</a>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
