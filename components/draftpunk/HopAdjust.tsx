"use client";
import { useMemo, useState } from "react";
import { r1 } from "@/lib/draftpunk/calc";
import { adjustForLots, backToDesign, compare, defaultMode, type HopMode, type Lot } from "@/lib/draftpunk/hopadjust";
import { HOPS } from "@/lib/draftpunk/library";
import type { Recipe, RHop } from "@/lib/draftpunk/types";
import type { MineItem } from "./RecipeTabs";
import { Num, Win } from "./ui";

const USE: Record<string, string> = { boil: "boil", first_wort: "first wort", whirlpool: "whirlpool", dry_hop: "dry hop", mash: "mash" };
type Label = { variety: string; alpha: number | null; form: string; weight_oz: number | null; crop_year: string; confidence: string; note: string };

/** a phone photo made small enough to send quickly (longest side 1600 px, JPEG) */
async function shrink(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(img.width, img.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext("2d")!.drawImage(img, 0, 0, cv.width, cv.height);
  return new Promise((res) => cv.toBlob((b) => res(b || file), "image/jpeg", 0.85));
}
async function readLabel(file: File): Promise<Label> {
  const fd = new FormData();
  fd.append("photo", await shrink(file), "hops.jpg");
  const res = await fetch("/api/draftpunk/hop-label", { method: "POST", body: fd });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || "Couldn't read that photo");
  return j;
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** the hop addition a package belongs to: same variety (ignoring ® and spacing), else the closest name */
const matchRow = (hops: RHop[], variety: string) => hops.find((h) => norm(h.name) === norm(variety)) || hops.find((h) => norm(h.name).includes(norm(variety)) || norm(variety).includes(norm(h.name)));

/**
 * "Adjust for my hops" (Nick, Nov 24 2026): on brew day, the alpha on each package (typed, read from a photo of the
 * package, or filled in from the Ingredients shelf), or a different variety when the store didn't have the one in the
 * recipe. Bittering keeps its IBU, aroma keeps its weight (switchable per addition); the new weights and the IBU before
 * and after show as you go, and nothing changes until "Use these amounts".
 */
export default function HopAdjust({ r, set, mine = [], onDone }: { r: Recipe; set: (fn: (x: Recipe) => Recipe) => void; mine?: MineItem[]; onDone?: () => void }) {
  const shelf = (name: string) => {
    const it = mine.find((m) => m.kind === "hop" && m.name.toLowerCase() === name.toLowerCase());
    const a = Number((it?.data as { lotAlpha?: number } | undefined)?.lotAlpha ?? NaN);
    return Number.isFinite(a) ? a : undefined;
  };
  const [lots, setLots] = useState<Record<string, Lot | undefined>>(() => Object.fromEntries(r.hops.map((h) => [h.lid, { alpha: shelf(h.name) }])));
  const [modes, setModes] = useState<Record<string, HopMode | undefined>>({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, setPending] = useState<Label | null>(null);
  const next = useMemo(() => adjustForLots(r, lots, modes), [r, lots, modes]);
  const cmp = useMemo(() => compare(r, next), [r, next]);
  const changed = next.hops.some((h, i) => h.oz !== r.hops[i].oz || h.alpha !== r.hops[i].alpha || h.name !== r.hops[i].name);
  const adjusted = r.hops.some((h) => h.designAlpha != null);
  const setLot = (lid: string, patch: Lot) => setLots((x) => ({ ...x, [lid]: { ...x[lid], ...patch } }));

  // a photo for one addition, or for "whichever this is"
  const scan = async (file: File | undefined, lid?: string) => {
    if (!file) return;
    setBusy(lid || "any"); setMsg("");
    try {
      const l = await readLabel(file);
      const row = lid ? r.hops.find((h) => h.lid === lid) : matchRow(r.hops, l.variety);
      const about = `${l.variety || "Unknown variety"}${l.alpha != null ? ` · ${l.alpha}% AA` : ""}${l.crop_year ? ` · ${l.crop_year}` : ""}${l.confidence !== "high" ? ` (${l.confidence} confidence${l.note ? `: ${l.note}` : ""})` : l.note ? ` (${l.note})` : ""}`;
      if (!row) { setPending(l); setMsg(`Read: ${about}. Which addition is it for?`); }
      else {
        const sameVariety = !l.variety || norm(row.name) === norm(l.variety) || norm(row.name).includes(norm(l.variety)) || norm(l.variety).includes(norm(row.name));
        setLot(row.lid, { alpha: l.alpha ?? undefined, name: sameVariety ? undefined : l.variety });
        setMsg(`Read: ${about}${sameVariety ? "" : ` → substituting for ${row.name}`}.`);
      }
    } catch (e) { setMsg((e as Error).message); }
    setBusy("");
  };
  const camera = (lid?: string, label = "📷") => (
    <label className={`dp-btn ${lid ? "dp-sm" : "dp-go"}`} style={{ cursor: "pointer" }} aria-label={lid ? "Photo of this package" : "Scan a hop package"}>
      {busy === (lid || "any") ? "Reading…" : label}
      <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { scan(e.target.files?.[0], lid); e.target.value = ""; }} />
    </label>
  );
  // substitutes the library suggests for a hop, then everything else
  const subsFor = (h: RHop) => {
    const lib = HOPS.find((x) => norm(x.name) === norm(h.designName || h.name));
    const sug = (lib?.substitutes || "").split(",").map((x) => x.trim()).filter(Boolean);
    return [...sug.map((n) => HOPS.find((x) => norm(x.name).startsWith(norm(n)))).filter(Boolean), ...HOPS.filter((x) => !sug.some((n) => norm(x.name).startsWith(norm(n))))] as typeof HOPS;
  };

  if (!r.hops.length) return null;
  return (
    <Win title="Adjust for my hops" note={`${r1(cmp.ibuBefore, 1)} IBU → ${r1(cmp.ibuAfter, 1)} IBU`}>
      <div className="dp-row" style={{ alignItems: "center", marginBottom: 10 }}>
        {camera(undefined, "📷 Scan a hop package")}
        <span className="dp-dim" style={{ flex: "1 1 240px", fontSize: 14 }}>Snap the label: it reads the variety and alpha and fills the right line. Or type the alpha below, or pick a substitute.</span>
      </div>
      {msg && <p style={{ margin: "0 0 10px", fontWeight: 600 }}>{msg}</p>}
      {pending && (
        <div className="dp-row" style={{ marginBottom: 10 }}>
          {r.hops.map((h) => <button key={h.lid} className="dp-btn dp-sm" onClick={() => { setLot(h.lid, { alpha: pending.alpha ?? undefined, name: norm(pending.variety) === norm(h.name) ? undefined : pending.variety }); setPending(null); setMsg(""); }}>{h.name} · {USE[h.use]}</button>)}
          <button className="dp-btn dp-sm dp-x" onClick={() => { setPending(null); setMsg(""); }}>Cancel</button>
        </div>
      )}
      <table className="dp-tbl" data-nofit>
        <thead><tr><th>Hop</th><th className="dp-num">Recipe</th><th>What you have</th><th>Keep</th><th className="dp-num">Use</th><th className="dp-num">IBU</th></tr></thead>
        <tbody>
          {r.hops.map((h, i) => {
            const n = next.hops[i], mode = modes[h.lid] || defaultMode(h);
            const moved = n.oz !== h.oz || n.name !== h.name;
            const lot = lots[h.lid] || {};
            return (
              <tr key={h.lid}>
                <td><b>{h.name}</b><div className="dp-dim" style={{ fontSize: 12 }}>{USE[h.use]}{h.use === "boil" ? ` ${h.min} min` : ""}{h.designAlpha ? ` · designed as ${h.designName || h.name} ${h.designAlpha}%` : ""}</div></td>
                <td className="dp-num" data-l="Recipe">{r1(h.oz, 2)} oz @ {h.alpha}%</td>
                <td data-l="What you have">
                  <span className="dp-row" style={{ gap: 6, alignItems: "center" }}>
                    <select style={{ width: "auto", maxWidth: 170 }} aria-label="Variety" value={lot.name || ""} onChange={(e) => { const v = e.target.value; const lib = HOPS.find((x) => x.name === v); setLot(h.lid, { name: v || undefined, alpha: v ? lot.alpha ?? lib?.alpha : lot.alpha }); }}>
                      <option value="">{h.name}</option>
                      {subsFor(h).filter((x) => norm(x.name) !== norm(h.name)).map((x) => <option key={x.id} value={x.name}>{x.name} ({x.alpha}%)</option>)}
                    </select>
                    <Num className="dp-nw" value={lot.alpha} onChange={(v) => setLot(h.lid, { alpha: v || undefined })} title="Alpha acid % on the package" />
                    <span className="dp-dim">%</span>
                    {camera(h.lid)}
                  </span>
                </td>
                <td data-l="Keep">
                  <select style={{ width: "auto" }} value={mode} onChange={(e) => setModes((x) => ({ ...x, [h.lid]: e.target.value as HopMode }))}>
                    <option value="ibu">Same IBU</option><option value="weight">Same weight</option>
                  </select>
                </td>
                <td className="dp-num" data-l="Use" style={moved ? { fontWeight: 800, fontSize: 17 } : undefined}>{r1(n.oz, 2)} oz{n.name !== h.name ? <div style={{ fontSize: 12 }}>{n.name}</div> : null}</td>
                <td className="dp-num" data-l="IBU">{r1(cmp.per[h.lid]?.after || 0, 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="dp-row" style={{ marginTop: 12 }}>
        <button className="dp-btn dp-go dp-big-btn" disabled={!changed} onClick={() => { set(() => next); setLots({}); setMsg(""); onDone?.(); }}>Use these amounts</button>
        {adjusted && <button className="dp-btn" onClick={() => set((x) => backToDesign(x))}>Back to the recipe&apos;s hops</button>}
        {onDone && <button className="dp-btn dp-x" onClick={onDone}>Close</button>}
      </div>
    </Win>
  );
}
