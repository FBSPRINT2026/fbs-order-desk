"use client";
import { useEffect, useState } from "react";
import { allowBigChange, driveView, makeDriveKey, type DriveView } from "@/app/shop/settings/dropbox/drive-actions";
import { backupScript } from "@/lib/backupDriveScript";

/**
 * The backup drive at home (lib/backupDrive.ts; Nick, Nov 14 2026): set it up once (the download is a small program that
 * installs itself), then see every night's run here. The key is only inside the download; making a new one stops the old.
 */
const when = (s?: string) => (s ? new Date(s).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const gb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(0, Math.round(b / 1e6))} MB`);

export default function BackupDrive() {
  const [v, setV] = useState<DriveView | null>(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false), [made, setMade] = useState(false);
  const load = () => void driveView().then((r) => (r.ok ? setV(r.v) : setErr(r.error)));
  useEffect(load, []);
  async function setUp() {
    if (v?.setUp && !confirm("Make a new key? The program already on the home computer stops working until you run the new download there.")) return;
    setBusy(true); setErr("");
    const r = await makeDriveKey();
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    const blob = new Blob([backupScript(r.key, window.location.origin)], { type: "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "fbs-backup.ps1"; a.click();
    setMade(true); load();
  }
  const l = v?.last;
  return (
    <section className="panel">
      <div className="panel-h"><h2>Backup drive</h2><span className="faint">The whole Dropbox copied to the drive at home every night; the drive is switched off between runs</span></div>
      <div className="panel-b bkd">
        {err && <div className="bkd-bad">{err}</div>}
        {!v ? <div className="faint">Loading…</div> : <>
          {v.problem && <div className="bkd-bad">{v.problem.replace(/^Backup drive: /, "")}</div>}
          {l?.held && <div className="bkd-row"><button type="button" className="btn" onClick={async () => { await allowBigChange(); load(); }} disabled={v.allowBig}>{v.allowBig ? "OK: backs them up tonight" : "I checked: back them up"}</button><span className="faint">Old copies are kept under _older on the drive either way.</span></div>}
          {v.setUp ? (
            <div className="bkd-stats">
              <div><span className="k">Last full backup</span><b>{when(v.lastDone)}</b></div>
              <div><span className="k">Last run</span><b>{when(l?.at)}</b>{l && <small>{l.done ? "finished" : l.held ? "paused" : "still going or stopped"}</small>}</div>
              <div><span className="k">Copied</span><b>{l ? `${l.added.toLocaleString()} new · ${l.changed.toLocaleString()} changed` : "—"}</b>{l && <small>{gb(l.bytes)}</small>}</div>
              <div><span className="k">Drive</span><b>{l?.freeGB != null ? `${l.freeGB.toLocaleString()} GB free` : "—"}</b>{l?.sizeGB ? <small>of {l.sizeGB.toLocaleString()} GB</small> : null}</div>
              {l && l.errors > 0 && <div className="bkd-full"><span className="k">Problems</span><b>{l.errors.toLocaleString()}</b><small>{l.firstError}</small></div>}
            </div>
          ) : <p className="faint" style={{ margin: 0 }}>Not set up yet.</p>}
          <div className="bkd-row">
            <button type="button" className={v.setUp ? "btn" : "btn primary"} disabled={busy} onClick={() => void setUp()}>{busy ? "Making…" : v.setUp ? "Set up again (new key)" : "Set up the backup drive"}</button>
            {v.setUp && <span className="faint">Set up {when(v.madeAt)}</span>}
          </div>
          {(made || !v.setUp) && <ol className="bkd-steps">
            <li>On the home computer, plug in the drive. Its name has to be <b>FBS Backup</b>.</li>
            <li>Press <b>Set up the backup drive</b> there; it downloads <b>fbs-backup.ps1</b>.</li>
            <li>In Downloads, right-click it → <b>Run with PowerShell</b>, and say <b>Yes</b> when Windows asks.</li>
            <li>It starts copying right away (the first time is the whole Dropbox and takes a while), then every night at 1:30 am. If a night is missed, it runs as soon as the computer is on.</li>
          </ol>}
        </>}
      </div>
    </section>
  );
}
