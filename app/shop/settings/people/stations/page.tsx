import SettingsTabs, { SettingsHead } from "@/components/SettingsTabs";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { shopNetwork } from "@/lib/shopNetwork";
import { STATIONS, stationEmail } from "@/lib/stations";
import StationPin, { SaveNetwork } from "./StationPin";

export const dynamic = "force-dynamic";

/** Settings → People → Shop computers (lib/stations.ts): the four computers, the PIN they share, the shop's network */
export default async function Page() {
  const v = await getViewer();
  const admin = createAdminClient();
  const [{ data }, net, { data: staff }] = await Promise.all([
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    shopNetwork(admin),
    admin.from("staff").select("email, role").in("email", STATIONS.map(stationEmail)),
  ]);
  const st = ((data?.data as Record<string, unknown>)?.stations || {}) as { pinHash?: string; setAt?: string; setBy?: string };
  const made = new Map(((staff || []) as { email: string; role: string }[]).map((x) => [x.email, x.role]));
  return (
    <>
      <SettingsHead title="Shop computers" note="Receiving, press, shipping and work order computers: each signs in with its name and one PIN, on the shop's network only" />
      <SettingsTabs />
      <div className="stack">
        <section className="panel">
          <div className="panel-h"><h2>The computers</h2><span className="faint">On the sign-in page: Shop computer, then the name and PIN</span></div>
          <div className="panel-b">
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Name</th><th>Opens on</th><th>Sees</th><th>Signed in yet</th></tr></thead>
              <tbody>{STATIONS.map((s) => <tr key={s.key}><td><b data-notranslate>{s.name}</b><div className="sub">{s.label}</div></td><td>{s.home}</td><td>{s.note}<div className="sub">Permissions of the {made.get(stationEmail(s)) || s.role} role · change on User access ({stationEmail(s)})</div></td><td>{made.has(stationEmail(s)) ? "Yes" : "Not yet"}</td></tr>)}</tbody>
            </table></div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-h"><h2>PIN</h2><span className="faint">{st.pinHash ? `Set ${st.setAt ? new Date(st.setAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" }) : ""}${st.setBy ? ` by ${st.setBy.split("@")[0]}` : ""}` : "Not set yet: no shop computer can sign in"}</span></div>
          <div className="panel-b">{v.role === "owner" ? <StationPin has={!!st.pinHash} /> : <p className="faint">Only the owner can set it.</p>}</div>
        </section>
        <section className="panel">
          <div className="panel-h"><h2>Shop network</h2><span className="faint">Shop computers only sign in from here, wired or Wi-Fi</span></div>
          <div className="panel-b stack"><p>{net.configured ? `Saved: ${net.ips.join(", ")}. This computer (${net.ip || "unknown"}) is ${net.on ? "on" : "not on"} the shop's network.` : `Not saved yet: shop computers can't sign in until it is. This computer's internet address is ${net.ip || "unknown"}.`}</p>{v.role === "owner" && !net.on && <SaveNetwork />}<p className="faint" style={{ fontSize: 12.5 }}>Press it on a computer at the shop. A second internet line can be added the same way from a computer on it; remove one on Shipping Center → Settings.</p></div>
        </section>
      </div>
    </>
  );
}
