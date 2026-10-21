"use client";
import { Fragment, useRef, useState, type ReactNode } from "react";
import PressLayout from "@/components/PressLayout";
import PressDefaults, { pressLayOf } from "@/components/PressDefaults";
import { useRole } from "@/components/RoleContext";
import { useSticky } from "@/lib/useSticky";
import { autoSetup, checkSetup, drawLayout, fitSetup, plateOf, printOrder, type Slot } from "@/lib/pressSetup";
import { recommendSetup, type PlanPlate } from "@/lib/pressPlan";
import { layoutCounts, type Machine, type Station } from "@/lib/production";

/**
 * The press setup card (Separations → Press, and step 5 of the production mockup; Oct 21, Nick: "use the same press
 * logic and setup that you do in the separations… exactly the same"). One piece of code for both, so they can't drift:
 * the press drawn with the load / unload station, its flashes, the roller, cool-down and skipped (down) heads; each
 * color picks its head (or is dragged onto one); tap a head for a flash, the roller or a cool-down; the suggested
 * layout and why; what to change on the press; Space colors out; Press Defaults; the setup sheet for the operator.
 */
export type PsPlate = { key: string; name: string; hex: string; kind: string; mesh?: number };
export type PsRec = { all: PlanPlate[]; dark: boolean; noShirt?: boolean; ov?: number[][] };

/** the screens on a press: the suggested layout (or the one set by hand, fitted to the press as it is today) */
export function planOnPress(press: Machine | undefined, plates0: PsPlate[], setup: Slot[] | null, rec?: PsRec, dark = true) {
  if (!press) return null;
  const lay = pressLayOf(press);
  const sp = plates0.map((p) => ({ key: p.key, name: p.name, hex: p.hex, kind: p.kind, mesh: p.mesh }));
  // automatic: the suggested layout (print order, flashes, cool-down, inks by the load / unload stations)
  const r = !setup && rec && rec.all.length ? recommendSetup(lay, rec.all, { dark: rec.dark, noShirt: rec.noShirt, ov: rec.ov, allPlates: rec.all }) : null;
  const { heads, off } = r?.ok ? { heads: r.heads, off: [] as typeof sp } : fitSetup(setup, lay, sp);
  // the colors in the order a pallet reaches them, the ones not on the press last
  const on = printOrder(heads);
  const plates = [...on.map((k) => plates0.find((p) => p.key === k)).filter((p): p is PsPlate => !!p), ...plates0.filter((p) => !on.includes(p.key))];
  const out = heads.map((x) => { const k = plateOf(x); const p = k ? plates.find((q) => q.key === k) : null; return p ? { hex: p.kind === "underbase" || p.kind === "highlight" ? "#FFFFFF" : p.hex, name: `${plates.indexOf(p) + 1} · ${p.name}` } : null; });
  const chk = checkSetup(heads, lay, sp, rec ? rec.dark : dark);
  const note = off.length ? `${off.length} screen${off.length === 1 ? "" : "s"} won't fit on ${press.name.split(" · ")[0]} (${off.map((p) => p.name).join(", ")}): free a head, print in two rounds, or pick another press.` : "";
  return { lay, heads, out, off, note, plates, ...chk, why: r?.why || [], recOrder: r?.ok ? r.order : null, recNote: r && !r.ok ? r.why[0] : "" };
}
export type OnPress = NonNullable<ReturnType<typeof planOnPress>>;

export default function PressSetupCard({ presses, setPresses, press, onPickPress, onPress, setup, commit, clearSetup, sheet, extra, onMesh, title = "Press Setup", compact = false, breaks, onBreaks, hits, onHits }: {
  presses: Machine[]; setPresses?: (fn: (ps: Machine[]) => Machine[]) => void;
  press: Machine; onPickPress: (id: string) => void;
  onPress: OnPress; setup: Slot[] | null;
  /** a setup changed by hand */ commit: (heads: Slot[]) => void;
  /** back to the suggested layout */ clearSetup: () => void;
  /** the setup sheet's heading and the line under it */ sheet: { title: string; heading: string; sub: string };
  /** more beside the press picker (the production mockup's "Must run on this press") */ extra?: ReactNode;
  /** mesh typed per color (the production mockup: the screens as they ran) */ onMesh?: (key: string, mesh: number | undefined) => void;
  title?: string;
  /** a narrow column (Separations): the stations open from a button beside Press Defaults */ compact?: boolean;
  /**
   * More than one round (Oct 21, Nick: "sometimes we have to go an additional round so that we can flash again… we
   * would go a second round between heads 11 and 12… we don't have the space to add a flash"): the heads where round 2
   * (and 3) start. Screens from there on print on that round; the earlier screens are lifted and the flashes fire again.
   */
  breaks?: number[]; onBreaks?: (b: number[]) => void;
  /**
   * Each later round: flash only (null), or the earlier colors hit again on it (Oct 21, Nick: "sometimes we have to hit
   * a color again… we need to hit the brown one more time to get the color right"). hits[0] is round 2, hits[1] round 3;
   * the screens by key.
   */
  hits?: (string[] | null)[]; onHits?: (h: (string[] | null)[]) => void;
}) {
  const [showSt, setShowSt] = useSticky("ps.stations", false);
  const stations = !compact || showSt;
  const { perms, email } = useRole();
  const plates = onPress.plates;
  const [selHead, setSelHead] = useState<number | null>(null);
  const [defOpen, setDefOpen] = useState(false), [msg, setMsg] = useState("");
  const drawing = useRef<HTMLDivElement>(null);

  function putPlate(key: string, head: number) {
    const n = [...onPress.heads], from = n.indexOf("p:" + key), prev = n[head];
    if (prev === "down") return;
    n[head] = "p:" + key;
    // whatever was on that head (a screen, a flash, the roller, a cool-down) trades places with it
    if (from >= 0 && from !== head) n[from] = prev;
    commit(n); setSelHead(null);
  }
  function setHeadTo(head: number, v: Slot) {
    if (plateOf(v)) { putPlate(plateOf(v)!, head); return; }
    const n = [...onPress.heads];
    // a flash, the roller or a cool-down head put where a screen is: that screen and the ones after it move down a head
    // (flashes, rollers and cool-down heads after it stay put)
    const moving = plateOf(n[head]) ? n.slice(head).filter((x) => plateOf(x)) : [];
    if (moving.length) for (let i = head; i < n.length; i++) if (plateOf(n[i])) n[i] = "";
    n[head] = v;
    for (let i = head + 1; i < n.length && moving.length; i++) if (n[i] === "") n[i] = moving.shift()!;
    commit(n);
  }
  // tap a head on the drawing: its station picker opens beside the press and its row below lights up
  function pickHead(i: number) {
    if (onPress.heads[i] === "down") { setMsg(`Head ${i + 1} is down (Production → Equipment Status).`); return; }
    setSelHead(i);
  }
  /**
   * Drag anything onto a head (Oct 21, Nick: "if I want to make the white head 8, I should just be able to drag it down
   * to head 8"): a head's color, flash, roller or cool-down dragged in the head list (or a screen off the press, or onto
   * the drawing) goes there, and what was there trades places with it. Heads that are down stay put.
   */
  const [drag, setDrag] = useState<{ head?: number; plate?: string; round?: number } | null>(null), [dropHead, setDropHead] = useState<number | null>(null);
  const brk = [...(breaks || [])].filter((b) => b > 0 && b < onPress.heads.length).sort((a, b) => a - b);
  const rounds = brk.length + 1;
  const roundOf = (h: number) => 1 + brk.filter((b) => b <= h).length;
  /** the later rounds a screen is hit again on */
  const againOf = (key: string) => (hits || []).flatMap((hs, k) => (k < rounds - 1 && hs?.includes(key) ? [k + 2] : []));
  const setHit = (k: number, v: string[] | null) => { if (!onHits) return; const n = [...(hits || [])]; while (n.length <= k) n.push(null); n[k] = v; onHits(n); };
  /** 2 or 3 rounds: round 2 (and 3) start at the last screens, unless they were placed already */
  function setRounds(n: number) {
    if (!onBreaks) return;
    if (n <= 1) { onBreaks([]); return; }
    const scr = onPress.heads.flatMap((x, i) => (plateOf(x) && i > 0 ? [i] : []));
    const next = brk.slice(0, n - 1);
    for (const w of scr.slice(-(n - 1))) if (next.length < n - 1 && !next.includes(w)) next.push(w);
    for (const w of [...scr].reverse()) if (next.length < n - 1 && !next.includes(w)) next.push(w);
    onBreaks(next.sort((a, b) => a - b));
  }
  /** the "round N starts here" bar dropped on a head: that round starts at that head */
  function moveBreak(k: number, h: number) {
    if (!onBreaks || h <= 0) return;
    const next = [...brk]; next[k] = h;
    onBreaks([...new Set(next)].sort((a, b) => a - b));
  }
  function moveSlot(from: number, to: number) {
    const n = [...onPress.heads];
    if (from === to || n[from] === "down" || n[to] === "down") return;
    [n[from], n[to]] = [n[to], n[from]];
    commit(n); setSelHead(null);
  }
  function dropOnHead(i: number) {
    if (drag?.round != null) moveBreak(drag.round, i); else if (drag?.head != null) moveSlot(drag.head, i); else if (drag?.plate) putPlate(drag.plate, i);
    setDrag(null); setDropHead(null);
  }
  /** a sheet for the press operator: the press drawn with every head, and the list */
  function printSetup() {
    const svg = drawing.current?.querySelector("svg")?.outerHTML || "";
    const css = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((x) => x.outerHTML).join("");
    const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
    const rows = onPress.heads.map((x, i) => { const k = plateOf(x), p = k ? plates.find((q) => q.key === k) : null;
      const what = p ? `<b>${esc(p.name)}</b>${p.kind === "underbase" ? " (underbase)" : p.kind === "highlight" ? " (highlight white)" : ""}${p.mesh ? ` · mesh ${p.mesh}` : ""}` : x === "flash" ? "<b>FLASH</b>" : x === "roller" ? "<b>ROLLER</b> (dead screen)" : x === "cool" ? "<i>empty: cool down</i>" : x === "down" ? "<i>head down</i>" : "<span style=\"color:#999\">empty</span>";
      const bar = rounds > 1 && brk.includes(i) ? `<tr><td colspan="2" style="padding:5px 10px;font-weight:800;border-top:2px dashed #2563eb;color:#2563eb">↻ ROUND ${roundOf(i)} STARTS HERE</td></tr>` : "";
      return `${bar}<tr><td style="padding:5px 10px;font-weight:800">Head ${i + 1}</td><td style="padding:5px 10px">${p ? `<span style="display:inline-block;width:14px;height:14px;border:1px solid #999;vertical-align:-2px;margin-right:6px;background:${p.hex}"></span>` : ""}${what}${rounds > 1 && p ? ` · <b>${againOf(p.key).length ? `rounds ${[roundOf(i), ...againOf(p.key)].join(" & ")}` : `round ${roundOf(i)}`}</b>` : ""}</td></tr>`; }).join("");
    const w = window.open("", "_blank"); if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(sheet.title)}</title>${css}<style>body{background:#fff;color:#111;font:14px system-ui;padding:24px}table{border-collapse:collapse}tr:nth-child(odd){background:#f4f5f7}.pl{width:360px;height:auto}</style></head><body>
      <h2 style="margin:0">${esc(sheet.heading)}</h2>
      <div style="color:#555;margin:4px 0 14px">${esc(press.name)} · ${esc(sheet.sub)}</div>
      <div style="display:flex;gap:28px;align-items:flex-start;flex-wrap:wrap">${svg}<table>${rows}</table></div>
      ${rounds > 1 ? `<h3>${rounds} rounds</h3><ul>${Array.from({ length: rounds }, (_, r) => { const hs = onPress.heads.flatMap((x, i) => { const kk = plateOf(x); return kk && (roundOf(i) === r + 1 || againOf(kk).includes(r + 1)) ? [i + 1] : []; }); return `<li>Round ${r + 1}: print head${hs.length === 1 ? "" : "s"} ${hs.join(", ")}${r ? `${hs.some((h) => roundOf(h - 1) < r + 1) ? " (hitting earlier colors again)" : ""} only (the others lifted), flashes on` : ""}</li>`; }).join("")}</ul>` : ""}
      ${onPress.moves.length ? `<h3>Before you start</h3><ul>${onPress.moves.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
      <script>setTimeout(()=>print(),400)</script></body></html>`);
    w.document.close();
  }

  return (
    <section className="sep-card sep-pressup">
      <h3>{title} <small className="faint">{setup ? "set by hand" : "suggested"}</small></h3>
      <div className="sep-row">
        <select value={press.id} onChange={(e) => { onPickPress(e.target.value); setSelHead(null); }} aria-label="Press">{presses.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        {perms.pressDefaults && setPresses && <button type="button" className="btn sm" onClick={() => setDefOpen(true)} title="What always sits on each head of this press: flashes, the roller">Press Defaults</button>}
        {compact && <button type="button" className={"btn sm" + (showSt ? " on" : "")} aria-pressed={showSt} onClick={() => setShowSt(!showSt)} title="How each station sits for this job: flashes, cool-down, the roller">Stations</button>}
        {extra}
      </div>
      {/* the press drawn, and beside it how each station sits for this job (Oct 21, Nick: "a visual next to the press…
          flash on 2, cool down 3, roller on 4… select from there the flashes, and it should edit it down below") */}
      <div className="ps-top">
        <div className="sep-press" ref={drawing}><PressLayout layout={drawLayout(onPress.heads)} size={230} mirror={!!press.mirror} inks={rounds > 1 ? onPress.out.map((o, i) => (o && roundOf(i) > 1 ? { ...o, name: `${o.name} · R${roundOf(i)}` } : o)) : onPress.out} selected={selHead} onPick={pickHead}
          onDropHead={drag ? dropOnHead : undefined} dropAt={dropHead} onDragHead={(i) => setDropHead(i)} /></div>
        {stations && <div className="ps-side">
          <div className="ps-lbl">How the press sits for this job · click a station to change it</div>
          <div className="ps-strip" style={{ gridTemplateColumns: `repeat(${Math.min(6, onPress.heads.length)}, minmax(0, 1fr))` }}>
            {onPress.heads.map((x, h) => {
              const k = plateOf(x), p = k ? plates.find((q) => q.key === k) : null;
              const kind = p ? "print" : x === "" ? "open" : x;
              const word = p ? "print" : x === "flash" ? "flash" : x === "roller" ? "roller" : x === "cool" ? "cool" : x === "down" ? "down" : "open";
              return (
                <button key={h} type="button" className={"ps-tile t-" + kind + (selHead === h ? " sel" : "")} disabled={x === "down"} title={p ? `Head ${h + 1}: ${p.name}` : `Head ${h + 1}: ${word}`}
                  onClick={() => setSelHead(selHead === h ? null : h)}>
                  <b>{h + 1}</b><span>{p && <i className="ps-dot" style={{ background: p.hex }} />}{word}</span>
                </button>
              );
            })}
          </div>
          {selHead != null && onPress.heads[selHead] !== "down" && (() => {
            const x = onPress.heads[selHead], k = plateOf(x), p = k ? plates.find((q) => q.key === k) : null;
            return (
              <div className="ps-pick">
                <span>Head {selHead + 1}{p ? ` (${p.name})` : ""}:</span>
                {([["", "Print"], ["flash", "Flash"], ["cool", "Cool down"], ["roller", "Roller"]] as const).map(([v, l]) => (
                  <button key={v || "open"} type="button" className={"ps-chip c-" + (v || "open") + ((v === "" ? !!p || x === "" : x === v) ? " on" : "")}
                    onClick={() => { if (v === "" ? !(p || x === "") : x !== v) setHeadTo(selHead, v); }}>{l}</button>
                ))}
                <button type="button" className="btn icon ghost sm" aria-label="Close" onClick={() => setSelHead(null)}>✕</button>
              </div>
            );
          })()}
          <div className="ps-sum">
            {(() => { const used = onPress.heads.filter((x) => x === "flash").length, units = onPress.lay.filter((x) => x === "flash" || x === "flashdown").length; return <span>{used} flash{used === 1 ? "" : "es"} of {units}</span>; })()}
            {onPress.moves.length > 0 && <span> · Set up: {onPress.moves.join("; ")}</span>}
          </div>
        </div>}
      </div>
      {onBreaks && (
        <div className="ps-rounds">
          <span>Do we go multiple rounds?</span>
          <select value={rounds > 1 ? "yes" : "no"} onChange={(e) => setRounds(e.target.value === "yes" ? Math.max(2, rounds) : 1)} aria-label="More than one round">
            <option value="no">No, one round</option><option value="yes">Yes</option>
          </select>
          {rounds > 1 && <label>How many rounds <select value={rounds} onChange={(e) => setRounds(+e.target.value)} aria-label="How many rounds"><option value={2}>2</option><option value={3}>3</option></select></label>}
        </div>
      )}
      <ol className="ps-hrows">{onPress.heads.map((x, h) => {
        const k = plateOf(x), p = k ? plates.find((q) => q.key === k) : null;
        const kind = p ? "print" : x || "empty";
        const label = p ? p.name : x === "flash" ? "Flash" : x === "roller" ? "Roller (dead screen)" : x === "cool" ? "Cool down (left empty)" : x === "down" ? "Head down (Equipment Status)" : "Open";
        const prev = (() => { for (let j = h - 1; j >= 0; j--) if (onPress.heads[j] !== "down") return j; return -1; })();
        const next = (() => { for (let j = h + 1; j < onPress.heads.length; j++) if (onPress.heads[j] !== "down") return j; return -1; })();
        const down = x === "down";
        const bk = brk.indexOf(h);
        return (
          <Fragment key={h}>
          {rounds > 1 && bk >= 0 && (
            <li className={"ps-round" + (drag?.round === bk ? " dragging" : "")} draggable onDragStart={(e) => { setDrag({ round: bk }); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", `round${bk}`); }} onDragEnd={() => { setDrag(null); setDropHead(null); }}
              title="Drag onto the head where this round starts">
              <span aria-hidden>↻</span><b>Round {bk + 2} starts here</b>
              {onHits && (() => {
                const cur = hits?.[bk] ?? null;
                const earlier = onPress.heads.flatMap((y, j) => { const kk = plateOf(y), q = kk ? plates.find((z) => z.key === kk) : null; return q && roundOf(j) < bk + 2 ? [q] : []; });
                return (
                  <span className="ps-round-opt" draggable={false} onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                    <button type="button" className={"ps-rbtn" + (cur === null ? " on" : "")} onClick={() => setHit(bk, null)}>Flash only</button>
                    <button type="button" className={"ps-rbtn" + (cur !== null ? " on" : "")} onClick={() => { if (cur === null) setHit(bk, []); }}>Re-hit colors</button>
                    {cur !== null && <span className="ps-rhits">{earlier.map((q) => (
                      <label key={q.key}><input type="checkbox" checked={cur.includes(q.key)} onChange={(e) => setHit(bk, e.target.checked ? [...cur, q.key] : cur.filter((x) => x !== q.key))} />{q.name}</label>
                    ))}</span>}
                  </span>
                );
              })()}
            </li>
          )}
          <li className={"ps-head k-" + kind + (selHead === h ? " sel" : "") + (drag?.head === h ? " dragging" : "") + (dropHead === h && drag ? " drop" : "")}
            draggable={!down && x !== ""} onDragStart={(e) => { setDrag({ head: h }); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(h)); }} onDragEnd={() => { setDrag(null); setDropHead(null); }}
            onDragOver={(e) => { if (drag && !down) { e.preventDefault(); if (dropHead !== h) setDropHead(h); } }} onDrop={(e) => { e.preventDefault(); if (!down) dropOnHead(h); }}>
            <span className="ps-hn">{h + 1}</span>
            {p ? <i className="ps-sw" style={{ background: p.hex }} /> : <i className={"ps-st k-" + kind} aria-hidden />}
            <span className="ps-hl" title={label}>{label}{p?.kind === "underbase" && <small> · underbase</small>}{p && !onMesh && p.mesh ? <small> · {p.mesh}</small> : null}{rounds > 1 && (p ? <small className={"ps-rtag" + (roundOf(h) > 1 || againOf(p.key).length ? " on" : "")}>{againOf(p.key).length ? `rounds ${[roundOf(h), ...againOf(p.key)].join(" & ")}` : `round ${roundOf(h)}`}</small> : x === "flash" ? <small className="ps-rtag">every round</small> : null)}</span>
            <span className="ps-hm">{p && (onMesh
              ? <input className="ps-mesh" value={p.mesh || ""} inputMode="numeric" placeholder="mesh" aria-label={`${p.name} mesh`} onChange={(e) => { const n = +e.target.value.replace(/[^0-9]/g, ""); onMesh(p.key, n > 0 ? n : undefined); }} />
              : null)}</span>
            <span className="ps-ud">
              <button type="button" className="btn icon ghost sm" title="Move to the head before (trade places)" disabled={down || x === "" || prev < 0} onClick={() => moveSlot(h, prev)}>↑</button>
              <button type="button" className="btn icon ghost sm" title="Move to the head after (trade places)" disabled={down || x === "" || next < 0} onClick={() => moveSlot(h, next)}>↓</button>
            </span>
            <select id={`ps-head-${h}`} className="ps-chg" value="" disabled={down} aria-label={`Change what goes on head ${h + 1}`}
              onChange={(e) => { const v = e.target.value; if (v === "keep") return; if (v.startsWith("p:")) putPlate(v.slice(2), h); else setHeadTo(h, v); }}>
              <option value="" disabled>Change…</option>
              {plates.filter((q) => q.key !== k).map((q) => { const at = onPress.heads.indexOf("p:" + q.key); return <option key={q.key} value={"p:" + q.key}>{q.name}{at >= 0 ? ` (now head ${at + 1})` : ""}</option>; })}
              {x !== "flash" && <option value="flash">Flash</option>}{x !== "roller" && <option value="roller">Roller</option>}{x !== "cool" && <option value="cool">Cool down</option>}{x !== "" && <option value="">Open</option>}
            </select>
          </li>
          </Fragment>
        );
      })}</ol>
      <p className="sep-help">Drag a row onto another head to move it (they trade places), or use ↑ ↓ or Change….</p>
      {plates.some((q) => !onPress.heads.includes("p:" + q.key)) && (
        <div className="ps-off"><b>Not on the press:</b>{plates.filter((q) => !onPress.heads.includes("p:" + q.key)).map((q) => (
          <span key={q.key} className="ps-offc" draggable onDragStart={(e) => { setDrag({ plate: q.key }); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", q.key); }} onDragEnd={() => { setDrag(null); setDropHead(null); }} title="Drag it onto a head">
            <i className="ps-sw" style={{ background: q.hex }} />{q.name}
          </span>))}</div>
      )}
      {onPress.note && <div className="sep-tip">{onPress.note}</div>}
      {onPress.recNote && <div className="sep-tip">{onPress.recNote}</div>}
      {!setup && onPress.why.length > 0 && <details className="ps-why" open><summary>Why this layout</summary><ul>{onPress.why.map((w) => <li key={w}>{w}</li>)}</ul></details>}
      {onPress.warn.map((w) => <div key={w} className="sep-tip">{w}</div>)}
      {!stations && onPress.moves.length > 0 && <div className="ps-moves"><b>Set up the press:</b><ul>{onPress.moves.map((m) => <li key={m}>{m}</li>)}</ul></div>}
      {msg && <div className="sep-tip">{msg}</div>}
      <div className="ps-acts">
        <button type="button" className="linkbtn" onClick={() => { const n = autoSetup(onPress.lay, plates.map((p) => ({ key: p.key, name: p.name, hex: p.hex, kind: p.kind })), true); commit(n); }} title="Leave an empty head between colors where there's room, so each hit cools before the next">Space colors out</button>
        {setup && <button type="button" className="linkbtn" onClick={() => { clearSetup(); setSelHead(null); }}>Use the suggested layout</button>}
        <button type="button" className="linkbtn" onClick={printSetup}>Print setup sheet</button>
      </div>
      {defOpen && setPresses && <PressDefaults presses={presses} start={press.id} me={email || ""} onClose={() => setDefOpen(false)} onSaved={(m: Machine, lay: Station[]) => { const lc = layoutCounts(lay); setPresses((ps) => ps.map((p) => (p.id === m.id ? { ...p, layout: lay, flashes: lc.units, rollers: lc.rollers || undefined } : p))); setDefOpen(false); setMsg(`${m.name.split(" · ")[0]} defaults saved. Every job's setup on it starts from these.`); }} />}
    </section>
  );
}
