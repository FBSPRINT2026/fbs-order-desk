import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { uid, type Group, type Imprint } from "@/lib/pricing";
import type { EODraft } from "@/lib/emailOrderShared";
import type { ProgramItem } from "@/lib/programs";
import { spotKey, spotOf } from "@/lib/spotChange";

/**
 * Master mockups: the program's prices name the saved mockups that ARE them (Program & training on the customer, Oct 30,
 * Nick: "it's just like, boom, use mockup this number… The only thing it should be trying to read is quantities and
 * styles… with All My Sons the key indicator is the garment. With Peticolas, the key indicator is the design… copy the
 * invoice and update the quantities").
 *
 * The reader still reads the job: whose it is, the garments, colors and quantities. Then, for a job the program covers
 * (its end client's words are in the job, none of its "not" words are):
 *  - the garment leads (programs.leads = "garment", All My Sons): every garment whose style a price lists goes straight
 *    into that price's mockup's group, the mockup's prints copied as they are (logos, spots, sizes, inks or threads) and
 *    its picture. A mockup can be for some garment colors only (Forest goods take D-10303, Black goods another mockup).
 *  - the design leads ("design", Peticolas): a group the job calls by a price's words ("Sit Down", "Velvet Hammer") gets
 *    that price's mockup, on whatever garments the job has; the one for the garment's color when there are several.
 * Nothing about the art is read, guessed or asked for those garments. Anything no price covers is read as before.
 */
export type Master = { item: string; name: string; number: number; title: string; thumb: string; kind?: "logo"; styles: string[]; words: string[]; colors: string[] | "any"; imprints: Imprint[] };
export type Masters = { leads: "garment" | "design"; masters: Master[] };

const styleKey = (s: string) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const norm = (s?: string) => ` ${(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
/** the phrase is in the text as whole words ("AMS" in "AMS 43146 PITTSBURGH", not in "Williams") */
const says = (text: string, phrase: string) => { const p = norm(phrase); return p.trim().length > 1 && norm(text).includes(p); };
const cwords = (s: string) => (s || "").toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !/^(the|and|heather|hthr|dark|light)$/.test(w));
/** a garment color is one of the mockup's: they share a word ("Forest" / "Forest Green", "Black" / "Jet Black") */
const colorFits = (color: string, colors: string[] | "any") => colors === "any" || colors.some((c) => cwords(c).some((w) => cwords(color).includes(w)));

export async function loadMasters(admin: SupabaseClient, customerId: string, about: string): Promise<Masters> {
  const { data: p } = await admin.from("programs").select("id, leads").eq("customer_id", customerId).order("created_at").limit(1).maybeSingle();
  if (!p) return { leads: "garment", masters: [] };
  const { data: its } = await admin.from("program_items").select("id, name, garment, match, mockups, position").eq("program_id", p.id).eq("active", true).is("archived_at", null).order("position");
  // only the prices this job is for: their end client named, none of their "not" words
  const items = ((its || []) as Pick<ProgramItem, "id" | "name" | "garment" | "match" | "mockups">[]).filter((it) => (it.mockups || []).length
    && (!(it.match?.who || []).length || (it.match!.who!).some((w) => says(about, w)))
    && !(it.match?.not || []).some((w) => says(about, w)));
  const nums = [...new Set(items.flatMap((it) => (it.mockups || []).map((m) => +m.n).filter(Boolean)))];
  if (!nums.length) return { leads: p.leads === "design" ? "design" : "garment", masters: [] };
  const { data: ms } = await admin.from("mockups").select("number, title, file_path, snapshot, created_at").eq("customer_id", customerId).in("number", nums).is("archived_at", null).order("created_at", { ascending: false });
  const rows = (ms || []) as { number: number; title: string | null; file_path: string; snapshot: { imprints?: Imprint[] } | null }[];
  const masters: Master[] = [];
  for (const it of items) for (const e of it.mockups || []) {
    const r = rows.find((x) => x.number === +e.n);
    const ims = (r?.snapshot?.imprints || []).filter((im) => im.location);
    if (!r || !ims.length) continue;
    const what = (it.match?.what || []).map((w) => w.trim()).filter(Boolean);
    const title = String(r.title || "");
    masters.push({
      item: it.id, name: (it.garment || "").split(":")[0].trim() || it.name || title.split(" — ")[0].trim(), number: r.number, title,
      thumb: r.file_path.replace(/\.png$/i, "-thumb.png"), ...(/ — Logo /.test(title) ? { kind: "logo" as const } : {}),
      styles: what.map(styleKey).filter(Boolean), words: [...what.filter((w) => !/\d/.test(w) || /\s/.test(w)), it.name].filter((w) => (w || "").trim().length > 2),
      colors: (e.colors || []).filter((c) => c.trim() && !/^any$/i.test(c.trim())).length ? e.colors!.filter((c) => c.trim()) : "any",
      imprints: ims,
    });
  }
  return { leads: p.leads === "design" ? "design" : "garment", masters };
}

/** the master for a garment (garment leads): its style is on the price's list and its color fits; a mockup for that
 *  color wins over one for any color */
export function masterFor(masters: Master[], style: string, color: string, methods?: Set<string>): Master | null {
  const k = styleKey(style);
  if (!k) return null;
  // the reading's decoration wins: an 18500 under the PO's embroidery goes with the embroidery, not the helper print
  const fit = masters.filter((m) => m.styles.includes(k) && colorFits(color, m.colors) && (!methods?.size || m.imprints.some((im) => methods.has(im.method || "screen"))));
  return fit.find((m) => m.colors !== "any") || fit[0] || null;
}

const ART_Q = /\b(art|logo|ink|inks|thread|threads|pms|colou?rs?|size|wide|width|print|prints|mockup|location|spot|underbase|design|file|digiti[sz]|stitch)/i;
const same = (a?: string, b?: string) => norm(a).trim() !== "" && norm(a) === norm(b);
/** the mockup's prints, as they are: known good, so nothing waits on production to confirm them (Oct 30, Nick: "we
 *  should set it to reorder and then don't confirm any of the details. We know it's good") */
const copyPrints = (m: Master) => m.imprints.map((im) => {
  const x = { ...JSON.parse(JSON.stringify(im)), id: uid(), notes: [String(im.notes || "").trim(), `From mockup M-${m.number}`].filter(Boolean).join(" · ") } as Imprint;
  delete (x as { confirm?: unknown }).confirm; delete (x as { visualOnly?: unknown }).visualOnly;
  return x;
});
const stamp = (g: Group, m: Master) => { g.masterMockup = m.number; g.mockupThumbs = [m.thumb]; g.mockupAt = new Date().toISOString(); if (m.kind) g.mockupKind = m.kind; delete g.mockupArt; delete g.mockupSkipped; delete g.customerMockups; };

const printKey = (ims: Imprint[]) => [...new Set(ims.map((im) => `${im.design_id || ""}@${(im.location || "").trim().toLowerCase()}`))].sort().join("|");
/** a garment into a master's group: the same logo sewn somewhere else on it (a beanie's cuff, a cap's front) as the reading had it */
function moveInto(mg: Group, from: Group, l: Group["lines"][number]) {
  for (const method of new Set(mg.imprints.map((im) => im.method))) {
    const mine = mg.imprints.filter((im) => im.method === method);
    const src = from.imprints.find((im) => im.method === method);
    const spot = src ? spotOf(src, l) : "";
    if (mine.length === 1 && method === "embroidery" && spot && spot !== mine[0].location) mine[0].spotBy = { ...(mine[0].spotBy || {}), [spotKey(l)]: spot };
  }
  mg.lines.push(l);
}

/**
 * Puts the job's garments into their masters' groups (see above). Returns what it did, in words. Questions about the
 * groups it settled are kept unless they're about the art, which the mockup settles.
 */
export function applyMasters(d: EODraft, ms: Masters, about: string): string[] {
  if (!ms.masters.length) return [];
  const did: string[] = [];
  const settled = new Set<string>(); // group names whose art the mockup settles
  if (ms.leads === "garment") {
    const byNum = new Map<number, Group>(d.groups.filter((g) => g.masterMockup).map((g) => [g.masterMockup!, g]));
    const next: Group[] = [];
    for (const g of d.groups) {
      if (g.masterMockup) { next.push(g); continue; }
      const keep: typeof g.lines = [];
      const methods = new Set(g.imprints.map((im) => im.method || "screen"));
      for (const l of g.lines) {
        const m = masterFor(ms.masters, l.style || "", l.color || "", methods);
        if (!m) { keep.push(l); continue; }
        let mg = byNum.get(m.number);
        if (!mg) {
          mg = { ...g, id: uid(), name: m.title.split(" — ")[0].trim() || m.name, description: undefined, lines: [], imprints: copyPrints(m) } as Group;
          stamp(mg, m);
          byNum.set(m.number, mg);
          next.push(mg);
        }
        moveInto(mg, g, l);
        settled.add(norm(g.name)); settled.add(norm(mg.name));
        did.push(`${[l.style, l.color].filter(Boolean).join(" ")} → M-${m.number}`);
      }
      if (keep.length) next.push({ ...g, lines: keep });
    }
    // garments left in a group with the same logos at the same spots as a master's group go with it (St Louis: the
    // 18500s under the PO's embroidery sew the same AMS logo as the jackets' mockup)
    for (const g of [...next]) {
      if (g.masterMockup || !g.imprints.length || !g.imprints.every((im) => im.design_id)) continue;
      const mg = next.find((x) => x.masterMockup && printKey(x.imprints) === printKey(g.imprints));
      if (!mg) continue;
      for (const l of g.lines) { moveInto(mg, g, l); did.push(`${[l.style, l.color].filter(Boolean).join(" ")} → M-${mg.masterMockup} (same logo)`); }
      settled.add(norm(g.name));
      next.splice(next.indexOf(g), 1);
    }
    const gone = d.groups.filter((g) => !next.some((x) => x.id === g.id));
    const goneIms = new Set(gone.flatMap((g) => g.imprints.map((im) => im.id)));
    d.groups = next;
    d.art = Object.fromEntries(Object.entries(d.art || {}).filter(([k]) => !goneIms.has(k)));
    d.mockups = Object.fromEntries(Object.entries(d.mockups || {}).filter(([k]) => !gone.some((g) => g.id === k)));
    // a question about a group that went into a master is now about the master's group
    d.check = (d.check || []).map((c) => { const g = gone.find((x) => same(x.name, c.about)); const to = g && next.find((x) => x.masterMockup && x.lines.some((l) => g.lines.some((gl) => gl.id === l.id))); return to ? { ...c, about: to.name } : c; });
  } else {
    // the design leads: a group the job calls by a price's words; the one email group when the email names it
    const open = d.groups.filter((g) => !g.masterMockup);
    for (const g of open) {
      const text = `${g.name || ""} ${g.description || ""}`;
      const fits = ms.masters.filter((m) => m.words.some((w) => says(text, w)) || (open.length === 1 && m.words.some((w) => says(about, w))));
      if (!fits.length) continue;
      const color = g.lines[0]?.color || "";
      const forColor = fits.filter((m) => colorFits(color, m.colors));
      const m = forColor.find((x) => x.colors !== "any") || forColor[0] || fits[0];
      const old = new Set(g.imprints.map((im) => im.id));
      d.art = Object.fromEntries(Object.entries(d.art || {}).filter(([k]) => !old.has(k)));
      g.imprints = copyPrints(m);
      stamp(g, m);
      settled.add(norm(g.name));
      const others = [...new Set(fits.filter((x) => x.number !== m.number && x.item === m.item).map((x) => `M-${x.number}`))];
      did.push(`${g.name || m.name} = M-${m.number}${others.length ? ` (also ${others.join(", ")})` : ""}`);
    }
  }
  d.check = (d.check || []).filter((c) => !(settled.has(norm(c.about)) && (ART_Q.test(c.q) || c.choices?.some((x) => x.path))));
  return did;
}
