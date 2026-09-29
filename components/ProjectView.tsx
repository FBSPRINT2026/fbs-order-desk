"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { PROJECT_STATUS, countdown, type Project, type ProjectOrder, type ProjectStatus, type ProjectTask } from "@/lib/projects";
import { fmtDateLong, money } from "@/lib/format";
import { useSticky } from "@/lib/useSticky";

type R = Promise<{ ok: boolean; error?: string; id?: string }>;
export type ProjectActs = {
  save: (patch: Partial<Pick<Project, "name" | "status" | "event_date" | "in_hands_date" | "delivery" | "requests">>) => R;
  addTask: (t: { title: string; due_date: string | null; who: "shop" | "customer"; shop_only: boolean }) => R;
  toggleTask: (id: string, done: boolean) => R;
  deleteTask?: (id: string) => R;
  link: (orderId: string, archived?: boolean) => R;
  unlink?: (orderId: string, archived?: boolean) => R;
  newOrder: () => R;
  changed: () => void;
};

/**
 * One project: key dates with a countdown, its orders (with totals), details and special requests,
 * a task checklist (ours and theirs; shop-only tasks never reach the customer) and the project's conversation.
 */
export default function ProjectView({ mode, project, tasks, orders, linkable, messages, act, canAct = true, customerHref, company }: {
  mode: "portal" | "shop"; project: Project; tasks: ProjectTask[]; orders: ProjectOrder[];
  /** the customer's orders not in this project yet */
  linkable: { id: string; label: string; archived?: boolean }[];
  messages: ReactNode; act: ProjectActs; canAct?: boolean; customerHref?: string; company?: string;
}) {
  const [p, setP] = useState(project);
  useEffect(() => setP(project), [project]);
  const [saving, setSaving] = useState(""), [err, setErr] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edit = (patch: Partial<Project>, now = false) => {
    setP((x) => ({ ...x, ...patch }));
    if (!canAct) return;
    if (timer.current) clearTimeout(timer.current);
    setSaving("Saving…");
    timer.current = setTimeout(async () => { const r = await act.save(patch); setSaving(r.ok ? "Saved" : ""); if (!r.ok) setErr(r.error || "Couldn't save."); }, now ? 0 : 700);
  };
  const total = orders.reduce((a, o) => a + o.total, 0), owed = orders.reduce((a, o) => a + Math.max(0, o.balance), 0);
  const st = PROJECT_STATUS[p.status];

  // tasks
  const [nt, setNt] = useState({ title: "", due: "", who: mode === "portal" ? "customer" : "shop", shopOnly: false });
  const open = tasks.filter((t) => !t.done_at).sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"));
  const doneT = tasks.filter((t) => t.done_at);
  const [showDone, setShowDone] = useSticky("project.showDone", false);
  const run = async (r: R) => { setErr(""); const x = await r; if (!x.ok) setErr(x.error || "Couldn't save."); else act.changed(); return x; };

  // key dates: event, needed-by, and tasks with due dates
  const dates = [
    ...(p.in_hands_date ? [{ d: p.in_hands_date, t: "Everything needed by", k: "hands" }] : []),
    ...(p.event_date ? [{ d: p.event_date, t: "Event", k: "event" }] : []),
    ...open.filter((t) => t.due_date).map((t) => ({ d: t.due_date as string, t: t.title, k: "task" })),
  ].sort((a, b) => a.d.localeCompare(b.d)).slice(0, 6);

  const [linkSel, setLinkSel] = useState("");
  const [busy, setBusy] = useState("");

  return (
    <div className="pv2">
      <header className="pv2-h" style={{ ["--pc" as string]: st.c }}>
        <div className="pv2-t">
          <span className="pv2-eyebrow">Project{mode === "shop" && company ? <> · {customerHref ? <Link href={customerHref}>{company}</Link> : company}</> : null}</span>
          <input type="text" className="pv2-name" value={p.name} disabled={!canAct} onChange={(e) => edit({ name: e.target.value })} aria-label="Project name" />
          <div className="pv2-when">
            {p.event_date && <span>📅 Event <b>{fmtDateLong(p.event_date)}</b> <i>{countdown(p.event_date)}</i></span>}
            {p.in_hands_date && <span>📦 Needed by <b>{fmtDateLong(p.in_hands_date)}</b> <i>{countdown(p.in_hands_date)}</i></span>}
          </div>
        </div>
        <div className="pv2-r">
          {mode === "shop"
            ? <select className="pv2-st" value={p.status} onChange={(e) => edit({ status: e.target.value as ProjectStatus }, true)} aria-label="Project status">{(Object.keys(PROJECT_STATUS) as ProjectStatus[]).map((k) => <option key={k} value={k}>{PROJECT_STATUS[k].label}</option>)}</select>
            : <span className="pv2-stp">{st.label}</span>}
          <div className="pv2-money"><span>{orders.length} order{orders.length === 1 ? "" : "s"}</span><b>{money(total)}</b>{owed > 0.004 && <small>{money(owed)} due</small>}</div>
          <span className="faint" style={{ fontSize: 12 }}>{saving}</span>
        </div>
      </header>
      {err && <div className="banner">{err}</div>}

      <div className="pv2-grid">
        <div className="pv2-main">
          <section className="panel">
            <div className="panel-h"><h2>Orders in this project</h2>
              <button type="button" className="btn primary sm" disabled={!canAct || !!busy} onClick={async () => { setBusy("new"); const r = await act.newOrder(); setBusy(""); if (!r.ok) setErr(r.error || "Couldn't start it."); }}>{busy === "new" ? "Starting…" : "+ New order for this project"}</button>
            </div>
            <div className="panel-b">
              {orders.length ? (
                <table className="aa-tbl pv2-orders"><tbody>
                  {orders.map((o) => (
                    <tr key={o.id} onClick={() => (location.href = o.href)}>
                      <td className="num"><Link href={o.href} onClick={(e) => e.stopPropagation()}>#{o.number}</Link></td>
                      <td><div className="aa-t">{o.nickname || (o.type === "quote" ? "Quote" : "Order")}{o.archived && <span className="aa-arch">Archived</span>}</div>{o.due_date && <div className="aa-s">In hands {fmtDateLong(o.due_date)}</div>}</td>
                      <td><span className="aa-pill" style={{ ["--sc" as string]: o.statusColor || "var(--accent)" }}>{o.statusLabel}</span></td>
                      <td className="r num b">{money(o.total)}</td>
                      {act.unlink && <td className="r" onClick={(e) => e.stopPropagation()}><button type="button" className="btn icon ghost sm" title="Take out of this project" aria-label="Take out of this project" onClick={() => run(act.unlink!(o.id, o.archived))}>✕</button></td>}
                    </tr>
                  ))}
                </tbody></table>
              ) : <div className="gb-empty">No orders in this project yet. Start one here, or add an order you already have.</div>}
              {linkable.length > 0 && canAct && (
                <div className="pv2-link">
                  <select value={linkSel} onChange={(e) => setLinkSel(e.target.value)} aria-label="Add an existing order">
                    <option value="">Add an existing order…</option>
                    {linkable.slice(0, 200).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                  <button type="button" className="btn sm" disabled={!linkSel} onClick={async () => { const l = linkable.find((x) => x.id === linkSel); await run(act.link(linkSel, l?.archived)); setLinkSel(""); }}>Add</button>
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Details</h2></div>
            <div className="panel-b pv2-details">
              <label>Event date<input type="date" value={p.event_date || ""} disabled={!canAct} onChange={(e) => edit({ event_date: e.target.value || null }, true)} /></label>
              <label>Everything needed by<input type="date" value={p.in_hands_date || ""} disabled={!canAct} onChange={(e) => edit({ in_hands_date: e.target.value || null }, true)} /></label>
              <label className="wide">Delivery (where it goes, who receives it)<textarea rows={2} value={p.delivery} disabled={!canAct} onChange={(e) => edit({ delivery: e.target.value })} placeholder="e.g. Hilton Downtown, loading dock B; attn. event manager" /></label>
              <label className="wide">Special requests<textarea rows={4} value={p.requests} disabled={!canAct} onChange={(e) => edit({ requests: e.target.value })} placeholder="Colors, packing by department, name drops, anything we should know" /></label>
            </div>
          </section>
        </div>

        <aside className="pv2-side">
          <section className="panel">
            <div className="panel-h"><h2>Key dates</h2></div>
            <div className="panel-b">
              {dates.length ? <ol className="pv2-dates">{dates.map((x, i) => <li key={i} className={x.k}><span className="d">{fmtDateLong(x.d)}</span><span className="t">{x.t}</span><span className="c">{countdown(x.d)}</span></li>)}</ol>
                : <div className="faint" style={{ fontSize: 13 }}>Add the event date and when you need everything.</div>}
            </div>
          </section>
          <section className="panel">
            <div className="panel-h"><h2>Tasks</h2><span className="faint" style={{ fontSize: 12 }}>{open.length} open</span></div>
            <div className="panel-b pv2-tasks">
              {open.map((t) => <Task key={t.id} t={t} mode={mode} canAct={canAct && (mode === "shop" || t.who === "customer")} onToggle={(d) => run(act.toggleTask(t.id, d))} onDelete={act.deleteTask ? () => run(act.deleteTask!(t.id)) : undefined} />)}
              {!open.length && <div className="faint" style={{ fontSize: 13 }}>No open tasks.</div>}
              {doneT.length > 0 && <button type="button" className="pd-link" onClick={() => setShowDone((x) => !x)}>{showDone ? "Hide" : "Show"} {doneT.length} done</button>}
              {showDone && doneT.map((t) => <Task key={t.id} t={t} mode={mode} canAct={canAct && (mode === "shop" || t.who === "customer")} onToggle={(d) => run(act.toggleTask(t.id, d))} onDelete={act.deleteTask ? () => run(act.deleteTask!(t.id)) : undefined} />)}
              {canAct && (
                <form className="pv2-add" onSubmit={async (e) => { e.preventDefault(); if (!nt.title.trim()) return; const r = await run(act.addTask({ title: nt.title, due_date: nt.due || null, who: nt.who as "shop" | "customer", shop_only: nt.shopOnly })); if (r.ok) setNt({ ...nt, title: "", due: "" }); }}>
                  <input type="text" value={nt.title} onChange={(e) => setNt({ ...nt, title: e.target.value })} placeholder={mode === "portal" ? "Add a to-do (e.g. send final headcount)" : "Add a task"} aria-label="New task" />
                  <div className="row">
                    <input type="date" value={nt.due} onChange={(e) => setNt({ ...nt, due: e.target.value })} aria-label="Due date" />
                    {mode === "shop" && <select value={nt.who} onChange={(e) => setNt({ ...nt, who: e.target.value })} aria-label="Whose task"><option value="shop">Us</option><option value="customer">Customer</option></select>}
                    {mode === "shop" && <label className="check" title="The customer won't see it"><input type="checkbox" checked={nt.shopOnly} onChange={(e) => setNt({ ...nt, shopOnly: e.target.checked })} /> Shop only</label>}
                    <button type="submit" className="btn sm" disabled={!nt.title.trim()}>Add</button>
                  </div>
                </form>
              )}
            </div>
          </section>
        </aside>
      </div>

      <section className="pv2-msgs">
        <h2>Project conversation</h2>
        {messages}
      </section>
    </div>
  );
}

function Task({ t, mode, canAct, onToggle, onDelete }: { t: ProjectTask; mode: "portal" | "shop"; canAct: boolean; onToggle: (done: boolean) => void; onDelete?: () => void }) {
  const late = !t.done_at && t.due_date && t.due_date < new Date().toISOString().slice(0, 10);
  return (
    <div className={"pv2-task" + (t.done_at ? " done" : "") + (late ? " late" : "")}>
      <input type="checkbox" checked={!!t.done_at} disabled={!canAct} onChange={(e) => onToggle(e.target.checked)} aria-label={t.title} />
      <div>
        <span className="tt">{t.title}</span>
        <span className="tm">
          <i className={t.who}>{t.who === "customer" ? (mode === "portal" ? "You" : "Customer") : mode === "portal" ? "Us" : "Shop"}</i>
          {t.shop_only && mode === "shop" && <i className="so">Shop only</i>}
          {t.due_date && <span>{late ? "Late · " : ""}{fmtDateLong(t.due_date)}</span>}
        </span>
      </div>
      {onDelete && <button type="button" className="btn icon ghost sm" aria-label="Delete task" onClick={onDelete}>✕</button>}
    </div>
  );
}
