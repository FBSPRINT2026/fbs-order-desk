"use client";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { colorHex } from "@/lib/inkColors";
import { PMS_COATED } from "@/lib/pms";
import { confirmDetails } from "@/app/shop/details-actions";
import { addPhoto, type JobFile } from "@/components/job/JobFiles";
import { createClient } from "@/lib/supabase/client";
import type { ProductionView, PvPrint } from "@/lib/productionView";
import PressSetupCard, { planOnPress, type PsPlate, type PsRec } from "@/components/PressSetupCard";
import { pressLayOf } from "@/components/PressDefaults";
import type { Slot } from "@/lib/pressSetup";
import type { Machine } from "@/lib/production";

/**
 * Production view (Oct 21, Nick: "one big view of the job… just like our mock-up… the press layout… the separations in
 * black and white… photos"). Nick and Jose. It follows the order's normal flow: each panel opens when its step has
 * happened, and Confirm & save as printed at the end makes this the record the next reorder copies.
 */
const STEPS = ["Order", "Mockup", "Separations requested", "Film made", "Film checked", "On press", "Printed"];
const fmtDay = (d: string | null) => (d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "");
const hm = (m: number) => (m <= 0 ? "—" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} m`);
const inkList = (s: string) => s.split(/\s*[,;+]\s*/).map((x) => x.trim()).filter(Boolean);
const FILM_LABEL: Record<string, string> = { asPrinted: "As-printed film on file", physical: "Physical film only (in the drawer)", new: "New film, never printed" };
const toJpeg = async (src: Blob | string, max = 360) => {
  const bm = await createImageBitmap(typeof src === "string" ? await (await fetch(src)).blob() : src);
  const k = Math.min(1, max / Math.max(bm.width, bm.height));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(bm.width * k)); c.height = Math.max(1, Math.round(bm.height * k));
  const x = c.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(bm, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
};

export default function ProductionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [v, setV] = useState<ProductionView | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [gi, setGi] = useState(0);
  const [pi, setPi] = useState(0);
  const [photos, setPhotos] = useState<JobFile[]>([]);

  const load = useCallback(async () => {
    const r = await fetch(`/api/orders/${id}/production`).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    if (!r?.ok || j.error) { setErr(j.error || "Couldn't load the job."); return; }
    setV(j); setErr("");
  }, [id]);
  const loadPhotos = useCallback(async () => {
    const r = await fetch(`/api/jobs/files?kind=o&id=${id}`).then((x) => x.json()).catch(() => ({}));
    setPhotos(((r.items || []) as JobFile[]).filter((x) => !x.archived));
  }, [id]);
  useEffect(() => { void load(); void loadPhotos(); }, [load, loadPhotos]);

  const post = async (body: Record<string, unknown>, label = "save") => {
    setBusy(label); setErr("");
    const r = await fetch(`/api/orders/${id}/production`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    setBusy("");
    if (!r?.ok || j.error) { setErr(j.error || "That didn't save."); return false; }
    if (j.order) setV(j); else await load();
    return true;
  };

  if (err && !v) return <div className="jv"><div className="panel"><div className="panel-b err">{err}</div></div></div>;
  if (!v) return <div className="jv"><div className="panel"><div className="panel-b faint">Opening the job…</div></div></div>;

  const group = v.groups[Math.min(gi, v.groups.length - 1)];
  const gPrints = v.prints.filter((p) => p.groupId === group?.id);
  const print = gPrints[Math.min(pi, Math.max(0, gPrints.length - 1))];
  // a reorder is logged in one sitting (Oct 21, Nick: "the production man is gonna sit down with the press operator and log
  // it all in, one step… a one page here's what we did"): nothing waits on a step, one Save everything
  const oneSitting = !!v.order.reorderOf || v.prints.some((p) => !!p.confirm && !p.confirmed);
  const lock = (i: number) => !oneSitting && v.step < i; // a new job's panels wait for their step
  // the job's production status, at the top (Oct 21, Nick: "it just needs some sort of status… awaiting production details")
  const waiting = v.prints.filter((p) => p.confirm && !p.confirmed).length;
  const saved = v.prints.length > 0 && v.prints.every((p) => p.confirmed) && v.prints.filter((p) => p.screen).every((p) => p.film?.state === "asPrinted");
  const status = waiting ? { t: "Awaiting production details", c: "warn", d: `${waiting} print${waiting === 1 ? "" : "s"} to confirm` }
    : saved ? { t: "Saved as printed", c: "ok", d: "the next reorder copies this" }
    : { t: v.step >= STEPS.length ? "Printed" : STEPS[v.step] ? `Next: ${STEPS[v.step]}` : "In production", c: "", d: "" };

  return (
    <div className="jv">
      <header className="jv-h">
        <div className="jv-h-t">
          <div className="jv-sub"><b>Production mockup</b> · {v.order.customer}{v.order.reorderOf ? ` · Reorder of ${v.order.reorderOf}` : ""}{v.order.due ? ` · due ${fmtDay(v.order.due)}` : ""}</div>
          <h1>#{v.order.number} {v.order.nickname} <span className={"jv-status " + status.c} title={status.d}>{status.t}</span></h1>
          <div className="jv-sub">{v.order.qty.toLocaleString()} pcs · {group?.lines.join(" · ")}</div>
        </div>
        <div className="jv-h-a">
          <Link className="btn sm" href={`/shop/orders/${id}?tab=prod`}>‹ Back to the order</Link>
          <Link className="btn sm" href={`/shop/artwork/mockup?order=${id}${group ? `&group=${group.id}` : ""}`}>Open in Mockup Creator</Link>
        </div>
      </header>

      {oneSitting ? (
        <section className="jv-steps jv-one" aria-label="Reorder">
          <b>Reorder: here&apos;s what we did.</b> <span>Log it all on this page with the press operator (size, placement, colors and screens, film, press setup, notes), then <b>Save everything</b>. The next reorder copies it.</span>
        </section>
      ) : (
      <section className="jv-steps" aria-label="Where the job is">
        <div className="jv-rail">
          {STEPS.map((s, i) => <span key={s} className={"jv-step" + (v.done[i] ? " done" : i === v.step ? " now" : "")}><b>{v.done[i] ? "✓" : i + 1}</b>{s}</span>)}
        </div>
        <div className="jv-why">{v.step >= STEPS.length ? "Printed. Check the details below and save them as printed: the next reorder starts from this record." : v.why[v.step]}</div>
      </section>
      )}
      {err && <div className="err">{err}</div>}

      {v.groups.length > 1 && (
        <div className="chips" role="tablist" aria-label="Group" data-toolbar>
          {v.groups.map((g, i) => <button key={g.id} type="button" role="tab" aria-selected={i === gi} className={"chip" + (i === gi ? " on" : "")} onClick={() => { setGi(i); setPi(0); }}>{g.name || `Group ${i + 1}`}</button>)}
        </div>
      )}

      <section className="jv-card jv-confirm" aria-label="Confirm the print">
        {gPrints.length > 1 && (
          <div className="chips" role="tablist" aria-label="Print" data-toolbar>
            {gPrints.map((p, i) => <button key={p.id} type="button" role="tab" aria-selected={p === print} className={"chip" + (p === print ? " on" : "")} onClick={() => setPi(i)}>{p.location}</button>)}
          </div>
        )}
        {print ? <ConfirmPrint key={print.id} p={print} busy={!!busy} post={post} one={oneSitting} v={v} orderId={id} reload={load} setErr={setErr} /> : <div className="faint">No prints on this group.</div>}
      </section>

      <section className={"jv-card jv-mock" + (lock(1) ? " jv-off" : "")} aria-label="Mockup">
        <div className="jv-card-h"><h2>Mockup</h2><span className="faint">what the customer approved</span></div>
        <Mockups list={group?.mockups || []} />
      </section>

      {print?.screen && !oneSitting && (
        <FilmPanel key={`f${print.id}`} v={v} p={print} locked={v.step < 2 && !print.sep && !print.film} busy={busy} post={post} orderId={id}
          request={async () => { setBusy("seps"); const r = await fetch("/api/separations/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: id, only: [print.id] }) }).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the server." })); setBusy(""); if (r.error) setErr(r.error); await load(); }} />
      )}

      <div className="jv-row">
        {print?.screen && !oneSitting && (
          <section className={"jv-card jv-press" + (lock(4) ? " jv-off" : "")} aria-label="Press setup">
            <div className="jv-card-h"><h2>Press setup · {print.location}</h2><span className="faint">{lock(4) ? "Opens once the film is checked" : print.press?.asPrinted ? `As printed${print.press.press ? ` on ${print.press.press}` : ""}` : "Planned from the separation · change anything that ran differently"}</span></div>
            <Press p={print} number={v.order.number} />
          </section>
        )}
        <section className={"jv-card jv-run" + (lock(5) ? " jv-off" : "")} aria-label="On press">
          <div className="jv-card-h"><h2>On press</h2><span className="faint">{lock(5) ? "Opens when the job goes on press" : "from the phone at the press"}</span></div>
          <div className="jv-stats">
            <div><span>Setup</span><b>{hm(print?.minutes.setup || 0)}</b></div>
            <div><span>Run</span><b>{hm(print?.minutes.run || 0)}</b></div>
            <div><span>Pieces</span><b>{v.order.qty.toLocaleString()}</b></div>
          </div>
          <div className="jv-lbl">Photos</div>
          <div className="jv-photos">
            {photos.filter((x) => x.kind === "photo").slice(0, 8).map((x) => <a key={x.id} href={x.url} target="_blank" rel="noreferrer" title={x.body || x.file_name}><img src={x.url} alt={x.body || "Print photo"} /></a>)}
            <label className="jv-addphoto">+ Photo<input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; setBusy("photo"); const r = await addPhoto({ kind: "o", id }, f, print ? `${print.location}` : "", "Approved print"); setBusy(""); if (!r.ok) setErr(r.error); else void loadPhotos(); }} /></label>
          </div>
          <div className="jv-lbl">Press notes</div>
          <div className="jv-notes">{photos.filter((x) => x.kind === "note").slice(0, 6).map((x) => <div key={x.id}><b>{x.tag}</b> {x.body} <span className="faint">· {x.by_name}</span></div>)}{!photos.some((x) => x.kind === "note") && <span className="faint">Notes from the phone land here.</span>}</div>
        </section>
      </div>

      <History v={v} busy={!!busy} add={(text) => post({ op: "note", text }, "note")} />

      {!oneSitting && <footer className="jv-save">
        <span>{v.step >= STEPS.length ? `Saves every print's inks, size and film to #${v.order.number} and the customer's designs. The next reorder copies this.` : "Saving as printed opens once the job has printed. Until then anything here can still change."}</span>
        <button type="button" className="btn primary" disabled={v.step < STEPS.length || !!busy} onClick={async () => {
          setBusy("printed"); setErr("");
          const r = await confirmDetails(id, v.prints.map((p) => ({ id: p.id, size: p.size, inks: p.inks, colors: p.colors, underbase: p.underbase, drop: p.drop, screensOnFile: p.film?.state === "asPrinted", notes: "" })));
          setBusy("");
          if (!r.ok) { setErr(r.error); return; }
          await post({ op: "printed" }, "printed");
        }}>{busy === "printed" ? "Saving…" : "Confirm & save as printed"}</button>
      </footer>}
    </div>
  );
}

function Mockups({ list }: { list: { title: string; thumb: string; full: string }[] }) {
  const [i, setI] = useState(0);
  if (!list.length) return <div className="jv-empty">No mockup saved yet. Make it in the Mockup Creator.</div>;
  const m = list[Math.min(i, list.length - 1)];
  return (
    <div className="jv-mk">
      <a href={m.full} target="_blank" rel="noreferrer" className="jv-mk-big" title="Open full size"><img src={m.full || m.thumb} alt={m.title} /></a>
      {list.length > 1 && <div className="jv-mk-thumbs">{list.map((x, k) => <button key={k} type="button" className={k === i ? "on" : ""} onClick={() => setI(k)} title={x.title}><img src={x.thumb} alt={x.title} /></button>)}</div>}
      <div className="faint jv-mk-t">{m.title}</div>
    </div>
  );
}

const LOCS = ["Full Front", "Full Back", "Left Chest", "Right Chest", "Center Chest", "Medium Front", "Medium Back", "Upper Back (Yoke)", "Left Sleeve", "Right Sleeve", "Nape (Back Neck)", "Pocket", "Bottom Hem"];
type Screen = { name: string; hex: string; mix: string };
const avgHex = (a: string, b: string) => { const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) || 0); const x = p(a), y = p(b); return "#" + x.map((v, i) => Math.round((v + y[i]) / 2).toString(16).padStart(2, "0")).join("").toUpperCase(); };

/**
 * Confirm the print (Oct 21, Nick: "the first thing you should see… confirm the size, then the drop, then the colors and
 * screens… we need to combine colors… put in PMS colors, or a custom color, half this, half that"). 1 size, 2 placement,
 * 3 the art's colors onto screens: two art colors on one screen print together; each screen is a PMS, a plain ink or a
 * custom mix. The art is repainted here the way it will print.
 */
/** a screen's key on the press: its name (the same name is the same screen) */
const plateKey = (name: string) => "s-" + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36);
function ConfirmPrint({ p, busy, post, one = false, v, orderId, reload, setErr }: { p: PvPrint; busy: boolean; post: (b: Record<string, unknown>, l?: string) => Promise<boolean>; one?: boolean; v: ProductionView; orderId: string; reload: () => Promise<void>; setErr: (s: string) => void }) {
  const [size, setSize] = useState(p.size), [loc, setLoc] = useState(p.location), [drop, setDrop] = useState(p.drop), [ub, setUb] = useState(p.underbase);
  // screens + which screen each art color prints through
  const start = useMemo(() => {
    const plan = p.plan;
    if (plan.length && Object.keys(p.inkMap).length) {
      const screens: Screen[] = [], assign: Record<string, number> = {};
      for (const k of plan) {
        const m = p.inkMap[k.hex]; if (!m) { screens.push({ name: k.name, hex: k.hex, mix: "" }); assign[k.hex] = screens.length - 1; continue; }
        let i = screens.findIndex((x) => x.name === m.name);
        if (i < 0) { screens.push({ name: m.name, hex: m.hex, mix: m.mix || "" }); i = screens.length - 1; }
        assign[k.hex] = i;
      }
      return { screens, assign };
    }
    if (plan.length) return { screens: plan.map((k) => ({ name: k.name, hex: k.hex, mix: "" })), assign: Object.fromEntries(plan.map((k, i) => [k.hex, i])) as Record<string, number> };
    return { screens: inkList(p.inks).map((n) => ({ name: n, hex: colorHex(n) || "#888888", mix: "" })), assign: {} as Record<string, number> };
  }, [p]);
  const [screens, setScreens] = useState<Screen[]>(start.screens);
  const [assign, setAssign] = useState<Record<string, number>>(start.assign);
  const used = new Set(Object.values(assign));
  // a screen no art color prints through is dropped (and the rest renumbered)
  function setAssigned(hex: string, to: number) {
    const next = { ...assign, [hex]: to };
    let list = to >= screens.length ? [...screens, { name: p.plan.find((k) => k.hex === hex)?.name || "New ink", hex, mix: "" }] : [...screens];
    const keep = list.map((_, i) => Object.values(next).includes(i));
    const remap = new Map<number, number>(); let n = 0;
    keep.forEach((k, i) => { if (k) remap.set(i, n++); });
    list = list.filter((_, i) => keep[i]);
    setScreens(p.plan.length ? list : screens);
    setAssign(Object.fromEntries(Object.entries(next).map(([h, i]) => [h, remap.get(i) ?? 0])));
  }
  const setScreen = (i: number, f: Partial<Screen>) => setScreens((a) => a.map((x, j) => (j === i ? { ...x, ...f } : x)));
  const colorsOn = (i: number) => p.plan.filter((k) => assign[k.hex] === i);

  // the art repainted with the screens' inks
  const cv = useRef<HTMLCanvasElement | null>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!p.art) return;
    const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => { img.current = i; setReady(true); }; i.src = p.art;
  }, [p.art]);
  useEffect(() => {
    const c = cv.current, i = img.current; if (!c || !i || !ready) return;
    const k = Math.min(1, 420 / Math.max(i.naturalWidth, i.naturalHeight));
    c.width = Math.max(1, Math.round(i.naturalWidth * k)); c.height = Math.max(1, Math.round(i.naturalHeight * k));
    const x = c.getContext("2d", { willReadFrequently: true })!; x.clearRect(0, 0, c.width, c.height); x.drawImage(i, 0, 0, c.width, c.height);
    if (!p.plan.length) return;
    const rgb = (h: string) => [1, 3, 5].map((n) => parseInt(h.slice(n, n + 2), 16) || 0);
    const plan = p.plan.map((q) => ({ c: rgb(q.hex), to: rgb(screens[assign[q.hex]]?.hex || q.hex) }));
    const d = x.getImageData(0, 0, c.width, c.height), a = d.data, memo = new Map<number, number[]>();
    for (let o = 0; o < a.length; o += 4) {
      if (a[o + 3] < 8) continue;
      const key = (a[o] >> 3 << 10) | (a[o + 1] >> 3 << 5) | (a[o + 2] >> 3);
      let to = memo.get(key);
      if (!to) { let best = 1e9; for (const q of plan) { const dd = (q.c[0] - a[o]) ** 2 + (q.c[1] - a[o + 1]) ** 2 + (q.c[2] - a[o + 2]) ** 2; if (dd < best) { best = dd; to = q.to; } } memo.set(key, to!); }
      a[o] = to![0]; a[o + 1] = to![1]; a[o + 2] = to![2];
    }
    x.putImageData(d, 0, 0);
  }, [ready, screens, assign, p.plan]);

  // one sitting (a reorder): the film, the press setup as it ran, notes; then Save everything
  const [film, setFilm] = useState<"" | "asPrinted" | "physical" | "new">(p.film?.state || "");
  const [finder, setFinder] = useState(false);
  // 5: the press setup, the same card as Separations → Press (components/PressSetupCard.tsx): the screens are the
  // underbase and the colors above; a setup saved as printed (or the separation's) comes back as it was
  const [presses, setPresses] = useState<Machine[]>(v.presses);
  const [mesh, setMesh] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const h of p.press?.heads || []) if (h.what === "screen" && +h.mesh > 0) m[plateKey(h.name)] = +h.mesh;
    return m;
  });
  const plates = useMemo<PsPlate[]>(() => {
    const out: PsPlate[] = [], seen = new Set<string>();
    const add = (pl: PsPlate) => { if (seen.has(pl.key)) return; seen.add(pl.key); out.push({ ...pl, ...(mesh[pl.key] ? { mesh: mesh[pl.key] } : {}) }); };
    if (ub === "yes") add({ key: plateKey("White underbase"), name: "White underbase", hex: "#FFFFFF", kind: "underbase" });
    for (const x of screens) if (x.name.trim()) add({ key: plateKey(x.name), name: x.name.trim(), hex: x.hex || colorHex(x.name) || "#999999", kind: "color" });
    return out;
  }, [screens, ub, mesh]);
  const rec = useMemo<PsRec>(() => ({ all: plates.map((x) => ({ key: x.key, name: x.name, hex: x.hex, kind: x.kind, coverage: x.kind === "underbase" ? 0.5 : 0.25 })), dark: ub === "yes" }), [plates, ub]);
  const savedSetup = useMemo<Slot[] | null>(() => (p.press && p.press.from !== "auto" && p.press.heads.length
    ? p.press.heads.map((h) => (h.what === "screen" ? "p:" + plateKey(h.name) : h.what === "flash" || h.what === "cool" || h.what === "roller" ? h.what : "")) : null), [p.press]);
  const [setup, setSetup] = useState<Slot[] | null>(savedSetup);
  // the press: the one it must run on, else the one it ran on (or the separation's), else the scheduled one if the
  // screens fit, else the smallest press they fit on
  const [pressId, setPressId] = useState(() => {
    const ok = (m?: Machine) => !!m && (planOnPress(m, plates, null, rec)?.off.length ?? 1) === 0;
    const by = (id?: string) => v.presses.find((m) => m.id === id);
    if (p.pressOnly && by(p.pressOnly.id)) return p.pressOnly.id;
    if (p.press && p.press.from !== "auto" && by(p.press.pressId)) return p.press.pressId!;
    if (ok(by(p.press?.pressId))) return p.press!.pressId!;
    const fit = [...v.presses].sort((a, b) => pressLayOf(a).length - pressLayOf(b).length).find((m) => ok(m));
    return fit?.id || v.presses[0]?.id || "";
  });
  const press = presses.find((m) => m.id === pressId) || presses[0];
  const onPress = useMemo(() => planOnPress(press, plates, setup, rec), [press, plates, setup, rec]);
  const pinned = p.pressOnly;
  const [pnotes, setPnotes] = useState("");
  const [saving, setSaving] = useState("");
  async function saveAll() {
    setSaving("Saving size and placement…"); setErr("");
    let ok = await post({ op: "draft", print: p.id, size, location: loc, drop, underbase: ub }, "save");
    if (ok && p.screen && screens.length) { setSaving("Saving colors and screens…"); ok = await post({ op: "colors", print: p.id, screens, map: assign }, "save"); }
    if (ok && p.screen && film && film !== p.film?.state) { setSaving("Saving the film…"); ok = await post({ op: "film", print: p.id, state: film }, "save"); }
    if (ok && p.screen && onPress && onPress.heads.some((h) => h.startsWith("p:"))) {
      setSaving("Saving the press setup…");
      const heads = onPress.heads.map((h) => {
        const pl = h.startsWith("p:") ? plates.find((x) => x.key === h.slice(2)) : null;
        return pl ? { what: "screen", name: pl.name, hex: pl.hex, mesh: pl.mesh || null } : { what: h === "flash" || h === "cool" || h === "roller" ? h : "empty", name: "", hex: "", mesh: null };
      });
      const r = await fetch("/api/jobs/press", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job: { kind: "o", id: orderId }, sheet: p.sep ? p.sep.id : `loc:${loc}`, pressId: press?.id || "", notes: pnotes, learn: true, heads }) }).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the server." }));
      if (r.error) { setErr(`Press setup: ${r.error}`); ok = false; }
    }
    if (ok) {
      setSaving("Confirming…");
      const r = await confirmDetails(orderId, [{ id: p.id, size, inks: screens.map((x) => x.name).filter(Boolean).join(", ") || p.inks, colors: screens.filter((x) => x.name).length || p.colors, underbase: ub, drop, screensOnFile: film === "asPrinted", notes: pnotes }]);
      if (!r.ok) { setErr(r.error); ok = false; }
    }
    setSaving("");
    await reload();
    if (ok) setErr("");
  }
  const dirty = size !== p.size || loc !== p.location || drop !== p.drop || ub !== p.underbase || JSON.stringify(screens) !== JSON.stringify(start.screens) || JSON.stringify(assign) !== JSON.stringify(start.assign);
  const pending = !!p.confirm && !p.confirmed;
  async function save() {
    const ok = await post({ op: "draft", print: p.id, size, location: loc, drop, underbase: ub }, "save");
    if (ok && p.screen && screens.length) await post({ op: "colors", print: p.id, screens, map: assign }, "save");
  }
  return (
    <div className="jv-cp">
      <div className="jv-card-h">
        <h2>Confirm the print · {p.location}</h2>
        <span className="faint">{p.method === "screen" ? "Screen print" : p.method}{p.design ? ` · ${p.design}` : ""}</span>
        <span className={"jv-badge" + (pending ? " warn" : " ok")}>{pending ? "Production to confirm" : p.confirmed ? `Confirmed by ${p.confirmed.by}` : "Set"}</span>
      </div>
      {p.last.length > 0 && (
        <div className="jv-last">
          <div className="jv-lbl">Last time we printed {p.design || "this design"}</div>
          {p.last.map((h, i) => (
            <div key={i} className="jv-last-r">
              <Link href={`/shop/orders/${h.orderId}/production`}>#{h.number}</Link>
              <span>{h.location} · {h.size || "size not set"}{h.drop ? ` · drop ${h.drop}"` : ""} · {h.inks || `${h.colors} colors`}{h.underbase === true ? " · underbase" : h.underbase === false ? " · no underbase" : ""}{h.garment ? ` · on ${h.garment}` : ""}</span>
              <span className="faint">confirmed by {h.by}, {new Date(h.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
              {i === 0 && <button type="button" className="btn sm" onClick={() => { setSize(h.size); setDrop(h.drop); if (h.underbase === true) setUb("yes"); else if (h.underbase === false) setUb("no"); if (!p.plan.length && h.inks) setScreens(inkList(h.inks).map((n) => ({ name: n, hex: colorHex(n) || "#888888", mix: "" }))); }}>Use the same</button>}
            </div>
          ))}
        </div>
      )}
      <div className="jv-cp-row">
        <div className="jv-cp-step">
          <div className="jv-cp-n"><b>1</b>Size</div>
          <input value={size} onChange={(e) => setSize(e.target.value)} placeholder={'11" wide'} aria-label="Print size" />
          <span className="faint">{p.sizeFrom === "film" ? "From the film (printed at this size before)" : p.sizeFrom === "customer" ? "The customer asked for this size" : pending ? "Our guess from the mockup: check it" : ""}</span>
        </div>
        <div className="jv-cp-step">
          <div className="jv-cp-n"><b>2</b>Placement</div>
          <select value={loc} onChange={(e) => setLoc(e.target.value)} aria-label="Location">{[...new Set([p.location, ...LOCS])].map((l) => <option key={l}>{l}</option>)}</select>
          <label className="jv-inl">Drop from the collar <input value={drop} onChange={(e) => setDrop(e.target.value)} placeholder="3" aria-label="Drop from collar" />in.</label>
        </div>
      </div>
      {p.screen && (
        <div className="jv-cp-step jv-cp-colors">
          <div className="jv-cp-n"><b>3</b>Colors &amp; screens <span className="faint">{p.plan.length ? `${p.plan.length} colors in the art → ${screens.length} screen${screens.length === 1 ? "" : "s"}` : `${screens.length} screen${screens.length === 1 ? "" : "s"}`}</span></div>
          <div className="jv-cc">
            <div className="jv-cc-art">
              {p.art ? <canvas ref={cv} aria-label="The art as it will print" /> : <span className="faint">No art picture on this print.</span>}
              <span className="faint">As it will print</span>
            </div>
            <div className="jv-cc-list">
              {p.plan.length > 0 && (
                <div className="jv-cc-art-colors">
                  <div className="jv-lbl">The art&apos;s colors · put two on one screen to print them together</div>
                  {p.plan.map((k) => (
                    <div key={k.hex} className="jv-ac">
                      <span className="jv-sw" style={{ background: k.hex }} />
                      <span className="jv-ac-n">{k.name}<span className="faint"> {k.hex}</span></span>
                      <select value={assign[k.hex] ?? 0} onChange={(e) => setAssigned(k.hex, +e.target.value)} aria-label={`Screen for ${k.name}`}>
                        {screens.map((x, i) => <option key={i} value={i}>Screen {i + 1}: {x.name}</option>)}
                        <option value={screens.length}>A screen of its own</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}
              <div className="jv-lbl">Screens, in print order</div>
              {screens.map((x, i) => {
                const on = colorsOn(i);
                return (
                  <div key={i} className="jv-scr">
                    <span className="jv-n">{i + 1}</span>
                    <input type="color" value={x.hex} onChange={(e) => setScreen(i, { hex: e.target.value.toUpperCase() })} aria-label={`Screen ${i + 1} color`} />
                    <div className="jv-scr-b">
                      <input value={x.name} list="jv-pms" onChange={(e) => { const name = e.target.value; const h = colorHex(name); setScreen(i, { name, ...(h ? { hex: h.toUpperCase() } : {}) }); }} aria-label={`Screen ${i + 1} ink`} placeholder="PMS 475 C, White, or a custom name" />
                      <input value={x.mix} onChange={(e) => setScreen(i, { mix: e.target.value })} placeholder="Custom mix? e.g. half PMS 475 C, half PMS 7506 C" aria-label={`Screen ${i + 1} mix`} />
                      {on.length > 1 && <span className="faint">Prints {on.map((k) => k.name).join(" + ")}{!x.mix && <> · <button type="button" className="linkbtn" onClick={() => setScreen(i, { name: `Custom ${on.map((k) => k.name.replace(/^PMS /, "").replace(/ C$/, "")).join("/")}`, hex: on.slice(1).reduce((h, k) => avgHex(h, k.hex), on[0].hex), mix: `half ${on[0].name}, half ${on[1].name}${on.length > 2 ? `, plus ${on.slice(2).map((k) => k.name).join(", ")}` : ""}` })}>Mix them half and half</button></>}</span>}
                    </div>
                    {!p.plan.length && <button type="button" className="jv-x" aria-label={`Remove screen ${i + 1}`} onClick={() => setScreens((a) => a.filter((_, j) => j !== i))}>×</button>}
                  </div>
                );
              })}
              {!p.plan.length && <button type="button" className="btn sm ghost" onClick={() => setScreens((a) => [...a, { name: "", hex: "#888888", mix: "" }])}>+ Screen</button>}
              <div className="jv-ub"><span>Underbase</span>{([["", "Not sure"], ["yes", "Yes"], ["no", "No"]] as const).map(([k, l]) => <button key={k} type="button" className={"chip" + (ub === k ? " on" : "")} onClick={() => setUb(k)}>{l}</button>)}</div>
            </div>
          </div>
        </div>
      )}
      <datalist id="jv-pms">{["White", "Black", "Athletic Gold", "Navy", "Red", "Royal", "Kelly Green", "Orange", "Purple", "Maroon", "Silver", ...Object.keys(PMS_COATED)].map((n) => <option key={n} value={n} />)}</datalist>
      {one && p.screen && (
        <div className="jv-cp-step">
          <div className="jv-cp-n"><b>4</b>Film</div>
          <div className="jv-ub">
            {([["asPrinted", "On file (film folder)"], ["physical", "In the drawer"], ["new", "New film / new separations"]] as const).map(([k, l]) => <button key={k} type="button" className={"chip" + (film === k ? " on" : "")} onClick={() => setFilm(k)}>{l}</button>)}
            <button type="button" className="linkbtn" onClick={() => setFinder((x) => !x)}>{finder ? "Hide the film folder" : "Find it in the Dropbox film folder"}</button>
          </div>
          {film && film !== "asPrinted" && <div className="jv-warn"><b>Need to replace a screen?</b> {film === "new" ? "New film has never printed: reburn every screen of this print together." : "No digital copy: if a film is lost, reburn every screen of this print from new film."}</div>}
          {finder && <FilmFinder v={v} p={p} busy={busy ? "busy" : ""} post={post} orderId={orderId} />}
        </div>
      )}
      {one && p.screen && (
        <div className="jv-cp-step">
          <div className="jv-cp-n"><b>5</b>Press setup, as we ran it</div>
          {p.press?.asPrinted && <div className="faint">Showing what was saved as printed{p.press.press ? ` on ${p.press.press}` : ""}.</div>}
          {!plates.length ? <div className="jv-empty">Put the colors in step 3 first: the press is laid out from those screens.</div>
            : !press || !onPress ? <div className="jv-empty">No screen presses set up (Settings → Production).</div>
            : <PressSetupCard title="Press setup" presses={presses} setPresses={setPresses} press={press} onPickPress={(id) => { setPressId(id); setSetup(null); }} onPress={onPress} setup={setup}
                commit={setSetup} clearSetup={() => setSetup(null)} onMesh={(k, n) => setMesh((m) => { const x = { ...m }; if (n) x[k] = n; else delete x[k]; return x; })}
                sheet={{ title: `Press setup #${v.order.number}`, heading: `Press setup · ${loc}${` · #${v.order.number} ${v.order.nickname}`}`, sub: `${plates.length} screens${p.design ? ` · ${p.design}` : ""}` }}
                extra={pinned && pinned.id === press.id
                  ? <button type="button" className="chip on" disabled={busy} title="The schedule only puts this print on this press, and every reorder of it does the same. Click to let it run on any press that fits." onClick={() => void post({ op: "pressOnly", print: p.id, press: "" }, "save")}>✓ Must run on {press.name.split(" · ")[0]}</button>
                  : <button type="button" className="chip" disabled={busy} title="The schedule will only put this print on this press, now and on every reorder" onClick={() => void post({ op: "pressOnly", print: p.id, press: press.id }, "save")}>Must run on this press{pinned ? ` (now: ${pinned.name.split(" · ")[0]})` : ""}</button>} />}
        </div>
      )}
      {one && (
        <div className="jv-cp-step">
          <div className="jv-cp-n"><b>{p.screen ? 6 : 3}</b>Notes for next time</div>
          <textarea value={pnotes} onChange={(e) => setPnotes(e.target.value)} rows={2} placeholder="Ink order, flash time, what to watch for, anything the press operator says" aria-label="Notes" />
        </div>
      )}
      {one ? (
        <div className="jv-saveall">
          <button type="button" className="btn primary" disabled={!!saving || busy} onClick={() => void saveAll()}>{saving || "Save everything"}</button>
          <span>Saves the size, placement, screens, film and press setup to #{v.order.number} and confirms them on {p.design || "the design"}. The next reorder copies this.</span>
        </div>
      ) : (
      <div className="jv-pd-f">
        <button type="button" className="btn primary" disabled={!dirty || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save size, placement and screens"}</button>
        <span className="faint">{dirty ? "Not saved yet" : "Saved on the order · confirmed for good with Confirm & save as printed"}</span>
      </div>
      )}
    </div>
  );
}

/**
 * Film for one print (Oct 21, Nick: "we lost all our film files… if the film goes bad, we have to reburn a job from
 * scratch"): make separations, or use film we already have (the Dropbox film folder, checked by picture, or an upload,
 * or the physical film in the drawer). The status says what a popped screen means: remake one, or reburn them all.
 */
function FilmPanel({ v, p, locked, busy, post, orderId, request }: { v: ProductionView; p: PvPrint; locked: boolean; busy: string; post: (b: Record<string, unknown>, l?: string) => Promise<boolean>; orderId: string; request: () => Promise<void> }) {
  const [mode, setMode] = useState<"" | "seps" | "film">(p.sep ? "seps" : p.film ? "film" : "");
  const st = p.film?.state;
  const made = p.sep?.status === "films" || st === "physical" || (p.film?.files || []).length > 0;
  return (
    <section className={"jv-card jv-film" + (locked ? " jv-off" : "")} aria-label="Separations and film">
      <div className="jv-card-h">
        <h2>Separations &amp; film · {p.location}</h2>
        {st && <span className={"jv-badge " + (st === "asPrinted" ? "ok" : "warn")}>{FILM_LABEL[st]}</span>}
        {p.film?.checked && <span className="jv-badge ok">Film checked by {p.film.checked.by}</span>}
        {made && !p.film?.checked && <button type="button" className="btn sm primary jv-push" disabled={!!busy} onClick={() => void post({ op: "filmOk", print: p.id })}>Film looks good</button>}
      </div>

      {!p.sep && !p.film && (
        <div className="jv-choose">
          <button type="button" className={"jv-opt" + (mode === "seps" ? " on" : "")} onClick={() => setMode("seps")}><b>Make separations</b><span>New film from the art, in the Separation Center</span></button>
          <button type="button" className={"jv-opt" + (mode === "film" ? " on" : "")} onClick={() => setMode("film")}><b>Use film we already have</b><span>From the Dropbox film folder, an upload, or the film in the drawer</span></button>
        </div>
      )}
      {mode === "seps" && !p.sep && <div className="jv-act"><button type="button" className="btn primary" disabled={!!busy} onClick={() => void request()}>{busy === "seps" ? "Requesting…" : "Request separations"}</button><span className="faint">The film will be new, never printed: if one screen pops later, every screen of this print gets reburned together.</span></div>}

      {p.sep && (
        <div className="jv-plates">
          <div className="jv-lbl">Separation S-{p.sep.number} · <Link href={`/shop/separations/${p.sep.id}`}>open in the Separation Center</Link> · {p.sep.status === "films" ? "film printed" : p.sep.status.replace("_", " ")}</div>
          <div className="jv-plate-row">
            {p.sep.plates.map((x, i) => (
              <figure key={i} className="jv-plate">
                <div>{x.url ? <img src={x.url} alt={`${x.name} film`} /> : <span className="faint">No picture</span>}</div>
                <figcaption><span className="jv-sw sm" style={{ background: x.hex }} /><b>{x.name}</b><span className="faint">{x.mesh ? `${x.mesh} mesh` : ""}{x.coverage != null ? ` · ${Math.round(x.coverage * (x.coverage <= 1 ? 100 : 1))}%` : ""}</span></figcaption>
              </figure>
            ))}
            {!p.sep.plates.length && <span className="faint">The separation hasn&apos;t been made yet.</span>}
          </div>
        </div>
      )}

      {(mode === "film" || p.film) && <FilmFinder v={v} p={p} busy={busy} post={post} orderId={orderId} />}

      <div className="jv-filmstate">
        <span className="jv-lbl">This print&apos;s film</span>
        {(["asPrinted", "physical", "new"] as const).map((k) => <button key={k} type="button" className={"chip" + (st === k ? " on" : "")} disabled={!!busy} onClick={() => void post({ op: "film", print: p.id, state: k })}>{FILM_LABEL[k]}</button>)}
      </div>
      {st && st !== "asPrinted" && (
        <div className="jv-warn">
          <b>Need to replace a screen?</b> {st === "new" ? "This film has never been printed: don't remake one screen from it to go with old screens. Reburn every screen of this print together." : "There's no digital copy of this film: if one film is lost, reburn every screen of this print from new film."}
        </div>
      )}
    </section>
  );
}

type Hit = { id: string; name: string; path: string; modified: string; score: number };
type Match = { id: string; name: string; verdict: string; why: string; widthIn: number };
function FilmFinder({ v, p, busy, post, orderId }: { v: ProductionView; p: PvPrint; busy: string; post: (b: Record<string, unknown>, l?: string) => Promise<boolean>; orderId: string }) {
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [note, setNote] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [looking, setLooking] = useState("");
  const upRef = useRef<HTMLInputElement | null>(null);
  const mine = useMemo(() => new Set((p.film?.files || []).map((f) => f.path)), [p.film]);

  const search = useCallback(async () => {
    setLooking("Looking in the Dropbox film folder…"); setNote("");
    const j = await fetch(`/api/dropbox/film?${new URLSearchParams({ customer: v.order.customerId, q: v.order.nickname, date: "" })}`).then((x) => x.json()).catch(() => ({ error: "Couldn't reach Dropbox." }));
    setLooking("");
    if (j.error) { setNote(j.error); setHits([]); return; }
    setHits((j.films || []).slice(0, 30));
    if (!j.folder) setNote("No film folder found for this customer: link it on the customer page.");
  }, [v.order.customerId, v.order.nickname]);
  useEffect(() => { void search(); }, [search]);

  // the closest-named films, drawn here and compared with the art by the AI (named badly or not)
  async function byPicture() {
    if (!hits?.length || !p.art) { setNote(p.art ? "No films to compare." : "This print has no art picture to compare films with."); return; }
    const { measureFilm } = await import("@/lib/printavoArt");
    const art = await toJpeg(p.art, 420).catch(() => "");
    const films: { id: string; name: string; pieces: { data: string; widthIn: number; heightIn: number }[] }[] = [];
    const list = hits.filter((h) => /\.(ai|pdf)$/i.test(h.name)).slice(0, 6);
    for (const [k, h] of list.entries()) {
      setLooking(`Drawing ${h.name} (${k + 1} of ${list.length})…`);
      const f = await fetch("/api/dropbox/film", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: h.id }) }).then((x) => x.json()).catch(() => null);
      if (!f?.url) continue;
      const buf = await fetch(f.url).then((x) => x.arrayBuffer()).catch(() => null);
      if (!buf) continue;
      const pieces = await measureFilm(buf, true, h.name).catch(() => []);
      const out: { data: string; widthIn: number; heightIn: number }[] = [];
      for (const pc of pieces.slice(0, 5)) if (pc.file) out.push({ data: await toJpeg(pc.file, 320), widthIn: pc.widthIn, heightIn: pc.heightIn });
      if (out.length) films.push({ id: h.id, name: h.name, pieces: out });
    }
    if (!films.length) { setLooking(""); setNote("None of those films could be drawn (EPS and PSD films can't be read here)."); return; }
    setLooking("Comparing the films with the art…");
    const r = await fetch(`/api/orders/${orderId}/production/film-match`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: p.location, art, films }) }).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the server." }));
    setLooking("");
    if (r.error) { setNote(r.error); return; }
    const ms = (r.matches || []) as Match[];
    setMatches(ms);
    const best = ms.find((m) => m.verdict === "same") || ms.find((m) => m.verdict === "likely");
    setNote(best ? `${best.name} looks like this print's art${best.verdict === "likely" ? " (not certain)" : ""}: ${best.why}` : "None of those films look like this print's art.");
  }

  async function use(h: { id: string; name: string }) {
    setLooking(`Bringing over ${h.name}…`);
    const f = await fetch("/api/dropbox/film", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: h.id, orderId }) }).then((x) => x.json()).catch(() => null);
    setLooking("");
    if (!f?.path) { setNote(f?.error || "Couldn't bring that film over."); return; }
    await post({ op: "filmFile", print: p.id, path: f.path, name: f.name }, "film");
  }
  async function upload(file: File) {
    setLooking(`Uploading ${file.name}…`);
    const path = `films/orders/${orderId}/${Date.now().toString(36)}-${file.name.replace(/[^\w.-]+/g, "_")}`;
    const sb = createClient();
    const up = await sb.storage.from("proofs").upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (up.error) { setLooking(""); setNote(up.error.message); return; }
    await sb.from("art_files").insert({ order_id: orderId, name: `Film: ${file.name}`, file_path: path, file_type: file.type || "", category: "film" });
    setLooking("");
    await post({ op: "filmFile", print: p.id, path, name: file.name }, "film");
  }

  const verdict = (id: string) => matches?.find((m) => m.id === id);
  return (
    <div className="jv-finder">
      {(p.film?.files || []).length > 0 && (
        <div className="jv-onfile"><span className="jv-lbl">On file for this print</span>{(p.film!.files as { path: string; name: string; url?: string }[]).map((f) => <a key={f.path} href={f.url || undefined} target="_blank" rel="noreferrer">{f.name}</a>)}</div>
      )}
      {v.films.filter((f) => !mine.has(f.path)).length > 0 && (
        <div className="jv-onfile"><span className="jv-lbl">Film on the order</span>{v.films.filter((f) => !mine.has(f.path)).map((f) => <span key={f.path} className="jv-fl"><a href={f.url} target="_blank" rel="noreferrer">{f.name}</a><button type="button" className="btn sm" disabled={!!busy} onClick={() => void post({ op: "filmFile", print: p.id, path: f.path, name: f.name }, "film")}>This print&apos;s film</button></span>)}</div>
      )}
      <div className="jv-act">
        <span className="jv-lbl">Dropbox film folder</span>
        <button type="button" className="btn sm" disabled={!!looking} onClick={() => void search()}>Look again</button>
        <button type="button" className="btn sm primary" disabled={!!looking || !hits?.length} onClick={() => void byPicture()} title="Draws the closest films and has the AI compare them with this print's art, whatever they're named">Check films by picture</button>
        <button type="button" className="btn sm" onClick={() => upRef.current?.click()}>Upload film</button>
        <input ref={upRef} type="file" hidden accept=".ai,.pdf,.eps,.psd,image/*" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
      </div>
      {(looking || note) && <div className={"jv-note" + (looking ? " busy" : "")}>{looking || note}</div>}
      {hits && hits.length > 0 && (
        <div className="jv-hits">
          {[...hits].sort((a, b) => { const r = (x: Hit) => ({ same: 3, likely: 2, no: 0 }[verdict(x.id)?.verdict || ""] ?? 1); return r(b) - r(a); }).slice(0, 10).map((h) => {
            const m = verdict(h.id);
            return (
              <div key={h.id} className={"jv-hit" + (m?.verdict === "same" ? " same" : m?.verdict === "likely" ? " likely" : m?.verdict === "no" ? " no" : "")}>
                <span className="jv-hit-n"><b>{h.name}</b><span className="faint">{h.path.split("/").slice(-2, -1)[0]} · {h.modified.slice(0, 10)}</span>{m && <span className="jv-hit-w">{m.verdict === "same" ? "Same art" : m.verdict === "likely" ? "Looks like it" : "Different art"}{m.widthIn ? ` · ${m.widthIn}" wide` : ""}: {m.why}</span>}</span>
                <button type="button" className={"btn sm" + (m?.verdict === "same" ? " primary" : "")} disabled={!!looking || !!busy} onClick={() => void use(h)}>Use this film</button>
              </div>
            );
          })}
        </div>
      )}
      {hits && !hits.length && !note && <div className="faint">No films found by name in their folder. Upload it, or mark it as physical film only.</div>}
    </div>
  );
}

function Press({ p, number, wheelOnly = false }: { p: PvPrint; number: number; wheelOnly?: boolean }) {
  const heads = p.press?.heads || [];
  if (!heads.length) return <div className="jv-empty">The press setup comes from the separation once it&apos;s made. <a href={`/j/${number}`}>Phone menu → Press setup</a></div>;
  const n = heads.length, R = 132, C = 170;
  return (
    <div className={wheelOnly ? "jv-wheel-only" : "jv-pr"}>
      <div className="jv-wheel" style={{ width: C * 2, height: C * 2 }}>
        <div className="jv-hub"><b>{p.press?.press || "Press"}</b><span>{n} heads</span></div>
        {heads.map((h, i) => {
          const a = (-90 + (i * 360) / n) * Math.PI / 180;
          return (
            <div key={i} className={"jv-head" + (h.what === "screen" ? " ink" : "")} style={{ left: C + R * Math.cos(a) - 36, top: C + R * Math.sin(a) - 36 }}>
              <span className="jv-n">{i + 1}</span>
              <span className="jv-sw" style={{ background: h.what === "screen" ? h.hex || colorHex(h.name) || "#999" : h.what === "flash" ? "#F2A900" : h.what === "cool" ? "#9BCBEB" : "#fff" }} />
              <span className="jv-hl">{h.what === "screen" ? h.name.replace(/^PMS /, "") : h.what === "flash" ? "Flash" : h.what === "cool" ? "Cool" : h.what === "roller" ? "Roller" : "Empty"}</span>
            </div>
          );
        })}
      </div>
      {!wheelOnly && <div className="jv-heads">
        {heads.map((h, i) => h.what === "empty" ? null : <div key={i}><span className="jv-n">{i + 1}</span><span>{h.what === "screen" ? h.name : h.what === "flash" ? "Flash" : h.what === "cool" ? "Cool-down" : h.what}</span><span className="faint">{h.mesh ? `${h.mesh} mesh` : ""}</span></div>)}
        <a className="btn sm" href={`/j/${number}`} target="_blank" rel="noreferrer">We ran it differently</a>
      </div>}
    </div>
  );
}

function History({ v, busy, add }: { v: ProductionView; busy: boolean; add: (t: string) => Promise<boolean> }) {
  const [kept, setKept] = useState<Set<number>>(new Set());
  return (
    <section className="jv-card" aria-label="From the job's history">
      <div className="jv-card-h"><h2>From the job&apos;s history</h2><span className="faint">keep what belongs on the record: it&apos;s added to the production notes</span></div>
      {v.history.length === 0 && <div className="faint">Nothing from an older job.</div>}
      {v.history.map((x, i) => (
        <div key={i} className="jv-hist">
          <span className="jv-hist-k"><b>{x.kind}</b><span className="faint">{x.when}</span></span>
          <span className="jv-hist-t">{x.text}</span>
          <button type="button" className={"jv-tick" + (kept.has(i) ? " on" : "")} disabled={busy || kept.has(i)} onClick={async () => { if (await add(`${x.kind} (${x.when}): ${x.text}`)) setKept((s) => new Set(s).add(i)); }}>{kept.has(i) ? "On the record" : "Keep"}</button>
        </div>
      ))}
      {v.productionNotes && <details className="jv-pn"><summary>Production notes</summary><pre>{v.productionNotes}</pre></details>}
    </section>
  );
}
