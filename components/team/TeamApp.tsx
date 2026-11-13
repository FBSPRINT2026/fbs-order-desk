"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fullName } from "@/lib/timeclock";
import { mergeProduction } from "@/lib/production";
import { CREW_EXTRAS, CREW_VIEWS, crewViewOf, joinViews, parseViews, phoneViewsOf, type CrewExtra, type CrewView } from "@/lib/crewView";
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
  const [views, setViews] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(""), [err, setErr] = useState("");
  useEffect(() => { createClient().from("settings").select("data").eq("id", 1).maybeSingle().then(({ data }) => { setCrews(mergeProduction((data?.data as { production?: unknown } | null)?.production).crews); setViews(phoneViewsOf(data?.data)); }); }, []);
  // kept in the shop's settings (settings.data.phoneViews), read fresh and merged so two people saving don't undo each other
  async function setView(id: string, v: string) {
    setSaving(id); setErr("");
    const sb = createClient();
    const { data } = await sb.from("settings").select("data").eq("id", 1).maybeSingle();
    const cur = (data?.data || {}) as Record<string, unknown>, pv = { ...phoneViewsOf(cur) };
    if (v) pv[id] = v; else delete pv[id];
    const { error } = await sb.from("settings").update({ data: { ...cur, phoneViews: pv } }).eq("id", 1);
    setSaving("");
    if (error) setErr(error.message); else setViews(pv);
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
                  <td>{(() => { const pv = parseViews(views[e.id]); const save = (main: CrewView | null, also: CrewExtra[]) => setView(e.id, joinViews(main, also)); return <>
                    <select value={pv.main || ""} disabled={saving === e.id} onChange={(x) => save((x.target.value || null) as CrewView | null, pv.also)} aria-label={`Phone view for ${fullName(e)}`}>
                      <option value="">From their press crew ({label(auto)})</option>
                      {CREW_VIEWS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                    {pv.main && <div className="sub" style={{ display: "flex", gap: 10, marginTop: 4 }}>{CREW_EXTRAS.map((x) => <label key={x.id} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={pv.also.includes(x.id)} onChange={(ev) => save(pv.main, ev.target.checked ? [...pv.also, x.id] : pv.also.filter((y) => y !== x.id))} />Also {x.label}</label>)}</div>}
                  </>; })()}</td>
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
