import { colorHex } from "./inkColors";

// Shared pricing engine and order vocabulary.
// Used by the shop editor (live totals), the customer portal (display)
// and the server (Stripe amounts), so every total comes from one place.

/** Infant (months) and toddler sizes: onesies, baby and toddler tees (Little Groupies). Supplier ranges like 3-6M
 *  are stored by their top month (6M), the way Printavo kept them. */
export const BABY_SIZES = ["NB", "6M", "12M", "18M", "24M"] as const;
export const TODDLER_SIZES = ["2T", "3T", "4T", "5T"] as const;
export const YOUTH_SIZES = ["YXS", "YS", "YM", "YL", "YXL"] as const;
export const ADULT_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"] as const;
/** Waist sizes for shorts and pants (Oct 30, Nick on AMS Baton Rouge's 9820 Burnside shorts: "you're not building in
 *  waist sizes like they are sizes like small, medium, large… there's going to be products in the catalogs that are
 *  waist sizes like 30"). Stored as the waist in inches ("30"), shown as 30". A waist × inseam ("32x30", SanMar's "3230") is its waist. */
export const WAIST_SIZES = ["28", "29", "30", "31", "32", "33", "34", "35", "36", "38", "40", "42", "44", "46", "48", "50", "52", "54", "56", "58", "60"] as const;
/** Quantity for one-size items (hats, koozies, bags). */
export const ONE_SIZE = "OS" as const;
/** Every size, smallest first (baby, toddler, youth, adult, waist), then one-size. Orders store quantities keyed by these names. */
export const SIZES = [...BABY_SIZES, ...TODDLER_SIZES, ...YOUTH_SIZES, ...ADULT_SIZES, ...WAIST_SIZES, ONE_SIZE] as const;
/** a waist size however it's written (30, 30", W30, 30W, 30 waist, 32x30, 32/30) → "30"; anything else → null */
export function waistOf(raw: string): (typeof WAIST_SIZES)[number] | null {
  // SanMar runs waist and inseam together: "3232" = 32 waist, 32 inseam (an inseam is 26–38)
  const run = /^\s*(\d{2})(2[6-9]|3[0-8])\s*$/.exec(String(raw || ""));
  const m = run || /^\s*W?\s*(\d{2})\s*(?:"|''|W|IN|INCH(?:ES)?|WAIST)?\s*(?:[X\/×]\s*\d{2}\s*(?:"|L|IN)?)?\s*$/i.exec(String(raw || ""));
  return m && (WAIST_SIZES as readonly string[]).includes(m[1]) ? (m[1] as (typeof WAIST_SIZES)[number]) : null;
}
export const isWaist = (z: string) => (WAIST_SIZES as readonly string[]).includes(z);
/** How a size is shown to people. */
export const sizeLabel = (z: string) => (z === ONE_SIZE ? "Qty" : isWaist(z) ? `${z}"` : z);
export type Size = (typeof SIZES)[number];

export type StatusKey =
  | "request" | "quote" | "quote_sent" | "approved" | "art" | "blanks" | "production" | "ready" | "completed";

export const STATUSES: { k: StatusKey; label: string; portal: string; type: "quote" | "invoice"; c: string }[] = [
  { k: "request", label: "Order request", portal: "Sent to FBS", type: "quote", c: "#0E9F9A" },
  { k: "quote", label: "Quote", portal: "Draft", type: "quote", c: "#7C8799" },
  { k: "quote_sent", label: "Quote Sent", portal: "Awaiting your approval", type: "quote", c: "#6477D6" },
  { k: "approved", label: "Approved", portal: "Approved", type: "invoice", c: "#0A8FC0" },
  { k: "art", label: "Art & Proofs", portal: "Artwork", type: "invoice", c: "#A152C9" },
  { k: "blanks", label: "Blanks Ordered", portal: "Ordering garments", type: "invoice", c: "#C98A0C" },
  { k: "production", label: "In Production", portal: "Printing", type: "invoice", c: "#E0582E" },
  { k: "ready", label: "Ready for Pickup", portal: "Ready for pickup", type: "invoice", c: "#2E9D5B" },
  { k: "completed", label: "Completed", portal: "Completed", type: "invoice", c: "#6B7688" },
];
export const ST: Record<string, (typeof STATUSES)[number]> = Object.fromEntries(STATUSES.map((s) => [s.k, s]));

export const METHODS: Record<string, string> = { screen: "Screen print", embroidery: "Embroidery", dtf: "Heat press (DTF)" };
/** House ink: Wilflex Epic Rio RFU standard colors. */
export const INK_COLORS = ["White", "Lemon Yellow", "Yellow", "Light Gold", "Gold", "Dolphin Orange", "Bright Orange", "Electric Orange", "National Red", "Drake Red", "Dallas Scarlet", "Scarlet", "Electric Red", "Maroon", "Brandywine", "Russell Purple", "Electric Purple", "Russell Gray", "Dark Gray", "Tan", "Aqua", "Contact Blue", "Royal", "Light Royal", "Bears Navy", "Navy", "Electric Blue", "Kelly Green", "Light Green", "Dark Green", "Electric Green", "Electric Yellow", "Electric Pink", "Black Diamond", "Black"];
/** Embroidery thread colors (standard list for now). */
export const THREAD_COLORS = ["White", "Black", "Navy", "Royal", "Light Blue", "Carolina Blue", "Red", "Maroon", "Kelly Green", "Forest Green", "Lime Green", "Gold", "Athletic Gold", "Yellow", "Orange", "Purple", "Pink", "Hot Pink", "Silver", "Gray", "Charcoal", "Brown", "Tan", "Cream"];
/** Staff roles. Owner sees everything; the others get their own views as those screens are built. */
export const ROLES = { owner: "Owner", admin: "Admin (orders, customers, payments)", production: "Production manager", embroidery: "Embroidery manager", receiving: "Receiving", shipping: "Shipping" } as const;
export type Role = keyof typeof ROLES;
/** Print locations (match the fbsprint.com order form). */
export const LOCATIONS = ["Left Chest", "Right Chest", "Full Front", "Medium Front", "Center Chest", "Across Chest", "Full Back", "Medium Back", "Upper Back (Yoke)", "Across Shoulders", "Left Sleeve", "Right Sleeve", "Left Vertical", "Right Vertical", "Front Bottom Left", "Front Bottom Right", "Pocket"];
/**
 * Headwear prints in its own spots (Oct 26, Nick: "when you pull in a hat, the locations for the hat will actually change…
 * full front, back, and side… hats, truckers, snapbacks, those are all hats. Beanies and visors are different. Beanies…
 * just that cuff spot. The visor… just the front"). A group whose garments are all one kind of headwear gets that list.
 */
export const HAT_LOCATIONS = ["Full Front", "Left Side", "Right Side", "Back"];
export const VISOR_LOCATIONS = ["Front"];
export const BEANIE_LOCATIONS = ["Cuff"];
export type Headwear = "hat" | "visor" | "beanie";
export function headwearOf(x: { style?: string; brand?: string; garment?: string; description?: string } | null | undefined): Headwear | null {
  const t = `${x?.garment || ""} ${x?.description || ""} ${x?.style || ""}`.toLowerCase();
  if (/\bbeanie|\bknit (cap|hat)|\btoque|\bpom\b|cuffed knit/.test(t)) return "beanie";
  if (/\bvisor/.test(t)) return "visor";
  if (/\b(cap|caps|hat|hats|trucker|snapback|snap ?back|dad hat|flexfit|fitted|5-panel|6-panel|bucket)\b/.test(t) || HEADWEAR_BRAND.test(String(x?.brand || "").trim())) return "hat";
  return null;
}
/** the print locations for a group's garments: headwear's own spots when they're all one kind of headwear, else the usual list */
export function locationsFor(lines: { style?: string; brand?: string; garment?: string; description?: string }[] | null | undefined): string[] {
  const kinds = new Set((lines || []).filter((l) => l && (l.style || l.garment || l.description)).map((l) => headwearOf(l)));
  if (kinds.size === 1) { const k = [...kinds][0]; if (k === "hat") return HAT_LOCATIONS; if (k === "visor") return VISOR_LOCATIONS; if (k === "beanie") return BEANIE_LOCATIONS; }
  // long sleeves: the upper arms and cuffs where a tee has its sleeves (every garment in the group long-sleeved)
  const ls = (lines || []).filter((l) => l && (l.style || l.garment || l.description));
  if (ls.length && ls.every((l) => longSleeved(l))) return LOCATIONS.flatMap((z) => (z === "Left Sleeve" ? ["Left Upper Arm", "Left Cuff"] : z === "Right Sleeve" ? ["Right Upper Arm", "Right Cuff"] : [z]));
  return LOCATIONS;
}
/** a location read for a shirt, moved to the headwear spot it means on a hat, visor or beanie (front stays front, a back
 *  stays back, a left / right goes to that side) */
export function fitLocation(loc: string, lines: { style?: string; brand?: string; garment?: string; description?: string }[] | null | undefined): string {
  const list = locationsFor(lines);
  if (list === LOCATIONS || list.includes(loc)) return loc;
  // long sleeves: a sleeve or arm read in goes to the upper arm (a tee's sleeve spot), a wrist or cuff to the cuff
  if (list.includes("Left Upper Arm")) {
    const k0 = (loc || "").toLowerCase(), side = /right/.test(k0) ? "Right" : "Left";
    if (/sleeve|arm|cuff|wrist/.test(k0)) return `${side} ${/cuff|wrist/.test(k0) ? "Cuff" : "Upper Arm"}`;
    return loc;
  }
  if (list === VISOR_LOCATIONS) return "Front";
  if (list === BEANIE_LOCATIONS) return "Cuff";
  const k = (loc || "").toLowerCase();
  if (/back|yoke|nape|shoulder/.test(k)) return "Back";
  if (/left/.test(k) && !/chest/.test(k)) return "Left Side";
  if (/right/.test(k) && !/chest/.test(k)) return "Right Side";
  return "Full Front";
}
/** every location name there is (shirts and headwear), for checking a location typed or read in */
/** long sleeves get these in place of Left / Right Sleeve (Oct 27, Nick): the upper arm (a tee's sleeve spot) and the cuff */
export const LONG_SLEEVE_LOCATIONS = ["Left Upper Arm", "Right Upper Arm", "Left Cuff", "Right Cuff"];
/** a garment with sleeves to the wrist: long sleeve tees, hoodies, crewnecks, quarter-zips, jackets */
export const longSleeved = (x: { style?: string; brand?: string; garment?: string; description?: string } | null | undefined) => {
  const t = `${x?.garment || ""} ${x?.description || ""} ${x?.style || ""}`.toLowerCase();
  if (/short sleeve|\bs\/s\b|\bvest\b|tank|sleeveless|\btee\b(?!.*long)/.test(t) && !/long sleeve|\bl\/s\b/.test(t)) return false;
  return /long sleeve|\bl\/s\b|\bls\b|hood|sweatshirt|crew ?neck sweat|fleece|quarter|1\/4|half[- ]?zip|jacket|soft ?shell|windbreaker|coat|anorak|pullover/.test(t);
};
export const ALL_LOCATIONS = [...new Set([...LOCATIONS, ...LONG_SLEEVE_LOCATIONS, ...HAT_LOCATIONS, ...VISOR_LOCATIONS, ...BEANIE_LOCATIONS])];
export const SHIP_METHODS = [
  "UPS Ground", "UPS 3 Day Select", "UPS 2nd Day Air", "UPS 2nd Day Air A.M.", "UPS Next Day Air Saver", "UPS Next Day Air", "UPS Next Day Air Early A.M.",
  "FedEx Ground", "FedEx Home Delivery", "FedEx Express Saver", "FedEx 2Day", "FedEx 2Day A.M.", "FedEx Standard Overnight", "FedEx Priority Overnight", "FedEx First Overnight",
  "USPS Ground Advantage", "USPS Priority Mail", "USPS Priority Mail Express",
];
const shipKey = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^(fedex|ups|usps)(fedex|ups|usps)/, "$1");
const SHIP_ALIAS: Record<string, string> = { fedexgroundhomedelivery: "FedEx Home Delivery", fedexhomedelivery: "FedEx Home Delivery", uspspriority: "USPS Priority Mail", uspsexpress: "USPS Priority Mail Express", uspsprioritymailexpress: "USPS Priority Mail Express", upsnextdayairearly: "UPS Next Day Air Early A.M." };
/**
 * The ship method list's name for a carrier's service (Oct 16, Nick: a rate picked in the shipping quote has to match
 * the Ship method dropdown, not land in "Other…"). "UPS" + "NextDayAirEarlyAM" → "UPS Next Day Air Early A.M.",
 * "FedEx" + "FEDEX_2_DAY" → "FedEx 2Day". Also matches a saved method typed differently. Null when it isn't on the list.
 */
export function matchShipMethod(v: string | null | undefined): string | null {
  const k = shipKey(v || "");
  if (!k) return null;
  return SHIP_METHODS.find((m) => shipKey(m) === k) || SHIP_ALIAS[k] || null;
}
export const PAY_METHODS = ["Credit card", "ACH", "Zelle", "Venmo", "Cash", "Check", "Card", "Other"];

export type Method = "screen" | "embroidery" | "dtf";
/** One decoration on a group of garments (Printavo calls these imprints). */
export type Imprint = { /** the art exactly as the Mockup Creator shows it on this print (inks painted, background off), saved with the mockup: the order's little print tile is this, so it always matches the blow-up (Oct 24, Nick: "we keep having problems with those little boxes… they're just supposed to be little versions of the blow-ups") */ shownArt?: string; id: string; method: Method; location: string; colors: number; inks: string; size: string; notes: string; inkChanges?: number;
  /** youth screens (Oct 30, Nick, #40302: "youth screen at 8 inches… left sleeve… print the same on all of them"): in a
   *  group of youth and adult shirts that has its own youth screens (Group.youthSet), the youth size of this print, or
   *  `same` when the youth shirts print from the adult screen. Its own youth screens get their own setup and are priced
   *  at the youth pieces' break; the adult print at the adult pieces' (lib/pricing.ts calcGroup) */
  youth?: { same?: boolean; size?: string };
  /** the ink picked for each color of the logo (logo color hex → ink), from the Mockup Creator, so the order page and a
   *  reopened mockup show the logo in the chosen inks (Oct 20, Nick: changed green to yellow, the order still showed green) */
  /** where the logo is centered, as a share of its picture, when its box's middle isn't its middle (a round badge with a
   *  tail sticking out: the circle goes in the center, the tail hangs off to the side; Oct 22, Nick, Hudson Band). d = the
   *  logo it was read for; on = use it; by = found on its own or ticked by a person */
  center?: { d: string; x: number; y: number; on: boolean; by?: "auto" | "you" };
  inkMap?: { design: string; map: Record<string, { name: string; hex: string; /** printed as a halftone of that ink, % (Mockup Creator: Combine colors) */ tone?: number;
    /** a custom ink mixed for this job ("half PMS 475 C, half PMS 7506 C"), set in the production view */ mix?: string }> };
  /** embroidery: stitch count (contract pricing includes 6,000; each extra 1,000 is charged) */ stitches?: number;
  /** embroidery only (Oct 23, Nick: "a whole different process"): where the stitch count came from, backing, topping,
   *  3D puff / metallic, the thread line and the digitized file (lib/embroidery.ts). Screen prints never have it */
  emb?: import("@/lib/embroidery").EmbSpec;
  /** added from the customer's brand (Customer artwork → Brands): the brand's name. Set up by its rules, no mockup needed */ fromBrand?: string;
  /** the version of the logo this print is (one of its colorways by name: "Maroon / Off White"), picked with Swap on the
   *  order (Oct 31, Nick: "M-1240-A, -B, -C, -D… I can use A, B, C, or D, depending on what the order calls for"). Its
   *  inks or threads, sew file and picture come from that colorway (lib/brands.ts applyColorway) */ colorway?: string;
  /** the logo whose own setup (colorway, sew file, threads, stitches) the print took when the logo was put on it
   *  (lib/brands.ts withLogoSetup), so it's taken once and what's set by hand after stays */ setupFrom?: string;
  /** a colorway change: by garment color (lowercase), the colorway it gets instead of the print's own. inkBy holds the
   *  same change as inks, so it works like a color change everywhere (lib/brands.ts applyColorwayChange) */ colorwayBy?: Record<string, string>;
  /** embroidery: a digitizing fee set by hand for a complex logo (overrides the base + stitches fee; digitizingFee) */ digitizeFee?: number;
  /** embroidery: the logo was digitized before (its DST is on file): no digitizing charge, no Needs digitizing stamp
   *  (Oct 27, Nick: "like repeat screens… already digitized or existing logo, and that overrides it") */ digitized?: boolean;
  /** the art's height ÷ width as it prints (colors taken off and empty edges don't count), saved by the Mockup Creator:
   *  the other side of the size comes from it (#40189: a logo on a black box read 6" × 4.41" for 6" × 1.12") */ artRatio?: number;
  /** inks matched to a PMS (non-standard ink): a matching fee each. Only used when the inks aren't named; named inks
   *  are charged by pmsInks() */ pms?: number;
  /** PMS charge per ink set by hand (lowercase ink name → charge or not): "standard, no charge" for a customer's
   *  regular PMS 186, or a match on an ink that isn't named as a PMS */ pmsCharge?: Record<string, boolean>;
  /** underbase on a dark garment: set by hand (true / false); not set = decided from the inks (black, navy, dark reds don't need one) */ underbase?: boolean;
  /** screens set by hand (else colors + underbase) */ screens?: number;
  /** a reorder's mockup is visual only (Oct 20, Nick): the print details wait for production to confirm on the print
   *  run; greyed out with a stamp for staff, and the customer sees just the mockup (no guessed colors, inks or size) */
  visualOnly?: boolean;
  /** this print's screens are on file from an earlier order: remake price per screen (else group.remake) */ remake?: boolean;
  /** the film this print's screens are burned from (Oct 21, Nick: "we lost all our film files… if the film goes bad, we
   *  have to reburn a job from scratch"). asPrinted = the exact film it printed from is on file, so one screen can be
   *  remade on its own; physical = only the film in the drawer; new = fresh separations never printed, so a screen
   *  that pops means reburning every screen of this print together. `checked` = production looked the film over. */
  /** this print only runs on one press (Oct 21, Nick: "this bottles job, we have to run it on the 12 color… build that
   *  into the production scheduling"): the schedule only puts it there; reorders copy it (designs.specs) */
  pressOnly?: { id: string; name: string; by?: string; at?: string };
  /** we have a physical sample of it (production mockup step 7): true / false; left out = not asked */
  sample?: { have: boolean; by?: string; at?: string };
  /** times around the press (2 or 3: the pallet goes around again to flash before a later color), from the press setup */
  rounds?: number;
  /** it prints differently by shirt color (production mockup step 3): shirt color → the screens (by ink name) left off */
  byColor?: { skip: Record<string, string[]>; by?: string; at?: string };
  film?: { state: "asPrinted" | "physical" | "new"; files?: { path: string; name: string }[]; note?: string; by?: string; at?: string; checked?: { by: string; at: string } };
  /** the customer told us this size ("12 inches wide on the front"), or it's off the job's film (printed at this size before): changing it in the Mockup Creator asks first */ sizeFrom?: "customer" | "film" | "brand" | "staff";
  /** a fashion hit (Oct 16, Nick): no underbase on a dark shirt, each color printed, flashed and printed again through
   *  the same screen. Priced the same as with the underbase (two rounds on press) */ printStyle?: "fashion";
  /** a logo with a distress layer printed clean, without it (Oct 16: the distress is a layer, on unless turned off) */ distress?: "off";
  /** soft hand additive mixed into the inks */ softHand?: boolean;
  /** puff ink (Oct 30, Nick: "add a puff print option to the screen print imprint… It's $1 typically"; "puff screen
   *  print is different than puff 3D embroidery"): a raised screen print, charged per piece (PriceList.puffPrice) and
   *  printed slower with a flash (lib/production.ts). Screen prints only; embroidery's 3D puff is emb.puff */ puff?: boolean;
  /** not known for sure (a reorder of an old Printavo job with no film found): production confirms before printing */
  /** a color change (Oct 24, Nick: "on the mauve sweatshirts… a burgundy print… on the blue spruce… white"): by garment
   *  color (lowercase), each of the print's inks that prints differently there: ink name → the ink on that color.
   *  Each changed ink is a screen's ink change (inkChanges, the Ink change fee) */ inkBy?: Record<string, Record<string, string>>;
  /** embroidery only: the other spots this print sews on, by garment (lib/spotChange.ts spotKey → location: "stc15" →
   *  "Cuff"); every other garment sews at `location` (Oct 30, Nick: "a location change… same logo, same file") */ spotBy?: Record<string, string>;
  /** customer supplied transfers (Oct 27, Nick: "there should be a click box that says customer supplied… you should be
   *  able to just upload the placement reference"): heat press only; they send the transfers (DTF Dallas, their order
   *  number) and we press them where their placement reference shows. Not priced; nothing else on the print to fill in.
   *  picture = the placement reference as a picture (a PDF's first page), file = what was uploaded */
  /** the customer's picture of where this logo goes (Oct 27, Nick: "just like you did with Heat Press… a customer placement
   *  PDF, we need to have that exact same thing there"): shown on the order and the work order */
  placeRef?: { path: string; name: string; file?: string };
  /** a custom spot's area (Oct 27, Nick: "front pocket… set the artboard size… 5x4"): inches, and which side; the
   *  location is the name typed (lib/mockup.ts registerAreas) */
  area?: { w: number; h: number; view?: "front" | "back" };
  supplied?: { by?: string; ref?: string; /** where they go, in words ("Front & back"), under the picture on the work order */ where?: string; picture?: { path: string; name: string; file?: string } };
  /** a color change across variations (Oct 27, Nick: #40111 Section Stack on the Charcoal tee and the Neon Blue long
   *  sleeve, two groups): this print is the same art as `imprint` (a print in another group of the order) in other inks.
   *  inks: that print's ink → the ink here ("" = that color isn't printed here). It prints from the same screens:
   *  setup is charged once for the pair (calcOrder), each changed ink is an ink change, and a screen the other print
   *  doesn't have is charged as setup */ changeOf?: { imprint: string; group?: string; inks: Record<string, string> };
  /** full color art, printed as simulated process (seps made in Separo); set in the Mockup Creator (Oct 26) */ fullColor?: boolean;
  confirm?: { size?: boolean; ink?: boolean; why: string; /** staff filled in what they think (still not confirmed): who and when */ filled?: { by: string; at: string } };
  /** changes made to the customer's art for this print (Oct 23, Nick: "here's your proof, here are the two changes we
   *  made: we flattened the black and we removed the thin stroke"): shown on the proof and the work order */
  artChanges?: string[];
  /** production (Jose) confirmed this print's details on a reorder: who and when (Reorder Details); `from` = taken
   *  from what production confirmed on an earlier order ("#40071"), lib/designSpecs.ts */
  confirmed?: { by: string; at: string; from?: string };
  /** what the AI read off the customer's mockup (size, drop, on which garment size), to learn from staff changes */ aiPlace?: { size: string; drop: string; garment: string; kind: string }; /** inches down from the collar; blank = standard */ drop?: string; /** the customer design printed here */ design_id?: string; /** staff confirmed a small print really goes on this big location */ keepLocation?: boolean;
  /** a new order that says "same process as order 85254": the past job this print copies how it printed (colors, inks,
   *  size) from, and that job's mockup (Oct 23, Logotology PO 92785 → Printavo #32303) */ sameAs?: { ref: string; label: string; pic?: string; /** its mockup PDF, to measure the print on */ pdf?: string; /** all its PDFs (the mockup sheet may be any of them) */ pdfs?: string[] }; };
/** A piece of customer art, saved under their account and reused across orders. */
export type Design = { id: string; number: number; customer_id: string | null; name: string; file_path: string; file_name: string; file_type: string; preview_path: string; width_px: number | null; height_px: number | null; starred?: boolean; archived_at?: string | null;
  /** in the customer's logos (their library), saved there on purpose (Oct 31, Nick: "you're just saving mockups unless we tell you to save a specific artwork"); else a background logo the mockups and orders use */ saved?: boolean; /** made by the portal for an order that hasn't gone out yet (lib/draftArt.ts) */ draft?: boolean; /** made in the shirt designer: where its editable layers are saved */ designer?: { file: string } | null; /** how it prints (lib/printPlan.ts PrintPlan), shared by the Mockup Creator and separations */ print_plan?: unknown;
  /** where the art really sits in the file once its background is removed / empty margins cut (original pixels) */ art_box?: { x: number; y: number; w: number; h: number; of: { w: number; h: number } } | null; method: string; colors: number; inks: string; notes: string; created_by: string; created_at: string;
  /** extra facts on a logo: distressed (prints as a fashion hit for some customers), the original file before it was
   *  edited, how it shows on each shirt color ({ shirt: "Navy", ink: "White" }) */
  specs?: { distressed?: boolean; original?: { path: string; name: string; type: string; preview?: string }; onShirts?: { shirt: string; ink: string; path?: string; map?: Record<string, unknown> }[]; cropped?: boolean; [k: string]: unknown } | null };
export const designLabel = (d: Pick<Design, "number" | "name">) => `D-${d.number}${d.name ? " · " + d.name : ""}`;
/** Height for a given width (or width for a given height) from the design's proportions. */
export function designOther(d: Pick<Design, "width_px" | "height_px"> | null | undefined, value: number, given: "W" | "H", /** the print's own proportions (Imprint.artRatio) when known */ ratio?: number | null) {
  if (!value) return 0;
  if (!(ratio && ratio > 0) && (!d?.width_px || !d?.height_px)) return 0;
  const r = ratio && ratio > 0 ? ratio : d!.height_px! / d!.width_px!;
  return Math.round((given === "W" ? value * r : value / r) * 100) / 100;
}
/** One garment + color row, with its size run. */
export type GLine = {
  id: string; style: string; brand: string; garment: string; color: string; cost: number | "";
  /** the garment's color as picked in the Mockup Creator (its Background, or the eyedropper off the photo): what every
   *  picture of it shows (lib/mockup.ts lineColor) */ hex?: string;
  /** the color the Mockup Creator drew it in when nobody picked one (the catalog's code, the color read off its photo),
   *  saved with each mockup so the order's pictures match it (lib/mockup.ts lineHex) */
  shade?: string;
  sizes: Partial<Record<Size, number>>; priceOverride: number | null;
  /** an embroidery specialty item (hat, bag, fleece…) set by hand; unset = from its name, style and brand (isSpecialtyItem) */
  specialty?: boolean | null;
  /** a garment we have no photo of, drawn in the Mockup Creator: its look read off the customer's sheet (Oct 27) */
  look?: import("@/lib/stockGarments").GarmentLook;
  /** the email didn't name the style: what they called it ("tees"); Create order asks which blank, their preferred goods
   *  first (Oct 26, Nick), and clears this once it's picked */
  called?: string;
  /** a note for this line only (Oct 22, Nick: "add line item description… for each specific line"): under the line
   *  on the order, the invoice and the work order */
  note?: string;
  /** the customer's extras (Oct 22, Nick: McKenna sends one extra of each size under the line; "we don't charge for
   *  extra printing… we'll just go ahead and print them"): its own line under the real one, marked "Extras" on the
   *  order, invoice and work order, and printed free (price each 0) */
  extras?: boolean;
  /** their extras printed (true) or only counted and sent back blank (false); asked when the order is made (Oct 23,
   *  Nick: "are these extras? …to be printed or not to be printed… a little stamp next to that row") */
  extrasPrint?: boolean;
  /** their extras at no charge (ticked by default); unticked = printed and charged like the rest */
  extrasFree?: boolean;
  /** the shop's own pieces on this order: a shop sample, spares for misprints (Oct 29, Nick: "if we ordered extras and
   *  it's a shop sample, we shouldn't show it on the invoice for the client… spare for misprints… also be hidden.
   *  Customer extras is a different thing"). Printed with the job and on the work order, but never on anything the
   *  customer sees or is billed from (`withoutShopPieces`), never charged, and never counted toward the customer's breaks */
  shopUse?: boolean;
  /** One-size item (hat, koozie, bag): a single quantity instead of a size run. */
  oneSize?: boolean;
  /** Sizes this garment comes in, copied from the catalog when the style is picked. */
  sizeRun?: string[];
  /** 2XL+ material charge per piece from the supplier's size pricing (S&S). Overrides the settings upcharges on retail. */
  sizeUp?: Partial<Record<Size, number>>;
  /** what that supplier charge is marked up by on this line (Settings → 2XL+ markup when the style was picked, e.g. 1.2);
   * stamped on the line so a change to the setting never reprices quotes already sent. None = 1 (lines from before Oct 16). */
  sizeUpMarkup?: number;
  /** 2XL+ charge each typed by hand for a size (click the "+$" under the size; Oct 20, Nick): wins over everything else; blank = automatic */
  sizeUpSet?: Partial<Record<Size, number>>;
  /** priced by the customer's program rate card (lib/programs.ts): the price put on this line and how it was worked out */
  /** the program price; `base` + `adds` when finishing not in the program is added on top (5.50 + tag removal 1.00) */
  prog?: { each: number; note: string; base?: number; adds?: string };
  /** staff typed their own price over the program price: the program leaves this line alone */
  progOff?: boolean;
  /** an embroidered name on this line's piece (Oct 30, Nick: "add personalization… what item should we have
   *  personalized? …you type the name, and then it adds it to the line item"): one piece per name, its own line, the
   *  personalization price added to the piece (`persEach`), "Personalization: <name>" as the line's note */
  pers?: string;
  /** the names sewn on pieces of this line (Oct 30, Nick: "if there's multiple personalizations within an item, you would
   *  just say… size small, quantity one… medium… "): each its size, how many and the price each (the program's own, set
   *  by the order page; else the price list's). Shown under the line; charged on top of the line (group sub). */
  persList?: PersEntry[];
};
export type PersEntry = { id: string; text: string; size: Size | ""; qty: number; price?: number; /** where it's sewn (Nick: "you have to add a location… right chest or sleeve"); empty = Right Chest */ loc?: string; /** from an uploaded name list (its file, in the order's Production files) */ list?: { path: string; name: string } };
/** over this many names on a line, the order, invoice and QuickBooks show one summary line, with the list in Production files */
export const PERS_SHOW = 10;
/** a line's personalizations (the older single `pers`, a whole one-piece line, read the same way) */
export function persOf(l: Pick<GLine, "pers" | "persList" | "sizes" | "id">): PersEntry[] {
  if (l.persList?.length) return l.persList;
  if (!l.pers) return [];
  const z = SIZES.find((x) => +(l.sizes?.[x] || 0) > 0) || "";
  return [{ id: `${l.id}-p`, text: l.pers, size: z, qty: Object.values(l.sizes || {}).reduce((a: number, n) => a + (+(n || 0)), 0) || 1 }];
}
/** the personalization price on a piece: the price list's own (embroidery extras), else the contract list's, else $5 */
export function persEach(s: Settings, type: PriceType = "retail"): number {
  const find = (pl: PriceList) => [...(pl.embExtras || []), ...(pl.finishing || [])].find((f) => /personali[sz]/i.test(`${f.id} ${f.name}`));
  const f = find(priceList(s, type)) || find(s.wholesale);
  return f && !isNaN(+f.price) ? +f.price : 5;
}
/** Garments that share the same imprints. Quantity breaks use the group total. */
export type Group = { id: string; name?: string; /** priced by a program design's flat price, which is everything in: no setup (screens, digitizing, PMS, minimum) on this group (Oct 30, Nick: "the program pricing overrides the setup… zero setups") */ allIn?: boolean;
  /** a longer description of everything in the group (Oct 22, Nick: "a more detailed description for a group… that's
   *  not just the group name"): under the name on the order, the quote, the invoice and the work order */
  description?: string;
  lines: GLine[]; imprints: Imprint[]; finishing?: string[];
  /** finishing made up on this order (a label and a price per piece), ticked by id in `finishing` like the list's */
  customFin?: Finishing[];
  /** the tag print's price a piece on this job (Private Label / relabel), typed on the group's imprints; the list's when not set */
  tagPrice?: number;
  /** the customer's neck label set printed when Private Label is on (customers.neck_labels id; lib/neckLabels.ts) */
  neckLabel?: string; youth?: boolean;
  /** youth and adult shirts in this group: true = the prints that don't fit youth shirts get their own youth screens
   *  (each print's Imprint.youth), false = staff said the same screens print all of them; unset = not asked yet (the
   *  Mockup Creator asks once) */ youthSet?: boolean;
  /** when mockups were last saved for this group (unlocks the imprints section) */ mockupAt?: string;
  /** the mockup was made in the logo builder (Add logo): Edit mockup opens it there (lib/mockupFresh.ts mockupHref) */ mockupKind?: "logo";
  /** the color behind a logo mockup's picture (Oct 31, Nick: "pick the most used color in that group… a little color
   *  picker… when you hover over it, it says background"): picked with the Background button on the order; not set =
   *  the color of the garment with the most pieces (lib/mockup.ts mainLine). Only the picture, never the garments */ mockupBg?: string;
  /** each section's close-up background when a print has a color or colorway change (Oct 31, Nick: "change the background
   *  on the individual colorway swatches"): by the section's ink or colorway (lower case), "_a" for the as-printed one;
   *  not set = that section's garment with the most pieces */ mockupBgBy?: Record<string, string>;
  /** the group is a brand's master mockup (lib/masterMockups.ts): its prints and picture came from M-<number>, and only
   *  its garments and quantities were read off the paperwork */ masterMockup?: number;
  /** what the saved pictures were drawn from: when it changes they're drawn again by themselves (lib/mockupFresh.ts) */ mockupArt?: import("@/lib/mockupFresh").MockupArt;
  /** staff chose to fill in imprints without making a mockup */ mockupSkipped?: boolean;
  /** photos-only pictures of the latest saved mockups (storage paths), shown as thumbnails on the order */ mockupThumbs?: string[];
  /** the size the mockup is shown on (2T, 3T…), picked in the Mockup Creator; else the middle size of the run */ mockupSize?: string;
  /** where each print was dragged to on the shirt pictures in the Mockup Creator (reference-photo pixels, by imprint id or
   *  "<line id>:<imprint id>"), so a reopened mockup shows it where it was put (Oct 22, Nick: "it returns back to the
   *  original placement") */ mockupOffsets?: Record<string, { dx: number; dy: number }>;
  /** made from the customer's saved mockup (Oct 24): its prints and garments are fixed on their order request */
  fromMockup?: { id: string; number: number | null };
  /** a customer's reorder (Oct 24, Nick): the prints are what was printed before ("#40123"), shown like a mockup's, fixed; the sizes are theirs */
  reprintOf?: string;
  /** mockups the customer supplied themselves (their own software, or saved from the portal builder): storage paths */
  customerMockups?: { path: string; name: string }[];
  /** Tag Print: the label art the customer uploaded in the portal when there's no tag on file (storage path) */
  tagArt?: { path: string; name: string };
  /** a reorder of an old Printavo job: its mockup PDF(s), where the art is pulled from when the order is made */
  pvArt?: { path: string; name: string; /** what it is in the new order's Production files (lib/productionFileKinds.ts) */ kind?: string; note?: string }[];
  /** a reorder of an old Printavo job: its mockup pictures (ours, not the customer's), kept in production files */
  pvRef?: { path: string; name: string }[];
  /** a reorder of several past jobs in one order: the past job (PastJob.ref) this group repeats */
  reorderFrom?: string;
  /** the garments are polyester, nylon or dyed: specialty (low-bleed) ink, charged per location (contract pricing).
   *  Set from the garments' fabric by the order editor unless staff set it by hand (specialtyInkSet) */ specialtyInk?: boolean;
  /** staff ticked / unticked specialty ink themselves: the garments no longer decide */ specialtyInkSet?: boolean;
  /** why specialty ink was picked automatically ("ST350: 100% polyester") */ fabricNote?: string;
  /** the screens are on file from an earlier order: remake price instead of new setup */ remake?: boolean;
  /** a reorder of a portal order: the group it was copied from (its mockups are copied with it, not made again) */ fromGroup?: string;
  /** staff answered the reprint screen fee question on this reorder (No, keep the new screen fee) */ reprintAsked?: boolean;
  /** price per screen from the customer's program (Oct 14: Tiger Blue pays $15 a screen, they supply separations);
   *  set by the order page while Program is on, instead of the price list's screen fee */ screenFee?: number };
export type PriceType = "retail" | "wholesale";

/** Older orders stored one garment per line with its own decorations. */
export type Decoration = { id: string; method: Method; location: string; colors: number };
export type Line = {
  id: string; garment: string; style: string; color: string; cost: number | "";
  sizes: Partial<Record<Size, number>>; decorations: Decoration[]; priceOverride: number | null;
};
export type Fee = { label: string; amount: number | "";
  /** the order's shipping charge (from the Shipping quote; shown as "Shipping", not a fee) (Oct 16, Nick) */ ship?: boolean;
  /** free shipping: the quoted price stays on the line but isn't charged */ free?: boolean;
  /** shipping to be decided later (Oct 27, Nick: backpacks, "two to a backpack, three… we're gonna have to figure that
   *  out later"): $0 now, shown as TBD on the order, quote and invoice */ tbd?: boolean };
/** The shipping line among an order's fees (marked, or an older "Shipping…" fee). */
export const isShipFee = (f: { label?: string; ship?: boolean }) => !!f.ship || /^shipping\b/i.test(f.label || "");
/** What a fee adds to the total (free shipping adds nothing). */
export const feeAmount = (f: { amount: number | ""; free?: boolean; tbd?: boolean }) => (f.free || f.tbd ? 0 : +f.amount || 0);
/** "tbd": the customer hasn't said yet (Oct 28, Nick: "sometimes customers give us an order and then don't tell us") */
export type Delivery = "pickup" | "ship" | "deliver" | "tbd";

export type Order = {
  id: string; number: number; customer_id: string | null; nickname: string; status: StatusKey; type: "quote" | "invoice";
  /** started, not saved or sent yet: no real number, in no list (Oct 24; migration 209) */ draft?: boolean; discarded_at?: string | null;
  due_date: string | null; lines: Line[]; groups: Group[]; fees: Fee[]; discount_pct: number; discount_amt?: number; discount_type?: "pct" | "amt"; tax_exempt: boolean; tax_rate: number | null;
  waive_setup: boolean; notes: string; /** print the customer notes on the quote / invoice (Oct 30, Nick: a checkbox) */ notes_on_invoice?: boolean; total: number; qty: number; sent_at: string | null; approved_at: string | null;
  approved_name: string | null; created_at: string; updated_at: string;
  /** the customer walked away (Job Center → Mark declined; migration 232): under Declined for two weeks */ declined_at?: string | null; declined_reason?: string;
  /** New order / Reorder / Reorder with changes (Oct 24, Nick; orders.order_type). Null = worked out from the order */ order_type?: "new" | "reorder" | "reorder_changes" | null;
  price_type: PriceType; /** priced by the customer's program rate card (the chip next to Retail / Wholesale) */ use_program?: boolean; /** which of the customer's rate cards (programs.rate_cards id, "main" = the first) */ program_card?: string | null; submitted_at?: string | null; completed_at?: string | null; source?: string; po_number: string; production_date: string | null; rush: boolean; /** firm in-hands (can't slip), and the time it's needed that day (minutes; null = end of day) */ firm?: boolean; due_time?: number | null; delivery_method: Delivery; ship_to: string; ship_method: string; tracking: string; /** bill third party: the carrier account this shipment is billed to (lib/thirdParty.ts) */ third_party?: import("@/lib/thirdParty").ThirdParty | null;
};
export type Garment = { id: string; style: string; brand: string; description: string; colors: string[]; cost: number; sizes?: string[]; /** the supplier's size chart: flat body width / length per size (inches) */ specs?: import("@/lib/garmentBody").GarmentSpecs | null; size_costs?: Record<string, number>; /** each color's own cost by size (suppliers price colors differently; Oct 20) */ color_size_costs?: Record<string, Record<string, number>> | null; ss_style_id?: number | null; image?: string; synced_at?: string | null; color_images?: Record<string, { front: string; back: string; side: string; hex: string; /** the hood's edge on the back photo (photo px), traced in the Mockup Creator: prints go behind the hood */ hoodBack?: [number, number][]; /** where the back photo came from when the supplier had none: sanmar, model, side, upload, picked, or drawn (Oct 26) */ back_from?: string }>; /** fiber content lines from the supplier ("100% polyester") */ fabric?: string; /** "ss" or "sanmar" */ supplier?: string | null; supplier_style?: string | null };
export type ArtFile = { id: string; order_id: string; name: string; file_path: string; file_type: string; created_at: string; /** what it is: barcodes, film, mailing list… (lib/productionFileKinds.ts, migration 177) */ category?: string | null; /** what the AI thinks it is (confirm) */ guess?: string | null; note?: string | null };
export type Payment = { id: string; order_id: string; amount: number; method: string; paid_on: string; stripe_session_id: string | null; created_at: string; fee?: number; processor_id?: string | null; note?: string | null };
export type Customer = { id: string; /** the design catalog shows in their portal too (Oct 24) */ design_catalog_portal?: boolean; /** brand standards show in their portal (default on) */ brand_portal?: boolean; is_test?: boolean; /** starred: top of the Customers list (Oct 21, Nick) */ favorite?: boolean; /** the Designs tab: orders grouped by design (customers.design_catalog) */ design_catalog?: boolean; company: string; name: string; email: string; phone: string; address: string; notes: string; tax_exempt: boolean; created_at: string; contact2_name: string; contact2_email: string; contact2_phone: string; ship_address: string; /** other addresses besides billing and ship-to (a delivery address, a second location): Oct 26, Nick */ other_addresses?: { id: string; label: string; address: string }[]; price_type: PriceType; payment_terms?: PayTerms;
  /** CRM */ tags?: string[]; next_follow_up?: string | null; owner_email?: string; /** account owner's name (Settings → Staff) */ account_owner?: string; last_contact_at?: string | null;
  /** Create order training (Oct 30): how this customer's orders are made, read in full by the order reader */ order_training?: string; /** what the training is called ("All My Sons") and the words that mark a job for it ("AMS, All My Sons"): Create order offers to make it by the training */ order_training_name?: string; order_training_when?: string;
  /** the EasyPost carrier account their shipments go on (their own: Nine18 FEDEX); empty = FBS's */ ship_on?: string; /** shipping: whose carrier account pays (fbs = ours, with markup) */ ship_bill?: "fbs" | "ups" | "fedex"; ship_ups_account?: string; ship_fedex_account?: string; ship_bill_zip?: string;
  /** their brand inks ("Red" = "PMS 199 C"), first in every Mockup Creator ink dropdown for them (Oct 16) */ brand_colors?: BrandColor[];
  /** their print sizes and how their prints are made (Oct 16) */ brand_print?: BrandPrint };
/** One of a customer's brand colors: what they call it and the exact ink. */
/**
 * Brand standards beyond colors (Oct 16, Nick): "Peticolas' circle logo is always 10.5" on the front and 3" on the nape";
 * "we never underbase their distressed logos, we hit it twice with one screen". Sizes are applied in the Mockup Creator
 * on their own (that's what the customer always wants); how it prints sets each new print's Standard / Fashion hit.
 */
export type BrandSize = { id: string; which: "any" | "round" | "wide" | "tall" | "design"; design_id?: string; location: string; width: number; note?: string };
export type BrandPrint = { sizes?: BrandSize[]; hit?: "standard" | "fashion" | "ask"; soft?: boolean; distressedOnly?: boolean;
  /** their other rules, in plain words ("never on red shirts", "0.5\" clear space around the circle"): shown in the Mockup Creator and on the work order */ rules?: string[];
  /** their distress texture (Oct 22, Peticolas_Film_Mask): a mask picture (white = texture) laid over their art; the film
   *  stacks it `layers` times (3), the mockup shows one layer (the shirt shows through) */ distress?: { path: string; name?: string; layers?: number } };
/** the customer has print standards on file: a size, a print style, soft hand, a rule or a distress mask. An empty record
 *  ({} left by opening the editor, Oct 30: A Premier Brand showed "Set from A Premier Brand's brand standards" with none
 *  made) is none. Every place that says a customer has standards asks this. */
export function hasBrandPrint(bp: BrandPrint | null | undefined): boolean {
  if (!bp) return false;
  return (bp.sizes || []).some((r) => r && +r.width > 0) || (!!bp.hit && bp.hit !== "ask") || !!bp.soft || (bp.rules || []).some((r) => String(r || "").trim()) || !!bp.distress?.path;
}
/** a logo's shape by its width ÷ height: round (about as tall as wide), wide or tall */
export const logoShape = (ratio: number | null | undefined): "round" | "wide" | "tall" | "" => (!ratio ? "" : ratio > 1.18 ? "wide" : ratio < 0.85 ? "tall" : "round");
/** the customer's size for this logo on this location: a rule for that logo first, then its shape, then any logo */
export function brandSizeFor(bp: BrandPrint | null | undefined, designId: string | undefined, ratio: number | null | undefined, location: string): BrandSize | null {
  const here = (bp?.sizes || []).filter((r) => r.width > 0 && r.location === location);
  const shape = logoShape(ratio);
  return here.find((r) => r.which === "design" && !!designId && r.design_id === designId) || here.find((r) => r.which !== "design" && r.which !== "any" && r.which === shape) || here.find((r) => r.which === "any") || null;
}
/** how a new print for this customer prints on a dark shirt: a fashion hit (and soft hand), standard, or null = ask */
export function brandHitFor(bp: BrandPrint | null | undefined, distressed: boolean): { printStyle?: "fashion"; softHand?: boolean } | null {
  if (!bp?.hit || bp.hit === "ask") return null;
  if (bp.hit === "fashion" && (!bp.distressedOnly || distressed)) return { printStyle: "fashion", softHand: !!bp.soft };
  return { softHand: bp.hit === "standard" && !!bp.soft && !bp.distressedOnly ? true : undefined };
}
/** puff ink on a screen print, each piece per puffed location (Imprint.puff) */
export const PUFF_PRICE = 1;
export const puffEach = (pl: Pick<PriceList, "puffPrice">) => (pl.puffPrice == null || isNaN(+pl.puffPrice) ? PUFF_PRICE : +pl.puffPrice);
/** a screen print as the customer reads it: "3-color screen print", "2-color fashion print (soft, no underbase)", "1-color puff print" */
export function printHow(d: Pick<Imprint, "method" | "colors" | "printStyle" | "softHand" | "puff">): string {
  if (d.method !== "screen") return d.method === "embroidery" ? "embroidery" : "full color DTF transfer";
  if (d.colors >= FULL_COLOR) return "full color screen print";
  const n = `${d.colors || 1}-color`;
  if (d.printStyle === "fashion") return `${n} fashion ${d.puff ? "puff " : ""}print (${d.softHand ? "soft, " : ""}no underbase)`;
  return `${n} ${d.puff ? "puff" : "screen"} print${d.softHand ? " (soft hand)" : ""}`;
}

export type BrandColor = { name: string; ink: string; /** a wholesaler's client or a second brand ("All My Sons"); none = the account's own */ group?: string };
/** One entry on a customer's timeline: an email, call, note, meeting or task. */
export type Activity = { id: string; customer_id: string | null; order_id: string | null; kind: "note" | "call" | "email" | "meeting" | "task" | "sms"; direction: "in" | "out" | "none"; subject: string; body: string; from_email: string; to_email: string; external_id: string | null; thread_id: string | null; occurred_at: string; ai_processed_at: string | null; meta: Record<string, unknown>; created_by: string; created_at: string };
/** One item in the Assistant inbox. */
export type Suggestion = { id: string; kind: string; source: "rules" | "ai" | "staff"; status: "open" | "snoozed" | "done" | "dismissed"; priority: 1 | 2 | 3; dedupe_key: string | null; customer_id: string | null; order_id: string | null; activity_id: string | null; title: string; body: string; draft: { channel?: "portal" | "email"; subject?: string; body?: string }; payload: Record<string, unknown>; due_at: string | null; snoozed_until: string | null; model: string | null; decided_at: string | null; decided_by: string | null; created_at: string; updated_at: string };
export type Proof = { id: string; order_id: string; title: string; file_path: string; file_type: string; status: "pending" | "approved" | "changes"; customer_comment: string; decided_at: string | null; decided_name: string | null; created_at: string;
  /** Oct 16: proofs are only versions sent to the customer (lib/proofs.ts) */
  version?: number | null; sent_at?: string | null; sent_to?: string | null; viewed_at?: string | null; last_viewed_at?: string | null; view_count?: number;
  reminded_at?: string | null; approved_via?: "staff" | null; mockup_id?: string | null; archived_at?: string | null };
export type Message = { id: string; order_id: string; author_type: "staff" | "customer"; author_email: string; author_name: string; body: string; read_at: string | null; created_at: string };
export type OrderEvent = { id: number; order_id: string; kind: string; detail: string; actor: string; created_at: string };

/** One imprint price list (retail or wholesale). */
export type PriceList = {
  tiers: number[]; screen: number[][]; embroidery: number[]; dtf: number[];
  screenFee: number; digitizing: number; inkChangeFee: number;
  upcharges: Partial<Record<Size, number>>;
  /** Optional all-inclusive retail model (ooshirts style). All arrays are per tier. */
  blankAdd?: number[];        // added to each garment's price (handling / shipping built in)
  screenLight?: number[][];   // screen print per location on light garments (screen = dark garments)
  dtg?: number[];             // full-color digital print per location, dark garments
  dtgLight?: number[];        // full-color digital print per location, light garments
  lightColors?: string[];     // garment colors that get light-garment screen prices
  dtgLightColors?: string[];  // garment colors that get light-garment full-color prices (no white underbase)
  colorAdjust?: Record<string, number>; // per-piece price change by garment color (e.g. White -0.065)
  /* Contract (wholesale) rules, from the FBS Contract Pricing List */
  /** dark garments (not on lightColors): one more color for the underbase, priced and set up like any color */
  darkAddsColor?: boolean;
  /** jobs under this many pieces are charged as this many */
  minQty?: number;
  /** screen remake per color, when the screens are on file (group.remake) */
  remakeFee?: number;
  /** PMS matching (non-standard ink), per matched color (imprint.pms) */
  pmsFee?: number;
  /** special imprint locations (sleeve, pocket, side): per location per piece */
  specialLocPrice?: number;
  specialLocations?: string[];
  /** specialty ink for polyester, nylon or dyed garments (group.specialtyInk): per location per piece, per screen tier */
  specialtyInk?: number[];
  /** this list's own finishing add-ons (contract prices); retail's list when not set */
  finishing?: Finishing[];
  /** embroidery's own quantity breaks (embroidery[] is per these), stitches included, each extra 1,000, and the
   *  specialty-item add-on (fleece, hats, beanies, bags, backpacks: any non-standard flat garment) per break */
  embTiers?: number[]; embStitches?: number; embPer1k?: number; embSpecialty?: number[];
  /** digitizing (Oct 28, Nick: "the digitizing fee is $40… then $1 for every 1,000 stitches after 6,000… unless we
   *  override it… super complex"): the stitches the base fee covers, and each extra 1,000 (started) after them */
  digStitches?: number; digPer1k?: number;
  /** embroidery extras per piece (specialty thread, 3D puff, personalization…), ticked on a group with embroidery */
  embExtras?: Finishing[];
  /** puff ink on a screen print (Imprint.puff), per puffed location per piece; not set = $1 (Oct 30, Nick) */
  puffPrice?: number;
  /** the price sheet's own notes (spoilage, rush, digitizing ranges…), shown with the list */
  contractNotes?: string;
};
/** non-standard flat garments (embroidery specialty items), from the garment's name */
export const SPECIALTY_ITEM = /\b(hat|cap|snapback|trucker|beanie|knit|bag|backpack|tote|duffel|fleece|hood(ie|ed)?|sweatshirt|crewneck sweat|jacket|jkt|jckt|coat|parka|anorak|windbreaker|soft ?shell|vest|blanket|towel|apron)s?\b/i;
/** the specialty words a garment name can be cut off in (the supplier's 30-odd character names: "Carhartt Thermal-Lined
 *  Duck Active Jac", Oct 31, #40311: the jacket wasn't charged as one) */
const SPECIALTY_WORDS = ["backpack", "beanie", "blanket", "duffel", "fleece", "hoodie", "hooded", "jacket", "parka", "anorak", "windbreaker", "sweatshirt", "snapback", "trucker", "towel", "apron"];
/** a garment name that's a specialty item: by its words, or (cut off) by a last word that's the start of one ("Jac") */
export function specialtyText(t: string): boolean {
  if (SPECIALTY_ITEM.test(t)) return true;
  const last = ((t || "").trim().match(/([A-Za-z]{3,})[^A-Za-z]*$/) || [])[1]?.toLowerCase() || "";
  return !!last && SPECIALTY_WORDS.some((w) => w !== last && w.startsWith(last));
}
/** brands that only make headwear: a line with just a style number ("Richardson 115", "Flexfit 110M") is still a hat
 *  (Oct 27, Nick: the hat add-on wasn't charged on #40181, whose lines had no garment name) */
export const HEADWEAR_BRAND = /^\s*(richardson|flexfit|yupoong|yp classics|pacific headwear|imperial|outdoor cap|legacy|infinity her|otto( cap)?|atlantis( headwear)?|kati|sportsman|decky|valucap|ahead|new era|cap america|dorfman|melin)\b/i;
/** an embroidery specialty item (hats, beanies, bags, fleece, jackets…): from the line's name, style and brand, or its
 *  own tick (GLine.specialty) */
export const isSpecialtyItem = (l: { garment?: string; style?: string; brand?: string; specialty?: boolean | null }) =>
  l.specialty != null ? !!l.specialty : specialtyText(l.garment || "") || SPECIALTY_ITEM.test(`${l.garment || ""} ${l.style || ""}`) || HEADWEAR_BRAND.test(l.brand || "") || !!headwearOf(l)
    || /^(C\d{3}|CP\d{2,3}|STC\d{2})\b/i.test((l.style || "").trim()); // Port Authority / Sport-Tek caps
/** the hat's own spots past the front (sides, back) are special locations like a sleeve (Oct 27, Nick) */
export const HAT_SPECIAL_LOCATIONS = ["Left Side", "Right Side", "Back"];
export const FULL_COLOR = 11;
/** True when a garment color is on the light-garment list. */
const normColor = (c: string) => (c || "").trim().toLowerCase().replace(/^sports /, "sport ");
export function isLightColor(color: string, pl: Pick<PriceList, "lightColors">, list = pl.lightColors) {
  const c = normColor(color);
  return !!c && (list || []).some((x) => normColor(x) === c);
}
/** a per-piece add-on. `more`: a sometimes-used one, kept under "+ More" on orders instead of shown every time (Oct 20, Nick: suffocation bags) */
export type Finishing = { id: string; name: string; price: number; more?: boolean };
/** Someone who owns customer accounts (a salesperson / account manager). Email links them to their shop login. */
export type AccountOwner = { name: string; email: string };
export const DEFAULT_ACCOUNT_OWNERS: AccountOwner[] = [{ name: "Nicholas McCoy", email: "nicholas@fbsprint.com" }, { name: "Amanda McCoy", email: "" }, { name: "Claudia Garcia", email: "" }];
/** Is this account owner the person signed in? (their email, or the same first name as their staff name) */
export function isMe(owner: string, owners: AccountOwner[], me: { email: string; name: string }) {
  if (!owner) return false;
  const o = owners.find((x) => x.name === owner);
  if (o?.email && me.email && o.email.toLowerCase() === me.email.toLowerCase()) return true;
  const first = (x: string) => x.trim().split(/[\s._@-]+/)[0].toLowerCase();
  return !!me.name && first(owner) === first(me.name) || (!!me.email && first(owner) === first(me.email));
}
export type Settings = PriceList & {
  /** people who own customer accounts ("My accounts" views use this) */
  accountOwners?: AccountOwner[];
  shop: { name: string; address: string; phone: string; email: string; terms: string; logoUrl: string;
    /** social links in the portal footer (Oct 24, Nick) */ facebook?: string; instagram?: string };
  /** The logo at the top of the shop's left menu (dark background, so a light version), its width, and the line under it. */
  brand: { sideLogoUrl: string; sideLogoWidth: number; sideTagline: string };
  markup: number; taxRate: number; depositPct: number;
  /** 2XL+ (2XL–5XL) supplier upcharge markup: the supplier's extra cost for a big size × this (1.2 = +20%) (Oct 16, Nick) */
  sizeUpMarkup?: number;
  /** online payments: card fee % (credit card only), and where to send Zelle / Venmo */
  pay: { cardFeePct: number; zelle: string; venmo: string };
  wholesale: PriceList;
  finishing: Finishing[];
  /** Follow-up rules and the (optional) AI assistant. */
  assistant: AssistantSettings;
  /** Shipping center: pieces per box, where we ship from, saved box sizes, and the markup on our own account. */
  ship: ShipSettings;
};

export type ShipAddress = { name: string; company: string; street1: string; street2: string; city: string; state: string; zip: string; country: string; phone: string; email: string };
export type BoxSize = { name: string; length: number; width: number; height: number };
export type ShipSettings = {
  perBox: number;          // pieces that fit in one box (for the box estimate)
  from: ShipAddress;       // our return / pickup address
  boxes: BoxSize[];        // box sizes we keep on hand
  defaultBox: string;      // the size new boxes start at (by name)
  markupPct: number;       // on our account: what we paid + this %
  perBoxFee: number;       // + this per box
  minCharge: number;       // at least this
  thirdPartyFee: number;   // per box, when it ships on the customer's own account (0 = free)
  goodsLeadDays: number;   // customer supplied goods must arrive this many business days before the in-hands date
  /** the box the transit map prices (and from which ZIP; blank = our ship-from ZIP) */
  transitBox?: TransitBox;
};
export type TransitBox = { length: number; width: number; height: number; weightLb: number; fromZip: string };
export const DEFAULT_TRANSIT_BOX: TransitBox = { length: 12, width: 10, height: 8, weightLb: 10, fromZip: "" };

/** When the Assistant flags things, and what the AI is allowed to do. AI stays off until an API key is set AND ai.enabled is on. */
export type AssistantSettings = {
  quoteFollowUpDays: number;   // quote sent, no answer after this many days
  proofFollowUpDays: number;   // proof waiting on the customer this many days
  replyWithinHours: number;    // customer message with no reply after this many hours = urgent
  priceRequestDays: number;    // customer order request not priced after this many days
  atRiskDays: number;          // job not printing yet and due within this many days
  pickupRemindDays: number;    // ready for pickup this many days
  reorderAfterDays: number;    // customers with no order in this many days get a check-in
  digest: boolean;             // email the shop a daily list of follow-ups
  ai: {
    enabled: boolean;          // master switch
    model: string;             // Claude model for drafting and reading orders
    fastModel: string;         // cheaper model for sorting emails
    readEmails: boolean;       // read forwarded emails and suggest orders / replies
    customerAssist: boolean;   // "describe your order" box in the customer order form
    voice: string;             // how the shop sounds in drafted messages
  };
};

export const DEFAULT_SETTINGS: Settings = {
  accountOwners: DEFAULT_ACCOUNT_OWNERS,
  shop: { name: "FBS Print", address: "", phone: "", email: "", terms: "50% deposit to start production. Balance due at pickup.", logoUrl: "" },
  brand: { sideLogoUrl: "/brand/fbs-logo-white.svg", sideLogoWidth: 64, sideTagline: "Shop management" },
  markup: 50,
  sizeUpMarkup: 1.2,
  taxRate: 8.25,
  depositPct: 50,
  pay: { cardFeePct: 3.25, zelle: "", venmo: "" },
  upcharges: { "2XL": 2, "3XL": 3, "4XL": 4, "5XL": 5 }, // 2XL+ Materials Charge (per piece, billed as their own line)
  tiers: [12, 24, 48, 72, 144, 288, 500],
  screen: [
    [4.5, 5.5, 6.5, 7.5, 8.5, 9.5],
    [3.25, 4.0, 4.75, 5.5, 6.25, 7.0],
    [2.4, 3.0, 3.6, 4.2, 4.8, 5.4],
    [1.95, 2.45, 2.95, 3.45, 3.95, 4.45],
    [1.5, 1.9, 2.3, 2.7, 3.1, 3.5],
    [1.2, 1.5, 1.8, 2.1, 2.4, 2.7],
    [0.95, 1.2, 1.45, 1.7, 1.95, 2.2],
  ],
  embroidery: [9, 8, 7, 6.5, 6, 5.5, 5],
  dtf: [7, 6, 5, 4.5, 4, 3.5, 3],
  screenFee: 25,
  digitizing: 45,
  inkChangeFee: 15,
  wholesale: {
    tiers: [12, 24, 48, 72, 144, 288, 500],
    screen: [
      [3.25, 4.0, 4.75, 5.5, 6.25, 7.0],
      [2.4, 3.0, 3.6, 4.2, 4.8, 5.4],
      [1.75, 2.2, 2.65, 3.1, 3.55, 4.0],
      [1.4, 1.8, 2.2, 2.6, 3.0, 3.4],
      [1.1, 1.4, 1.7, 2.0, 2.3, 2.6],
      [0.9, 1.15, 1.4, 1.65, 1.9, 2.15],
      [0.7, 0.9, 1.1, 1.3, 1.5, 1.7],
    ],
    embroidery: [7, 6.25, 5.5, 5, 4.5, 4.25, 4],
    dtf: [5.5, 4.75, 4, 3.5, 3.25, 3, 2.75],
    screenFee: 20,
    digitizing: 40,
    inkChangeFee: 15,
    upcharges: { "2XL": 0.5, "3XL": 0.75, "4XL": 1, "5XL": 1 },
  },
  finishing: [
    { id: "fold_bag", name: "Fold & bag", price: 0.5 },
    { id: "hang_tag", name: "Hang tag", price: 0.35 },
    { id: "relabel", name: "Private Label (Remove MFG Tags)", price: 1.0 },
  ],
  assistant: {
    quoteFollowUpDays: 3,
    proofFollowUpDays: 2,
    replyWithinHours: 24,
    priceRequestDays: 1,
    atRiskDays: 5,
    pickupRemindDays: 5,
    reorderAfterDays: 150,
    digest: false,
    ai: {
      enabled: false,
      model: "claude-sonnet-5",
      fastModel: "claude-haiku-4-5-20251001",
      readEmails: false,
      customerAssist: false,
      voice: "Friendly, short and plain-spoken, like a local print shop owner.",
    },
  },
  ship: {
    perBox: 72,
    from: { name: "Shipping", company: "FBS Print", street1: "", street2: "", city: "Richardson", state: "TX", zip: "75081", country: "US", phone: "9724877858", email: "" },
    boxes: [
      { name: "Small", length: 14, width: 10, height: 8 },
      { name: "Medium", length: 18, width: 14, height: 10 },
      { name: "Large", length: 21, width: 16, height: 13 },
      { name: "XL", length: 24, width: 18, height: 12 },
    ],
    defaultBox: "Large",
    markupPct: 15, perBoxFee: 2, minCharge: 0, thirdPartyFee: 0,
    goodsLeadDays: 3,
  },
};

/**
 * The contract list as first loaded (Oct 7) had the embroidery extras and vinyl in its finishing. Finishing is fold,
 * poly bag, barcode and tag removal; the embroidery extras have their own list (Nicholas, Oct 7). Fixed on read until
 * the settings are saved again.
 */
function contractFinishing(w: PriceList): PriceList {
  if (!w.finishing?.some((f) => /^(emb_|vinyl_)/.test(f.id))) return w;
  const moved = w.finishing.filter((f) => f.id.startsWith("emb_") && !(w.embExtras || []).some((x) => x.id === f.id));
  return { ...w, embExtras: [...(w.embExtras || []), ...moved], finishing: w.finishing.filter((f) => !/^(emb_|vinyl_)/.test(f.id)) };
}
/** Fill any missing keys in stored settings with defaults. */
export function mergeSettings(data: unknown): Settings {
  const d = (data && typeof data === "object" ? data : {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...d,
    shop: { ...DEFAULT_SETTINGS.shop, ...(d.shop || {}) },
    brand: { ...DEFAULT_SETTINGS.brand, ...(d.brand || {}) },
    pay: { ...DEFAULT_SETTINGS.pay, ...(d.pay || {}) },
    upcharges: { ...DEFAULT_SETTINGS.upcharges, ...(d.upcharges || {}) },
    wholesale: contractFinishing({ ...DEFAULT_SETTINGS.wholesale, ...(d.wholesale || {}), upcharges: { ...DEFAULT_SETTINGS.wholesale.upcharges, ...(d.wholesale?.upcharges || {}) } }),
    finishing: Array.isArray(d.finishing) ? d.finishing : DEFAULT_SETTINGS.finishing,
    assistant: { ...DEFAULT_SETTINGS.assistant, ...(d.assistant || {}), ai: { ...DEFAULT_SETTINGS.assistant.ai, ...(d.assistant?.ai || {}) } },
    ship: { ...DEFAULT_SETTINGS.ship, ...(d.ship || {}), from: { ...DEFAULT_SETTINGS.ship.from, ...(d.ship?.from || {}) }, boxes: Array.isArray(d.ship?.boxes) && d.ship.boxes.length ? d.ship.boxes : DEFAULT_SETTINGS.ship.boxes },
  };
}

/** The price list and garment rules for retail or wholesale work. */
/** A big size's material charge on a line from the supplier's size price: the extra cost × the line's markup (program
 * lines are priced by their rate card, never marked up). */
export const sizeUpEach = (l: { sizeUp?: Partial<Record<Size, number>>; sizeUpMarkup?: number; prog?: unknown }, sz: Size) =>
  Math.round(num(l.sizeUp?.[sz]) * (l.prog ? 1 : num(l.sizeUpMarkup) || 1) * 100) / 100;
/** The supplier's extra cost for 2XL–5XL over the base size, and the markup to stamp on the line (Settings). */
/**
 * A color's own costs by size, when the supplier prices colors differently (Oct 20, Nick: the PC55RS White/Royal 4XL is
 * $7.98 over a $4.44 base, but the cheapest color's $5.61 over $4.07 gave +$1.85). The color is matched loosely
 * ("White / Royal" = "White/ Royal"). Base = the color's lowest regular-size (not 2XL+) cost.
 */
export function colorCosts(gm: { size_costs?: Record<string, number> | null; color_size_costs?: Record<string, Record<string, number>> | null; cost?: number | string | null }, color?: string | null): { base: number; sizes: Record<string, number> } {
  const k = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const per = gm.color_size_costs || {};
  const hit = color ? per[color] || Object.entries(per).find(([c]) => k(c) === k(color))?.[1] : undefined;
  if (hit && Object.keys(hit).length) {
    const reg = Object.entries(hit).filter(([z, v]) => !/^[2-6]XL$/.test(z) && +v > 0).map(([, v]) => +v);
    const base = reg.length ? Math.min(...reg) : +(gm.cost || 0);
    return { base, sizes: hit };
  }
  return { base: +(gm.cost || 0), sizes: gm.size_costs || {} };
}
export function supplierSizeUp(gm: { size_costs?: Record<string, number> | null; color_size_costs?: Record<string, Record<string, number>> | null; cost?: number | string | null }, s?: Pick<Settings, "sizeUpMarkup"> | null, color?: string | null) {
  const { base, sizes: sc } = colorCosts(gm, color), up: Partial<Record<Size, number>> = {};
  for (const z of ["2XL", "3XL", "4XL", "5XL"] as const) if (sc[z] && base) up[z] = Math.max(0, Math.round((sc[z] - base) * 100) / 100);
  const has = Object.keys(up).length > 0;
  return { sizeUp: has ? up : undefined, sizeUpMarkup: has ? (s?.sizeUpMarkup ?? DEFAULT_SETTINGS.sizeUpMarkup ?? 1) : undefined };
}
export function priceList(s: Settings, type: PriceType = "retail") {
  const pl: PriceList = type === "wholesale" ? s.wholesale : s;
  return { ...pl, markup: s.markup, useGarment: type !== "wholesale" };
}

/** every finishing and embroidery extra a group of this price list can have ticked (fold, tags… and specialty thread,
 *  3D puff, personalization), plus the group's own: the one list pricing, the order page and the order reader use */
export function finishingList(s: Settings, pl: PriceList, custom?: Finishing[] | null): Finishing[] {
  return [...(pl.finishing?.length ? pl.finishing : s.finishing), ...(pl.embExtras || []), ...(custom || [])];
}

export const r2 = (n: number) => Math.round((+n || 0) * 100) / 100;
const num = (v: unknown) => (v === "" || v == null || isNaN(+(v as number)) ? 0 : +(v as number));

export function tierIndex(q: number, s: { tiers: number[] }) {
  let i = 0;
  s.tiers.forEach((m, ix) => { if (q >= m) i = ix; });
  return i;
}
export function lineQty(l: { sizes?: Partial<Record<Size, number>> }) {
  return SIZES.reduce((a, sz) => a + num(l.sizes?.[sz]), 0);
}
/** the pieces the customer is billed for: the shop's own pieces (shopUse) count for nothing */
export const billQty = (l: { sizes?: Partial<Record<Size, number>>; shopUse?: boolean }) => (l.shopUse ? 0 : lineQty(l));
/**
 * THE order as the customer sees it: the shop's own pieces (Line.shopUse) taken out. Every page, document, sync and
 * message that reaches the customer or bills them (invoice, quote, proof, portal, Printavo, QuickBooks, the AI's
 * replies) loads the order through this before drawing or pricing it; staff pages and the work order use the order as is.
 * Prices don't move (shop pieces are never charged or counted), so totals match the staff side.
 */
/** the shop's own pieces in words, for staff-only notes (Printavo's production note): "Ours, not on the invoice: …" */
export function shopPiecesNote(o: Pick<Order, "groups" | "lines">): string {
  const ls = orderGroups(o).flatMap((g) => (g.lines || []).filter((l) => l.shopUse && lineQty(l) > 0));
  if (!ls.length) return "";
  return "Ours, not on the customer's invoice: " + ls.map((l) => `${SIZES.filter((z) => num(l.sizes?.[z])).map((z) => `${num(l.sizes?.[z])} ${z}`).join(", ")} ${[l.brand, l.style, l.color].filter(Boolean).join(" ")}${l.note ? ` (${l.note})` : ""}${l.extrasPrint === false ? ", not printed" : ", printed"}`).join("; ") + ".";
}
export function withoutShopPieces<T extends Pick<Order, "groups" | "lines">>(o: T): T {
  if (!o) return o;
  const gs = orderGroups(o);
  if (!gs.some((g) => (g.lines || []).some((l) => l.shopUse))) return o;
  return { ...o, groups: gs.map((g) => ({ ...g, lines: (g.lines || []).filter((l) => !l.shopUse) })) } as T;
}

/** front prints first, then the back, then sleeves, then anything else (tags); same side keeps its order */
export const printSideRank = (loc: string) => { const l = (loc || "").toLowerCase(); return /sleeve/.test(l) ? 3 : /back|yoke|shoulder|nape/.test(l) ? 2 : /front|chest|pocket|vertical|bottom/.test(l) ? 1 : 4; };
/** put a group's prints front first (in place, stable). Oct 26, Nick: "We always want to do the front print listed first and then the back print listed second." */
export function frontFirst<T extends { location: string }>(list: T[]): T[] {
  if (list.some((x, i) => i > 0 && printSideRank(list[i - 1].location) > printSideRank(x.location))) {
    const s = list.map((x, i) => ({ x, i })).sort((a, b) => printSideRank(a.x.location) - printSideRank(b.x.location) || a.i - b.i);
    s.forEach((e, i) => { list[i] = e.x; });
  }
  return list;
}

/** The order's garment groups, each one's prints front first; converts older one-garment lines on the fly. */
export function orderGroups(o: Pick<Order, "groups" | "lines">): Group[] {
  if (o.groups && o.groups.length) { for (const g of o.groups) if (Array.isArray(g.imprints)) frontFirst(g.imprints); return o.groups; }
  return (o.lines || []).map((l) => ({
    id: l.id,
    lines: [{ id: l.id + "-g", style: l.style || "", brand: "", garment: l.garment || "", color: l.color || "", cost: l.cost, sizes: l.sizes || {}, priceOverride: l.priceOverride ?? null }],
    imprints: frontFirst((l.decorations || []).map((d) => ({ id: d.id, method: d.method, location: d.location, colors: d.colors, inks: "", size: "", notes: "" }))),
  }));
}

/**
 * One imprint's price per piece and its one-time charges. `light` = on a light garment (no underbase).
 * Contract rules when the list has them: dark garments add a color for the underbase (price and screens), screens on
 * file are remakes, PMS-matched inks have a fee each, embroidery has its own quantity breaks (x.eti) and charges
 * stitches past the included count.
 */
/** how light an ink prints (L*, 0 black to 100 white), from its name ("Black", "Navy", "PMS 186 C"); null = unknown */
function inkL(name: string): number | null {
  const hex = colorHex(name.trim());
  if (!hex) return /\b(black|navy|maroon|burgundy|oxblood|charcoal|forest|brown|dark)\b/i.test(name) ? 20 : null;
  const v = [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; });
  const Y = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  return 116 * (Y > 0.008856 ? Math.cbrt(Y) : 7.787 * Y + 16 / 116) - 16;
}
/**
 * Does this print need an underbase on a dark garment? Set by hand on the imprint, otherwise from its inks: dark
 * inks (black, navy, maroon, dark reds: L* 40 and under) print on their own, the same as the separations never put
 * an underbase under black. Any lighter ink, or inks not filled in yet, means yes.
 */
/** the inks named on a print ("Black, PMS 186 C + White") */
export const inkNames = (inks: string) => (inks || "").split(/[,;\/+]|\band\b/i).map((x) => x.trim()).filter((x) => x && !/^(none|removed)$/i.test(x));
/** an ink named as a PMS / Pantone color ("PMS 186 C", "Pantone 7625", "186C") rather than a house ink */
export const isPmsInk = (n: string) => /\b(pms|pantone)\b/i.test(n) || /^\d{3,4}\s*-?\s*[cu]?$/i.test(n.trim());
/** each named ink on a print and whether it's charged as a PMS match: PMS inks are, unless marked standard (no charge) */
export function pmsInks(d: Pick<Imprint, "inks" | "pmsCharge">): { name: string; auto: boolean; charge: boolean; set: boolean }[] {
  return inkNames(d.inks).map((name) => {
    const auto = isPmsInk(name), v = d.pmsCharge?.[name.toLowerCase()];
    return { name, auto, charge: v ?? auto, set: v != null };
  });
}
/** PMS matching fees on a print: the named inks charged as matches, or the count typed when no inks are named */
/** the same PMS however it's written: "PMS 230 C", "230C", "Pantone 230" → "230" */
/** how many screens change ink across the garment colors (Imprint.inkBy): the color changes charged as ink changes */
/** what a color change is called (Oct 26, Nick: "on embroidery orders, you'd call it thread change and not color
 * change… It should operate exactly the same as color change") */
export const changeWord = (method?: string | null) => (method === "embroidery" ? "Thread change" : "Color change");
const changed = (m: Record<string, string> | undefined) => Object.entries(m || {}).filter(([a, b]) => b && b.trim().toLowerCase() !== a.trim().toLowerCase()).length;
export const colorChanges = (d: Pick<Imprint, "inkBy"> & { changeOf?: Imprint["changeOf"] }) => Object.values(d.inkBy || {}).reduce((n, m) => n + changed(m), 0) + changed(d.changeOf?.inks);
export const pmsKey = (n: string) => { const m = n.match(/(\d{3,4})/); return m ? m[1] : n.trim().toLowerCase().replace(/\s+/g, " "); };
export function pmsCount(d: Pick<Imprint, "inks" | "pmsCharge" | "pms">): number {
  return inkNames(d.inks).length ? pmsInks(d).filter((x) => x.charge).length : num(d.pms);
}
export function needsUnderbase(d: Pick<Imprint, "inks" | "underbase" | "method" | "colors"> & { printStyle?: Imprint["printStyle"]; puff?: boolean }): boolean {
  if (d.printStyle === "fashion") return false; // a fashion hit never gets one
  if (d.underbase != null) return d.underbase;
  if (d.puff) return false; // puff ink prints on its own: no underbase unless someone turns it on (Oct 30, Nick)
  const names = inkNames(d.inks);
  if (!names.length) return true;
  return names.some((n) => { const L = inkL(n); return L == null || L > 40; });
}
/** screens for a screen print: set by hand, else its colors plus the underbase when it gets one */
export function screensFor(d: Imprint, s: Pick<PriceList, "darkAddsColor">, light: boolean): { n: number; under: boolean; auto: number; hit2: boolean } {
  const k0 = Math.max(1, num(d.colors) || 1);
  const under = !!s.darkAddsColor && !light && k0 < FULL_COLOR && needsUnderbase(d);
  // a fashion hit on a dark shirt: no underbase screen, but the second round on press is priced like the underbase color
  const hit2 = d.printStyle === "fashion" && !!s.darkAddsColor && !light && k0 < FULL_COLOR && needsUnderbase({ ...d, printStyle: undefined });
  const auto = k0 + (under ? 1 : 0);
  return { n: d.screens != null && d.screens > 0 ? d.screens : auto, under, auto, hit2 };
}

function imprintPrice(d: Imprint, ti: number, s: PriceList, light = false, dtgLight = light, x: { eti?: number; remake?: boolean; screenFee?: number } = {}) {
  const inkFee = num(d.inkChanges) * num(s.inkChangeFee) + (d.method === "screen" ? pmsCount(d) : num(d.pms)) * num(s.pmsFee);
  if (d.method === "screen") {
    const k0 = Math.max(1, num(d.colors) || 1);
    const full = k0 >= FULL_COLOR;
    if (s.dtg && full) {
      const each = num((dtgLight && s.dtgLight ? s.dtgLight : s.dtg)[ti]);
      return { each, setup: 0, inkFee, dtg: each, full: true };
    }
    // the underbase on a dark garment is one more color (not under black, navy, dark reds; or as set by hand)
    const sc = screensFor(d, s, light);
    const under = sc.under ? 1 : 0;
    const k = k0 + under + (sc.hit2 ? 1 : 0);
    const row = (light && s.screenLight ? s.screenLight : s.screen)[ti] || [];
    const n = Math.min(row.length || 6, k);
    const dtg = s.dtg ? num((dtgLight && s.dtgLight ? s.dtgLight : s.dtg)[ti]) : 0;
    const fee = (d.remake ?? x.remake) && s.remakeFee != null ? s.remakeFee : x.screenFee != null ? x.screenFee : s.screenFee;
    return { each: num(row[n - 1]), setup: Math.min(sc.n, 15) * num(fee), inkFee, dtg, full: false, under, screens: sc.n, custom: k > (row.length || 99) };
  }
  if (d.method === "embroidery") {
    const eti = x.eti ?? ti;
    const extra = s.embPer1k && num(d.stitches) > num(s.embStitches) ? Math.ceil((num(d.stitches) - num(s.embStitches)) / 1000) * num(s.embPer1k) : 0;
    // the logo digitized before (its DST on file): no digitizing charge (Imprint.digitized, like repeat screens)
    return { each: r2(num(s.embroidery[eti]) + extra), setup: digitizingFee(d, s), inkFee };
  }
  if (d.method === "dtf") return d.supplied ? { each: 0, setup: 0, inkFee: 0 } : { each: num(s.dtf[ti]), setup: 0, inkFee };
  return { each: 0, setup: 0, inkFee };
}

export type LineCalc = { id: string; qty: number; garmentEach: number; printEach: number; light: boolean; calcEach: number; each: number; hasOv: boolean; sub: number; upTotal: number };
export type GroupCalc = ReturnType<typeof calcGroup>;
/**
 * Screens shared across groups (Oct 20, Nick: a reorder of #32668 The Bottles charged 14 screens for one 7-color front:
 * two garment groups, the same art): a print with the same art at the same spot and the same screens as one in an
 * earlier group of the order prints from the same screens, so its setup is charged once.
 */
const screenKey = (d: Imprint, n: number) => (d.method === "screen" && d.design_id ? `${d.design_id}|${(d.location || "").toLowerCase()}|${n}` : "");
/** the order's screens charged so far, plus the color-change pairs across variations (Imprint.changeOf): print id → pair
 *  key, and the screens the pair's first print paid for */
export type SeenScreens = Set<string> & { links?: Map<string, string>; linkScreens?: Map<string, number>;
  /** pieces carrying each logo across the order ("<method>:<design id>" → pieces): the same logo in several groups is
   *  priced at the break for all of them together (Oct 27, Nick: "if you use it in two separate locations, so like sleeves
   *  and left chest, it's the same logo… he can get the quantity discount") */ designQty?: Map<string, number> };
export function calcGroup(g: Group, o: Pick<Order, "waive_setup"> & { price_type?: PriceType }, s: Settings, /** the order's screens charged in earlier groups (calcOrder) */ seen?: SeenScreens) {
  const pl = priceList(s, o.price_type || "retail");
  const qty = (g.lines || []).reduce((a, l) => a + billQty(l), 0);
  const ti = tierIndex(qty, pl);
  // embroidery has its own quantity breaks on contract pricing
  const eti = pl.embTiers?.length ? tierIndex(qty, { tiers: pl.embTiers }) : ti;
  const ix = { eti, remake: !!g.remake, screenFee: g.screenFee != null && !isNaN(+g.screenFee) ? +g.screenFee : undefined };
  // each print's price break: the pieces carrying its logo across the whole order (never fewer than this group's)
  const dq = (d: Imprint) => { const n = d.design_id ? seen?.designQty?.get(`${d.method}:${d.design_id}`) || 0 : 0; return n > qty ? n : qty; };
  // youth screens (Oct 30, Nick: "two fronts, which both get setups… the quantity discount on the front for one, and…
  // for the other. Then they both get the same sleeve. They get the full discount on the sleeve. And only one setup"):
  // a print with its own youth screen is priced at the youth pieces' break on youth shirts and the adult pieces' on
  // adult shirts; every other print at the whole group's
  const kidAt = (g.lines || []).map(kidLine);
  const yQty = (g.lines || []).reduce((a, l, i) => a + (kidAt[i] ? billQty(l) : 0), 0), aQty = qty - yQty;
  const split = (d: Imprint) => youthSplit(g, d);
  type Side = "a" | "y" | undefined;
  const sideQty = (side: Side) => (side === "y" ? yQty : aQty);
  const tiOf = (d: Imprint, side?: Side) => (side && split(d) ? tierIndex(sideQty(side), pl) : dq(d) === qty ? ti : tierIndex(dq(d), pl));
  const ixOf = (d: Imprint, side?: Side) => (side && split(d) ? { ...ix, eti: pl.embTiers?.length ? tierIndex(sideQty(side), { tiers: pl.embTiers }) : tiOf(d, side) } : dq(d) === qty ? ix : { ...ix, eti: pl.embTiers?.length ? tierIndex(dq(d), { tiers: pl.embTiers }) : tiOf(d) });
  const anySplit = (g.imprints || []).some(split);
  // the youth screens' own underbase: none when every youth shirt is light (a Natural), the same rule as the adult's
  const kidLight = !!pl.darkAddsColor && !(g.lines || []).some((l, i) => kidAt[i] && billQty(l) > 0 && !isLightColor(l.color, pl));
  const adultLight = !!pl.darkAddsColor && !(g.lines || []).some((l, i) => !kidAt[i] && billQty(l) > 0 && !isLightColor(l.color, pl));
  const imprints: (ReturnType<typeof imprintPrice> & { id: string; pmsShared?: string[]; /** PMS inks a color change prints in, charged as matches */ pmsChange?: string[]; /** PMS matches charged on this print */ pmsN?: number;
    /** its own youth screen: the youth print's price each and setup, and the pieces each side is priced at */ youth?: { each: number; setup: number; screens?: number; qty: number; adultQty: number; size: string; /** the adult print's price each on its own shirts (light shirts priced as light) */ adultEach: number } })[] =
    (g.imprints || []).map((d) => {
      if (!split(d)) return { id: d.id, ...imprintPrice(d, tiOf(d), pl, false, false, ixOf(d)) };
      const y = imprintPrice(d, tiOf(d, "y"), pl, kidLight, kidLight, ixOf(d, "y"));
      const a = imprintPrice(d, tiOf(d, "a"), pl, adultLight, adultLight, ixOf(d, "a"));
      return { id: d.id, ...imprintPrice(d, tiOf(d, "a"), pl, false, false, ixOf(d, "a")), youth: { each: y.each, setup: y.setup, screens: (y as { screens?: number }).screens, qty: yQty, adultQty: aQty, size: d.youth?.size || "", adultEach: a.each } };
    });
  // RULE (Nick, Oct 24 2026): one PMS matching fee per PMS color per ORDER. The same PMS on the front and the back (or on
  // another group of the same order) is matched once, so only its first print pays. `seen` is shared by calcOrder.
  // A typed count (inks not named) can't be compared and is charged as typed.
  const pmsSeen = seen || new Set<string>();
  const pmsFresh = (g.imprints || []).map((d, i) => {
    if (d.method !== "screen" || !inkNames(d.inks).length) return null;
    const charged = pmsInks(d).filter((x) => x.charge).map((x) => x.name);
    const dup = charged.filter((n) => { const k = "pms:" + pmsKey(n); if (pmsSeen.has(k)) return true; pmsSeen.add(k); return false; });
    if (dup.length) imprints[i] = { ...imprints[i], inkFee: r2(imprints[i].inkFee - dup.length * num(pl.pmsFee)), pmsShared: dup };
    // a color change to a PMS is a PMS match too (Oct 28, Nick: #40175's White → 7640 on Mauve had no $15 PMS fee),
    // once per order like any PMS; "standard, no charge" on that ink (pmsCharge) leaves it out
    const to = [...new Set(Object.values(d.inkBy || {}).flatMap((m) => Object.entries(m || {}).filter(([a, b]) => b && b.trim().toLowerCase() !== a.trim().toLowerCase()).map(([, b]) => b.trim())))]
      .filter((n) => isPmsInk(n) && (d.pmsCharge?.[n.toLowerCase()] ?? true) && !charged.some((c) => pmsKey(c) === pmsKey(n)));
    const fresh = to.filter((n) => { const k = "pms:" + pmsKey(n); if (pmsSeen.has(k)) return false; pmsSeen.add(k); return true; });
    const sharedTo = to.filter((n) => !fresh.includes(n));
    if (fresh.length || sharedTo.length) imprints[i] = { ...imprints[i], inkFee: r2(imprints[i].inkFee + fresh.length * num(pl.pmsFee)), pmsChange: fresh, pmsShared: [...(imprints[i].pmsShared || []), ...sharedTo] };
    imprints[i] = { ...imprints[i], pmsN: charged.length - dup.length + fresh.length };
    return charged.length - dup.length + fresh.length;
  });
  // Print price per piece. With a digital (full color) price list, screen prints switch to digital
  // for the whole garment when that is cheaper, or when any location is full color.
  const printFor = (light: boolean, dtgLight: boolean, side?: Side) => {
    const imps = light || dtgLight || side === "y" ? (g.imprints || []).map((d) => imprintPrice(d, tiOf(d, side), pl, light, dtgLight, ixOf(d, side))) : imprints;
    const other = imps.filter((_, i) => (g.imprints || [])[i]?.method !== "screen").reduce((a, d) => a + d.each, 0);
    const scr = imps.filter((_, i) => (g.imprints || [])[i]?.method === "screen");
    let screenPart = scr.reduce((a, d) => a + d.each, 0);
    if (pl.dtg && scr.length) {
      const digital = scr.reduce((a, d) => a + num(d.dtg), 0);
      screenPart = scr.some((d) => d.full) ? digital : Math.min(screenPart, digital);
    }
    return other + screenPart;
  };
  const printEach = printFor(false, false);
  const printCache = new Map<string, number>();
  const printLine = (color: string, side?: Side) => {
    const light = isLightColor(color, pl), dl = isLightColor(color, pl, pl.dtgLightColors);
    const key = `${light}${dl}${side || ""}`;
    if (!printCache.has(key)) printCache.set(key, light || dl || side === "y" ? printFor(light, dl, side) : printEach);
    return { light, print: printCache.get(key) as number };
  };
  const finList = finishingList(s, pl, g.customFin);
  const finishing = ((g.finishing || []).map((fid) => finList.find((f) => f.id === fid)).filter(Boolean) as Finishing[])
    .map((f) => (f.id === "relabel" && g.tagPrice != null && !isNaN(+g.tagPrice) ? { ...f, price: +g.tagPrice } : f));
  const finishEach = r2(finishing.reduce((a, f) => a + num(f.price), 0));
  // contract extras per piece: special locations (sleeve, pocket, side), specialty ink on poly / nylon / dyed garments
  const imps = g.imprints || [];
  const specLocs = [...(pl.specialLocations || []), ...HAT_SPECIAL_LOCATIONS, ...((pl.specialLocations || []).some((z) => /sleeve/i.test(z)) ? LONG_SLEEVE_LOCATIONS : [])].map((z) => z.toLowerCase());
  const locExtra = pl.specialLocPrice ? imps.filter((d) => specLocs.includes((d.location || "").toLowerCase())).length * num(pl.specialLocPrice) : 0;
  // puff ink (Oct 30): each puffed screen print, per piece
  const puffExtra = imps.filter((d) => d.method === "screen" && d.puff).length * puffEach(pl);
  const inkExtra = g.specialtyInk && pl.specialtyInk?.length ? imps.filter((d) => d.method === "screen").length * num(pl.specialtyInk[Math.min(ti, pl.specialtyInk.length - 1)]) : 0;
  // embroidery on a specialty item (fleece, hats, bags…): an add-on per embroidered location
  const embSpecial = (l: GLine) => (pl.embSpecialty?.length && isSpecialtyItem(l) ? imps.filter((d) => d.method === "embroidery").length * num(pl.embSpecialty[Math.min(eti, pl.embSpecialty.length - 1)]) : 0);
  const persRate = (g.lines || []).some((l) => l.pers || l.persList?.length) ? persEach(s, o.price_type || "retail") : 0;
  // personalizations: each name its own charge, on top of its line (not in the line's price each)
  const persItems = (g.lines || []).filter((l) => !l.shopUse).flatMap((l) => persOf(l).map((e) => ({ lineId: l.id, text: e.text, size: e.size, qty: num(e.qty) || 1, unit: e.price != null ? num(e.price) : persRate, amount: r2((num(e.qty) || 1) * (e.price != null ? num(e.price) : persRate)) })));
  const persTotal = r2(persItems.reduce((a, x) => a + x.amount, 0));
  const lines: LineCalc[] = (g.lines || []).map((l, li) => {
    const lq = lineQty(l);
    const adj = Object.entries(pl.colorAdjust || {}).find(([c]) => normColor(c) === normColor(l.color))?.[1] || 0;
    const garmentRaw = pl.useGarment ? num(l.cost) * (1 + num(pl.markup) / 100) + num(pl.blankAdd?.[ti]) + num(adj) : 0;
    const garmentEach = r2(garmentRaw);
    const { light, print: basePrint } = printLine(l.color, anySplit ? (kidAt[li] ? "y" : "a") : undefined);
    const linePrint = r2(basePrint + locExtra + inkExtra + puffExtra + embSpecial(l));
    const calcEach = r2(garmentRaw + linePrint + finishEach);
    const hasOv = !!l.shopUse || (l.priceOverride !== null && l.priceOverride !== undefined && (l.priceOverride as unknown) !== "" && !isNaN(+l.priceOverride));
    const each = l.shopUse ? 0 : hasOv ? r2(+(l.priceOverride as number)) : calcEach;
    let sub = 0, upTotal = 0;
    SIZES.forEach((sz) => {
      const q = num(l.sizes?.[sz]);
      const up = l.sizeUpSet?.[sz] != null && (l.sizeUpSet[sz] as unknown) !== "" ? num(l.sizeUpSet[sz]) : pl.useGarment && l.sizeUp && l.sizeUp[sz] !== undefined ? sizeUpEach(l, sz) : num(pl.upcharges?.[sz]);
      sub += q * each; // 2XL+ Materials Charge are billed as their own line
      if (!l.shopUse) upTotal += q * up;
    });
    return { id: l.id, qty: lq, garmentEach, printEach: r2(linePrint), light, calcEach, each, hasOv, sub: r2(sub), upTotal: r2(upTotal) };
  });
  // screens: no underbase screen when every garment is light
  const anyDark = !pl.darkAddsColor || (g.lines || []).some((l) => billQty(l) > 0 && !isLightColor(l.color, pl));
  const setups0 = anyDark ? imprints : (g.imprints || []).map((d) => ({ id: d.id, ...imprintPrice(d, tiOf(d), pl, true, true, ixOf(d)) }));
  const setups = setups0.map((d, i) => {
    const im = (g.imprints || [])[i], k = im ? screenKey(im, num((d as { screens?: number }).screens)) : "";
    // a color change across variations: the pair prints from one set of screens. The first of the two pays its setup;
    // the other pays only for screens beyond those (a color the first doesn't have)
    const lk = im && im.method === "screen" ? seen?.links?.get(im.id) : undefined;
    if (lk && seen) {
      const n = num((d as { screens?: number }).screens), had = seen.linkScreens?.get(lk);
      if (had == null) { (seen.linkScreens ||= new Map()).set(lk, n); if (k) seen.add(k); return d; }
      if (k) seen.add(k);
      const extra = Math.max(0, n - had), per = n ? d.setup / Math.min(n, 15) : 0;
      return { ...d, setup: r2(extra * per), shared: true };
    }
    if (!k || !seen) return d;
    if (seen.has(k)) return { ...d, setup: 0, shared: true };
    seen.add(k); return d;
  });
  // a print's own youth screens: a second setup (the same logo at the same spot and size on another order shares it)
  const youthSetups = (g.imprints || []).map((im, i) => {
    const y = imprints[i]?.youth; if (!y) return null;
    const k = im.method === "screen" && im.design_id ? `${im.design_id}|${(im.location || "").toLowerCase()}|y${(y.size || "").replace(/[^\d.]/g, "")}|${num(y.screens)}` : "";
    if (k && seen) { if (seen.has(k)) return { ...y, setup: 0, shared: true }; seen.add(k); }
    return { ...y, shared: false };
  });
  const noSetup = !!o.waive_setup || !!g.allIn;
  const screens = noSetup ? 0 : setups.reduce((a, d) => a + d.setup, 0) + youthSetups.reduce((a, d) => a + (d?.setup || 0), 0);
  const inkFees = g.allIn ? 0 : imprints.reduce((a, d) => a + d.inkFee, 0);
  const sub = r2(lines.reduce((a, l) => a + l.sub, 0) + persTotal);
  // contract minimum: a job under minQty pieces is charged as minQty pieces (the missing pieces at the average price)
  // (screen printing: embroidery has its own 6-11 break)
  const minCharge = !g.allIn && pl.minQty && qty > 0 && qty < pl.minQty && imps.some((d) => d.method === "screen") ? r2((pl.minQty - qty) * (sub / qty)) : 0;
  const setup = r2(screens + inkFees + minCharge);
  // the setup charge itemized (as Printavo lists it: new / repeat screens, digitizing, PMS match, ink changes, minimum)
  const setupItems: { kind: "screens" | "remake" | "digitize" | "pms" | "inkchange" | "min"; qty: number; unit: number; amount: number; /** an embroidery thread change */ thread?: boolean; /** a print's own youth screens / file */ youth?: boolean }[] = [];
  if (!noSetup) setups.forEach((d, i) => {
    const im = (g.imprints || [])[i];
    if (!im) return;
    const one = (amt: number, sc: number | undefined, youth?: boolean) => {
      if (!amt) return;
      const y = youth ? { youth: true } : {};
      if (im.method === "screen") {
        const n = Math.min(num(sc), 15) || 1;
        setupItems.push({ kind: (im.remake ?? ix.remake) && pl.remakeFee != null ? "remake" : "screens", qty: n, unit: r2(amt / n), amount: r2(amt), ...y });
      } else setupItems.push({ kind: "digitize", qty: 1, unit: r2(amt), amount: r2(amt), ...y });
    };
    one(d.setup, (d as { screens?: number }).screens);
    const ys = youthSetups[i]; if (ys) one(ys.setup, ys.screens, true);
  });
  if (!g.allIn) imprints.forEach((_, i) => {
    const im = (g.imprints || [])[i]; if (!im) return;
    const pms = pmsFresh[i] ?? (im.method === "screen" ? pmsCount(im) : num(im.pms)), ic = num(im.inkChanges);
    if (pms && num(pl.pmsFee)) setupItems.push({ kind: "pms", qty: pms, unit: num(pl.pmsFee), amount: r2(pms * num(pl.pmsFee)) });
    if (ic && num(pl.inkChangeFee)) setupItems.push({ kind: "inkchange", qty: ic, unit: num(pl.inkChangeFee), amount: r2(ic * num(pl.inkChangeFee)), ...(im.method === "embroidery" ? { thread: true } : {}) });
  });
  if (minCharge) setupItems.push({ kind: "min", qty: 1, unit: minCharge, amount: minCharge });
  return { id: g.id, /** each print's setup as charged (light shirts: no underbase screen; a screen shared with another print: 0) */ imprintSetups: setups.map((d) => (noSetup ? 0 : d.setup)), qty, /** the youth and adult pieces, when a print has its own youth screens */ youthQty: anySplit ? yQty : 0, adultQty: anySplit ? aQty : 0, /** every piece printed, the shop's own included (the work order) */ allQty: (g.lines || []).reduce((a, l) => a + lineQty(l), 0), ti, eti, tierMin: pl.tiers[ti], setupItems, materials: r2(lines.reduce((a, l) => a + l.upTotal, 0)), imprints, printEach: r2(printEach), finishEach, finishing, lines, sub, persItems, persTotal, setup, inkFees: r2(inkFees), minCharge, belowMin: qty > 0 && qty < (pl.minQty || pl.tiers[0]), wholesale: !pl.useGarment, custom: imprints.some((d) => (d as { custom?: boolean }).custom) };
}

export type OrderCalc = ReturnType<typeof calcOrder>;
export function calcOrder(
  o: Pick<Order, "lines" | "groups" | "fees" | "discount_pct" | "tax_exempt" | "tax_rate" | "waive_setup"> & { price_type?: PriceType; discount_amt?: number; discount_type?: "pct" | "amt" },
  s: Settings,
  payments: Pick<Payment, "amount">[] = []
) {
  const seen: SeenScreens = new Set<string>();
  // color changes across variations (Imprint.changeOf): both prints of a pair share one key
  const gs0 = orderGroups(o), ids = new Set(gs0.flatMap((g) => (g.imprints || []).map((d) => d.id)));
  for (const g of gs0) for (const d of g.imprints || []) if (d.changeOf?.imprint && ids.has(d.changeOf.imprint) && d.changeOf.imprint !== d.id) {
    const key = [d.id, d.changeOf.imprint].sort().join("~");
    (seen.links ||= new Map()).set(d.id, key);
    if (!seen.links.has(d.changeOf.imprint)) seen.links.set(d.changeOf.imprint, key);
  }
  // the same logo in several groups: its pieces counted together for the price break
  const dqm = new Map<string, number>();
  for (const g of gs0) {
    const q = (g.lines || []).reduce((a, l) => a + billQty(l), 0);
    for (const k of new Set((g.imprints || []).filter((d) => d.design_id).map((d) => `${d.method}:${d.design_id}`))) dqm.set(k, (dqm.get(k) || 0) + q);
  }
  seen.designQty = dqm;
  const groups = gs0.map((g) => calcGroup(g, o, s, seen));
  const lines = groups.flatMap((g) => g.lines);
  const items = r2(groups.reduce((a, g) => a + g.sub, 0));
  const setup = r2(groups.reduce((a, g) => a + g.setup, 0));
  const materials = r2(groups.reduce((a, g) => a + g.materials, 0)); // 2XL+ Materials Charge
  const fees = r2((o.fees || []).reduce((a, f) => a + feeAmount(f), 0));
  // shipping is its own line (Totals, invoice), inside the fees total so every sum stays the same
  const shipFee = (o.fees || []).find(isShipFee);
  const shipping = r2((o.fees || []).filter(isShipFee).reduce((a, f) => a + feeAmount(f), 0));
  const pre = items + setup + materials + fees;
  const discount = o.discount_type === "amt" ? r2(Math.min(pre, Math.max(0, num(o.discount_amt)))) : r2((pre * num(o.discount_pct)) / 100);
  const rate = o.tax_rate === null || o.tax_rate === undefined || (o.tax_rate as unknown) === "" ? num(s.taxRate) : num(o.tax_rate);
  const tax = o.tax_exempt ? 0 : r2(((pre - discount) * rate) / 100);
  const total = r2(pre - discount + tax);
  const paid = r2(payments.reduce((a, p) => a + num(p.amount), 0));
  const qty = groups.reduce((a, g) => a + g.qty, 0);
  return { groups, lines, items, setup, materials, fees, shipping, hasShipping: !!shipFee, freeShipping: !!shipFee?.free, shippingTbd: !!shipFee?.tbd, discount, rate, tax, total, paid, balance: r2(total - paid), qty, /** every piece printed, the shop's own included */ allQty: groups.reduce((a, g) => a + g.allQty, 0) };
}

export const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

export function newGLine(): GLine {
  return { id: uid(), style: "", brand: "", garment: "", color: "", cost: "", sizes: {}, priceOverride: null };
}
export function newImprint(location = "Full Front"): Imprint {
  return { id: uid(), method: "screen", location, colors: 1, inks: "", size: "", notes: "", inkChanges: 0 };
}
export function newGroup(): Group {
  return { id: uid(), lines: [newGLine()], imprints: [newImprint()] };
}
/** A garment line of kids' sizes only (youth, toddler, baby): the shirts a youth screen prints on. */
export const KID_SIZES: readonly string[] = [...YOUTH_SIZES, ...TODDLER_SIZES, ...BABY_SIZES];
export function kidLine(l: { sizes?: Partial<Record<Size, number>> }) {
  const z = Object.entries(l.sizes || {}).filter(([, v]) => num(v) > 0).map(([k]) => k);
  return z.length > 0 && z.every((k) => KID_SIZES.includes(k));
}
/** This print has its own youth screens on this group: the group was set for youth screens, the print isn't "same as
 *  adult" and has a youth size, and the group has both youth and adult pieces. */
export function youthSplit(g: Pick<Group, "youthSet" | "lines">, d: Pick<Imprint, "youth">) {
  if (!g.youthSet || !d.youth || d.youth.same || !(d.youth.size || "").trim()) return false;
  const ls = (g.lines || []).filter((l) => lineQty(l) > 0);
  return ls.some(kidLine) && ls.some((l) => !kidLine(l));
}
/** True when a size is a youth size. */
export const isYouth = (z: string) => (YOUTH_SIZES as readonly string[]).includes(z);

/** Short description of an imprint for invoices and the portal. */
export function imprintLabel(d: Imprint) {
  const parts = [`${METHODS[d.method] || d.method} ${d.location}`.trim()];
  if (d.method === "screen" || d.method === "embroidery") parts.push(d.method === "screen" && d.colors >= FULL_COLOR ? "full color" : `${d.colors} color${d.colors > 1 ? "s" : ""}`);
  // a fashion hit / soft hand (Oct 16): said so wherever the print is described, so no one expects an underbase
  if (d.method === "screen" && d.printStyle === "fashion") parts.push(d.softHand ? "fashion print (soft, no underbase)" : "fashion print (no underbase)");
  else if (d.method === "screen" && d.softHand) parts.push("soft hand");
  if (d.method === "screen" && d.puff) parts.push("puff ink");
  if (d.inks) parts.push(d.inks);
  if (d.size) parts.push(d.size);
  if (d.drop) parts.push(`${d.drop}" drop`);
  return parts.join(" · ");
}

/** Image types a browser can show as a logo preview. */
export const PREVIEWABLE_TYPES = /^image\/(png|jpe?g|gif|webp|svg\+xml)$/i;

/**
 * What stops a customer's order from being sent in. Kept loose on purpose: it just needs pieces and
 * some artwork (a logo on any print location, or a mockup). Anything else is a gentle reminder (requestHints).
 */
export function requestProblems(groups: Group[]): string[] {
  const pcs = groups.reduce((a, g) => a + g.lines.reduce((b, l) => b + Object.values(l.sizes || {}).reduce((c, v) => c + (+v || 0), 0), 0), 0);
  const art = groups.some((g) => g.imprints.some((im) => im.design_id) || (g.customerMockups || []).length > 0);
  const out: string[] = [];
  if (!pcs) out.push("Add at least one garment with quantities");
  if (!art) out.push("Attach your artwork: upload a logo on a print location, or add a mockup");
  return out;
}

/** Nice-to-haves we remind the customer about but don't require (we can sort them out with them). */
export function requestHints(groups: Group[]): string[] {
  const out: string[] = [];
  groups.forEach((g, gi) => {
    const name = g.name || `Group ${gi + 1}`;
    g.imprints.forEach((im) => {
      const need: string[] = [];
      if (!im.design_id) need.push("logo");
      if (!(im.size || "").trim()) need.push("print size");
      const inks = im.method !== "dtf" && !(im.method === "screen" && im.colors >= FULL_COLOR);
      if (inks && !(im.inks || "").trim()) need.push("ink colors");
      if (need.length) out.push(`${name} ${im.location || "print location"}: ${need.join(", ")}`);
    });
  });
  return out;
}


/** Customer payment terms. */
export type PayTerms = "prepay" | "receipt" | "net30" | "deposit";
export const PAY_TERMS: Record<PayTerms, string> = { prepay: "Pre-pay", receipt: "Due on receipt", deposit: "50/50", net30: "Net 30 days" };
/**
 * What the terms mean, for the invoice (Oct 16, Nick): due on receipt = due when they get it (at delivery, or at pickup);
 * 50/50 = half down to start production and half at delivery.
 */
export function termsText(terms: PayTerms | null | undefined, pickup = false) {
  const at = pickup ? "at pickup" : "at delivery";
  switch (terms || "receipt") {
    case "prepay": return "Pre-pay: paid in full before production starts.";
    case "deposit": return `50/50: 50% down to start production, 50% due ${at}.`;
    case "net30": return `Net 30: due 30 days after ${pickup ? "pickup" : "delivery"}.`;
    default: return `Due on receipt: paid in full ${at}.`;
  }
}
/**
 * When an order's payment is due under the customer's terms:
 * pre-pay = when the order is approved; due on receipt = when the order is closed (completed);
 * net 30 = 30 days after it's closed. Null = not due yet (still being made).
 */
export function payDueDate(o: { approved_at?: string | null; sent_at?: string | null; created_at: string; completed_at?: string | null }, terms?: PayTerms | null) {
  if (terms === "prepay") return (o.approved_at || o.sent_at || o.created_at || "").slice(0, 10) || null;
  const closed = (o.completed_at || "").slice(0, 10);
  if (!closed) return null;
  if (terms !== "net30") return closed;
  const d = new Date(closed + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
}

/**
 * A print's notes without the lines we write on it in Printavo (Oct 21, Nick: "why is this disclaimer… still on there
 * once production has already confirmed the details?"): "*** REORDER DETAILS NEEDED … ***" and "Specs confirmed by
 * production …" are made from the print's state each time; read back from Printavo they ended up in the notes.
 */
/**
 * A print's notes without what Create order wrote about how it got there ("Art pulled off … with the Helper: 10.25" ×
 * 10.25"…", "Set at the check: 10.5" wide, Black", "You said: printed 1 color", "From Printavo #33728"…): the print's own
 * fields hold the size, drop and inks, and those lines only confused the press (Oct 23, Nick: "we don't even need that…
 * that's going to hurt us more than help us"). What a person wrote (a press note, the customer's words) stays.
 */
const MACHINE_NOTE = /^(From Printavo #|Art (pulled off|from|uploaded)|Pulled off |You said:|Set at the check|Placement from their mockup|Size from |No underbase \(set at the check\)|The [a-z ]+ box behind the art|Their [a-z ]+ box prints|Same inks as the |Inks? (and size )?from Printavo|Inks from |\*\*\*\s*REORDER|Confirm in the portal|Changed after it was made|Press: )/i;
export const cleanPrintNotes = (s: string | null | undefined) => String(s || "").split(/\n|(?<=\.)\s+(?=[A-Z*"])/)
  .map((x) => x.trim()).filter((x) => x && !MACHINE_NOTE.test(x)).join(" ").trim();

export const shopNotes = (s: string | null | undefined) => String(s || "").replace(/\*\*\*\s*REORDER[^*]*\*\*\*[^\n]*\n?/gi, "").replace(/^\s*Specs confirmed by production[^\n]*\n?/gim, "").trim();

/** THE digitizing fee for an embroidered print, everywhere it's charged or shown (Oct 28, Nick): nothing when the logo
 *  was digitized before; the price set by hand for a complex logo; else the list's base ($40) plus $1 for each started
 *  1,000 stitches past 6,000 (23,847 stitches: $40 + 18 = $58) */
export function digitizingFee(d: Pick<Imprint, "digitized" | "digitizeFee" | "stitches">, s: Pick<PriceList, "digitizing" | "digStitches" | "digPer1k">): number {
  if (d.digitized) return 0;
  if (d.digitizeFee != null && isFinite(+d.digitizeFee)) return r2(Math.max(0, +d.digitizeFee));
  const inc = s.digStitches ?? 6000, per = s.digPer1k ?? 1, st = +(d.stitches || 0) || 0;
  return r2((+s.digitizing || 0) + (st > inc && per ? Math.ceil((st - inc) / 1000) * per : 0));
}
