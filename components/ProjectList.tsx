"use client";
import { useState } from "react";
import Link from "next/link";
import { PROJECT_STATUS, countdown, daysTo, type ProjectSummary } from "@/lib/projects";
import { fmtDateLong, money } from "@/lib/format";
import { useSticky } from "@/lib/useSticky";

type NewProject = { name: string; event_date: string | null; in_hands_date: string | null; requests: string; customer_id?: string };

/**
 * Projects as cards: upcoming first (by event date, with a countdown), then in progress, then done.
 * "New project" opens a short form (the shop also picks the customer).
 */
export default function ProjectList({ mode, projects, hrefOf, onCreate, customers, canAct = true, compact = false }: {
  mode: "portal" | "shop"; projects: ProjectSummary[]; hrefOf: (id: string) => string;
  onCreate?: (p: NewProject) => Promise<{ ok: boolean; error?: string; id?: string }>;
  /** shop: who the new project is for */
  customers?: { id: string; label: string }[];
  canAct?: boolean; compact?: boolean;
}) {
  const [tab, setTab] = useSticky<"open" | "done">("projects.tab", "open");
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState<NewProject>({ name: "", event_date: null, in_hands_date: null, requests: "", customer_id: customers?.length === 1 ? customers[0].id : "" });
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const open = projects.filter((p) => p.status === "planning" || p.status === "active");
  const done = projects.filter((p) => p.status === "delivered" || p.status === "closed");
  const list = (tab === "open" ? open : done).slice().sort((a, b) => (a.event_date || a.in_hands_date || "9999").localeCompare(b.event_date || b.in_hands_date || "9999"));
  return (
    <div className="pj">
      <div className="pj-bar">
        <div className="aa-sub" role="tablist">
          <button type="button" className={tab === "open" ? "on" : ""} onClick={() => setTab("open")}>Upcoming & in progress<span className="aa-n">{open.length}</span></button>
          <button type="button" className={tab === "done" ? "on" : ""} onClick={() => setTab("done")}>Done<span className="aa-n">{done.length}</span></button>
        </div>
        <span className="spacer" />
        {onCreate && <button type="button" className="btn primary" disabled={!canAct} onClick={() => setAdding((x) => !x)}>+ New project</button>}
      </div>
      {adding && onCreate && (
        <div className="pj-new">
          <b>{mode === "portal" ? "Tell us about your project" : "New project"}</b>
          <div className="pj-grid">
            {customers && <label className="wide">Customer<select value={f.customer_id} onChange={(e) => setF({ ...f, customer_id: e.target.value })}><option value="">Choose…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
            <label className="wide">Project name<input type="text" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Fall Sales Conference 2026" /></label>
            <label>Event date<input type="date" value={f.event_date || ""} onChange={(e) => setF({ ...f, event_date: e.target.value || null })} /></label>
            <label>Need everything by<input type="date" value={f.in_hands_date || ""} onChange={(e) => setF({ ...f, in_hands_date: e.target.value || null })} /></label>
            <label className="wide">What&apos;s it for? Anything special?<textarea rows={3} value={f.requests} onChange={(e) => setF({ ...f, requests: e.target.value })} placeholder="e.g. 400 attendees; staff shirts, tote bags and hats; ship to the hotel by Oct 10" /></label>
          </div>
          {err && <div className="banner">{err}</div>}
          <div className="row">
            <button type="button" className="btn primary" disabled={busy || !f.name.trim() || (!!customers && !f.customer_id)} onClick={async () => { setBusy(true); setErr(""); const r = await onCreate(f); setBusy(false); if (r.ok) { setAdding(false); setF({ name: "", event_date: null, in_hands_date: null, requests: "", customer_id: f.customer_id }); if (r.id) location.href = hrefOf(r.id); } else setErr(r.error || "Couldn't create it."); }}>{busy ? "Creating…" : "Create project"}</button>
            <button type="button" className="btn ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}
      <div className={"pj-cards" + (compact ? " compact" : "")}>
        {list.map((p) => {
          const d = p.event_date || p.in_hands_date, n = daysTo(d), st = PROJECT_STATUS[p.status];
          return (
            <Link key={p.id} href={hrefOf(p.id)} className="pj-card" style={{ ["--pc" as string]: st.c }}>
              <div className="pj-top"><span className="pj-st">{st.label}</span>{d && <span className={"pj-cd" + (n !== null && n >= 0 && n <= 14 ? " soon" : "")}>{countdown(d)}</span>}</div>
              <b className="pj-name">{p.name}</b>
              {mode === "shop" && p.company && <span className="pj-co">{p.company}</span>}
              <div className="pj-dates">
                {p.event_date && <span>📅 Event {fmtDateLong(p.event_date)}</span>}
                {p.in_hands_date && <span>📦 Needed by {fmtDateLong(p.in_hands_date)}</span>}
              </div>
              <div className="pj-foot">
                <span>{p.orders} order{p.orders === 1 ? "" : "s"}{p.total ? ` · ${money(p.total)}` : ""}</span>
                <span>{p.openTasks ? `${p.openTasks} open task${p.openTasks === 1 ? "" : "s"}` : "No open tasks"}</span>
              </div>
              {p.nextTask && <div className="pj-next">Next: {p.nextTask.title}{p.nextTask.due_date ? ` · ${fmtDateLong(p.nextTask.due_date)}` : ""}</div>}
            </Link>
          );
        })}
        {!list.length && <div className="gb-empty">{tab === "open" ? (mode === "portal" ? "No projects yet. Planning an event, a season or a big launch with several orders? Start a project and keep it all in one place." : "No upcoming projects.") : "Nothing finished yet."}</div>}
      </div>
    </div>
  );
}
