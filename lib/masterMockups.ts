import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { uid, type Group, type Imprint } from "@/lib/pricing";
import type { BrandRules } from "@/lib/brands";
import type { EODraft } from "@/lib/emailOrderShared";

/**
 * Master mockups (Oct 30, Nick on All My Sons: "it's just like, boom, use mockup this number… you make a master mockup and
 * that's it… The only thing it should be trying to read is quantities and styles. But once it gets to an ST350, it knows
 * that's this mockup. Just plug in the quantities").
 *
 * A brand's standard mockups (Brand standards → Standard mockups) are masters: each one is the whole group, its prints
 * (logos, spots, sizes, inks or threads) and its picture. Every garment read off a job whose style it covers goes straight
 * into that mockup's group, with its prints copied from the mockup as they are; nothing about the art is read, guessed or
 * asked for those garments. Only the styles, colors and quantities come from the paperwork.
 *
 * Which styles a master covers: the brand's list for it (rules.masterFor[number].styles), else the garments on the mockup.
 * Which colors: the list for it ("any" for every color), else the colors of the garments on the mockup, so a Forest
 * mockup isn't used for Black goods that take another logo. A garment no master covers is read as before.
 *
 * The same goes for every repeat customer's catalog (Nick, the same evening: "it's the same thing with everybody… as soon
 * as it sees Every Season, it knows, boom, I'm going with this art… Rice Life, boom, it's this artwork. Just look for the
 * sizes, plug it in, go… all we ever did was copy the invoice and update the quantities"): a group the job names by one of
 * their saved mockups' names, or whose logos sit at the same spots as a saved mockup's, IS that mockup: its prints and
 * picture are copied, and only the garments and quantities are the job's.
 */
export type Master = { number: number; title: string; name: string; brand: string; thumb: string; kind?: "logo"; styles: string[]; colors: string[] | "any"; imprints: Imprint[] };

const styleKey = (s: string) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const words = (s: string) => (s || "").toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !/^(the|and|heather|dark|light)$/.test(w));
/** a garment color is one of the master's: they share a word ("Forest" / "Forest Green", "Black" / "Jet Black") */
const colorFits = (color: string, colors: string[] | "any") => colors === "any" || colors.some((c) => { const a = words(c), b = words(color); return a.some((w) => b.includes(w)); });

export async function loadMasters(admin: SupabaseClient, customerId: string): Promise<Master[]> {
  const { data: bs } = await admin.from("brands").select("name, rules, sort").eq("customer_id", customerId).is("archived_at", null).order("sort");
  const brands = ((bs || []) as { name: string; rules: BrandRules | null }[]).filter((b) => b.rules?.mockups?.length);
  const nums = [...new Set(brands.flatMap((b) => b.rules!.mockups!))];
  if (!nums.length) return [];
  const { data: ms } = await admin.from("mockups").select("number, title, file_path, snapshot, created_at").eq("customer_id", customerId).in("number", nums).is("archived_at", null).order("created_at", { ascending: false });
  const rows = (ms || []) as { number: number; title: string | null; file_path: string; snapshot: { lines?: { style?: string; color?: string }[]; imprints?: Imprint[] } | null }[];
  const out: Master[] = [];
  for (const b of brands) for (const n of b.rules!.mockups!) {
    const m = rows.find((r) => r.number === n);
    const ims = (m?.snapshot?.imprints || []).filter((im) => im.location);
    if (!m || !ims.length) continue;
    const set = b.rules!.masterFor?.[String(n)];
    const own = (m.snapshot?.lines || []).filter((l) => l.style);
    const styles = [...new Set((set?.styles?.length ? set.styles : own.map((l) => l.style!)).map(styleKey).filter(Boolean))];
    const colors: string[] | "any" = set?.colors?.some((c) => /^any$/i.test(c.trim())) ? "any" : set?.colors?.length ? set.colors : [...new Set(own.map((l) => l.color || "").filter(Boolean))];
    const title = String(m.title || "");
    out.push({ number: n, title, name: title.split(" — ")[0].trim() || `Mockup M-${n}`, brand: b.name, thumb: m.file_path.replace(/\.png$/i, "-thumb.png"), ...(/ — Logo /.test(title) ? { kind: "logo" as const } : {}), styles, colors, imprints: ims });
  }
  return out;
}

/** every saved mockup of theirs (the newest version of each number), as a master for a group that names it or matches its logos */
export async function loadCatalog(admin: SupabaseClient, customerId: string): Promise<Master[]> {
  const { data: ms } = await admin.from("mockups").select("number, title, file_path, snapshot, created_at").eq("customer_id", customerId).is("archived_at", null).not("number", "is", null).order("created_at", { ascending: false }).limit(400);
  const seen = new Set<number>(), out: Master[] = [];
  for (const m of (ms || []) as { number: number; title: string | null; file_path: string; snapshot: { lines?: { style?: string; color?: string }[]; imprints?: Imprint[] } | null }[]) {
    if (seen.has(m.number)) continue;
    seen.add(m.number);
    const ims = (m.snapshot?.imprints || []).filter((im) => im.location && im.design_id);
    if (!ims.length || !m.file_path) continue;
    const title = String(m.title || "");
    out.push({ number: m.number, title, name: title.split(" — ")[0].trim(), brand: "", thumb: m.file_path.replace(/\.png$/i, "-thumb.png"), ...(/ — Logo /.test(title) ? { kind: "logo" as const } : {}), styles: [], colors: [...new Set((m.snapshot?.lines || []).map((l) => l.color || "").filter(Boolean))], imprints: ims });
  }
  return out;
}

const spotKey = (ims: { design_id?: string | null; location?: string }[]) => [...new Set(ims.filter((im) => im.design_id).map((im) => `${im.design_id}@${(im.location || "").trim().toLowerCase()}`))].sort().join("|");

/** the saved mockup a group is: the same logos at the same spots, or its name named by the group (both, best); among
 *  equals the one on the same garment color, then the newest */
export function catalogFor(catalog: Master[], g: Group, about: string): Master | null {
  const key = g.imprints.length && g.imprints.every((im) => im.design_id) ? spotKey(g.imprints) : "";
  const text = ` ${norm(`${g.name || ""} ${g.description || ""}`)} `, said = norm(about);
  const named = (m: Master) => { const n = norm(m.name); return n.length >= 4 && !/^(mockup|logo|front|back|group)/.test(n) && (text.includes(n) || (!!said && said.includes(n) && norm(g.name).includes(n))); };
  const color = g.lines[0]?.color || "";
  const score = (m: Master) => (key && spotKey(m.imprints) === key ? 2 : 0) + (named(m) ? 1 : 0);
  const fit = catalog.map((m) => ({ m, s: score(m) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || (colorFits(color, b.m.colors) ? 1 : 0) - (colorFits(color, a.m.colors) ? 1 : 0));
  if (!fit.length) return null;
  // a name alone that fits several different mockups: not sure, left to staff
  if (fit[0].s === 1 && fit.filter((x) => x.s === 1).length > 1 && !colorFits(color, fit[0].m.colors)) return null;
  return fit[0].m;
}

/** the master for a garment: its style is on the master's list and its color fits; a master naming the color wins */
export function masterFor(masters: Master[], style: string, color: string): Master | null {
  const k = styleKey(style);
  if (!k) return null;
  const fit = masters.filter((m) => m.styles.includes(k) && colorFits(color, m.colors));
  return fit.find((m) => m.colors !== "any") || fit[0] || null;
}

const ART_Q = /\b(art|logo|ink|inks|thread|threads|pms|colou?rs?|size|wide|width|print|prints|mockup|location|spot|underbase|design|file|digiti[sz]|stitch)/i;
const norm = (s?: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Moves every garment a master covers into that master's group (made once per master, its prints copied from the
 * mockup). The groups left empty go, with their art picks; questions about them are kept on the master's group unless
 * they're about the art, which the master settles. Returns what it did, in words.
 */
export function applyMasters(d: EODraft, masters: Master[], catalog: Master[] = [], about = ""): string[] {
  if (!masters.length && !catalog.length) return [];
  const did: string[] = [];
  const byNum = new Map<number, Group>(d.groups.filter((g) => g.masterMockup).map((g) => [g.masterMockup!, g]));
  const moved = new Map<string, number>(); // source group id → the master it all went to (last one)
  const next: Group[] = [];
  for (const g of d.groups) {
    if (g.masterMockup) { next.push(g); continue; }
    const keep: typeof g.lines = [];
    for (const l of g.lines) {
      const m = masterFor(masters, l.style || "", l.color || "");
      if (!m) { keep.push(l); continue; }
      let mg = byNum.get(m.number);
      if (!mg) {
        const imprints = m.imprints.map((im) => ({ ...JSON.parse(JSON.stringify(im)), id: uid(), fromBrand: m.brand, notes: [String(im.notes || "").trim(), `From master mockup M-${m.number}`].filter(Boolean).join(" · ") }) as Imprint);
        mg = {
          ...g, id: uid(), name: m.name, description: undefined, lines: [], imprints, masterMockup: m.number,
          mockupThumbs: [m.thumb], mockupAt: new Date().toISOString(), ...(m.kind ? { mockupKind: m.kind } : {}),
          customerMockups: undefined, mockupArt: undefined, mockupSkipped: undefined,
        } as Group;
        byNum.set(m.number, mg);
        next.push(mg);
      }
      // the same logo sewn somewhere else on this garment (a beanie's cuff, a cap's front), as the reading had it
      for (const method of new Set(mg.imprints.map((im) => im.method))) {
        const mine = mg.imprints.filter((im) => im.method === method);
        if (mine.length !== 1) continue;
        const src = g.imprints.find((im) => im.method === method);
        const spot = src ? (src.spotBy?.[l.id] || src.location) : "";
        if (spot && spot !== mine[0].location) mine[0].spotBy = { ...(mine[0].spotBy || {}), [l.id]: spot };
      }
      mg.lines.push(l);
      moved.set(g.id, m.number);
      did.push(`${[l.style, l.color].filter(Boolean).join(" ")} → M-${m.number}`);
    }
    if (keep.length) next.push({ ...g, lines: keep });
  }
  // the rest: a group that is one of their saved mockups gets its prints and picture, as they are
  for (const g of next) {
    if (g.masterMockup || !g.lines.length) continue;
    const m = catalogFor(catalog, g, about);
    if (!m) continue;
    const old = new Set(g.imprints.map((im) => im.id));
    d.art = Object.fromEntries(Object.entries(d.art || {}).filter(([k]) => !old.has(k)));
    g.imprints = m.imprints.map((im) => ({ ...JSON.parse(JSON.stringify(im)), id: uid(), notes: [String(im.notes || "").trim(), `From mockup M-${m.number}`].filter(Boolean).join(" · ") }) as Imprint);
    g.masterMockup = m.number; g.mockupThumbs = [m.thumb]; g.mockupAt = new Date().toISOString();
    if (m.kind) g.mockupKind = m.kind;
    delete g.mockupArt; delete g.mockupSkipped;
    d.check = (d.check || []).filter((c) => !(norm(c.about) && norm(c.about) === norm(g.name) && (ART_Q.test(c.q) || c.choices?.some((x) => x.path))));
    did.push(`${g.name || "a group"} = M-${m.number}`);
  }
  if (!did.length) return [];
  const gone = d.groups.filter((g) => !g.masterMockup && !next.some((x) => x.id === g.id));
  const goneIms = new Set(gone.flatMap((g) => g.imprints.map((im) => im.id)));
  d.groups = next;
  d.art = Object.fromEntries(Object.entries(d.art || {}).filter(([k]) => !goneIms.has(k)));
  d.mockups = Object.fromEntries(Object.entries(d.mockups || {}).filter(([k]) => !gone.some((g) => g.id === k)));
  const masterName = (about?: string) => {
    const g = gone.find((x) => norm(x.name) && norm(x.name) === norm(about)) || next.find((x) => x.masterMockup && norm(x.name) === norm(about));
    if (!g) return null;
    return g.masterMockup ? g.name || "" : byNum.get(moved.get(g.id)!)?.name || "";
  };
  d.check = (d.check || []).flatMap((c) => {
    const to = masterName(c.about);
    if (to === null) return [c];
    if (ART_Q.test(c.q) || c.choices?.some((x) => x.path)) return [];
    return [{ ...c, about: to }];
  });
  return did;
}
