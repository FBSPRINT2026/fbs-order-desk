"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import { useRole } from "@/components/RoleContext";

/**
 * Support (owner): every "Report an issue" sent from the shop menu, newest first: who, when, which page, what they
 * said and the screenshot. Mark each one Working / Fixed / Won't fix, keep notes, and "Copy for Claude" puts the whole
 * report (with a link to the screenshot) on the clipboard to work through it with Claude. Claude can also read these
 * straight from the support_issues table.
 */
type Issue = { id: string; created_at: string; by: string; page: string | null; page_title: string | null; message: string; screenshot: string | null; context: Record<string, unknown>; status: "open" | "working" | "fixed" | "wont"; notes: string };
const STATUS: { v: Issue["status"]; label: string }[] = [{ v: "open", label: "Open" }, { v: "working", label: "Working on it" }, { v: "fixed", label: "Fixed" }, { v: "wont", label: "Won't fix" }];

export default function SupportPage() {
  const sb = useMemo(() => createClient(), []);
  const { realRole } = useRole();
  const [rows, setRows] = useState<Issue[]>([]), [shots, setShots] = useState<Record<string, string>>({});
  const [err, setErr] = useState(""), [loading, setLoading] = useState(true), [big, setBig] = useState<string | null>(null);
  const [show, setShow] = useSticky<"open" | "all">("support.show", "open");
  const load = useCallback(async () => {
    setLoading(true); setErr("");
    const r = await sb.from("support_issues").select("*").order("created_at", { ascending: false }).limit(300);
    if (r.error) { setErr(/support_issues/.test(r.error.message) ? "The support table isn't in the database yet: run supabase/migrations/115_support_issues.sql in Supabase (SQL Editor)." : r.error.message); setLoading(false); return; }
    const list = (r.data || []) as Issue[]; setRows(list);
    const paths = list.map((x) => x.screenshot).filter(Boolean) as string[];
    if (paths.length) {
      const s = await sb.storage.from("proofs").createSignedUrls(paths, 60 * 60 * 24);
      const m: Record<string, string> = {}; (s.data || []).forEach((x) => { if (x.path && x.signedUrl) m[x.path] = x.signedUrl; }); setShots(m);
    }
    setLoading(false);
  }, [sb]);
  useEffect(() => { load(); }, [load]);

  async function update(id: string, patch: Partial<Issue>) {
    setRows((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const r = await sb.from("support_issues").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (r.error) setErr(r.error.message);
  }
  async function copy(x: Issue) {
    const t = [`Support issue ${x.id}`, `From: ${x.by} · ${new Date(x.created_at).toLocaleString()}`, `Page: ${x.page_title || ""} ${x.page || ""}`.trim(),
      `What happened: ${x.message || "(nothing typed)"}`, x.screenshot ? `Screenshot: ${shots[x.screenshot] || x.screenshot}` : "No screenshot",
      `Details: ${JSON.stringify(x.context)}`, x.notes ? `Notes: ${x.notes}` : ""].filter(Boolean).join("\n");
    try { await navigator.clipboard.writeText(t); } catch { /* clipboard blocked */ }
  }

  if (realRole && realRole !== "owner") return <div className="page"><h1>Support</h1><p className="faint">Only the owner sees the support reports. To report a problem, use “Report an issue” in the menu.</p></div>;
  const list = show === "open" ? rows.filter((x) => x.status === "open" || x.status === "working") : rows;
  const openN = rows.filter((x) => x.status === "open").length;
  return (
    <div className="page sup-page">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1>Support {openN > 0 && <span className="badge">{openN}</span>}</h1>
        <div className="rv-seg">{([["open", "Open"], ["all", "All"]] as const).map(([k, l]) => <button key={k} type="button" className={show === k ? "on" : ""} onClick={() => setShow(k)}>{l}</button>)}</div>
      </div>
      <p className="faint">Problems the team reported with “Report an issue”: what they said and what the screen looked like. Use “Copy for Claude” to work through one with Claude.</p>
      {err && <div className="pv-err">{err}</div>}
      {loading ? <p className="faint">Loading…</p> : !list.length ? <p className="faint">{show === "open" ? "No open issues." : "No issues reported yet."}</p> : (
        <div className="sup-list">
          {list.map((x) => (
            <article key={x.id} className={"sup-card st-" + x.status}>
              {x.screenshot && shots[x.screenshot] ? <button type="button" className="sup-thumb" onClick={() => setBig(shots[x.screenshot!])} title="See it full size"><img src={shots[x.screenshot]} alt="Screenshot" /></button> : <div className="sup-thumb none faint">No screenshot</div>}
              <div className="sup-body">
                <div className="sup-meta"><b data-notranslate>{x.by.split("@")[0]}</b> · {new Date(x.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  {x.page && <> · <a href={x.page} target="_blank" rel="noreferrer" data-notranslate>{x.page_title || new URL(x.page).pathname}</a></>}</div>
                <p className="sup-msg">{x.message || <span className="faint">(nothing typed)</span>}</p>
                <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <select value={x.status} onChange={(e) => update(x.id, { status: e.target.value as Issue["status"] })} aria-label="Status">{STATUS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}</select>
                  <button type="button" className="btn sm" onClick={() => copy(x)}>Copy for Claude</button>
                </div>
                <textarea className="sup-notes" rows={2} defaultValue={x.notes} placeholder="Notes (what we found, what was fixed)" onBlur={(e) => { if (e.target.value !== x.notes) update(x.id, { notes: e.target.value }); }} />
              </div>
            </article>
          ))}
        </div>
      )}
      {big && <div className="sup-back" onClick={() => setBig(null)} role="dialog" aria-label="Screenshot"><img className="sup-big" src={big} alt="Screenshot full size" /></div>}
    </div>
  );
}
