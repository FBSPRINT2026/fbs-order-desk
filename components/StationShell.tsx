"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Translate from "@/components/Translate";
import { stationFind, stationJob, type StationHit } from "@/app/shop/station-actions";
import type { JobCard } from "@/lib/jobCard";
import type { Station } from "@/lib/stations";

/**
 * A shop computer's whole screen (Nick, Nov 23 2026: "these are not the most computer literate people… they don't speak
 * English… it has to always be open on outbound… no left toolbar… all on one page… every computer needs to be able to
 * print a work order, print a box label, search for an order, and then they have individual tasks, and that's it").
 *
 * No menu: one bar on top (the station's name, Home, one search, Print work order, Print box label, Spanish) over the
 * station's own page. The station never leaves its pages: a link to a job opens the job here, over the page; anything
 * else stays put, and a page that isn't theirs goes straight back home.
 */
export default function StationShell({ station, page }: { station: Station; page: ReactNode }) {
  const path = usePathname() || "";
  const router = useRouter();
  const pages = [station.home, ...(station.pages || [])];
  const ours = (p: string) => pages.some((h) => p === h || p.startsWith(h + "/"));

  // a page that isn't the station's: back home at once
  useEffect(() => { if (path.startsWith("/shop") && !ours(path)) router.replace(station.home); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const [peek, setPeek] = useState<{ kind: "o" | "a"; id: string } | null>(null);
  // links: a job's page opens the job here; any other page that isn't theirs does nothing; printing still opens
  useEffect(() => {
    const on = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const u = new URL(a.href, location.href);
      if (u.origin !== location.origin || !u.pathname.startsWith("/shop")) return;
      const m = u.pathname.match(/^\/shop\/(orders|archive)\/([0-9a-f-]{36})/);
      if (m) { e.preventDefault(); e.stopPropagation(); setPeek({ kind: m[1] === "orders" ? "o" : "a", id: m[2] }); return; }
      if (!ours(u.pathname)) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener("click", on, true);
    return () => document.removeEventListener("click", on, true);
  }, [station.home]); // eslint-disable-line react-hooks/exhaustive-deps

  // the print buttons in the bar ask for the job first: "wo" or "label"
  const [want, setWant] = useState<"" | "wo" | "label">("");
  const pick = (h: { kind: "o" | "a"; id: string }) => {
    // an old Printavo job has no work order of ours: it opens to look at instead
    if (want === "wo" && h.kind === "o") printWo(h); else if (want === "label") printLabel(h); else setPeek(h);
    setWant("");
  };

  return (
    <div className="stn">
      <header className="stn-bar">
        <button type="button" className="stn-home" onClick={() => { setPeek(null); router.push(station.home); }} title="Back to the start">
          <svg viewBox="0 0 24 24" aria-hidden><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
          <span><b data-notranslate>{station.name}</b><small>{station.label}</small></span>
        </button>
        <StationSearch want={want} onPick={pick} onCancel={() => setWant("")} />
        <button type="button" className={"stn-act" + (want === "wo" ? " on" : "")} onClick={() => setWant(want === "wo" ? "" : "wo")}>
          <svg viewBox="0 0 24 24" aria-hidden><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M6 14h12v7H6z" /></svg>
          <span>Print work order</span>
        </button>
        <button type="button" className={"stn-act" + (want === "label" ? " on" : "")} onClick={() => setWant(want === "label" ? "" : "label")}>
          <svg viewBox="0 0 24 24" aria-hidden><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01" /></svg>
          <span>Print box label</span>
        </button>
        <div className="stn-tr"><Translate /></div>
      </header>
      <main className="main stn-main">{page}</main>
      {peek && <JobPeek ref0={peek} onClose={() => setPeek(null)} />}
    </div>
  );
}

function printWo(h: { kind: "o" | "a"; id: string }) {
  if (h.kind === "o") window.open(`/print/${h.id}?work=1`, "_blank");
}
function printLabel(h: { kind: "o" | "a"; id: string }) {
  window.open(`/print/${h.id}/labels${h.kind === "a" ? "?a=1" : ""}`, "_blank");
}

/** the one search: type, pick a job (or press Enter for the first) */
function StationSearch({ want, onPick, onCancel }: { want: "" | "wo" | "label"; onPick: (h: StationHit) => void; onCancel: () => void }) {
  const [q, setQ] = useState(""), [hits, setHits] = useState<StationHit[]>([]), [busy, setBusy] = useState(false), [open, setOpen] = useState(false);
  const box = useRef<HTMLInputElement>(null), seq = useRef(0);
  useEffect(() => { if (want) { box.current?.focus(); setOpen(true); } }, [want]);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setHits([]); return; }
    const my = ++seq.current;
    const h = setTimeout(async () => { setBusy(true); const r = await stationFind(t); if (my === seq.current) { setBusy(false); setHits(r.ok ? r.hits : []); } }, 250);
    return () => clearTimeout(h);
  }, [q]);
  const choose = (h: StationHit) => { onPick(h); setQ(""); setHits([]); setOpen(false); box.current?.blur(); };
  const ask = want === "wo" ? "Which job? Type its # or name to print its work order" : want === "label" ? "Which job? Type its # or name to print its box label" : "Find a job: # , customer, PO or name";
  return (
    <div className={"stn-find" + (want ? " asking" : "")}>
      <svg viewBox="0 0 24 24" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input ref={box} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)}
        onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) choose(hits[0]); if (e.key === "Escape") { setQ(""); onCancel(); box.current?.blur(); } }}
        placeholder={ask} aria-label={ask} />
      {want && <button type="button" className="stn-x" onClick={onCancel} aria-label="Cancel">✕</button>}
      {open && q.trim().length >= 2 && (
        <ul className="stn-hits">
          {busy && !hits.length ? <li className="faint">Looking…</li> : !hits.length ? <li className="faint">No job found</li> : hits.map((h) => (
            <li key={h.kind + h.id}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(h)}>
              <b data-notranslate>#{h.number}</b><span><span data-notranslate>{h.customer}</span>{h.job && <small data-notranslate>{h.job}</small>}</span><em>{h.status}</em>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** a job, to look at: over the station's page, with its two print buttons; nothing to change */
function JobPeek({ ref0, onClose }: { ref0: { kind: "o" | "a"; id: string }; onClose: () => void }) {
  const [job, setJob] = useState<JobCard | null>(null), [err, setErr] = useState("");
  const load = useCallback(async () => { const r = await stationJob(ref0.kind, ref0.id); if (r.ok) setJob(r.job); else setErr(r.error); }, [ref0.kind, ref0.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="stn-peek-bg" onClick={onClose}>
      <div className="stn-peek" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <div className="stn-peek-h">
          {job ? <div><h2 data-notranslate>#{job.number} · {job.customer}</h2><p><span data-notranslate>{job.name}</span>{job.po ? <> · PO <span data-notranslate>{job.po}</span></> : null}</p></div> : <h2>{err || "Opening the job…"}</h2>}
          <button type="button" className="stn-close" onClick={onClose}>✕ Close</button>
        </div>
        {job && <>
          <div className="stn-peek-facts">
            <span><small>Status</small><b>{job.status}</b></span>
            <span><small>Due</small><b data-notranslate>{job.due ? new Date(job.due + "T12:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "—"}</b></span>
            <span><small>Pieces</small><b data-notranslate>{job.qty}</b></span>
            <span><small>Goes out</small><b>{job.delivery === "ship" ? "Ship" : job.delivery === "deliver" ? "Delivery" : job.delivery === "pickup" ? "Pickup" : "—"}</b></span>
            {job.rush && <span className="bad"><b>RUSH</b></span>}
            {job.priority && <span className="pri"><b>Priority</b></span>}
          </div>
          <div className="stn-peek-b">
            {job.groups.map((g, gi) => (
              <section key={gi}>
                {job.groups.length > 1 && <h3 data-notranslate>{g.name}</h3>}
                {g.rows.map((r, ri) => (
                  <div key={ri} className="stn-row">
                    <div className="stn-g"><b data-notranslate>{r.style}</b> <span data-notranslate>{r.color}</span>{r.desc && <small data-notranslate>{r.desc}</small>}</div>
                    <div className="stn-sz">{r.sizes.map((s) => <span key={s.label}><small data-notranslate>{s.label}</small><b data-notranslate>{s.qty}</b></span>)}<span className="t"><small>Total</small><b data-notranslate>{r.total}</b></span></div>
                  </div>
                ))}
                {g.prints.length > 0 && <div className="stn-prints">{g.prints.map((p, pi) => (
                  <div key={pi} className="stn-print">
                    {p.image && <img src={p.image} alt="" />}
                    <div><b>{p.location}</b><span>{[p.method, p.colors, p.size].filter(Boolean).join(" · ")}</span>{p.inks && <small data-notranslate>{p.inks}</small>}</div>
                  </div>
                ))}</div>}
              </section>
            ))}
            {(job.productionNote || job.customerNote) && <p className="stn-note">{job.productionNote || job.customerNote}</p>}
          </div>
          <div className="stn-peek-f">
            {ref0.kind === "o" && <button type="button" className="stn-big" onClick={() => printWo(ref0)}>Print work order</button>}
            <button type="button" className="stn-big" onClick={() => printLabel(ref0)}>Print box label</button>
          </div>
        </>}
      </div>
    </div>
  );
}
