import type { Group } from "@/lib/pricing";

/**
 * A group's saved mockup pictures (Group.mockupThumbs) kept up to date by themselves (Oct 28, Nick: "the little boxes
 * aren't updating. Why does that keep happening everywhere? And what's a permanent fix so we don't have to talk about
 * this all the time?").
 *
 * The pictures are saved when the mockup is saved, and every screen shows those saved pictures: the order, the work
 * order and invoice, the portal, the job lists, the search. So a change after the save (new art, a recolor, the
 * digitizer's file, a print's size, spot or inks) never reached them. Now each save stamps the group with what its
 * pictures were drawn from (mockupArt); when the order is opened and that's changed, the order page draws them again
 * out of sight with the Mockup Creator (its quiet mode) and saves them, and every screen has the new pictures.
 *
 * Also THE link into the group's mockup: a mockup made in the logo builder (Add logo) opens there again, not in the
 * garment Mockup Creator (Oct 28, Nick: "if I click edit mockup… it goes to the other one").
 */

/** JSON with its keys in order (the database hands objects back with their keys reordered) */
function stable(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (typeof v === "object") return `{${Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
function hash(s: string): string { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

/** what a group's pictures are drawn from: each print's logo, spot, size, drop, inks and sew file */
export function mockupArtKey(g: Pick<Group, "imprints"> & { mockupBg?: string; mockupKind?: string }): string {
  // a logo mockup's background picked on the order (Group.mockupBg) and a print's colorway and colorway change count too; left out when
  // not set, so pictures saved before them aren't all drawn again
  return hash((g.imprints || []).map((im) => stable([im.id, im.design_id || "", im.method || "", (im.location || "").trim(), (im.size || "").trim(), String(im.drop ?? "").trim(), (im.inks || "").trim(), im.inkMap?.map || null, im.inkBy || null, im.emb?.file?.path || "", ...(im.colorway ? [im.colorway] : []), ...(im.colorwayBy && Object.keys(im.colorwayBy).length ? [im.colorwayBy] : [])])).join("|"))
    + (g.mockupKind === "logo" && g.mockupBg ? `:${g.mockupBg.toLowerCase()}` : "");
}

/** the garments a group's pictures are drawn on and named for: each style and color (Oct 30, Nick on #40284: the helper
 *  mockup still said "STC15 Knit Beanie" after the beanies moved to their own group) */
export function mockupGarmentKey(g: Pick<Group, "lines">): string {
  return hash([...new Set((g.lines || []).map((l) => `${(l.style || "").trim().toLowerCase()}|${(l.color || "").trim().toLowerCase()}`))].join(","));
}

export type MockupArt = { k: string; /** the garments drawn (mockupGarmentKey) */ gk?: string; /** each logo's picture (designs.preview_path) when it was drawn */ d: Record<string, string>;
  /** saved since the garment's color as drawn is kept on its lines (GLine.shade, Oct 29): one made before is drawn again once */ s?: 1;
  /** the garments drawn, "style|color" as the lines name them (Nov 12): one taken off the group is asked about (mockupGone) */ gn?: string[] };

export function mockupArtStamp(g: Pick<Group, "imprints" | "lines" | "mockupBg" | "mockupKind">, designs: { id: string; preview_path?: string | null; file_path?: string | null }[]): MockupArt {
  const ids = [...new Set((g.imprints || []).map((im) => im.design_id).filter(Boolean))] as string[];
  return { k: mockupArtKey(g), gk: mockupGarmentKey(g), gn: garmentNames(g), d: Object.fromEntries(ids.map((id) => { const x = designs.find((y) => y.id === id); return [id, String(x?.preview_path || x?.file_path || "")]; }).filter(([, p]) => p)), s: 1 };
}

const garmentNames = (g: Pick<Group, "lines">) => [...new Set((g.lines || []).filter((l) => (l.style || l.color || "").trim()).map((l) => `${(l.style || "").trim()}|${(l.color || "").trim()}`))];
/** the garments the group's mockup shows that are no longer on the group ("1717 Mauve"), to ask whether to take them off
 *  it (Nick, Nov 12: "if you have a mock-up that has a garment on it, and you remove the garment, you should ask") */
export function mockupGone(g: Pick<Group, "lines" | "mockupThumbs" | "mockupArt">): string[] {
  if (!(g.mockupThumbs || []).some(Boolean) || !g.mockupArt?.gn?.length) return [];
  const k = (x: string) => x.toLowerCase().replace(/[^a-z0-9|]/g, "");
  const now = new Set(garmentNames(g).map(k));
  return g.mockupArt.gn.filter((x) => !now.has(k(x))).map((x) => x.split("|").filter(Boolean).join(" "));
}

/** the group's saved pictures no longer match its prints or logos */
export function mockupStale(g: Group, designs: { id: string; preview_path?: string | null; file_path?: string | null }[]): boolean {
  if (!(g.mockupThumbs || []).some(Boolean) || !g.mockupAt || g.mockupSkipped) return false;
  const st = g.mockupArt;
  if (st) {
    if (st.k !== mockupArtKey(g)) return true;
    // the garments changed (a style taken off, another added): drawn and named again on what the group has now
    if (st.gk !== mockupGarmentKey(g)) return true;
    // drawn before its garment's color was kept with it: once more, so the order's little pictures get that color
    if (!st.s) return true;
    // a logo's art changed (recolored, replaced): only logos this page has loaded are compared
    return Object.entries(st.d || {}).some(([id, p]) => { const x = designs.find((y) => y.id === id); const now = x ? String(x.preview_path || x.file_path || "") : ""; return !!now && now !== p; });
  }
  // saved before the stamp: the digitizer's file came in after the pictures were made
  return (g.imprints || []).some((im) => (im.emb?.file?.at || "") > g.mockupAt!);
}

/** THE link into a group's mockup (the logo builder when it was made there) */
export function mockupHref(orderId: string, g: Pick<Group, "id" | "mockupKind">, extra = ""): string {
  return `/shop/artwork/mockup?order=${orderId}&group=${g.id}${g.mockupKind === "logo" ? "&logo=1" : ""}${extra}`;
}

/** draw a group's mockup again out of sight (the Mockup Creator saves it and says so), up to a minute */
export function remakeMockup(orderId: string, g: Pick<Group, "id" | "mockupKind">): Promise<boolean> {
  return new Promise((res) => {
    const f = document.createElement("iframe");
    f.setAttribute("aria-hidden", "true"); f.tabIndex = -1;
    f.style.cssText = "position:fixed;left:-12000px;top:0;width:1400px;height:900px;border:0;opacity:0;pointer-events:none";
    let ok = false;
    const end = () => { window.removeEventListener("message", on); clearTimeout(t); f.remove(); res(ok); };
    const on = (e: MessageEvent) => { if (e.origin === location.origin && e.data?.type === "fbs:mockup-saved" && e.data.group === g.id) { ok = true; end(); } };
    const t = setTimeout(end, 60_000);
    window.addEventListener("message", on);
    f.src = mockupHref(orderId, g, "&auto=1&quiet=1");
    document.body.appendChild(f);
  });
}

/**
 * What a saved mockup shows, without the picture files themselves (Nov 9: #40460's mockup was saved again after the
 * customer approved it, nothing changed, and the order said "Version 2 · not sent"). Two saves with the same key are the
 * same mockup: the garments, prints, sizes and inks, not the file names a new render gets.
 */
export function mockupContentKey(snap: unknown): string {
  const drop = new Set(["shownArt", "mockupThumbs", "file_path", "path", "url", "thumb"]);
  const clean = (v: unknown): unknown => Array.isArray(v) ? v.map(clean) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !drop.has(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, clean(x)])) : v;
  return JSON.stringify(clean(snap ?? null));
}

/**
 * A group's mockup pictures, wherever they came from (storage paths in the "proofs" bucket), for anything that shows
 * "the mockup": ours (`mockupThumbs`) first; else the customer's placement picture for supplied transfers; else the visual
 * mockup added by hand; else the customer's own mockups (Tiger Blue's, printed from their films). Pictures only: a PDF
 * cart or an .ai can't be drawn. (Nick, Nov 13 2026, #40380: the phone's Proof said there was no mockup; it only looked
 * at ours.) `full` swaps our small "-thumb.png" for the full picture where one was kept.
 */
export function groupPictures(g: Pick<Group, "mockupThumbs" | "imprints" | "customerMockups" | "visualMockup">, full = false): string[] {
  const pic = (x: string) => /\.(png|jpe?g|webp|gif|svg)$/i.test(x);
  const ours = [...new Set((g.mockupThumbs || []).filter(Boolean))];
  if (ours.length) return full ? ours.map((x) => x.replace(/-thumb\.png$/, ".png")) : ours;
  const placed = (g.imprints || []).map((d) => d.supplied?.picture?.path || d.placeRef?.path || "").filter((x) => x && pic(x));
  if (placed.length) return placed;
  const theirs = [g.visualMockup?.path || "", ...(g.customerMockups || []).map((m) => m.path)].filter((x) => x && pic(x));
  return [...new Set(theirs)];
}
