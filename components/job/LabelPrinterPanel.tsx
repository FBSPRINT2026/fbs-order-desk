"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SITE_URL } from "@/lib/config";

/**
 * Shipping Center → Settings: the Zebra label printer (ZT231) and the shop's network.
 *  - Printer: its IP address on the shop network, port 9100, 203 or 300 dpi.
 *  - Print computer: a shop computer on the same network runs a small relay script that sends labels to the printer
 *    (phones can't reach a printer directly from a secure web page). Or PrintNode, if that's set up instead.
 *  - Shop network: the shop's internet address. Crew PIN sign-ins only open the job's phone menu from there.
 */
type Status = {
  settings: { mode: "relay" | "printnode"; host: string; port: number; dpi: 203 | 300; printnodeId: string };
  relays: { id: string; name: string; last_seen_at: string | null }[];
  jobs: { id: string; title: string; status: string; error: string; created_by: string; created_at: string }[];
  printnode: boolean; network: { ip: string; ips: string[]; names?: Record<string, string>; on: boolean };
};
const ago = (d: string | null) => { if (!d) return "never"; const s = (Date.now() - Date.parse(d)) / 1000; return s < 90 ? "connected" : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };

export function relayScript(token: string, server = SITE_URL) {
  return `# FBS Print relay: sends labels from the portal to the Zebra label printer on this network.
# Install (once): right-click this file > Run with PowerShell, or in PowerShell:
#   powershell -ExecutionPolicy Bypass -File "$HOME\\Downloads\\fbs-print-relay.ps1" -Install
# It then starts by itself whenever someone signs in to this computer. Keep this computer on during work hours.
param([switch]$Install)
$Server = "${server}"
$Token = "${token}"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if ($Install) {
  $dir = Join-Path $env:LOCALAPPDATA "FBSPrintRelay"; New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $dest = Join-Path $dir "fbs-print-relay.ps1"; Copy-Item -Force $PSCommandPath $dest
  $act = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \`"$dest\`""
  $trg = New-ScheduledTaskTrigger -AtLogOn
  $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName "FBS Print Relay" -Action $act -Trigger $trg -Settings $set -Force | Out-Null
  Start-ScheduledTask -TaskName "FBS Print Relay"
  Write-Host "FBS Print Relay is installed and running. You can close this window."; exit
}
$h = @{ "x-relay-token" = $Token }
while ($true) {
  try {
    $r = Invoke-RestMethod -Uri "$Server/api/print/relay" -Headers $h -TimeoutSec 45
    foreach ($j in $r.jobs) {
      try {
        if (-not $r.host) { throw "The printer's IP address isn't set in the Shipping Center." }
        $c = New-Object System.Net.Sockets.TcpClient
        $c.Connect($r.host, [int]$r.port)
        $s = $c.GetStream(); $b = [System.Text.Encoding]::UTF8.GetBytes($j.zpl); $s.Write($b, 0, $b.Length); $s.Flush(); $c.Close()
        Invoke-RestMethod -Method Post -Uri "$Server/api/print/relay" -Headers $h -ContentType "application/json" -Body (@{ id = $j.id; ok = $true } | ConvertTo-Json) | Out-Null
      } catch {
        Invoke-RestMethod -Method Post -Uri "$Server/api/print/relay" -Headers $h -ContentType "application/json" -Body (@{ id = $j.id; ok = $false; error = "$($_.Exception.Message)" } | ConvertTo-Json) | Out-Null
      }
    }
  } catch { Start-Sleep -Seconds 5 }
}
`;
}

export default function LabelPrinterPanel() {
  const [st, setSt] = useState<Status | null>(null);
  const [v, setV] = useState<Status["settings"] | null>(null);
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState(""), [err, setErr] = useState("");
  const [newName, setNewName] = useState("Shipping computer"), [token, setToken] = useState("");
  const [netName, setNetName] = useState("Shop");
  const load = useCallback(async () => {
    const r = await fetch("/api/print", { cache: "no-store" }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (!r?.ok || !j) return setErr(j?.error || "Couldn't load the printer status.");
    setSt(j); setV((x) => x || j.settings);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  async function saveData(patch: Record<string, unknown>, done: string) {
    setBusy("save"); setErr(""); setMsg("");
    const sb = createClient();
    const { data } = await sb.from("settings").select("data").eq("id", 1).maybeSingle();
    const { error } = await sb.from("settings").upsert({ id: 1, data: { ...(data?.data || {}), ...patch }, updated_at: new Date().toISOString() });
    setBusy("");
    if (error) setErr(error.message); else { setMsg(done); load(); }
  }
  async function test() {
    setBusy("test"); setMsg(""); setErr("");
    const r = await fetch("/api/print", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test" }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { message: "Offline." };
    setBusy(""); setMsg(j.message || j.error || ""); load();
  }
  async function addRelay() {
    setBusy("relay"); setErr("");
    const r = await fetch("/api/print/relays", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Offline." };
    setBusy("");
    if (!r?.ok) return setErr(j.error || "Couldn't add it.");
    setToken(j.token); load();
  }
  function download() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([relayScript(token)], { type: "text/plain" }));
    a.download = "fbs-print-relay.ps1"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  if (!st || !v) return <section className="panel sc-set"><div className="panel-b">{err || "Loading the label printer…"}</div></section>;
  const live = st.relays.some((r) => r.last_seen_at && Date.now() - Date.parse(r.last_seen_at) < 90000);
  const ips = st.network.ips, names = st.network.names || {};
  return (
    <section className="panel sc-set">
      <div className="panel-h"><h2>Label printer (Zebra) &amp; shop network</h2></div>
      <div className="panel-b stack" style={{ gap: 16 }}>
        <div className="sc-grid">
          <div className="stack" style={{ gap: 10 }}>
            <div className="sw-h">Printer</div>
            <label className="field">Send labels through
              <select value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as "relay" | "printnode" })}>
                <option value="relay">Our print relay on a shop computer (free)</option>
                <option value="printnode">PrintNode{st.printnode ? "" : " (add PRINTNODE_API_KEY in Vercel first)"}</option>
              </select>
            </label>
            {v.mode === "relay" ? (
              <div className="row" style={{ gap: 8 }}>
                <label className="field" style={{ flex: 2 }}>Printer IP address<input type="text" value={v.host} placeholder="192.168.1.50" onChange={(e) => setV({ ...v, host: e.target.value.trim() })} /></label>
                <label className="field" style={{ flex: 1 }}>Port<input type="number" value={v.port} onChange={(e) => setV({ ...v, port: +e.target.value || 9100 })} /></label>
              </div>
            ) : (
              <label className="field">PrintNode printer ID<input type="text" value={v.printnodeId} placeholder="e.g. 71234567" onChange={(e) => setV({ ...v, printnodeId: e.target.value.trim() })} /></label>
            )}
            <label className="field">Printer resolution
              <select value={v.dpi} onChange={(e) => setV({ ...v, dpi: +e.target.value === 300 ? 300 : 203 })}><option value={203}>203 dpi (most ZT231s)</option><option value={300}>300 dpi</option></select>
            </label>
            <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>The ZT231 prints its IP address on a configuration label: hold the Feed button while it&apos;s idle, or check its menu under Connection. Give it a fixed IP on the router so it doesn&apos;t change.</p>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn primary" disabled={!!busy} onClick={() => saveData({ printing: v }, "Printer saved.")}>{busy === "save" ? "Saving…" : "Save printer"}</button>
              <button type="button" className="btn" disabled={!!busy} onClick={test}>{busy === "test" ? "Sending…" : "Print a test label"}</button>
            </div>
          </div>

          <div className="stack" style={{ gap: 10 }}>
            {v.mode === "relay" && <>
              <div className="sw-h">Print computer {live ? <span style={{ color: "#1E7A4C" }}>● connected</span> : <span style={{ color: "#B8392A" }}>● not connected</span>}</div>
              {st.relays.map((r) => (
                <div key={r.id} className="row" style={{ gap: 8, fontSize: 13.5 }}>
                  <b>{r.name}</b><span className="faint">{ago(r.last_seen_at)}</span><span className="spacer" />
                  <button type="button" className="linkbtn" onClick={async () => { await fetch(`/api/print/relays?id=${r.id}`, { method: "DELETE" }); load(); }}>Remove</button>
                </div>
              ))}
              {!token ? (
                <div className="row" style={{ gap: 8 }}>
                  <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Computer name" style={{ flex: 1 }} />
                  <button type="button" className="btn" disabled={!!busy} onClick={addRelay}>{st.relays.length ? "+ Another computer" : "+ Set up a print computer"}</button>
                </div>
              ) : (
                <div className="banner" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <b>Install it on a Windows computer at the shop (the WorldShip computer works):</b>
                  <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                    <li>On that computer, open this page and click <b>Download the relay</b>.</li>
                    <li>Open PowerShell and run: <code>powershell -ExecutionPolicy Bypass -File &quot;$HOME\Downloads\fbs-print-relay.ps1&quot; -Install</code></li>
                    <li>It starts itself after every sign-in. This page shows <b>connected</b> within a few seconds.</li>
                  </ol>
                  <div className="row" style={{ gap: 8 }}><button type="button" className="btn primary" onClick={download}>Download the relay</button><button type="button" className="btn" onClick={() => setToken("")}>Done</button></div>
                  <span className="faint" style={{ fontSize: 12 }}>The download has this computer&apos;s key in it; it isn&apos;t shown again. Lost it? Remove the computer and set it up again.</span>
                </div>
              )}
            </>}

            <div className="sw-h" style={{ marginTop: 6 }}>Shop network</div>
            <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>Crew who sign in with their employee PIN only get the job tools (press setup, notes, photos, labels) on the shop&apos;s Wi-Fi. Anyone else who scans a label, like a customer at home, gets their own order in the customer portal.</p>
            <div style={{ fontSize: 13.5 }}>This computer&apos;s internet address: <b>{st.network.ip || "unknown"}</b> {st.network.on ? <span style={{ color: "#1E7A4C" }}>(the shop network)</span> : null}</div>
            {ips.length ? <div className="stack" style={{ gap: 4 }}>{ips.map((ip) => <div key={ip} className="row" style={{ gap: 8, fontSize: 13.5 }}><span><b>{names[ip] || "Network"}</b>: {ip}</span><button type="button" className="linkbtn" onClick={() => saveData({ network: { ips: ips.filter((x) => x !== ip), names: Object.fromEntries(Object.entries(names).filter(([k]) => k !== ip)) } }, "Removed.")}>Remove</button></div>)}</div>
              : <div className="pv-err" style={{ fontSize: 13 }}>Not set yet: until it is, a PIN sign-in works from any network.</div>}
            {st.network.ip && !st.network.on && (
              <div className="row" style={{ gap: 8 }}>
                <input type="text" value={netName} onChange={(e) => setNetName(e.target.value)} aria-label="Name for this network" style={{ width: 150 }} />
                <button type="button" className="btn" disabled={!!busy || !netName.trim()} onClick={() => saveData({ network: { ips: [...ips, st.network.ip], names: { ...names, [st.network.ip]: netName.trim() } } }, `Saved. Crew PIN sign-ins now work on "${netName.trim()}".`)}>Use this network</button>
              </div>
            )}
            <p className="faint" style={{ fontSize: 12, margin: 0 }}>Add the shop while you&apos;re there. A home network can be added for testing; remove it when you&apos;re done.</p>
          </div>
        </div>
        {(msg || err) && <div className={err ? "pv-err" : "banner"}>{err || msg}</div>}
        {st.jobs.length > 0 && (
          <div>
            <div className="sw-h">Recent labels</div>
            <table className="aa-tbl" style={{ fontSize: 13 }}><tbody>{st.jobs.map((j) => (
              <tr key={j.id}><td>{j.title}</td><td>{j.created_by}</td><td>{new Date(j.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</td>
                <td style={{ color: j.status === "printed" ? "#1E7A4C" : j.status === "error" || j.status === "expired" ? "#B8392A" : undefined, fontWeight: 600 }}>{j.status === "queued" ? "waiting" : j.status}{j.error ? `: ${j.error}` : ""}</td></tr>
            ))}</tbody></table>
          </div>
        )}
      </div>
    </section>
  );
}
