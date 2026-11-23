"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Translate from "@/components/Translate";
import { stationFind, stationJob, type StationHit, type StationMock } from "@/app/shop/station-actions";
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
  // a job's full page is open to every shop computer too (View full order in the job's details; Nick, Nov 23 2026)
  const pages = [station.home, ...(station.pages || []), "/shop/orders/", "/shop/archive/"];
  const ours = (p: string) => pages.some((h) => p === h || p.startsWith(h.endsWith("/") ? h : h + "/"));

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
      // a page that isn't the station's (an order's "← Orders", a customer): back to the station's own page, never stuck
      if (!ours(u.pathname)) { e.preventDefault(); e.stopPropagation(); window.location.assign(station.home); }
    };
    document.addEventListener("click", on, true);
    return () => document.removeEventListener("click", on, true);
  }, [station.home]); // eslint-disable-line react-hooks/exhaustive-deps

  // type a job, press Enter: the bar shows which job it found (#, customer, job name) and the three buttons beside it work
  // on that job (Nick, Nov 23 2026: "when you hit enter it should just confirm the job name and customer and then to the
  // right there should be three buttons… view details, print work order and print box label")
  const [job, setJob] = useState<StationHit | null>(null);

  return (
    <div className="stn">
      <header className="stn-bar">
        <button type="button" className="stn-home" onClick={() => { setPeek(null); window.location.assign(station.home); }} title="Back to the start">
          <svg viewBox="0 0 24 24" aria-hidden><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
          <span><b data-notranslate>{station.name}</b><small>{station.label}</small></span>
        </button>
        <StationSearch job={job} onPick={setJob} onClear={() => setJob(null)} />
        <button type="button" className="stn-act" disabled={!job} onClick={() => job && setPeek(job)}>
          <svg viewBox="0 0 24 24" aria-hidden><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
          <span>View details</span>
        </button>
        <button type="button" className="stn-act" disabled={!job || job.kind !== "o"} title={job?.kind === "a" ? "An old Printavo job has no work order here" : undefined} onClick={() => job && printWo(job)}>
          <svg viewBox="0 0 24 24" aria-hidden><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M6 14h12v7H6z" /></svg>
          <span>Print work order</span>
        </button>
        <button type="button" className="stn-act" disabled={!job} onClick={() => job && printLabel(job)}>
          <svg viewBox="0 0 24 24" aria-hidden><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01" /></svg>
          <span>Print box label</span>
        </button>
        <div className="stn-tr"><Translate /></div>
      </header>
      <main className="main stn-main">{page}</main>
      {peek && <JobPeek ref0={peek} onClose={() => setPeek(null)} onFull={(href) => { setPeek(null); router.push(href); }} />}
    </div>
  );
}

function printWo(h: { kind: "o" | "a"; id: string }) {
  if (h.kind === "o") window.open(`/print/${h.id}?work=1`, "_blank");
}
function printLabel(h: { kind: "o" | "a"; id: string }) {
  window.open(`/print/${h.id}/labels${h.kind === "a" ? "?a=1" : ""}`, "_blank");
}

/** the one search: type a #, a customer, a PO or a name and press Enter (or tap a job in the list); the job it found stays
 * in the bar, confirmed, until it's cleared or another is looked up */
function StationSearch({ job, onPick, onClear }: { job: StationHit | null; onPick: (h: StationHit) => void; onClear: () => void }) {
  const [q, setQ] = useState(""), [hits, setHits] = useState<StationHit[]>([]), [busy, setBusy] = useState(false), [open, setOpen] = useState(false);
  const box = useRef<HTMLInputElement>(null), seq = useRef(0), enterNext = useRef(false);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setHits([]); return; }
    const my = ++seq.current;
    const h = setTimeout(async () => {
      setBusy(true); const r = await stationFind(t);
      if (my !== seq.current) return;
      setBusy(false); const hs = r.ok ? r.hits : []; setHits(hs);
      // Enter pressed before the answer came back: take the best match once it's here
      if (enterNext.current) { enterNext.current = false; const best = exact(t, hs); if (best) choose(best); }
    }, 200);
    return () => clearTimeout(h);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  // a typed job # wins over everything else; otherwise the first job found
  const exact = (t: string, hs: StationHit[]) => hs.find((h) => h.number === t.replace(/^#/, "").trim()) || hs[0] || null;
  const choose = (h: StationHit) => { onPick(h); setQ(""); setHits([]); setOpen(false); box.current?.blur(); };
  if (job && !q) return (
    <div className="stn-find stn-got" onClick={() => { onClear(); setTimeout(() => box.current?.focus(), 0); }} title="Look up another job">
      <svg viewBox="0 0 24 24" aria-hidden><path d="M5 12l5 5L20 7" /></svg>
      <span className="stn-got-t"><b data-notranslate>#{job.number}</b><span data-notranslate>{job.customer}</span>{job.job && <small data-notranslate>{job.job}</small>}</span>
      <em>{job.status}</em>
      <button type="button" className="stn-x" onClick={(e) => { e.stopPropagation(); onClear(); }} aria-label="Clear">✕</button>
    </div>
  );
  const ask = "Find a job: # , customer, PO or name, then Enter";
  return (
    <div className="stn-find">
      <svg viewBox="0 0 24 24" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input ref={box} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { const best = exact(q, hits); if (best && !busy) choose(best); else if (q.trim().length >= 2) enterNext.current = true; }
          if (e.key === "Escape") { setQ(""); box.current?.blur(); }
        }}
        placeholder={ask} aria-label={ask} />
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
function JobPeek({ ref0, onClose, onFull }: { ref0: { kind: "o" | "a"; id: string }; onClose: () => void; onFull: (href: string) => void }) {
  const [job, setJob] = useState<JobCard | null>(null), [err, setErr] = useState(""), [mocks, setMocks] = useState<StationMock[]>([]), [mi, setMi] = useState(0), [big, setBig] = useState(false);
  const load = useCallback(async () => { const r = await stationJob(ref0.kind, ref0.id); if (r.ok) { setJob(r.job); setMocks(r.mockups); } else setErr(r.error); }, [ref0.kind, ref0.id]);
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
            <div className="stn-peek-top">
              <div className="stn-mock">
                {mocks.length ? <>
                  <button type="button" className="stn-mock-img" onClick={() => setBig(true)} title="See it big"><img src={mocks[mi]?.thumb || mocks[mi]?.full} alt="Mockup" /></button>
                  {mocks.length > 1 && <div className="stn-mock-n">{mocks.map((m, i) => <button key={i} type="button" className={i === mi ? "on" : ""} onClick={() => setMi(i)} aria-label={`Picture ${i + 1}`} />)}</div>}
                  <small>Tap to see it big{mocks.length > 1 ? ` · ${mi + 1} of ${mocks.length}` : ""}</small>
                </> : <div className="stn-mock-none">No mockup</div>}
              </div>
              <div className="stn-shipto">
                <div className="stn-shipto-k">{job.delivery === "pickup" ? "Pickup" : job.delivery === "deliver" ? "We deliver to" : "Ships to"}</div>
                {job.delivery === "pickup" ? <p>The customer picks it up here.</p> : job.shipTo.length ? <p data-notranslate>{job.shipTo.map((l, i) => <span key={i} className={i === 0 ? "b" : ""}>{l}</span>)}</p> : <p className="faint">No address on the job</p>}
                {job.delivery !== "pickup" && <small>{[job.shipMethod, job.tracking ? `Tracking ${job.tracking}` : "Not shipped yet"].filter(Boolean).join(" · ")}</small>}
              </div>
            </div>
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
            <button type="button" className="stn-big stn-full" onClick={() => onFull(job.href || (ref0.kind === "o" ? `/shop/orders/${ref0.id}` : `/shop/archive/${ref0.id}`))}>View full order</button>
          </div>
        </>}
      </div>
      {big && mocks[mi] && <div className="stn-big-pic" onClick={(e) => { e.stopPropagation(); setBig(false); }}><img src={mocks[mi].full || mocks[mi].thumb} alt="Mockup" /><span>Tap to close</span></div>}
    </div>
  );
}
