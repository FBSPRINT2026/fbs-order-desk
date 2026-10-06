"use client";
import { useEffect, useRef, useState } from "react";
import type { JobCard } from "@/lib/jobCard";
import type { JobActor } from "@/lib/jobAccess";
import type { ShipSettings } from "@/lib/pricing";
import type { Shipment } from "@/lib/shipping";
import type { CheckJob } from "@/lib/checkinShared";
import type { ShipTarget } from "@/components/ShipWindow";
import { addNote, addPhoto, NOTE_TAGS, useJobFiles, type JobFile } from "./JobFiles";
import MobileShip from "./MobileShip";
import PhoneCheckin from "./PhoneCheckin";
import { LangToggle, useT } from "./lang";

export type PressSheet = {
  id: string; number: number; location: string; status: string; garment: string; notes: string; press: string;
  heads: { n: number; what: string; name: string; hex: string; mesh: number | null }[];
  screens: { name: string; hex: string; mesh: number | null; kind: string }[];
};
type View = "home" | "setup" | "notes" | "photos" | "labels" | "ship" | "checkin";

const fmtDay = (d: string | null, loc = "en-US") => (d ? new Date(d.slice(0, 10) + "T12:00").toLocaleDateString(loc, { weekday: "short", month: "short", day: "numeric" }) : "—");
const when = (d: string, loc = "en-US") => new Date(d).toLocaleString(loc, { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
const I = {
  setup: "M4 6h16M4 12h16M4 18h16M8 4v4M14 10v4M10 16v4",
  notes: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5",
  photo: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  label: "M6 9V3h12v6M6 18H4v-8h16v8h-2M7 14h10v7H7z",
  ship: "M3 6h11v10H3zM14 9h4l3 4v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  checkin: "M4 8l8-4 8 4v9l-8 4-8-4zM4 8l8 4 8-4M12 12v9M9 15l2 2 4-4",
  time: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 3",
  open: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
};

/** The phone menu for one job (opened by scanning its QR code). */
export default function JobMobile(p: {
  who: JobActor; missing?: string; card?: JobCard; box?: number | null; designs?: Record<string, { number: number; name: string; url: string }>; press?: PressSheet[];
  ship?: { t: ShipTarget; existing: Shipment | null } | null; shipSettings?: ShipSettings; checkin?: CheckJob | null; printer?: { ready: boolean; dpi: number };
}) {
  const { who, card } = p;
  const { t, locale } = useT();
  const [view, setView] = useState<View>("home");
  // each tool is its own history entry, so the phone's Back button returns to the menu
  const go = (v: View) => { if (v !== "home") history.pushState({ jm: v }, ""); setView(v); scrollTo(0, 0); };
  useEffect(() => { const on = (e: PopStateEvent) => setView(((e.state && e.state.jm) as View) || "home"); addEventListener("popstate", on); return () => removeEventListener("popstate", on); }, []);
  const back = () => (history.state?.jm ? history.back() : setView("home"));

  if (!card) return (
    <div className="jm"><header className="jm-top"><img src="/brand/fbs-logo-white.svg" alt="FBS Print" /><span className="jm-top-who">{who.name}</span><LangToggle /></header>
      <main className="jm-main"><div className="jm-card"><h1 className="jm-h">{t("No job #{0}", p.missing || "")}</h1><p>{t("This code doesn't match a job in the portal or in Printavo. Check the number on the label.")}</p></div></main></div>
  );
  const job = { kind: card.kind, id: card.id };
  const title: Record<View, string> = { home: "", setup: t("Press setup"), notes: t("Notes"), photos: t("Photos"), labels: t("Box labels"), ship: t("Ship"), checkin: t("Check in goods") };

  return (
    <div className="jm">
      <header className="jm-top"><img src="/brand/fbs-logo-white.svg" alt="FBS Print" /><span className="jm-top-who">{who.name}</span><LangToggle /></header>
      <section className={"jm-job" + (view === "checkin" ? " slim" : "")}>
        {view !== "home" && <button type="button" className="jm-back" onClick={back}>{t("← Job menu")}</button>}
        <div className="jm-num"><b>#{card.number}</b>{card.rush && <span className="jm-rush">{t("RUSH")}</span>}{p.box ? <span className="jm-box">{t("Box {0}", p.box)}</span> : null}</div>
        <div className="jm-cust">{card.customer || "—"}</div>
        {card.name && <div className="jm-name">{card.name}</div>}
        <div className="jm-facts"><span><b>{card.qty}</b> {t("pcs")}</span><span>{t("Due")} <b>{fmtDay(card.due, locale)}</b></span>{card.status && <span>{t(card.status)}</span>}<span>{t(card.delivery === "ship" ? "Ship|delivery" : card.delivery === "deliver" ? "Delivery|delivery" : "Pickup|delivery")}</span></div>
        {view !== "home" && <h1 className="jm-viewh">{title[view]}</h1>}
      </section>
      <main className="jm-main">
        {view === "home" && <Home p={p} job={job} go={go} />}
        {view === "setup" && <Setup card={card} designs={p.designs || {}} press={p.press || []} />}
        {view === "notes" && <Notes card={card} job={job} />}
        {view === "photos" && <Photos job={job} />}
        {view === "labels" && <Labels card={card} box={p.box || null} printer={p.printer} perBox={p.shipSettings?.perBox || 72} staff={who.kind === "staff"} />}
        {view === "ship" && p.ship && p.shipSettings && <MobileShip t={p.ship.t} existing={p.ship.existing} settings={p.shipSettings} box={p.box || null} />}
        {view === "checkin" && p.checkin && <Checkin job={p.checkin} />}
      </main>
    </div>
  );
}

function Home({ p, job, go }: { p: Parameters<typeof JobMobile>[0]; job: { kind: "o" | "a"; id: string }; go: (v: View) => void }) {
  const card = p.card!;
  const { t } = useT();
  const cam = useRef<HTMLInputElement>(null);
  const [shot, setShot] = useState<File | null>(null);
  const { items, load } = useJobFiles(job);
  const recent = (items || []).filter((x) => x.kind === "note").slice(0, 2);
  const tile = (v: View | "time" | "open", label: string, icon: string, sub = "", hot = false) => {
    const inner = <><Icon d={icon} /><b>{label}</b>{sub && <small>{sub}</small>}</>;
    if (v === "time") return <a key={v} className="jm-tile" href={`/work?job=${card.number}`}>{inner}</a>;
    if (v === "open") return <a key={v} className="jm-tile" href={card.href}>{inner}</a>;
    return <button key={v} type="button" className={"jm-tile" + (hot ? " hot" : "")} onClick={() => go(v)}>{inner}</button>;
  };
  const prints = card.groups.reduce((a, g) => a + g.prints.length, 0);
  const nNotes = (items || []).filter((x) => x.kind === "note").length;
  return (
    <>
      <button type="button" className="jm-cam" onClick={() => cam.current?.click()}><Icon d={I.photo} />{t("Take a photo of the print")}</button>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setShot(f); }} />
      {shot && <PhotoSave job={job} file={shot} onDone={() => { setShot(null); load(); }} />}
      <div className="jm-tiles">
        {tile("setup", t("Press setup"), I.setup, prints ? (prints === 1 ? t("1 print") : t("{0} prints", prints)) + (p.press?.length ? ` · ${t("screens")}` : "") : "")}
        {tile("notes", t("Notes"), I.notes, items ? (nNotes === 1 ? t("1 shop note") : t("{0} shop notes", nNotes)) : "")}
        {tile("photos", t("Photos"), I.photo, items ? ((n) => (n === 1 ? t("1 saved") : t("{0} saved", n)))((items || []).filter((x) => x.kind !== "note").length) : "")}
        {tile("labels", t("Box labels"), I.label, p.printer?.ready ? t("Print to the Zebra") : t("Printer not set up"))}
        {p.ship && tile("ship", t("Ship"), I.ship, t("Boxes, weights, rates"))}
        {p.checkin && tile("checkin", t("Check in goods"), I.checkin, p.checkin.state === "checked" ? t("Counted") : p.checkin.state === "issue" ? t("Problem open") : t("{0} pcs expected", p.checkin.ordered), p.checkin.state === "ready")}
        {tile("time", t("Log time"), I.time, t("Start / finish"))}
        {p.who.can.open && tile("open", t("Full job"), I.open, t("Open in the shop"))}
      </div>
      {recent.length > 0 && (
        <div className="jm-card">
          <div className="jm-cardh"><b>{t("Latest notes")}</b><button type="button" className="jm-link" onClick={() => go("notes")}>{t("All notes")}</button></div>
          {recent.map((n) => <NoteRow key={n.id} n={n} />)}
        </div>
      )}
      {(card.productionNote || card.customerNote) && (
        <div className="jm-card">
          {card.productionNote && <><div className="jm-label">{t("Production note")}</div><p className="jm-pre">{card.productionNote}</p></>}
          {card.customerNote && <><div className="jm-label">{t("Order note")}</div><p className="jm-pre">{card.customerNote}</p></>}
        </div>
      )}
    </>
  );
}

function NoteRow({ n }: { n: JobFile }) {
  const { t, locale } = useT();
  return <div className="jm-note">{n.tag && <span className="jm-tag">{t(n.tag)}</span>}<p>{n.body}</p><small>{n.by_name} · {when(n.created_at, locale)}</small></div>;
}

/** What's printed where: the imprints, the designs, and how each separation goes on the press. */
function Setup({ card, designs, press }: { card: JobCard; designs: Record<string, { number: number; name: string; url: string }>; press: PressSheet[] }) {
  const { t } = useT();
  return (
    <>
      {press.map((s) => (
        <div key={s.id} className="jm-card">
          <div className="jm-cardh"><b>{t(s.location || "Print")} · S-{s.number}</b><span className="jm-faint">{s.press || t("press not chosen")}</span></div>
          {s.heads.length ? (
            <ol className="jm-heads">{s.heads.map((h) => (
              <li key={h.n} className={"h-" + h.what}><span className="jm-hn">{h.n}</span>
                {h.what === "screen" ? <><i style={{ background: h.hex || "#ccc" }} /><b>{h.name}</b>{h.mesh ? <small>{t("{0} mesh", h.mesh)}</small> : null}</> : <b className="jm-faint">{t(h.what === "flash" ? "Flash" : h.what === "roller" ? "Roller" : h.what === "cool" ? "Cool down (empty)" : h.what === "down" ? "Head down" : "Empty")}</b>}
              </li>
            ))}</ol>
          ) : (
            <>
              <p className="jm-faint" style={{ margin: "4px 0 8px" }}>{t("No press setup saved yet. Screens in print order:")}</p>
              <ol className="jm-heads">{s.screens.map((c, i) => <li key={i} className="h-screen"><span className="jm-hn">{i + 1}</span><i style={{ background: c.hex || "#ccc" }} /><b>{c.name}</b>{c.mesh ? <small>{t("{0} mesh", c.mesh)}</small> : null}</li>)}</ol>
            </>
          )}
          {s.notes && <p className="jm-pre">{s.notes}</p>}
        </div>
      ))}
      {card.groups.map((g, gi) => (
        <div key={gi} className="jm-card">
          <div className="jm-cardh"><b>{card.groups.length > 1 ? g.name : t("Prints")}</b><span className="jm-faint">{t("{0} pcs", g.rows.reduce((a, r) => a + r.total, 0))}</span></div>
          {g.prints.map((pr, i) => {
            const d = pr.designId ? designs[pr.designId] : null;
            return (
              <div key={i} className="jm-print">
                {(d?.url || pr.image) && <img src={d?.url || pr.image} alt="" />}
                <div>
                  <b>{[pr.location, pr.method].filter(Boolean).map((x) => t(x)).join(" · ") || t("Imprint")}</b>
                  {d && <small>D-{d.number} {d.name}</small>}
                  <ul>
                    {pr.colors && <li>{t(pr.colors)}</li>}
                    {pr.inks && <li><span>{t("Inks")}</span> {pr.inks}</li>}
                    {pr.size && <li><span>{t("Size")}</span> {pr.size}</li>}
                    {pr.drop && <li><span>{t("Drop")}</span> {pr.drop}</li>}
                  </ul>
                  {pr.notes && <p className="jm-pre">{pr.notes}</p>}
                </div>
              </div>
            );
          })}
          {!g.prints.length && <p className="jm-faint">{t("No imprints entered.")}</p>}
          <table className="jm-sizes"><tbody>{g.rows.map((r, ri) => (
            <tr key={ri}><td><b>{r.style || r.desc}</b><small>{r.color}</small></td><td data-notranslate>{r.sizes.map((z) => `${z.label} ${z.qty}`).join(" · ")}</td><td className="r"><b>{r.total}</b></td></tr>
          ))}</tbody></table>
        </div>
      ))}
    </>
  );
}

/** Shop notes: press setup or ink changes, problems, OKs, saved on the job for next time. */
function Notes({ card, job }: { card: JobCard; job: { kind: "o" | "a"; id: string } }) {
  const { t } = useT();
  const { items, load, err } = useJobFiles(job);
  const [body, setBody] = useState(""), [tag, setTag] = useState("Press setup"), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  return (
    <>
      <div className="jm-card">
        <div className="jm-label">{t("Add a note to this job")}</div>
        <div className="jm-chips">{NOTE_TAGS.map((k) => <button key={k} type="button" className={"jm-chip" + (tag === k ? " on" : "")} onClick={() => setTag(k)}>{t(k)}</button>)}</div>
        <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t(tag === "Ink / colors" ? "e.g. Switched PMS 186 to the darker red, customer OK'd" : tag === "Press setup" ? "e.g. White on head 3, 156 mesh, flash 8 sec" : "What should the next person know?")} />
        {msg && <div className="jm-err">{t(msg)}</div>}
        <button type="button" className="jm-go" disabled={!body.trim() || busy} onClick={async () => { setBusy(true); setMsg(""); const r = await addNote(job, body, tag); setBusy(false); if (r.ok) { setBody(""); load(); } else setMsg(r.error); }}>{busy ? t("Saving…") : t("Save note")}</button>
      </div>
      {err && <div className="jm-err">{t(err)}</div>}
      {(items || []).filter((x) => x.kind === "note").map((n) => <div key={n.id} className="jm-card tight"><NoteRow n={n} /></div>)}
      {(card.productionNote || card.customerNote) && (
        <div className="jm-card">
          {card.productionNote && <><div className="jm-label">{t("Production note (from the order)")}</div><p className="jm-pre">{card.productionNote}</p></>}
          {card.customerNote && <><div className="jm-label">{t("Order note")}</div><p className="jm-pre">{card.customerNote}</p></>}
        </div>
      )}
    </>
  );
}

function PhotoSave({ job, file, onDone }: { job: { kind: "o" | "a"; id: string }; file: File; onDone: () => void }) {
  const { t } = useT();
  const [url] = useState(() => URL.createObjectURL(file));
  const [cap, setCap] = useState(""), [tag, setTag] = useState("Approved print"), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  return (
    <div className="jm-card jm-shot">
      <img src={url} alt={t("New photo")} />
      <div className="jm-chips">{["Approved print", "Press setup", "Print issue", "General"].map((k) => <button key={k} type="button" className={"jm-chip" + (tag === k ? " on" : "")} onClick={() => setTag(k)}>{t(k)}</button>)}</div>
      <input type="text" value={cap} onChange={(e) => setCap(e.target.value)} placeholder={t("Caption (optional)")} />
      {msg && <div className="jm-err">{t(msg)}</div>}
      <div className="jm-row">
        <button type="button" className="jm-ghost" disabled={busy} onClick={onDone}>{t("Cancel")}</button>
        <button type="button" className="jm-go" disabled={busy} onClick={async () => { setBusy(true); setMsg(""); const r = await addPhoto(job, file, cap, tag === "General" ? "" : tag); setBusy(false); if (r.ok) onDone(); else setMsg(r.error); }}>{busy ? t("Saving…") : t("Save to job")}</button>
      </div>
    </div>
  );
}

function Photos({ job }: { job: { kind: "o" | "a"; id: string } }) {
  const { t, locale } = useT();
  const { items, load } = useJobFiles(job);
  const cam = useRef<HTMLInputElement>(null);
  const [shot, setShot] = useState<File | null>(null), [big, setBig] = useState<JobFile | null>(null);
  const photos = (items || []).filter((x) => x.kind === "photo");
  return (
    <>
      <button type="button" className="jm-cam" onClick={() => cam.current?.click()}><Icon d={I.photo} />{t("Take a photo")}</button>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setShot(f); }} />
      {shot && <PhotoSave job={job} file={shot} onDone={() => { setShot(null); load(); }} />}
      {items === null ? <p className="jm-faint">{t("Loading…")}</p> : !photos.length ? <p className="jm-faint">{t("No photos on this job yet.")}</p> : (
        <div className="jm-gallery">{photos.map((x) => (
          <button key={x.id} type="button" onClick={() => setBig(x)}><img src={x.url} alt={x.body || ""} loading="lazy" /><span>{x.tag ? t(x.tag) : x.body || when(x.created_at, locale)}</span></button>
        ))}</div>
      )}
      {big && <div className="jm-lightbox" onClick={() => setBig(null)}><img src={big.url} alt="" /><p>{[big.tag && t(big.tag), big.body].filter(Boolean).join(" · ")}<br /><small>{big.by_name} · {when(big.created_at, locale)}</small></p></div>}
    </>
  );
}

/** Count the goods in: what was counted before (if anything), else the size-by-size counter. */
function Checkin({ job }: { job: CheckJob }) {
  const { t, locale } = useT();
  const [done, setDone] = useState(job.checkins[0] || null), [again, setAgain] = useState(false), [fresh, setFresh] = useState(false);
  if (done && !again) {
    const issues = done.lines.filter((l) => l.issue);
    return (
      <div className="jm-card">
        {fresh && <div className="jm-ok" role="status">{t("Checked in. Thanks!")}</div>}
        <div className="jm-cardh"><b>{t("Counted in")}</b><span className="jm-faint">{done.by} · {when(done.created_at, locale)}</span></div>
        <p style={{ margin: 0 }}>{t("{0} of {1} counted", done.received, done.expected)}{done.boxes ? ` · ${t(done.boxes === 1 ? "in 1 box" : "in {0} boxes", done.boxes)}` : ""}</p>
        {issues.length > 0 && <ul className="jm-ck-plist">{issues.map((l, k) => <li key={k}>{l.item} · {l.size}: {t("got {0} of {1}", l.received, l.expected)}{l.bad ? ` · ${t(l.issue === "mispick" ? "{0} wrong" : "{0} damaged", l.bad)}` : ""}</li>)}</ul>}
        {done.status === "issue" && !done.resolved_at && <div className="jm-warn">{t("Each one is flagged in Goods & Receiving until it's resolved.")}</div>}
        <button type="button" className="jm-ghost" onClick={() => { setAgain(true); setFresh(false); }}>{t("Count again")}</button>
      </div>
    );
  }
  return <PhoneCheckin job={job} onDone={(c) => { setDone(c); setAgain(false); setFresh(true); scrollTo(0, 0); }} />;
}

/** Print box labels on the Zebra: how many boxes, all of them or just this one. */
function Labels({ card, box, printer, perBox, staff }: { card: JobCard; box: number | null; printer?: { ready: boolean; dpi: number }; perBox: number; staff: boolean }) {
  const { t } = useT();
  const [n, setN] = useState(Math.max(box || 0, Math.max(1, Math.ceil((card.qty || 0) / Math.max(1, perBox)))));
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function print(only?: number) {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/print", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "box", job: { kind: card.kind, id: card.id }, boxes: n, only }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { message: "Offline. Try again." };
    setBusy(false); setMsg({ ok: !!r?.ok && j.ok !== false, text: t(j.message || j.error || "Done.") });
  }
  return (
    <div className="jm-card">
      {!printer?.ready && <div className="jm-warn">{t("The label printer isn't set up yet (Shipping Center → Settings → Label printer).")}</div>}
      <div className="jm-label">{t("How many boxes?")}</div>
      <div className="jm-count">
        <button type="button" aria-label={t("One fewer box")} onClick={() => setN(Math.max(1, n - 1))}>−</button>
        <input inputMode="numeric" value={n} onChange={(e) => setN(Math.max(1, Math.min(99, +e.target.value.replace(/\D/g, "") || 1)))} aria-label={t("Boxes")} />
        <button type="button" aria-label={t("One more box")} onClick={() => setN(Math.min(99, n + 1))}>+</button>
      </div>
      <p className="jm-faint">{t("{0} pcs · about {1} per box. Each label says box 1 of {2}, 2 of {2}…", card.qty, perBox, n)}</p>
      <button type="button" className="jm-go" disabled={busy} onClick={() => print()}>{busy ? t("Sending…") : n === 1 ? t("Print 1 label") : t("Print {0} labels", n)}</button>
      {box && box <= n && <button type="button" className="jm-ghost" disabled={busy} onClick={() => print(box)}>{t("Just box {0} of {1}", box, n)}</button>}
      {msg && <div className={msg.ok ? "jm-ok" : "jm-err"} role="status">{msg.text}</div>}
      {staff && card.kind === "o" && <a className="jm-alt" href={`/print/${card.id}/labels?boxes=${n}`}>{t("Open the printable labels instead")}</a>}
    </div>
  );
}
