"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { calcRecipe, kegPsi, r1, sgFmt } from "@/lib/draftpunk/calc";
import { fmtDate, normalize } from "@/lib/draftpunk/defaults";
import type { Recipe } from "@/lib/draftpunk/types";
import { useToast } from "./Shell";
import { F, Num } from "./ui";

/**
 * The brewery, drawn (Nick, Nov 24 2026: from photos of his chambers, keezer and RIMS stand: "very visual
 * representations… a very graphical layout"). Each fermentation chamber as the fridge or chest freezer it is, its
 * Inkbird showing the chamber's temperature and setpoint, the Fermzilla inside filled with the beer's own color, the
 * Tilt floating in it; the keezer from above with every keg's beer, how full it is and its pressure; the RIMS on its
 * own stand. Everything is live from the logs (Tilt, Inkbird, autopilot); a keg is changed by tapping it.
 */
type Chamber = { id: string; name: string; device_id: string; kind: "upright" | "chest" };
type CRead = { chamber_id: string; temp_f: number | null; set_f: number | null; read_at: string };
type Brew = { id: string; brewed_on: string; recipe_snapshot: Recipe; measured: { og?: number; fg?: number; chamberId?: string; tiltColor?: string; autopilot?: { on: boolean; stage: number; stageStart?: string }; alarms?: { text: string }[] } };
type Tilt = { brew_id: string; sg: number | null; temp_f: number | null; read_at: string };
type Keg = { id: string; place: string; slot: number; beer: string; brew_id: string | null; color: string; size_gal: number; left_gal: number; psi: number | null; tapped_on: string | null; status: "serving" | "carbonating" | "conditioning" | "empty" | "clean" };

const TILT: Record<string, string> = { RED: "#e5484d", GREEN: "#30a46c", BLACK: "#222", PURPLE: "#8e4ec6", ORANGE: "#f76b15", BLUE: "#0090ff", YELLOW: "#ffc53d", PINK: "#e93d82" };
const days = (iso?: string) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : 0);
const ago = (iso?: string) => { if (!iso) return ""; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

// ---------------- drawings ----------------
/** a Fermzilla: dome top, straight sides, the beer inside to its level with krausen while it's busy */
export function Fermzilla({ x, y, w, h, color, level = 0.78, krausen, tilt }: { x: number; y: number; w: number; h: number; color?: string; level?: number; krausen?: boolean; tilt?: string }) {
  const top = y + h * (1 - level);
  const id = `fz${x}${y}`;
  return (
    <g>
      <defs>
        <clipPath id={id}><path d={`M${x},${y + w * 0.35} Q${x},${y} ${x + w / 2},${y} Q${x + w},${y} ${x + w},${y + w * 0.35} V${y + h - 8} Q${x + w},${y + h} ${x + w - 8},${y + h} H${x + 8} Q${x},${y + h} ${x},${y + h - 8}Z`} /></clipPath>
        <linearGradient id={`${id}g`} x1="0" x2="1"><stop offset="0" stopColor="#000" stopOpacity=".28" /><stop offset=".45" stopColor="#fff" stopOpacity=".22" /><stop offset="1" stopColor="#000" stopOpacity=".2" /></linearGradient>
      </defs>
      <g clipPath={`url(#${id})`}>
        <rect x={x} y={y} width={w} height={h} fill="#e9eef3" opacity=".55" />
        {color && <rect x={x} y={top} width={w} height={h} fill={color} />}
        {color && krausen && <path d={`M${x},${top} q${w / 8},-9 ${w / 4},0 t${w / 4},0 t${w / 4},0 t${w / 4},0 V${top + 6} H${x}Z`} fill="#f6efe0" />}
        <rect x={x} y={y} width={w} height={h} fill={`url(#${id}g)`} />
      </g>
      <path d={`M${x},${y + w * 0.35} Q${x},${y} ${x + w / 2},${y} Q${x + w},${y} ${x + w},${y + w * 0.35} V${y + h - 8} Q${x + w},${y + h} ${x + w - 8},${y + h} H${x + 8} Q${x},${y + h} ${x},${y + h - 8}Z`} fill="none" stroke="#9aa6b2" strokeWidth="2" />
      {/* lid, spunding valve, gauge */}
      <rect x={x + w / 2 - 14} y={y - 7} width="28" height="9" rx="3" fill="#2b2f36" />
      <rect x={x + w / 2 + 3} y={y - 20} width="3" height="13" fill="#9aa6b2" />
      <circle cx={x + w / 2 + 4.5} cy={y - 24} r="6" fill="#fff" stroke="#2b2f36" strokeWidth="2" />
      <path d={`M${x + w / 2 + 4.5},${y - 24} l3,-3`} stroke="#e5484d" strokeWidth="1.5" />
      {/* the Tilt, floating at an angle */}
      {tilt && color && <rect x={x + w * 0.58} y={top + 10} width="9" height="34" rx="4.5" fill={TILT[tilt] || "#888"} stroke="#fff" strokeWidth="1.5" transform={`rotate(25 ${x + w * 0.58 + 4.5} ${top + 27})`} />}
    </g>
  );
}

/** an Inkbird on the side of a chamber: the chamber's temperature over its setpoint, in red digits */
export function Inkbird({ x, y, temp, set, off }: { x: number; y: number; temp?: number | null; set?: number | null; off?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width="54" height="70" rx="7" fill="#3a4048" />
      <rect x={x + 5} y={y + 7} width="44" height="36" rx="3" fill="#120808" />
      <text x={x + 27} y={y + 23} textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="14" fontWeight="700" fill={off ? "#ff9b7a" : "#ff3b30"}>{temp != null ? r1(temp, 1) : "--.-"}</text>
      <text x={x + 27} y={y + 38} textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="10" fill="#4ade80">{set != null ? `SET ${r1(set, 0)}` : "SET --"}</text>
      <rect x={x + 9} y={y + 50} width="10" height="6" rx="2" fill="#6b7280" /><rect x={x + 22} y={y + 50} width="10" height="6" rx="2" fill="#6b7280" /><rect x={x + 35} y={y + 50} width="10" height="6" rx="2" fill="#6b7280" />
      <path d={`M${x + 27},${y + 70} v18`} stroke="#3a4048" strokeWidth="3" />
    </g>
  );
}

export function ChamberArt({ c, brew, color, read, tilt }: { c: Chamber; brew?: Brew; color?: string; read?: CRead; tilt?: Tilt }) {
  const busy = !!brew && !brew.measured?.fg && days(brew.brewed_on) < 6;
  const off = !!read && read.temp_f != null && read.set_f != null && Math.abs(read.temp_f - read.set_f) > 3;
  if (c.kind === "chest") {
    // a chest freezer from the front, its lid lifted to show the fermenter inside
    return (
      <svg viewBox="0 0 300 260" className="dp-art" role="img" aria-label={`${c.name}: chest freezer`}>
        <path d="M30 70 L270 70 L250 18 L50 18 Z" fill="#f3f5f7" stroke="#c9d1d9" strokeWidth="2" />
        <rect x="30" y="70" width="240" height="160" rx="10" fill="#fbfcfd" stroke="#c9d1d9" strokeWidth="2" />
        <rect x="42" y="70" width="216" height="10" fill="#e3e8ee" />
        <Fermzilla x={115} y={60} w={70} h={120} color={color} krausen={busy} tilt={brew?.measured?.tiltColor} />
        <rect x="30" y="150" width="240" height="80" rx="10" fill="#fbfcfd" stroke="#c9d1d9" strokeWidth="2" />
        <text x="150" y="196" textAnchor="middle" fontFamily="var(--dp-head)" fontWeight="800" fontSize="20" fill="#1f7a3a">draft punk</text>
        <Inkbird x={236} y={104} temp={read?.temp_f} set={read?.set_f} off={off} />
      </svg>
    );
  }
  // an upright stainless fridge with a window cut into its door
  return (
    <svg viewBox="0 0 240 360" className="dp-art" role="img" aria-label={`${c.name}: upright chamber`}>
      <defs>
        <linearGradient id={`ss${c.id}`} x1="0" x2="1"><stop offset="0" stopColor="#8d949c" /><stop offset=".35" stopColor="#d7dce1" /><stop offset=".6" stopColor="#b6bcc3" /><stop offset="1" stopColor="#7c838b" /></linearGradient>
      </defs>
      <rect x="20" y="10" width="160" height="340" rx="10" fill={`url(#ss${c.id})`} stroke="#6e757d" strokeWidth="2" />
      <rect x="166" y="80" width="6" height="120" rx="3" fill="#4b5158" />
      <rect x="38" y="40" width="122" height="290" rx="8" fill="#e9eef3" stroke="#6e757d" strokeWidth="1.5" />
      <rect x="44" y="275" width="110" height="5" fill="#c3cad1" />
      <Fermzilla x={64} y={110} w={70} h={160} color={color} krausen={busy} tilt={brew?.measured?.tiltColor} />
      <rect x="38" y="40" width="122" height="290" rx="8" fill="#fff" opacity=".08" />
      <Inkbird x={180} y={110} temp={read?.temp_f} set={read?.set_f} off={off} />
      {tilt?.sg != null && <g><rect x="44" y="50" width="76" height="22" rx="11" fill="#0f1b2d" opacity=".85" /><text x="82" y="65" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="12" fill="#fff">{sgFmt(tilt.sg)}</text></g>}
    </svg>
  );
}

/** the keezer from above: kegs as ball-lock tops, each ringed in its beer's color and filled to its level */
export function KeezerArt({ kegs, onPick }: { kegs: Keg[]; onPick: (k: Keg) => void }) {
  const cols = Math.max(3, Math.ceil(kegs.length / 2));
  const W = 70 + cols * 96, H = 250;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="dp-art dp-keezer" role="img" aria-label="Keezer from above">
      <rect x="6" y="6" width={W - 12} height={H - 12} rx="18" fill="#fbfcfd" stroke="#c9d1d9" strokeWidth="3" />
      <rect x="20" y="20" width={W - 40} height={H - 40} rx="12" fill="#eef2f6" />
      {kegs.map((k, i) => {
        const cx = 70 + (i % cols) * 96, cy = i < cols ? 78 : 172;
        const pct = k.size_gal ? Math.max(0, Math.min(1, k.left_gal / k.size_gal)) : 0;
        const R = 38, circ = 2 * Math.PI * (R - 4);
        const live = k.status !== "empty" && k.status !== "clean";
        return (
          <g key={k.id} className="dp-keg" onClick={() => onPick(k)} role="button" tabIndex={0} aria-label={`Keg ${k.slot}: ${k.beer || k.status}`} onKeyDown={(e) => e.key === "Enter" && onPick(k)}>
            <circle cx={cx} cy={cy} r={R} fill="#1d2127" />
            <circle cx={cx} cy={cy} r={R - 4} fill="none" stroke="#3a4048" strokeWidth="6" />
            {live && <circle cx={cx} cy={cy} r={R - 4} fill="none" stroke={k.color || "#e58500"} strokeWidth="6" strokeDasharray={`${circ * pct} ${circ}`} transform={`rotate(-90 ${cx} ${cy})`} strokeLinecap="round" />}
            <circle cx={cx} cy={cy} r={R - 12} fill="#c9cfd5" stroke="#9aa3ad" strokeWidth="1.5" />
            <circle cx={cx - 18} cy={cy - 18} r="4" fill="#4b5158" /><circle cx={cx + 18} cy={cy + 18} r="4" fill="#4b5158" />
            <text x={cx} y={cy + R + 16} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--dp-text)">{(k.beer || (k.status === "clean" ? "Clean" : "Empty")).slice(0, 14)}</text>
            {live && <text x={cx} y={cy + 4} textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="11" fontWeight="700" fill="#1d2127">{Math.round(pct * 100)}%</text>}
          </g>
        );
      })}
    </svg>
  );
}

/** the RIMS on its own stand: the strut, the control box with its PID, the tube */
export function RimsArt() {
  return (
    <svg viewBox="0 0 200 300" className="dp-art" role="img" aria-label="RIMS stand">
      <ellipse cx="100" cy="282" rx="80" ry="12" fill="none" stroke="#2b2f36" strokeWidth="5" />
      <rect x="93" y="70" width="14" height="210" fill="#b6bcc3" stroke="#7c838b" />
      <rect x="20" y="58" width="160" height="10" rx="3" fill="#b6bcc3" stroke="#7c838b" />
      <rect x="40" y="70" width="90" height="96" rx="5" fill="#d9d6cf" stroke="#9a968e" strokeWidth="2" />
      <rect x="62" y="80" width="46" height="30" rx="2" fill="#111" />
      <text x="85" y="93" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="10" fill="#ff3b30">152.0</text>
      <text x="85" y="105" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="9" fill="#4ade80">152.0</text>
      <circle cx="70" cy="128" r="6" fill="#d22" /><rect x="96" y="120" width="16" height="16" rx="2" fill="#f2f0eb" stroke="#9a968e" />
      <circle cx="60" cy="150" r="8" fill="#2453c7" /><circle cx="110" cy="150" r="8" fill="#8b1d1d" />
      <rect x="74" y="178" width="12" height="80" rx="5" fill="#e6eaee" stroke="#8d949c" />
      <rect x="71" y="176" width="18" height="6" rx="2" fill="#8d949c" /><rect x="71" y="214" width="18" height="6" rx="2" fill="#8d949c" /><rect x="71" y="252" width="18" height="6" rx="2" fill="#8d949c" />
      <rect x="150" y="70" width="10" height="200" rx="4" fill="#cfd5db" /><rect x="138" y="40" width="34" height="50" rx="6" fill="#cfd5db" />
    </svg>
  );
}

// ---------------- the page ----------------
export default function Brewery({ userId }: { userId: string }) {
  const { toast, node } = useToast();
  const [chambers, setChambers] = useState<Chamber[] | null>(null);
  const [reads, setReads] = useState<CRead[]>([]);
  const [brews, setBrews] = useState<Brew[]>([]);
  const [tilts, setTilts] = useState<Tilt[]>([]);
  const [kegs, setKegs] = useState<Keg[]>([]);
  const [edit, setEdit] = useState<Keg | null>(null);
  const load = async () => {
    const sb = createClient();
    const since = new Date(Date.now() - 6 * 3600000).toISOString();
    const [{ data: ch }, { data: rd }, { data: bw }, { data: kg }] = await Promise.all([
      sb.from("dp_chambers").select("id, name, device_id, kind").eq("owner_id", userId).order("name"),
      sb.from("dp_readings").select("chamber_id, temp_f, set_f, read_at").eq("owner_id", userId).eq("source", "inkbird").gte("read_at", since).order("read_at", { ascending: false }).limit(500),
      sb.from("dp_brews").select("id, brewed_on, recipe_snapshot, measured").eq("owner_id", userId).gte("brewed_on", new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)).order("brewed_on", { ascending: false }),
      sb.from("dp_kegs").select("*").eq("owner_id", userId).order("place").order("slot"),
    ]);
    setChambers((ch || []) as Chamber[]); setReads((rd || []) as CRead[]); setBrews((bw || []) as Brew[]); setKegs((kg || []) as Keg[]);
    const ids = ((bw || []) as Brew[]).map((b) => b.id);
    if (ids.length) {
      const { data: tl } = await sb.from("dp_readings").select("brew_id, sg, temp_f, read_at").in("brew_id", ids).eq("source", "tilt").gte("read_at", new Date(Date.now() - 2 * 86400000).toISOString()).order("read_at", { ascending: false }).limit(1000);
      setTilts((tl || []) as Tilt[]);
    }
  };
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const colorOf = useMemo(() => { const m = new Map<string, string>(); for (const b of brews) { try { m.set(b.id, calcRecipe(normalize(b.recipe_snapshot)).color); } catch { /* old snapshot */ } } return m; }, [brews]);
  const brewIn = (chId: string) => brews.find((b) => b.measured?.chamberId === chId);
  const places = [...new Set(kegs.map((k) => k.place))];
  if (!places.length) places.push("Keezer");

  const saveKeg = async (k: Keg) => {
    const sb = createClient();
    const { id, ...rest } = k;
    const { error } = id ? await sb.from("dp_kegs").update(rest).eq("id", id) : await sb.from("dp_kegs").insert({ ...rest, owner_id: userId });
    if (error) toast(error.message); else { setEdit(null); load(); }
  };
  const addKeg = (place: string) => setEdit({ id: "", place, slot: kegs.filter((k) => k.place === place).length + 1, beer: "", brew_id: null, color: "", size_gal: 5, left_gal: 0, psi: null, tapped_on: null, status: "clean" });
  const removeKeg = async (k: Keg) => { if (!confirm(`Remove keg ${k.slot} from ${k.place}?`)) return; await createClient().from("dp_kegs").delete().eq("id", k.id); setEdit(null); load(); };

  return (
    <>
      <div className="dp-row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h1 className="dp-h1" style={{ margin: 0 }}>Brewery</h1>
        <span className="dp-dim" style={{ fontSize: 13 }}>Live from your Tilts and Inkbirds · updates every minute</span>
      </div>

      <h2 className="dp-h2">Fermentation chambers</h2>
      {chambers && !chambers.length && <section className="dp-card"><p className="dp-dim" style={{ margin: 0 }}>Add your chambers on the <Link href="/draftpunk/equipment">Equipment</Link> page and they show up here.</p></section>}
      <div className="dp-art-grid">
        {(chambers || []).map((c) => {
          const b = brewIn(c.id);
          const read = reads.find((r) => r.chamber_id === c.id);
          const tilt = b ? tilts.find((t) => t.brew_id === b.id) : undefined;
          const step = b?.measured?.autopilot?.on ? b.recipe_snapshot?.ferment?.[b.measured.autopilot.stage] : undefined;
          return (
            <section key={c.id} className="dp-card dp-art-card">
              <ChamberArt c={c} brew={b} color={b ? colorOf.get(b.id) : undefined} read={read} tilt={tilt} />
              <div>
                <div className="dp-art-name">{c.name}</div>
                {b ? (
                  <>
                    <Link href={`/draftpunk/brews/${b.id}`} className="dp-art-beer">{b.recipe_snapshot?.name || "Brew"}</Link>
                    <div className="dp-art-facts">
                      <span><b>{tilt?.sg != null ? sgFmt(tilt.sg) : b.measured?.og ? sgFmt(b.measured.og) : "–"}</b>{tilt?.sg != null ? "Tilt" : "OG"}</span>
                      <span><b>{tilt?.temp_f != null ? `${r1(tilt.temp_f, 1)}°` : "–"}</b>Beer</span>
                      <span><b>{read?.temp_f != null ? `${r1(read.temp_f, 1)}°` : "–"}</b>Chamber</span>
                      <span><b>Day {days(b.brewed_on)}</b>{step ? step.name : "Fermenting"}</span>
                    </div>
                    {b.measured?.alarms?.slice(0, 2).map((a, i) => <div key={i} className="dp-note">{a.text}</div>)}
                  </>
                ) : <div className="dp-dim">Empty{read?.temp_f != null ? ` · ${r1(read.temp_f, 1)}°F` : ""}</div>}
                {read && <div className="dp-dim" style={{ fontSize: 12, marginTop: 6 }}>Inkbird {ago(read.read_at)}</div>}
              </div>
            </section>
          );
        })}
      </div>

      {places.map((place) => {
        const here = kegs.filter((k) => k.place === place);
        const serving = here.filter((k) => k.status === "serving");
        return (
          <section key={place} className="dp-card" style={{ marginTop: 20 }}>
            <h2 className="dp-card-t">{place}<small>{serving.length} on tap · {r1(here.reduce((a, k) => a + (k.status !== "empty" && k.status !== "clean" ? Number(k.left_gal) || 0 : 0), 0), 1)} gal of beer</small></h2>
            {here.length ? <KeezerArt kegs={here} onPick={setEdit} /> : <p className="dp-dim">No kegs yet.</p>}
            <div className="dp-row" style={{ marginTop: 10 }}>
              <button className="dp-btn" onClick={() => addKeg(place)}>+ Keg</button>
              <span className="dp-dim" style={{ fontSize: 13 }}>Tap a keg to change what&apos;s in it, pour a pint, or mark it empty.</span>
            </div>
          </section>
        );
      })}

      <section className="dp-card dp-art-card" style={{ marginTop: 20 }}>
        <RimsArt />
        <div>
          <div className="dp-art-name">RIMS stand</div>
          <div className="dp-dim">Its own stand: PID control box, RIMS tube and pump. The mash temperature for each rest is on the recipe&apos;s Brew day.</div>
          <div className="dp-row" style={{ marginTop: 10 }}><Link className="dp-btn" href="/draftpunk/equipment">Equipment</Link></div>
        </div>
      </section>

      {edit && <KegEditor k={edit} brews={brews} colorOf={colorOf} onSave={saveKeg} onRemove={edit.id ? () => removeKeg(edit) : undefined} onClose={() => setEdit(null)} />}
      {node}
    </>
  );
}

function KegEditor({ k, brews, colorOf, onSave, onRemove, onClose }: { k: Keg; brews: Brew[]; colorOf: Map<string, string>; onSave: (k: Keg) => void; onRemove?: () => void; onClose: () => void }) {
  const [d, setD] = useState(k);
  const up = (p: Partial<Keg>) => setD((x) => ({ ...x, ...p }));
  const pour = (oz: number) => up({ left_gal: Math.max(0, r1((Number(d.left_gal) || 0) - oz / 128, 3)) });
  return (
    <div className="dp-modal" onClick={onClose}>
      <div className="dp-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="dp-card-t">{d.id ? `${d.place} · keg ${d.slot}` : `New keg in ${d.place}`}</h2>
        <div className="dp-row">
          <F label="From a brew" grow="2 1 240px">
            <select value={d.brew_id || ""} onChange={(e) => { const b = brews.find((x) => x.id === e.target.value); up(b ? { brew_id: b.id, beer: b.recipe_snapshot?.name || d.beer, color: colorOf.get(b.id) || d.color, psi: d.psi ?? r1(kegPsi(b.recipe_snapshot?.carb?.vols || 2.4, b.recipe_snapshot?.carb?.tempF || 38), 1) } : { brew_id: null }); }}>
              <option value="">(none)</option>
              {brews.map((b) => <option key={b.id} value={b.id}>{fmtDate(b.brewed_on)} · {b.recipe_snapshot?.name}</option>)}
            </select>
          </F>
          <F label="Beer" grow="2 1 200px"><input value={d.beer} onChange={(e) => up({ beer: e.target.value })} /></F>
          <F label="Status">
            <select value={d.status} onChange={(e) => up({ status: e.target.value as Keg["status"] })}>
              <option value="serving">On tap</option><option value="carbonating">Carbonating</option><option value="conditioning">Conditioning</option><option value="clean">Clean, purged</option><option value="empty">Empty</option>
            </select>
          </F>
        </div>
        <div className="dp-row" style={{ marginTop: 10 }}>
          <F label="Slot"><Num value={d.slot} onChange={(n) => up({ slot: Math.max(1, Math.round(n)) })} /></F>
          <F label="Keg size gal"><Num value={d.size_gal} onChange={(n) => up({ size_gal: n })} /></F>
          <F label="Left gal"><Num value={d.left_gal} onChange={(n) => up({ left_gal: n })} /></F>
          <F label="PSI"><Num value={d.psi ?? undefined} onChange={(n) => up({ psi: n })} /></F>
          <F label="Tapped"><input type="date" value={d.tapped_on || ""} onChange={(e) => up({ tapped_on: e.target.value || null })} /></F>
          <F label="Place"><input value={d.place} onChange={(e) => up({ place: e.target.value })} /></F>
        </div>
        <div className="dp-row" style={{ marginTop: 12 }}>
          <button className="dp-btn" onClick={() => pour(16)}>Pour a pint (16 oz)</button>
          <button className="dp-btn" onClick={() => pour(12)}>12 oz</button>
          <button className="dp-btn" onClick={() => up({ left_gal: d.size_gal, status: "carbonating", tapped_on: null })}>Just filled</button>
          <button className="dp-btn" onClick={() => up({ left_gal: 0, status: "empty" })}>Kicked</button>
        </div>
        <div className="dp-row" style={{ marginTop: 16 }}>
          <button className="dp-btn dp-go" onClick={() => onSave(d)}>Save</button>
          {onRemove && <button className="dp-btn dp-x" onClick={onRemove}>Remove keg</button>}
          <button className="dp-btn dp-x" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}


