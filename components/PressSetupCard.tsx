"use client";
import { useRef, useState, type ReactNode } from "react";
import PressLayout from "@/components/PressLayout";
import PressDefaults, { pressLayOf } from "@/components/PressDefaults";
import { useRole } from "@/components/RoleContext";
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

export default function PressSetupCard({ presses, setPresses, press, onPickPress, onPress, setup, commit, clearSetup, sheet, extra, onMesh, title = "Press Setup" }: {
  presses: Machine[]; setPresses?: (fn: (ps: Machine[]) => Machine[]) => void;
  press: Machine; onPickPress: (id: string) => void;
  onPress: OnPress; setup: Slot[] | null;
  /** a setup changed by hand */ commit: (heads: Slot[]) => void;
  /** back to the suggested layout */ clearSetup: () => void;
  /** the setup sheet's heading and the line under it */ sheet: { title: string; heading: string; sub: string };
  /** more beside the press picker (the production mockup's "Must run on this press") */ extra?: ReactNode;
  /** mesh typed per color (the production mockup: the screens as they ran) */ onMesh?: (key: string, mesh: number | undefined) => void;
  title?: string;
}) {
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
  // tap a head on the drawing: its row in the list below lights up and its dropdown opens for a choice
  function pickHead(i: number) {
    if (onPress.heads[i] === "down") { setMsg(`Head ${i + 1} is down (Production → Equipment Status).`); return; }
    setSelHead(i);
    setTimeout(() => { const el = document.getElementById(`ps-head-${i}`) as HTMLSelectElement | null; el?.scrollIntoView({ block: "nearest" }); el?.focus(); }, 0);
  }
  /** drag a screen (from a head or the not-on-the-press list) onto a head: it goes there, and they trade places */
  const [dragPlate, setDragPlate] = useState<string | null>(null), [dropHead, setDropHead] = useState<number | null>(null);
  function dropOnHead(i: number) { if (dragPlate) chooseHead(dragPlate, i); setDragPlate(null); setDropHead(null); }
  /**
   * A color picks its head. A free head: it moves there. A head with another color on it: ask where that color goes
   * (back to this color's head, or any open head). A flash / roller / cool-down head: ask before covering it.
   */
  const [ask, setAsk] = useState<{ key: string; to: number; other?: string; station?: string } | null>(null);
  function chooseHead(key: string, to: number) {
    const n = onPress.heads, there = n[to];
    if (there === "down" || n.indexOf("p:" + key) === to) return;
    if (plateOf(there)) { setAsk({ key, to, other: plateOf(there)! }); return; }
    if (there === "flash" || there === "roller" || there === "cool") { setAsk({ key, to, station: there }); return; }
    moveColor(key, to);
  }
  /** two colors trade heads (↑ / ↓ in the press list: print one earlier or later) */
  function swapWith(a: string, b?: string) {
    if (!b) return;
    const n = [...onPress.heads], ha = n.indexOf("p:" + a), hb = n.indexOf("p:" + b);
    if (ha < 0 || hb < 0) return;
    n[ha] = "p:" + b; n[hb] = "p:" + a; commit(n); setAsk(null);
  }
  /** move it, and the color that was there to `otherTo` (a head), or back where the moving one came from */
  function moveColor(key: string, to: number, otherTo?: number) {
    const n = [...onPress.heads], from = n.indexOf("p:" + key), there = n[to], other = plateOf(there);
    n[to] = "p:" + key;
    if (from >= 0) n[from] = "";
    if (other) { const dest = otherTo ?? from; if (dest >= 0 && (n[dest] === "" || dest === from)) n[dest] = "p:" + other; }
    commit(n); setAsk(null); setSelHead(null);
  }
  /** a sheet for the press operator: the press drawn with every head, and the list */
  function printSetup() {
    const svg = drawing.current?.querySelector("svg")?.outerHTML || "";
    const css = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((x) => x.outerHTML).join("");
    const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
    const rows = onPress.heads.map((x, i) => { const k = plateOf(x), p = k ? plates.find((q) => q.key === k) : null;
      const what = p ? `<b>${esc(p.name)}</b>${p.kind === "underbase" ? " (underbase)" : p.kind === "highlight" ? " (highlight white)" : ""}${p.mesh ? ` · mesh ${p.mesh}` : ""}` : x === "flash" ? "<b>FLASH</b>" : x === "roller" ? "<b>ROLLER</b> (dead screen)" : x === "cool" ? "<i>empty: cool down</i>" : x === "down" ? "<i>head down</i>" : "<span style=\"color:#999\">empty</span>";
      return `<tr><td style="padding:5px 10px;font-weight:800">Head ${i + 1}</td><td style="padding:5px 10px">${p ? `<span style="display:inline-block;width:14px;height:14px;border:1px solid #999;vertical-align:-2px;margin-right:6px;background:${p.hex}"></span>` : ""}${what}</td></tr>`; }).join("");
    const w = window.open("", "_blank"); if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(sheet.title)}</title>${css}<style>body{background:#fff;color:#111;font:14px system-ui;padding:24px}table{border-collapse:collapse}tr:nth-child(odd){background:#f4f5f7}.pl{width:360px;height:auto}</style></head><body>
      <h2 style="margin:0">${esc(sheet.heading)}</h2>
      <div style="color:#555;margin:4px 0 14px">${esc(press.name)} · ${esc(sheet.sub)}</div>
      <div style="display:flex;gap:28px;align-items:flex-start;flex-wrap:wrap">${svg}<table>${rows}</table></div>
      ${onPress.moves.length ? `<h3>Before you start</h3><ul>${onPress.moves.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
      <script>setTimeout(()=>print(),400)</script></body></html>`);
    w.document.close();
  }

  return (
    <section className="sep-card sep-pressup">
      <h3>{title} <small className="faint">{setup ? "set by hand" : "suggested"}</small></h3>
      <div className="sep-row">
        <select value={press.id} onChange={(e) => { onPickPress(e.target.value); setSelHead(null); setAsk(null); }} aria-label="Press">{presses.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        {perms.pressDefaults && setPresses && <button type="button" className="btn sm" onClick={() => setDefOpen(true)} title="What always sits on each head of this press: flashes, the roller">Press Defaults</button>}
        {extra}
      </div>
      <div className="sep-press" ref={drawing}><PressLayout layout={drawLayout(onPress.heads)} size={250} mirror={!!press.mirror} inks={onPress.out} selected={selHead} onPick={pickHead}
        onDropHead={dragPlate ? dropOnHead : undefined} dropAt={dropHead} onDragHead={(i) => setDropHead(i)} /></div>
      {selHead != null && (() => {
        // tapped a head on the drawing: what's on it (a color's head is picked in the list below)
        const x = onPress.heads[selHead], k = plateOf(x), p = k ? plates.find((q) => q.key === k) : null;
        return (
          <div className="ps-headmenu">
            <b>Head {selHead + 1}</b>
            {p ? <span>{p.name}: pick a different head for it in the list below.</span> : <>
              {([["", "Empty"], ["cool", "Cool down"], ["flash", "Flash"], ["roller", "Roller"]] as const).map(([v, l]) => <button key={v || "e"} type="button" className={"pl-opt " + (v || "print") + (x === v ? " on" : "")} onClick={() => { setHeadTo(selHead, v); setSelHead(null); }}><i aria-hidden />{l}</button>)}
            </>}
            <button type="button" className="btn icon ghost sm" aria-label="Close" onClick={() => setSelHead(null)}>✕</button>
          </div>
        );
      })()}
      <p className="sep-help">Each color: pick the head it goes on. Tap a head on the press for a flash, the roller or a cool-down.</p>
      <ol className="ps-colors">{plates.map((p, i) => {
        const at = onPress.heads.indexOf("p:" + p.key);
        const what = (x: Slot) => { const k = plateOf(x); return k ? (plates.find((q) => q.key === k)?.name || "a screen") : x === "flash" ? "Flash" : x === "roller" ? "Roller" : x === "cool" ? "Cool down" : x === "down" ? "down" : "open"; };
        const a = ask && ask.key === p.key ? ask : null;
        const otherName = a?.other ? plates.find((q) => q.key === a.other)?.name : "";
        const open = onPress.heads.map((x, h) => (x === "" && h !== a?.to ? h : -1)).filter((h) => h >= 0);
        return (
          <li key={p.key} className={"ps-color" + (dragPlate === p.key ? " dragging" : "") + (a ? " asking" : "")}
            draggable onDragStart={(e) => { setDragPlate(p.key); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p.key); }} onDragEnd={() => { setDragPlate(null); setDropHead(null); }}>
            <div className="ps-color-r">
              <i className="ps-sw" style={{ background: p.hex }} />
              <span className="ps-cname"><b>{i + 1} · {p.name}</b>{onMesh
                ? <input className="ps-mesh" value={p.mesh || ""} inputMode="numeric" placeholder="mesh" aria-label={`${p.name} mesh`} onChange={(e) => { const n = +e.target.value.replace(/[^0-9]/g, ""); onMesh(p.key, n > 0 ? n : undefined); }} />
                : <small>mesh {p.mesh}</small>}</span>
              <span className="ps-ud">
                <button type="button" className="btn icon ghost sm" title="Print earlier (trades heads with the color before it)" disabled={!i || at < 0} onClick={() => swapWith(p.key, plates[i - 1]?.key)}>↑</button>
                <button type="button" className="btn icon ghost sm" title="Print later (trades heads with the color after it)" disabled={i === plates.length - 1 || at < 0} onClick={() => swapWith(p.key, plates[i + 1]?.key)}>↓</button>
              </span>
              <select id={at >= 0 ? `ps-head-${at}` : undefined} value={at} aria-label={`Head for ${p.name}`} onChange={(e) => chooseHead(p.key, +e.target.value)}>
                {at < 0 && <option value={-1}>Not on the press</option>}
                {onPress.heads.map((x, h) => <option key={h} value={h} disabled={x === "down"}>Head {h + 1}{h === at ? "" : ` · ${what(x)}`}</option>)}
              </select>
            </div>
            {a && (
              <div className="ps-ask">
                {a.other ? <>
                  <span>Head {a.to + 1} has <b>{otherName}</b>. Where should {otherName} go?</span>
                  <div className="ps-ask-b">
                    {at >= 0 && <button type="button" className="btn sm primary" onClick={() => moveColor(p.key, a.to, at)}>Head {at + 1} (trade places)</button>}
                    <select value="" aria-label={`Another head for ${otherName}`} onChange={(e) => e.target.value !== "" && moveColor(p.key, a.to, +e.target.value)}>
                      <option value="">Another open head…</option>
                      {open.map((h) => <option key={h} value={h}>Head {h + 1}</option>)}
                    </select>
                    <button type="button" className="btn sm" onClick={() => setAsk(null)}>Cancel</button>
                  </div>
                </> : <>
                  <span>Head {a.to + 1} is {a.station === "flash" ? "a flash" : a.station === "roller" ? "the roller" : "a cool-down head"}. Put {p.name} there instead?</span>
                  <div className="ps-ask-b">
                    <button type="button" className="btn sm primary" onClick={() => moveColor(p.key, a.to)}>Yes, use head {a.to + 1}</button>
                    <button type="button" className="btn sm" onClick={() => setAsk(null)}>Cancel</button>
                  </div>
                </>}
              </div>
            )}
          </li>
        );
      })}</ol>
      {onPress.note && <div className="sep-tip">{onPress.note}</div>}
      {onPress.recNote && <div className="sep-tip">{onPress.recNote}</div>}
      {!setup && onPress.why.length > 0 && <details className="ps-why" open><summary>Why this layout</summary><ul>{onPress.why.map((w) => <li key={w}>{w}</li>)}</ul></details>}
      {onPress.warn.map((w) => <div key={w} className="sep-tip">{w}</div>)}
      {onPress.moves.length > 0 && <div className="ps-moves"><b>Set up the press:</b><ul>{onPress.moves.map((m) => <li key={m}>{m}</li>)}</ul></div>}
      {msg && <div className="sep-tip">{msg}</div>}
      <div className="ps-acts">
        <button type="button" className="linkbtn" onClick={() => { const n = autoSetup(onPress.lay, plates.map((p) => ({ key: p.key, name: p.name, hex: p.hex, kind: p.kind })), true); commit(n); }} title="Leave an empty head between colors where there's room, so each hit cools before the next">Space colors out</button>
        {setup && <button type="button" className="linkbtn" onClick={() => { clearSetup(); setSelHead(null); setAsk(null); }}>Use the suggested layout</button>}
        <button type="button" className="linkbtn" onClick={printSetup}>Print setup sheet</button>
      </div>
      {defOpen && setPresses && <PressDefaults presses={presses} start={press.id} me={email || ""} onClose={() => setDefOpen(false)} onSaved={(m: Machine, lay: Station[]) => { const lc = layoutCounts(lay); setPresses((ps) => ps.map((p) => (p.id === m.id ? { ...p, layout: lay, flashes: lc.units, rollers: lc.rollers || undefined } : p))); setDefOpen(false); setMsg(`${m.name.split(" · ")[0]} defaults saved. Every job's setup on it starts from these.`); }} />}
    </section>
  );
}
