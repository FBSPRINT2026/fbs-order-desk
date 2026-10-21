"use client";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { colorHex } from "@/lib/inkColors";
import { PMS_COATED } from "@/lib/pms";
import { confirmDetails } from "@/app/shop/details-actions";
import { addPhoto, type JobFile } from "@/components/job/JobFiles";
import { useShirtBg } from "@/lib/fabricTile";
import { useSticky } from "@/lib/useSticky";
import { qrSvg } from "@/lib/qr";
import { jobLink } from "@/lib/zpl";
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
        </div>
        <div className="jv-h-a">
          <Link className="btn sm" href={`/shop/orders/${id}?tab=prod`}>‹ Back to the order</Link>
          <Link className="btn sm" href={`/shop/artwork/mockup?order=${id}${group ? `&group=${group.id}` : ""}`}>Open in Mockup Creator</Link>
        </div>
      </header>

      {/* a reorder sitting: no banner (Oct 21, Nick: "don't need all this extra text at the top") */}
      {oneSitting ? null : (
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
        {print ? <ConfirmPrint key={print.id} p={print} busy={!!busy} post={post} one={oneSitting} v={v} orderId={id} reload={load} setErr={setErr} photos={photos} reloadPhotos={loadPhotos} /> : <div className="faint">No prints on this group.</div>}
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
      </div>

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
function ConfirmPrint({ p, busy, post, one = false, v, orderId, reload, setErr, photos, reloadPhotos }: { p: PvPrint; busy: boolean; post: (b: Record<string, unknown>, l?: string) => Promise<boolean>; one?: boolean; v: ProductionView; orderId: string; reload: () => Promise<void>; setErr: (s: string) => void; photos: JobFile[]; reloadPhotos: () => Promise<void> }) {
  const grp = v.groups.find((g) => g.id === p.groupId);
  const mockups = grp?.mockups || [];
  const shirts = grp?.shirts || [];
  // the viewer (Oct 21, Nick: "move the mock-up so it's one of the first things you see… all the mock-ups below… click
  // through and it brings it up to the one above"): -1 = the art as it will print, else a mockup
  const [view, setView] = useState(-1);
  // prints differently by shirt color (Nick: "you may not print the black on one mock-up"): shirt color → screens left off
  const [skip, setSkip] = useState<Record<string, string[]>>(p.skip || {});
  const [byColor, setByColor] = useState(Object.keys(p.skip || {}).length > 0);
  const [shirt, setShirt] = useState("");
  const skipNow = byColor ? Object.fromEntries(Object.entries(skip).filter(([, n]) => n.length)) : {};
  const skipDirty = JSON.stringify(skipNow) !== JSON.stringify(p.skip || {});
  const [size, setSize] = useState(p.size), [loc, setLoc] = useState(p.location), [drop, setDrop] = useState(p.drop), [ub, setUb] = useState(p.underbase);
  // screens + which screen each art color prints through
  const start = useMemo(() => {
    const plan = p.plan;
    if (plan.length && Object.keys(p.inkMap).length) {
      const screens: Screen[] = [], assign: Record<string, number> = {};
      for (const k of plan) {
        const m = p.inkMap[k.hex]; if (!m) { screens.push({ name: k.name, hex: k.hex, mix: "" }); assign[k.hex] = screens.length - 1; continue; }
        if (m.name === "none") { assign[k.hex] = -1; continue; } // the shirt color, not printed
        let i = screens.findIndex((x) => x.name === m.name);
        if (i < 0) { screens.push({ name: m.name, hex: m.hex, mix: m.mix || "" }); i = screens.length - 1; }
        assign[k.hex] = i;
      }
      return { screens, assign };
    }
    if (plan.length) return { screens: plan.map((k) => ({ name: k.name, hex: k.hex, mix: "" })), assign: Object.fromEntries(plan.map((k, i) => [k.hex, i])) as Record<string, number> };
    return { screens: inkList(p.inks).map((n) => ({ name: n, hex: colorHex(n) || "#888888", mix: "" })), assign: {} as Record<string, number> };
  }, [p]);
  // the inks on the print (from the customer's notes or last time: "PMS 7466 C, PMS 803 C, PMS 806 C, Black") name the
  // screens: a screen whose name isn't one of them takes the closest unused one (Oct 21, Nick: "where you put electric
  // pink, it should have been 806")
  const named = useMemo(() => {
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
    const inks = inkList(p.inks).map((n) => ({ n, hex: (colorHex(n) || "").toUpperCase() })).filter((x) => /^#[0-9A-F]{6}$/.test(x.hex));
    if (!inks.length || !p.plan.length) return start.screens;
    const lc = (s: string) => s.trim().toLowerCase();
    const taken = new Set(start.screens.map((x) => lc(x.name)).filter((n) => inks.some((i) => lc(i.n) === n)));
    return start.screens.map((x) => {
      if (taken.has(lc(x.name)) || x.mix) return x;
      const a = rgb(x.hex);
      let best: { n: string; hex: string } | null = null, bd = 90 * 90;
      for (const i of inks) { if (taken.has(lc(i.n))) continue; const b = rgb(i.hex), d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2; if (d < bd) { bd = d; best = i; } }
      if (!best) return x;
      taken.add(lc(best.n));
      return { ...x, name: best.n, hex: best.hex };
    });
  }, [start, p.inks, p.plan.length]);
  const [screens, setScreens] = useState<Screen[]>(named);
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
    setAssign(Object.fromEntries(Object.entries(next).map(([h, i]) => [h, i < 0 ? -1 : remap.get(i) ?? 0])));
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
    // full detail (Oct 21, Nick: "on the photoshop files in preview… they are extremely grainy"): it was drawn at 420px
    // and stretched, so halftone dots turned to noise; now up to 1800px, shown smaller (sharp on a retina screen too)
    const k = Math.min(1, 1800 / Math.max(i.naturalWidth, i.naturalHeight));
    c.width = Math.max(1, Math.round(i.naturalWidth * k)); c.height = Math.max(1, Math.round(i.naturalHeight * k));
    const x = c.getContext("2d", { willReadFrequently: true })!; x.imageSmoothingQuality = "high"; x.clearRect(0, 0, c.width, c.height); x.drawImage(i, 0, 0, c.width, c.height);
    if (!p.plan.length) return;
    const rgb = (h: string) => [1, 3, 5].map((n) => parseInt(h.slice(n, n + 2), 16) || 0);
    const off = new Set((shirt && byColor ? skip[shirt] || [] : []).map((n) => n.toLowerCase()));
    const plan = p.plan.map((q) => ({ c: rgb(q.hex), to: assign[q.hex] === -1 || off.has((screens[assign[q.hex]]?.name || "").toLowerCase()) ? [-1, -1, -1] : rgb(screens[assign[q.hex]]?.hex || q.hex) }));
    const d = x.getImageData(0, 0, c.width, c.height), a = d.data, memo = new Map<number, number[]>();
    for (let o = 0; o < a.length; o += 4) {
      if (a[o + 3] < 8) continue;
      const key = (a[o] >> 3 << 10) | (a[o + 1] >> 3 << 5) | (a[o + 2] >> 3);
      let to = memo.get(key);
      if (!to) { let best = 1e9; for (const q of plan) { const dd = (q.c[0] - a[o]) ** 2 + (q.c[1] - a[o + 1]) ** 2 + (q.c[2] - a[o + 2]) ** 2; if (dd < best) { best = dd; to = q.to; } } memo.set(key, to!); }
      if (to![0] < 0) { a[o + 3] = 0; continue; }
      a[o] = to![0]; a[o + 1] = to![1]; a[o + 2] = to![2];
    }
    x.putImageData(d, 0, 0);
  }, [ready, screens, assign, p.plan, shirt, skip, byColor]);

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
  // more than one round: the heads where round 2 (and 3) start, from the setup saved as printed
  const [breaks, setBreaks] = useState<number[]>(() => {
    const hs = p.press && p.press.from !== "auto" ? p.press.heads : [];
    const out: number[] = []; let r = 1;
    hs.forEach((h, i) => { if (h.what === "screen" && (h.round || 1) > r) { r = h.round || 1; out.push(i); } });
    return out;
  });
  // each later round: flash only (null) or the earlier screens hit again (by key)
  const [hits, setHits] = useState<(string[] | null)[]>(() => {
    const hs = p.press && p.press.from !== "auto" ? p.press.heads : [];
    const out: (string[] | null)[] = [null, null];
    for (const h of hs) for (const r of h.again || []) if (r >= 2 && r <= 3) { out[r - 2] = [...(out[r - 2] || []), plateKey(h.name)]; }
    return out;
  });
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
    if (ok && p.screen && skipDirty) { setSaving("Saving the shirt colors…"); ok = await post({ op: "byColor", print: p.id, skip: skipNow }, "save"); }
    if (ok && p.screen && film && film !== p.film?.state) { setSaving("Saving the film…"); ok = await post({ op: "film", print: p.id, state: film }, "save"); }
    if (ok && p.screen && onPress && onPress.heads.some((h) => h.startsWith("p:"))) {
      setSaving("Saving the press setup…");
      const heads = onPress.heads.map((h, i) => {
        const pl = h.startsWith("p:") ? plates.find((x) => x.key === h.slice(2)) : null;
        const round = 1 + breaks.filter((b) => b <= i).length;
        const again = pl ? hits.flatMap((hs, k) => (k < breaks.length && hs?.includes(pl.key) ? [k + 2] : [])) : [];
        return pl ? { what: "screen", name: pl.name, hex: pl.hex, mesh: pl.mesh || null, ...(round > 1 ? { round } : {}), ...(again.length ? { again } : {}) } : { what: h === "flash" || h === "cool" || h === "roller" ? h : "empty", name: "", hex: "", mesh: null };
      });
      const r = await fetch("/api/jobs/press", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job: { kind: "o", id: orderId }, sheet: p.sep ? p.sep.id : `loc:${loc}`, pressId: press?.id || "", notes: pnotes, learn: true, heads }) }).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the server." }));
      if (r.error) { setErr(`Press setup: ${r.error}`); ok = false; }
      if (ok && (breaks.length + 1) !== (p.rounds || 1)) ok = await post({ op: "rounds", print: p.id, n: breaks.length + 1 }, "save");
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
  const dirty = skipDirty || size !== p.size || loc !== p.location || drop !== p.drop || ub !== p.underbase || JSON.stringify(screens) !== JSON.stringify(named) || JSON.stringify(assign) !== JSON.stringify(start.assign);
  const pending = !!p.confirm && !p.confirmed;
  async function save() {
    const ok = await post({ op: "draft", print: p.id, size, location: loc, drop, underbase: ub }, "save");
    if (ok && p.screen && screens.length) await post({ op: "colors", print: p.id, screens, map: assign }, "save");
    if (ok && p.screen && skipDirty) await post({ op: "byColor", print: p.id, skip: skipNow }, "save");
  }
  // the art on the shirt color, like the Mockup Creator's close-ups (Oct 21, Nick): the picked shirt, else the first
  const viewShirt = shirt || shirts[0]?.color || "";
  const shirtBgCss = useShirtBg(viewShirt || "White");
  const viewer = (
    <div className="jv-cc-art">
      <div className={"jv-view" + (view < 0 && viewShirt ? " on-shirt" : "")} style={view < 0 && viewShirt ? { background: shirtBgCss } : undefined}>
        {p.art ? <canvas ref={cv} aria-label="The art as it will print" style={{ display: view < 0 ? undefined : "none" }} /> : view < 0 && <span className="faint">No art picture on this print.</span>}
        {view >= 0 && mockups[view] && <a href={mockups[view].full} target="_blank" rel="noreferrer" title="Open full size"><img src={mockups[view].full || mockups[view].thumb} alt={mockups[view].title} /></a>}
      </div>
      <span className="faint">{view >= 0 && mockups[view] ? mockups[view].title.replace(/^.*? — /, "") : viewShirt ? `As it will print on ${viewShirt}${shirt && (skip[shirt] || []).length && byColor ? ` (no ${skip[shirt].join(", ")})` : ""}` : "As it will print"}</span>
      {mockups.length > 0 && (
        <div className="jv-strip" aria-label="Mockups">
          {p.art && <button type="button" className={"jv-strip-art" + (view < 0 ? " on" : "")} onClick={() => setView(-1)} title="The art as it will print">Art</button>}
          {mockups.map((m, i) => <button key={i} type="button" className={view === i ? "on" : ""} onClick={() => { setView(i); const c = shirts.find((sh) => m.title.toLowerCase().endsWith(sh.color.toLowerCase())); setShirt(c ? c.color : ""); }} title={m.title}><img src={m.thumb || m.full} alt={m.title} /></button>)}
        </div>
      )}
      {!mockups.length && <span className="faint">No mockup saved yet: make it in the Mockup Creator.</span>}
    </div>
  );
  return (
    <div className="jv-cp">
      <div className="jv-card-h">
        <h2>Confirm the print · {p.location}</h2>
        <span className="faint">{p.method === "screen" ? "Screen print" : p.method}{p.design ? ` · ${p.design}` : ""}</span>
        <span className={"jv-badge" + (pending ? " warn" : " ok")}>{pending ? "Production to confirm" : p.confirmed ? `Confirmed by ${p.confirmed.by}` : "Set"}</span>
      </div>
      <RefNotes v={v} p={p} open={pending} />
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
      {!p.screen && mockups.length > 0 && <div className="jv-cp-step"><div className="jv-cp-n">Mockup</div><div className="jv-cc">{viewer}</div></div>}
      {p.screen && (
        <div className="jv-cp-step jv-cp-colors">
          <div className="jv-cp-n"><b>3</b>Colors &amp; screens <span className="faint">{p.plan.length ? `${p.plan.length} colors in the art → ${screens.length} screen${screens.length === 1 ? "" : "s"}` : `${screens.length} screen${screens.length === 1 ? "" : "s"}`}</span></div>
          <div className="jv-cc">
            {viewer}
            <div className="jv-cc-list">
              {p.plan.length > 0 && (
                <div className="jv-cc-art-colors">
                  <h3 className="jv-cc-h">Detected colors</h3>
                  <div className="jv-cc-hint">The colors found in the art. To combine two, pick the same screen for both (e.g. set PMS 7506 C to the screen PMS 475 C is on); a color on its own screen prints by itself.</div>
                  <div className="jv-ac jv-ac-head"><span /><span>Art color</span><span className="jv-ac-c">Combined</span><span title="Pick the same screen for two colors to print them together">Screen · ⇄ same screen = combined</span></div>
                  {p.plan.map((k) => {
                    const sc = assign[k.hex] ?? 0;
                    // the other art colors on the same screen (combined with this one)
                    const with_ = sc < 0 ? [] : p.plan.filter((o) => o.hex !== k.hex && (assign[o.hex] ?? 0) === sc);
                    return (
                      <div key={k.hex} className={"jv-ac" + (with_.length ? " joined" : "")}>
                        <span className="jv-sw" style={{ background: k.hex }} />
                        <span className="jv-ac-n">{k.name}<span className="faint"> {k.hex}</span></span>
                        <span className="jv-ac-c">{sc < 0 ? <span className="faint">shirt color: not printed</span> : with_.length ? <span className="jv-join" title={`Prints on screen ${sc + 1} together with ${with_.map((o) => o.name).join(", ")}`}>⇄ with {with_.map((o) => o.name).join(", ")}</span> : <span className="faint">its own screen</span>}</span>
                        <select value={sc} onChange={(e) => setAssigned(k.hex, +e.target.value)} aria-label={`Screen for ${k.name} (pick another color's screen to combine them)`}>
                          {screens.map((x, i) => <option key={i} value={i}>Screen {i + 1}: {x.name}</option>)}
                          <option value={screens.length}>A screen of its own</option>
                          <option value={-1}>Shirt color: don&apos;t print</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}
              <h3 className="jv-cc-h">How we printed it</h3>
              <div className="jv-cc-hint">The screens, in print order: the ink on each, and a custom mix if it was mixed.</div>
              {screens.map((x, i) => {
                const on = colorsOn(i);
                return (
                  <div key={i} className="jv-scr">
                    <span className="jv-n">{i + 1}</span>
                    <input type="color" value={x.hex} onChange={(e) => setScreen(i, { hex: e.target.value.toUpperCase() })} aria-label={`Screen ${i + 1} color`} />
                    <div className="jv-scr-b">
                      <input value={x.name} list="jv-pms" onChange={(e) => { const name = e.target.value; const h = colorHex(name); setScreen(i, { name, ...(h ? { hex: h.toUpperCase() } : {}) }); }} aria-label={`Screen ${i + 1} ink`} placeholder="PMS 475 C, White, or a custom name" />
                      <input value={x.mix} onChange={(e) => setScreen(i, { mix: e.target.value })} placeholder="Custom mix (optional)" aria-label={`Screen ${i + 1} mix`} />
                      {on.length > 1 && <span className="faint">Prints {on.map((k) => k.name).join(" + ")}{!x.mix && <> · <button type="button" className="linkbtn" onClick={() => setScreen(i, { name: `Custom ${on.map((k) => k.name.replace(/^PMS /, "").replace(/ C$/, "")).join("/")}`, hex: on.slice(1).reduce((h, k) => avgHex(h, k.hex), on[0].hex), mix: `half ${on[0].name}, half ${on[1].name}${on.length > 2 ? `, plus ${on.slice(2).map((k) => k.name).join(", ")}` : ""}` })}>Mix them half and half</button></>}</span>}
                    </div>
                    {!p.plan.length && <button type="button" className="jv-x" aria-label={`Remove screen ${i + 1}`} onClick={() => setScreens((a) => a.filter((_, j) => j !== i))}>×</button>}
                  </div>
                );
              })}
              {!p.plan.length && <button type="button" className="btn sm ghost" onClick={() => setScreens((a) => [...a, { name: "", hex: "#888888", mix: "" }])}>+ Screen</button>}
              <div className="jv-ub"><span>Underbase</span>{([["", "Not sure"], ["yes", "Yes"], ["no", "No"]] as const).map(([k, l]) => <button key={k} type="button" className={"chip" + (ub === k ? " on" : "")} onClick={() => setUb(k)}>{l}</button>)}</div>
              {shirts.length > 1 && screens.some((x) => x.name.trim()) && (
                <div className="jv-bc">
                  <h3 className="jv-cc-h">On each shirt color</h3>
                  <div className="jv-ub">
                    <button type="button" className={"chip" + (!byColor ? " on" : "")} onClick={() => { setByColor(false); setShirt(""); }}>Prints the same on every color</button>
                    <button type="button" className={"chip" + (byColor ? " on" : "")} onClick={() => setByColor(true)}>Changes by shirt color</button>
                  </div>
                  {byColor && (
                    <>
                      <table className="jv-bc-t">
                        <thead><tr><th>Shirt</th>{screens.filter((x) => x.name.trim()).map((x, i) => <th key={i}><span className="jv-sw" style={{ background: x.hex }} />{x.name}</th>)}</tr></thead>
                        <tbody>{shirts.map((sh) => {
                          const k = sh.color, offs = skip[k] || [];
                          return (
                            <tr key={k} className={shirt === k ? "on" : ""}>
                              <td><button type="button" className="linkbtn" title="See how it prints on this color" onClick={() => { setShirt(shirt === k ? "" : k); setView(-1); }}>{k}</button>{sh.styles && <span className="faint"> {sh.styles}</span>}</td>
                              {screens.filter((x) => x.name.trim()).map((x, i) => {
                                const isOff = offs.some((n) => n.toLowerCase() === x.name.trim().toLowerCase());
                                return <td key={i}><button type="button" className={"jv-bc-c" + (isOff ? " off" : "")} aria-label={`${x.name} on ${k}: ${isOff ? "skipped" : "prints"}`} aria-pressed={!isOff}
                                  onClick={() => { setShirt(k); setView(-1); setSkip((m) => ({ ...m, [k]: isOff ? offs.filter((n) => n.toLowerCase() !== x.name.trim().toLowerCase()) : [...offs, x.name.trim()] })); }}>{isOff ? "skip" : "✓"}</button></td>;
                              })}
                            </tr>
                          );
                        })}</tbody>
                      </table>
                      <div className="jv-cc-hint">Click a box to skip that screen on that shirt color. Click a shirt to see how it prints on it. The work order and the next reorder show the skips.</div>
                    </>
                  )}
                </div>
              )}
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
            : <PressSetupCard title="Press setup" presses={presses} setPresses={setPresses} press={press} onPickPress={(id) => { setPressId(id); setSetup(null); setBreaks([]); setHits([null, null]); }} breaks={breaks} onBreaks={setBreaks} hits={hits} onHits={setHits} onPress={onPress} setup={setup}
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
      <Samples n={one ? (p.screen ? 7 : 4) : p.screen ? 4 : 3} p={p} v={v} orderId={orderId} busy={busy} post={post} photos={photos} reloadPhotos={reloadPhotos} setErr={setErr} />
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
 * What the customer and the last job said, to check the print against (Oct 21, Nick: "the customer gave us all the
 * details in the customer notes and you missed it… include the notes and the production notes from last time in here
 * somewhere as a reference"): the old Printavo job's customer and production notes, imprint details and emails, this
 * order's notes and production notes, and this print's notes.
 */
function RefNotes({ v, p, open }: { v: ProductionView; p: PvPrint; open: boolean }) {
  // closed to start (Oct 21, Nick: "not dropped down by default"); opening it is remembered
  const [shown, setKeepOpen] = useSticky("pv.refNotes", false);
  const setShown = (x: boolean) => { if (x !== shown) setKeepOpen(x); };
  void open;
  const old = v.history.filter((h) => /^(Customer note|Production note|Imprint|Customer email|Shop email)/.test(h.kind) && h.text.trim());
  const items: { from: string; text: string }[] = [
    ...old.map((h) => ({ from: `${h.when} · ${h.kind}`, text: h.text })),
    ...(v.order.notes.trim() ? [{ from: `#${v.order.number} · Order notes`, text: v.order.notes }] : []),
    ...(p.notes.trim() ? [{ from: `${p.location} · Print notes`, text: p.notes }] : []),
    ...(v.productionNotes.trim() ? [{ from: `#${v.order.number} · Production notes`, text: v.productionNotes }] : []),
  ];
  if (!items.length) return null;
  return (
    <details className="jv-ref" open={shown} onToggle={(e) => setShown((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Notes from the customer and last time <span className="faint">({items.length})</span></summary>
      <div className="jv-ref-l">
        {items.map((x, i) => <div key={i} className="jv-ref-i"><b>{x.from}</b><div>{x.text}</div></div>)}
      </div>
    </details>
  );
}

/**
 * 7 Samples or photos (Oct 21, Nick: "a box that says we have a physical sample… yes or no… find in the messages the
 * pictures… look at the messages to Brooke… I sent this one… also an upload field for photos"). The yes/no is on the
 * group's prints; the photos are the job's production photos (job_files), from the customer's texts and emails
 * (/api/orders/[id]/photos) or uploaded.
 */
type Found = { key: string; src: "text" | "email"; url: string; name: string; date: string; fromMe: boolean; body: string; job: string; here: boolean; with?: string; /** on the iPhone only (not on the shop's Mac yet) */ missing?: boolean };
const markOf = (body: string) => (body.match(/\[([te]:[^\]]+)\]\s*$/) || [])[1] || "";
function Samples({ n, p, v, orderId, photos, reloadPhotos, setErr }: { n: number; p: PvPrint; v: ProductionView; orderId: string; busy?: boolean; post?: unknown; photos: JobFile[]; reloadPhotos: () => Promise<void>; setErr: (s: string) => void }) {
  // whose photos (Oct 21, Nick: "this is a reorder… you're not bringing photos in of the job that we're doing… are you
  // uploading photos from a previous order, or from this order… this whole process is about what we did last time"):
  // photos of last time go on the job they're of (the old Printavo job or order), photos of this run on this order
  const jobs = [
    ...(v.prev ? [{ kind: v.prev.kind, id: v.prev.id, number: v.prev.number, label: v.prev.label, what: "How we ran it before" }] : []),
    { kind: "o" as const, id: orderId, number: String(v.order.number), label: `#${v.order.number}`, what: "This run" },
  ];
  const [to, setTo] = useState(0); // last time first on a reorder
  const tgt = jobs[Math.min(to, jobs.length - 1)];
  const [prevPics, setPrevPics] = useState<JobFile[]>([]);
  const loadPrev = useCallback(async () => {
    if (!v.prev) return;
    const r = await fetch(`/api/jobs/files?kind=${v.prev.kind}&id=${v.prev.id}`).then((x) => x.json()).catch(() => ({}));
    setPrevPics(((r.items || []) as JobFile[]).filter((x) => !x.archived));
  }, [v.prev]);
  const reloadAll = useCallback(async () => { await Promise.all([reloadPhotos(), loadPrev()]); }, [reloadPhotos, loadPrev]);
  useEffect(() => { void loadPrev(); }, [loadPrev]);
  const [found, setFound] = useState<Found[] | null>(null);
  const [looking, setLooking] = useState(false), [adding, setAdding] = useState(""), [upl, setUpl] = useState(false), [msg, setMsg] = useState("");
  const [all, setAll] = useState(false);
  // from the phone: the QR opens the picked job's Photos on the phone (take one, add from the photo library or from the
  // texts with the customer); they show up here on their own
  const qr = useMemo(() => qrSvg(`${jobLink(tgt.number)}?v=photos`, 2).svg, [tgt.number]);
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === "visible") void reloadAll(); }, 8000); return () => clearInterval(t); }, [reloadAll]);
  // the physical sample: set right away on screen, saved in the background (it lagged waiting on the whole page)
  const [have, setHave] = useState<boolean | null>(p.sample);
  async function setSample(k: boolean) {
    const next = have === k ? null : k, was = have;
    setHave(next); setMsg("");
    const r = await fetch(`/api/orders/${orderId}/production`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "sample", print: p.id, have: next }) }).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the server." }));
    if (r.error) { setHave(was); setMsg(r.error); }
  }
  const mine = photos.filter((x) => x.kind === "photo" && x.url), last = prevPics.filter((x) => x.kind === "photo" && x.url);
  const added = new Set((v.prev && tgt.id === v.prev.id ? last : mine).map((x) => markOf(x.body || "")).filter(Boolean));
  // a photo's note, or take it off (archived, never deleted)
  const [noting, setNoting] = useState(""), [noteText, setNoteText] = useState("");
  const capOf = (x: JobFile) => (x.body || "").replace(/\s*\[[te]:[^\]]+\]\s*$/, "").trim();
  async function patchFile(id: string, b: Record<string, unknown>) {
    const r = await fetch("/api/jobs/files", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...b }) }).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the server." }));
    if (r.error) setMsg(r.error); else await reloadAll();
  }
  async function find() {
    setLooking(true); setMsg("");
    const r = await fetch(`/api/jobs/text-photos?kind=${tgt.kind}&id=${tgt.id}`).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the server." }));
    setLooking(false);
    if (r.error) { setMsg(r.error); return; }
    setFound(r.items || []);
  }
  async function add(f: Found) {
    setAdding(f.key); setMsg("");
    const r = await fetch("/api/jobs/text-photos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: tgt.kind, id: tgt.id, key: f.key }) }).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the server." }));
    setAdding("");
    if (r.error) { setMsg(r.error); return; }
    await reloadAll();
  }
  const list = (found || []).filter((f) => all || f.here);
  const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const gallery = (xs: JobFile[]) => xs.map((x) => (
    <div key={x.id} className="jv-ph">
      <a href={x.url} target="_blank" rel="noreferrer" title={capOf(x) || x.file_name}><img src={x.url} alt={capOf(x) || "Photo"} /></a>
      {noting === x.id ? (
        <input autoFocus value={noteText} placeholder="Add a note" aria-label="Photo note" onChange={(e) => setNoteText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { setNoting(""); void patchFile(x.id, { body: noteText }); } if (e.key === "Escape") setNoting(""); }}
          onBlur={() => { if (noteText !== capOf(x)) void patchFile(x.id, { body: noteText }); setNoting(""); }} />
      ) : capOf(x) ? <span className="jv-ph-cap" title={capOf(x)}>{capOf(x)}</span> : null}
      <span className="jv-ph-acts">
        <button type="button" className="linkbtn" onClick={() => { setNoting(x.id); setNoteText(capOf(x)); }}>{capOf(x) ? "Edit note" : "Add note"}</button>
        <button type="button" className="linkbtn danger" onClick={() => void patchFile(x.id, { archived: true })}>Remove</button>
      </span>
    </div>
  ));
  return (
    <div className="jv-cp-step jv-smp">
      <div className="jv-cp-n"><b>{n}</b>Samples or photos</div>
      <div className="jv-smp-top">
        <div className="stack" style={{ gap: 8 }}>
          <div className="jv-ub">
            <span>We have a physical sample</span>
            {([[true, "Yes"], [false, "No"]] as const).map(([k, l]) => <button key={l} type="button" className={"chip" + (have === k ? " on" : "")} onClick={() => void setSample(k)}>{l}</button>)}
          </div>
          {jobs.length > 1 && (
            <div className="jv-ub">
              <span>Adding photos of</span>
              {jobs.map((j, i) => <button key={j.id} type="button" className={"chip" + (tgt === j ? " on" : "")} onClick={() => { setTo(i); setFound(null); }}>{j.what}</button>)}
            </div>
          )}
        </div>
      </div>
      {v.prev && (
        <div className="jv-smp-sec">
          <div className="jv-lbl">How we ran it before</div>
          <div className="jv-smp-pics">{gallery(last)}{!last.length && <span className="faint">No photos yet.</span>}</div>
        </div>
      )}
      <div className="jv-smp-sec">
        {v.prev && <div className="jv-lbl">This run</div>}
        <div className="jv-smp-pics">{gallery(mine)}{v.prev && !mine.length && <span className="faint">No photos of this run yet.</span>}</div>
      </div>
      <div className="jv-smp-pics">
        <label className="jv-addphoto">{upl ? "Adding…" : "+ Upload photos"}<input type="file" accept="image/*" multiple hidden onChange={async (e) => {
          const fs = [...(e.target.files || [])]; e.target.value = ""; if (!fs.length) return;
          setUpl(true);
          for (const f of fs) { const r = await addPhoto({ kind: tgt.kind, id: tgt.id }, f, `${p.location} sample`, "Sample"); if (!r.ok) { setErr(r.error); break; } }
          setUpl(false); await reloadAll();
        }} /></label>
        <button type="button" className="jv-addphoto" disabled={looking} onClick={() => (found ? setFound(null) : void find())}>{looking ? "Looking…" : found ? "Hide the messages" : "Find photos in texts and emails"}</button>
        <div className="jv-phone jv-phone-sm">
          <div className="jv-phone-qr" dangerouslySetInnerHTML={{ __html: qr }} />
          <div>
            <b>Photos on your phone?</b>
            <div className="jv-cc-hint">Scan with the iPhone camera, then tap <b>Add from my messages</b> or <b>Add from my photos</b>. They show up here in a few seconds{jobs.length > 1 ? `, under ${tgt.what.toLowerCase()}` : ""}.</div>
          </div>
        </div>
      </div>
      {msg && <div className="err">{msg}</div>}
      {found && (
        <div className="jv-find">
          <div className="jv-find-h">
            <span>{found.length ? `${list.length} picture${list.length === 1 ? "" : "s"} ${all ? `with ${v.order.customer}` : "filed to this job"}` : `No pictures in the texts or emails with ${v.order.customer}.`}{jobs.length > 1 ? ` · adding to ${tgt.what.toLowerCase()}` : ""}</span>
            {found.length > 0 && <button type="button" className="linkbtn" onClick={() => setAll((x) => !x)}>{all ? "Only this job's" : `All ${found.length} with ${v.order.customer}`}</button>}
          </div>
          {found.length > 0 && !list.length && <div className="jv-cc-hint">None of the texts or emails are filed to this job. <button type="button" className="linkbtn" onClick={() => setAll(true)}>Show all of {v.order.customer}&apos;s</button></div>}
          <div className="jv-find-g">
            {list.map((f) => {
              const mk = `${f.key.slice(0, 2)}${f.key.split("/").pop()}`, has = added.has(mk);
              return (
                <div key={f.key} className={"jv-find-i" + (has ? " has" : "")}>
                  {f.missing ? <div className="jv-find-miss" title="Messages on the Mac mini hasn't downloaded this picture yet (it's in iCloud). Open the chat on the Mac and scroll up to it; it comes in within a day.">On your iPhone only</div>
                    : <a href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt={f.name} loading="lazy" /></a>}
                  <div className="jv-find-m"><b>{f.src === "text" ? (f.fromMe ? `We texted${f.with ? ` ${f.with}` : ""}` : `${f.with || "They"} texted`) : f.fromMe ? "We emailed" : "They emailed"}</b> {fmt(f.date)}{f.job && <span className="faint"> · {f.job}</span>}</div>
                  {f.body && <div className="jv-find-b faint">{f.body}</div>}
                  <button type="button" className={"btn sm" + (has ? "" : " primary")} disabled={has || !!adding || !!f.missing} onClick={() => void add(f)}>{f.missing ? "Not on the Mac yet" : has ? "✓ On the job" : adding === f.key ? "Adding…" : "Add"}</button>
                </div>
              );
            })}
          </div>
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

