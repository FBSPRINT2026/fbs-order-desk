import { WILFLEX_HEX, colorHex } from "@/lib/inkColors";
import { LOCATIONS, type BrandColor, type BrandPrint, type BrandSize } from "@/lib/pricing";

/**
 * Brand standards set up by talking them through with the AI (Oct 16, Nick: "some pretty specific brand standards…
 * talk through it and you set it up… any admin should be able to do it"). The AI proposes changes; nothing is saved
 * until an admin clicks Apply. Shared by the chat route (server) and the panel (browser).
 */
export type OnShirtRule = { shirt: string; ink: string };
/** what the AI proposes: each part it includes replaces that part whole (a list is the full list after the change) */
export type BrandProposal = {
  colors?: BrandColor[];
  sizes?: { which: BrandSize["which"]; logo?: number; location: string; width: number; note?: string }[];
  hit?: "standard" | "fashion" | "ask";
  soft?: boolean;
  distressedOnly?: boolean;
  rules?: string[];
  logos?: { number: number; onShirts?: OnShirtRule[]; distressed?: boolean }[];
};
export type ChangeLine = { op: "+" | "~" | "-"; what: string; text: string; hex?: string };
export type BrandFile = { name: string; path: string; type: string };
export type BrandMsg = {
  role: "staff" | "ai"; text: string; at: string; by?: string; files?: BrandFile[];
  proposal?: BrandProposal; lines?: ChangeLine[]; question?: string;
  status?: "open" | "applied" | "dismissed"; done_by?: string; done_at?: string;
};
export type BrandLogo = { id: string; number: number; name: string; inks: string; distressed: boolean; onShirts: OnShirtRule[]; ratio: number | null };

/** "199c", "pms 289", "cool gray 5" → "PMS 199 C"…; "white" → the ink "White" */
export function tidyInk(ink: string) {
  const t = (ink || "").trim();
  if (!t || /^#/.test(t)) return t;
  const w = Object.keys(WILFLEX_HEX).find((k) => k.toLowerCase() === t.toLowerCase());
  if (w) return w;
  const m = t.replace(/^(pms|pantone)\s*/i, "").replace(/\s*c$/i, "").replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return colorHex(`PMS ${m} C`) ? `PMS ${m} C` : t;
}

const WHICH = ["any", "round", "wide", "tall", "design"] as const;
const locOk = (l: string) => LOCATIONS.find((x) => x.toLowerCase() === (l || "").toLowerCase().trim()) || "";
const whichLabel = (w: string, logo?: number) => (w === "design" ? `D-${logo}` : w === "any" ? "Any logo" : `${w[0].toUpperCase()}${w.slice(1)} logos`);
const fmtW = (w: number) => `${Math.round(w * 100) / 100}"`;

/** keep only what makes sense: real locations, logos that exist, sizes in range, tidy inks */
export function cleanProposal(p: BrandProposal, logos: BrandLogo[]): BrandProposal {
  const nums = new Set(logos.map((l) => l.number));
  const out: BrandProposal = {};
  if (Array.isArray(p.colors)) out.colors = p.colors.filter((c) => c && (c.name || c.ink)).slice(0, 60).map((c) => ({ name: String(c.name || "").trim().slice(0, 40), ink: tidyInk(String(c.ink || "")).slice(0, 40), ...(c.group?.trim() ? { group: c.group.trim().slice(0, 40) } : {}) }));
  if (Array.isArray(p.sizes)) out.sizes = p.sizes.map((s) => ({ ...s, which: (WHICH as readonly string[]).includes(s.which) ? s.which : "any", location: locOk(s.location), width: Math.round(+s.width * 100) / 100 }))
    .filter((s) => s.location && s.width >= 0.5 && s.width <= 20 && (s.which !== "design" || (s.logo && nums.has(s.logo)))).slice(0, 30)
    .map((s) => ({ which: s.which, ...(s.which === "design" ? { logo: s.logo } : {}), location: s.location, width: s.width, ...(s.note?.trim() ? { note: s.note.trim().slice(0, 80) } : {}) }));
  if (p.hit && ["standard", "fashion", "ask"].includes(p.hit)) out.hit = p.hit;
  if (typeof p.soft === "boolean") out.soft = p.soft;
  if (typeof p.distressedOnly === "boolean") out.distressedOnly = p.distressedOnly;
  if (Array.isArray(p.rules)) out.rules = p.rules.map((r) => String(r || "").trim().slice(0, 240)).filter(Boolean).slice(0, 30);
  if (Array.isArray(p.logos)) out.logos = p.logos.filter((l) => nums.has(+l.number)).slice(0, 40).map((l) => ({
    number: +l.number,
    ...(Array.isArray(l.onShirts) ? { onShirts: l.onShirts.filter((x) => x?.shirt && x?.ink).slice(0, 16).map((x) => ({ shirt: String(x.shirt).trim().slice(0, 40), ink: x.ink === "Original colors" ? x.ink : tidyInk(String(x.ink)).slice(0, 40) })) } : {}),
    ...(typeof l.distressed === "boolean" ? { distressed: l.distressed } : {}),
  })).filter((l) => l.onShirts || l.distressed !== undefined);
  return out;
}

/** the proposal as plain lines against what's saved now (+ added, ~ changed, - removed) */
export function changeLines(cur: { colors: BrandColor[]; print: BrandPrint; logos: BrandLogo[] }, p: BrandProposal): ChangeLine[] {
  const L: ChangeLine[] = [];
  if (p.colors) {
    const key = (c: BrandColor) => `${(c.group || "").toLowerCase()}|${(c.name || c.ink).toLowerCase()}`;
    const was = new Map(cur.colors.map((c) => [key(c), c])), now = new Map(p.colors.map((c) => [key(c), c]));
    const label = (c: BrandColor) => `${c.group ? c.group + ": " : ""}${c.name || c.ink}`;
    for (const [k, c] of now) {
      const w = was.get(k);
      if (!w) L.push({ op: "+", what: "Color", text: `${label(c)} = ${c.ink}`, hex: colorHex(c.ink) || undefined });
      else if (w.ink !== c.ink) L.push({ op: "~", what: "Color", text: `${label(c)}: ${w.ink} → ${c.ink}`, hex: colorHex(c.ink) || undefined });
    }
    for (const [k, c] of was) if (!now.has(k)) L.push({ op: "-", what: "Color", text: `${label(c)} (${c.ink})` });
  }
  if (p.sizes) {
    const byId = new Map(cur.logos.map((l) => [l.id, l.number]));
    const key = (s: { which: string; logo?: number; location: string }) => `${s.which}|${s.logo || ""}|${s.location}`;
    const was = new Map((cur.print.sizes || []).map((s) => { const x = { which: s.which, logo: s.design_id ? byId.get(s.design_id) : undefined, location: s.location, width: s.width }; return [key(x), x]; }));
    const now = new Map(p.sizes.map((s) => [key(s), s]));
    for (const [k, s] of now) {
      const w = was.get(k), t = `${whichLabel(s.which, s.logo)} · ${s.location}`;
      if (!w) L.push({ op: "+", what: "Size", text: `${t} · ${fmtW(s.width)}${s.note ? ` (${s.note})` : ""}` });
      else if (w.width !== s.width) L.push({ op: "~", what: "Size", text: `${t}: ${fmtW(w.width)} → ${fmtW(s.width)}` });
    }
    for (const [k, s] of was) if (!now.has(k)) L.push({ op: "-", what: "Size", text: `${whichLabel(s.which, s.logo)} · ${s.location} · ${fmtW(s.width)}` });
  }
  const HIT = { standard: "Standard (underbase)", fashion: "Fashion hit (no underbase)", ask: "Ask each time" } as const;
  if (p.hit && p.hit !== (cur.print.hit || "standard")) L.push({ op: "~", what: "Printing", text: `On dark shirts: ${HIT[p.hit]}` });
  if (p.distressedOnly !== undefined && p.distressedOnly !== !!cur.print.distressedOnly) L.push({ op: "~", what: "Printing", text: p.distressedOnly ? "Fashion hit only for distressed logos" : "Fashion hit for every logo" });
  if (p.soft !== undefined && p.soft !== !!cur.print.soft) L.push({ op: "~", what: "Printing", text: `Soft hand additive: ${p.soft ? "on" : "off"}` });
  if (p.rules) {
    const was = new Set((cur.print.rules || []).map((r) => r.toLowerCase()));
    const now = new Set(p.rules.map((r) => r.toLowerCase()));
    p.rules.filter((r) => !was.has(r.toLowerCase())).forEach((r) => L.push({ op: "+", what: "Rule", text: r }));
    (cur.print.rules || []).filter((r) => !now.has(r.toLowerCase())).forEach((r) => L.push({ op: "-", what: "Rule", text: r }));
  }
  for (const l of p.logos || []) {
    const was = cur.logos.find((x) => x.number === l.number);
    if (!was) continue;
    if (l.onShirts) {
      const t = (v: OnShirtRule[]) => v.map((x) => `${x.shirt} → ${x.ink}`).join(" · ");
      if (t(l.onShirts) !== t(was.onShirts)) L.push({ op: was.onShirts.length ? "~" : "+", what: "Shirt colors", text: `D-${l.number} ${was.name}: ${t(l.onShirts) || "none"}` });
    }
    if (l.distressed !== undefined && l.distressed !== was.distressed) L.push({ op: "~", what: "Logo", text: `D-${l.number} ${was.name}: ${l.distressed ? "distressed" : "not distressed"}` });
  }
  return L;
}
