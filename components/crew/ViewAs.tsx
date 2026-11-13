"use client";
import { useEffect, useState } from "react";
import { useT } from "@/components/job/lang";

/**
 * View as (Nick, Nov 13 2026): the bar across the top while the owner sees someone's phone (look only, Stop ends it), and
 * the owner's picker on his own main menu. Only the owner's portal login gets either (lib/jobAccess.ts).
 */
export function ViewAsBar({ name }: { name: string }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  async function stop() { setBusy(true); await fetch("/api/viewas", { method: "DELETE" }).catch(() => null); location.href = "/crew"; }
  return (
    <div className="vas-bar" data-notranslate>
      <span><b>{t("Viewing as {0}", name)}</b><small>{t("Look only: nothing you tap is saved")}</small></span>
      <button type="button" onClick={stop} disabled={busy}>{t("Stop")}</button>
    </div>
  );
}

export function ViewAsPick() {
  const { t } = useT();
  const [people, setPeople] = useState<{ id: string; first_name: string; last_name: string; code: number | null; department: string }[] | null>(null);
  const [q, setQ] = useState(""), [err, setErr] = useState("");
  useEffect(() => { fetch("/api/viewas").then((r) => r.json()).then((j) => setPeople(j.people || [])).catch(() => setPeople([])); }, []);
  async function pick(id: string) {
    setErr("");
    const r = await fetch("/api/viewas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId: id }) }).catch(() => null);
    if (!r?.ok) { setErr(t("Couldn't switch. Try again.")); return; }
    location.href = "/crew";
  }
  const w = q.trim().toLowerCase();
  const list = (people || []).filter((p) => !w || `${p.first_name} ${p.last_name} ${p.code ?? ""} ${p.department}`.toLowerCase().includes(w));
  return (
    <div className="jm-card vas-pick">
      <div className="jm-cardh"><b>{t("See a phone as…")}</b><span className="jm-faint">{t("Owner only · look only")}</span></div>
      <input className="vas-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Name or employee #")} aria-label={t("Name or employee #")} />
      {err && <div className="jm-warn">{err}</div>}
      <div className="vas-list">
        {!people ? <p className="jm-faint">{t("Loading…")}</p> : list.slice(0, 40).map((p) => (
          <button key={p.id} type="button" onClick={() => pick(p.id)}><b data-notranslate>{p.first_name} {p.last_name}</b><small>{p.code ? `#${p.code}` : ""}{p.department ? ` · ${t(p.department)}` : ""}</small></button>
        ))}
      </div>
    </div>
  );
}
