"use client";
/**
 * The Idea Lab's clip art library: about 20,000 open-licensed icons (built into /public/clipart at deploy time,
 * see scripts/build-assets.mjs), searchable by name, category and everyday words ("football", "mascot", "church").
 */
import { CLIPART } from "@/lib/designerArt";

export type ClipSet = { p: string; name: string; by: string; license: string; full: boolean; w: number; h: number; n: number };
type Index = { v: number; sets: ClipSet[]; cats: string[]; i: [number, string, number, number?][] };
export type ClipHit = { id: string; set: string; name: string; label: string; full: boolean };
export type ClipIcon = { id: string; body: string; w: number; h: number; left: number; top: number; full: boolean; label: string };

type Entry = { si: number; name: string; chunk: number; tokens: string[]; label: string };
let indexP: Promise<{ idx: Index; entries: Entry[] } | null> | null = null;
const chunkCache = new Map<string, Promise<Record<string, [string, number, number, number, number]>>>();

const SUFFIX = /-(fill|filled|solid)$/;
const labelOf = (name: string) => name.replace(SUFFIX, "").replace(/-/g, " ");

/** Load the library index once (about 20k names). Null when the library wasn't built (local dev). */
export function loadClipIndex() {
  if (!indexP) {
    indexP = fetch("/clipart/index.json").then((r) => (r.ok ? r.json() : null)).then((idx: Index | null) => {
      if (!idx) return null;
      const entries = idx.i.map(([si, name, chunk, cat]) => {
        const base = name.replace(SUFFIX, "");
        const tokens = base.split("-").filter(Boolean);
        if (cat !== undefined && idx.cats[cat]) tokens.push(...idx.cats[cat].toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
        return { si, name, chunk, tokens, label: labelOf(name) };
      });
      return { idx, entries };
    }).catch(() => null);
  }
  return indexP;
}

/** Everyday words → the words icon makers use. Both directions are searched. */
const SYN: Record<string, string[]> = {
  football: ["american-football", "football", "helmet", "gridiron", "rugby"], soccer: ["soccer", "soccer-ball", "football"], baseball: ["baseball", "bat", "glove", "mitt"],
  softball: ["softball", "baseball", "bat", "glove"], basketball: ["basketball", "hoop", "basket"], volleyball: ["volleyball"], hockey: ["hockey", "puck", "ice-hockey", "stick"],
  golf: ["golf", "flag-in-hole", "tee", "club"], tennis: ["tennis", "racket", "racquet"], track: ["running", "runner", "sprint", "shoe", "sneaker", "track"], running: ["running", "runner", "run", "shoe"],
  run: ["running", "runner"], swim: ["swim", "swimming", "swimmer", "pool", "wave"], swimming: ["swim", "swimmer", "pool"], wrestling: ["wrestling", "wrestler", "boxing"], boxing: ["boxing", "glove", "punch"],
  cheer: ["cheer", "megaphone", "pom", "bullhorn", "loudspeaker"], cheerleading: ["cheer", "megaphone", "pom"], bowling: ["bowling", "pin"], lacrosse: ["lacrosse"], rugby: ["rugby", "football"],
  cycling: ["bicycle", "bike", "cycling", "cyclist"], bike: ["bicycle", "bike", "motorcycle"], gym: ["dumbbell", "weight", "barbell", "gym", "muscle", "fitness"], weightlifting: ["dumbbell", "barbell", "weight"],
  fitness: ["dumbbell", "fitness", "muscle", "gym"], dance: ["dance", "dancer", "ballet", "dancing"], gymnastics: ["gymnast", "gymnastics", "acrobat"], karate: ["karate", "martial", "belt"], skate: ["skate", "skateboard", "roller"],
  ski: ["ski", "skier", "snowboard"], surf: ["surf", "surfer", "surfboard", "wave"], fishing: ["fishing", "fish", "hook", "rod", "bobber", "lure"], fish: ["fish", "bass", "trout", "tropical-fish"],
  hunting: ["deer", "antlers", "rifle", "duck", "bow", "arrow", "buck"], deer: ["deer", "antlers", "stag", "buck"], racing: ["checkered", "race", "racing", "car", "flag", "tire"], race: ["race", "racing", "checkered"],
  mascot: ["eagle", "wolf", "bear", "tiger", "lion", "panther", "bulldog", "hawk", "falcon", "mustang", "horse", "ram", "bull", "shark", "dragon", "knight", "viking", "spartan", "pirate", "hornet", "wildcat"],
  eagle: ["eagle", "hawk", "falcon", "bird"], hawk: ["hawk", "falcon", "eagle"], falcon: ["falcon", "hawk", "eagle"], wolf: ["wolf", "wolves", "howl", "dog"], wildcat: ["cat", "lion", "tiger", "panther", "wildcat", "lynx", "bobcat"],
  panther: ["panther", "cat", "jaguar", "leopard"], tiger: ["tiger", "cat"], lion: ["lion", "cat", "mane"], bear: ["bear", "grizzly", "paw"], bulldog: ["dog", "bulldog", "canine"], dog: ["dog", "puppy", "paw", "bone"],
  cat: ["cat", "kitten", "paw"], horse: ["horse", "mustang", "stallion", "pony", "horseshoe"], bull: ["bull", "ox", "cow", "horns"], ram: ["ram", "goat", "horns"], shark: ["shark", "fin"], dragon: ["dragon", "wyvern"],
  knight: ["knight", "helm", "helmet", "sword", "shield", "armor"], viking: ["viking", "helmet", "axe", "horns"], spartan: ["spartan", "helmet", "trojan", "gladiator"], pirate: ["pirate", "skull", "crossbones", "jolly", "flag", "parrot"],
  bee: ["bee", "hornet", "wasp", "honey"], hornet: ["hornet", "bee", "wasp"], owl: ["owl"], snake: ["snake", "cobra", "rattlesnake", "serpent"], gator: ["crocodile", "alligator"], rooster: ["rooster", "chicken", "hen"],
  paw: ["paw", "pawprint", "footprint"], animal: ["dog", "cat", "bear", "horse", "bird", "fish", "paw"], bird: ["bird", "eagle", "owl", "dove", "parrot", "chicken"],
  school: ["school", "graduation", "book", "pencil", "apple", "backpack", "bus", "diploma"], graduation: ["graduation", "graduate", "mortarboard", "cap", "diploma", "scroll"], graduate: ["graduation", "graduate", "mortarboard"],
  class: ["graduation", "graduate", "school"], senior: ["graduation", "graduate", "star", "crown"], teacher: ["apple", "book", "pencil", "chalkboard", "school"], book: ["book", "bible", "library", "read"],
  science: ["atom", "flask", "microscope", "dna", "beaker", "science", "rocket"], math: ["calculator", "math", "pi", "plus"], art: ["palette", "paint", "brush", "pencil", "art"], band: ["music", "drum", "trumpet", "saxophone", "guitar", "note"],
  music: ["music", "note", "musical", "guitar", "drum", "microphone", "headphones", "piano", "trumpet", "saxophone", "violin"], choir: ["music", "note", "microphone", "singing"], guitar: ["guitar", "bass"],
  drum: ["drum", "drumsticks"], theater: ["theater", "masks", "comedy", "tragedy", "performing"], drama: ["theater", "masks", "performing"], camera: ["camera", "photo", "film"],
  christmas: ["christmas", "santa", "snowflake", "gift", "ornament", "tree", "reindeer", "snowman", "candy-cane", "bell"], xmas: ["christmas", "santa", "snowflake", "gift"],
  halloween: ["pumpkin", "jack-o-lantern", "ghost", "bat", "skull", "spider", "witch", "zombie", "candy"], thanksgiving: ["turkey", "pie", "leaf", "leaves", "corn", "harvest"], fall: ["leaf", "leaves", "pumpkin", "maple"],
  july: ["flag", "fireworks", "firework", "star", "sparkler", "usa"], fourth: ["flag", "fireworks", "star", "usa"], patriotic: ["flag", "star", "eagle", "usa", "liberty"], usa: ["flag", "usa", "star", "eagle", "liberty"], america: ["flag", "usa", "star", "eagle"],
  valentine: ["heart", "cupid", "love", "rose", "kiss"], love: ["heart", "love", "kiss"], easter: ["egg", "bunny", "rabbit", "chick", "cross"], patrick: ["shamrock", "clover", "leprechaun", "rainbow", "gold"], irish: ["shamrock", "clover"],
  newyear: ["party", "champagne", "fireworks", "clock", "confetti"], birthday: ["cake", "birthday", "balloon", "gift", "party", "candle", "confetti"], party: ["party", "balloon", "confetti", "popper", "cake"], wedding: ["ring", "rings", "heart", "bride", "champagne"],
  bachelorette: ["ring", "diamond", "champagne", "heart", "crown", "cocktail"], baby: ["baby", "bottle", "stroller", "footprints", "rattle"], family: ["family", "house", "heart", "tree", "home"], reunion: ["family", "tree", "house", "heart"],
  church: ["church", "cross", "chapel", "bible", "praying", "dove", "angel"], christian: ["cross", "church", "bible", "dove", "praying"], jesus: ["cross", "church", "dove", "crown"], cross: ["cross", "latin-cross"], faith: ["cross", "dove", "praying", "church"],
  military: ["army", "tank", "helmet", "medal", "star", "soldier", "jet", "anchor", "chevron", "dog-tag"], army: ["army", "tank", "soldier", "helmet", "star"], navy: ["anchor", "ship", "sailor", "boat"], marines: ["anchor", "eagle", "globe"],
  firefighter: ["fire", "flame", "fire-truck", "hydrant", "helmet", "axe", "extinguisher"], fire: ["fire", "flame", "fire-truck", "hydrant"], police: ["police", "badge", "sheriff", "handcuffs", "shield", "car"], ems: ["ambulance", "medical", "hospital", "heartbeat", "stethoscope"],
  medical: ["medical", "stethoscope", "hospital", "heart", "pill", "syringe", "nurse", "doctor", "ambulance", "tooth"], nurse: ["nurse", "stethoscope", "medical", "heart", "syringe"], dental: ["tooth", "teeth", "dentist"],
  awareness: ["ribbon", "heart", "hands", "puzzle"], cancer: ["ribbon", "heart"], ribbon: ["ribbon", "banner", "award"], charity: ["hands", "heart", "donation", "ribbon", "handshake"],
  nature: ["tree", "mountain", "leaf", "sun", "flower", "forest", "pine"], outdoors: ["mountain", "tree", "tent", "campfire", "compass", "hiking", "canoe"], camping: ["tent", "campfire", "camping", "fire", "lantern", "marshmallow"],
  hiking: ["hiking", "boot", "mountain", "backpack", "compass"], mountain: ["mountain", "mountains", "peak", "summit"], beach: ["beach", "palm", "umbrella", "sun", "wave", "sunglasses", "shell", "island"], summer: ["sun", "beach", "palm", "sunglasses", "wave"],
  vacation: ["palm", "beach", "plane", "airplane", "suitcase", "luggage", "sun", "island", "sunglasses", "map"], travel: ["plane", "airplane", "suitcase", "luggage", "map", "compass", "globe", "passport"], ocean: ["wave", "fish", "anchor", "whale", "shell", "boat"],
  tree: ["tree", "pine", "palm", "oak", "forest"], flower: ["flower", "rose", "tulip", "sunflower", "daisy", "blossom"], sun: ["sun", "sunny", "sunrise", "sunset"], moon: ["moon", "crescent", "night"], star: ["star", "stars", "sparkle"],
  weather: ["sun", "cloud", "rain", "lightning", "snowflake", "snow", "storm"], lightning: ["lightning", "bolt", "thunder", "flash"], snow: ["snowflake", "snow", "snowman"], rainbow: ["rainbow"],
  food: ["pizza", "burger", "hamburger", "taco", "hot-dog", "fries", "donut", "cupcake", "ice-cream", "coffee"], bbq: ["grill", "barbecue", "bbq", "meat", "steak", "flame", "pig"], barbecue: ["grill", "barbecue", "bbq", "meat"],
  coffee: ["coffee", "cup", "mug", "hot-beverage", "bean"], beer: ["beer", "mug", "hops", "pint", "brewery"], drink: ["cup", "glass", "beer", "wine", "cocktail", "soda"], chili: ["chili", "pepper", "hot"], restaurant: ["chef", "fork", "knife", "plate", "food"],
  business: ["briefcase", "building", "office", "handshake", "chart"], construction: ["hammer", "wrench", "hard-hat", "helmet", "crane", "saw", "drill", "tools", "excavator"], tools: ["hammer", "wrench", "screwdriver", "saw", "toolbox", "tools"],
  mechanic: ["wrench", "car", "gear", "tire", "engine"], car: ["car", "truck", "vehicle", "auto", "tire"], truck: ["truck", "pickup", "semi", "delivery"], farm: ["tractor", "barn", "cow", "pig", "chicken", "corn", "wheat", "farm", "horse"],
  landscaping: ["lawn", "mower", "leaf", "tree", "shovel", "flower", "plant"], plumbing: ["pipe", "wrench", "faucet", "water"], electric: ["lightning", "bolt", "plug", "electric", "light-bulb"], chef: ["chef", "hat", "cooking", "fork", "knife"],
  salon: ["scissors", "comb", "hair", "salon", "lipstick"], realestate: ["house", "home", "key", "building"], home: ["house", "home"], tech: ["laptop", "computer", "code", "robot", "chip"], gaming: ["gamepad", "controller", "game", "joystick", "dice"],
  shapes: ["circle", "square", "star", "heart", "triangle", "hexagon", "diamond", "shield", "badge"], frame: ["frame", "badge", "shield", "banner", "border", "wreath", "laurel"], badge: ["badge", "shield", "emblem", "crest", "medal"], banner: ["banner", "ribbon", "flag", "scroll"],
  laurel: ["laurel", "wreath", "olive"], crown: ["crown", "king", "queen", "tiara"], trophy: ["trophy", "cup", "award", "medal", "winner"], medal: ["medal", "award", "trophy"], winner: ["trophy", "medal", "award", "crown", "first"],
  skull: ["skull", "crossbones", "death"], fun: ["smile", "laugh", "party", "rocket", "rainbow", "unicorn"], emoji: ["face", "smile", "grin", "heart"], smile: ["smile", "smiling", "grin", "happy"], cool: ["sunglasses", "fire", "cool"], space: ["rocket", "planet", "astronaut", "star", "moon", "alien", "ufo"],
};

const stem = (w: string) => (w.length > 4 && w.endsWith("ies") ? w.slice(0, -3) + "y" : w.length > 3 && w.endsWith("es") && !w.endsWith("ses") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
/** Sets that read best on a shirt come first when two results match equally well. */
const SET_BONUS: Record<string, number> = { "game-icons": 2.2, "fluent-emoji-high-contrast": 2, "fluent-emoji-flat": 1.6, mdi: 1, "icon-park-solid": 0.6, fbs: 1.8, ph: 0.3, mingcute: 0.2, tabler: 0 };

/** Search the library. All the words have to match something (each word can be matched by its everyday synonyms). */
export async function searchClipart(q: string, opts: { style?: "all" | "one" | "full"; limit?: number } = {}): Promise<ClipHit[]> {
  const words = q.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter((w) => w.length > 1 && !["the", "and", "of", "for", "a", "with"].includes(w));
  const builtin = CLIPART.map((c) => ({ id: `fbs:${c.key}`, set: "fbs", name: c.key, label: c.label.toLowerCase(), full: false }));
  const lib = await loadClipIndex();
  if (!words.length) return [];
  const groups = words.map((w) => {
    const s = stem(w);
    const alts = new Map<string, number>([[w, 1], [s, 1]]);
    for (const k of [w, s]) (SYN[k] || []).forEach((a) => a.split("-").forEach((p) => { if (!alts.has(p)) alts.set(p, 0.7); }));
    return [...alts.entries()];
  });
  const scoreTokens = (tokens: string[]) => {
    let total = 0;
    for (const g of groups) {
      let best = 0;
      for (const [a, wgt] of g) for (const t of tokens) {
        const v = t === a ? 10 : t.startsWith(a) && a.length >= 3 ? 6 : a.length >= 4 && t.includes(a) ? 3 : stem(t) === a ? 9 : 0;
        if (v * wgt > best) best = v * wgt;
      }
      if (!best) return 0;
      total += best;
    }
    return total;
  };
  const hits: { h: ClipHit; s: number }[] = [];
  const style = opts.style || "all";
  if (style !== "full") builtin.forEach((b) => { const s = scoreTokens(b.label.split(" ").concat(b.name)); if (s) hits.push({ h: b, s: s + SET_BONUS.fbs }); });
  if (lib) {
    for (const e of lib.entries) {
      const set = lib.idx.sets[e.si];
      if ((style === "one" && set.full) || (style === "full" && !set.full)) continue;
      const s = scoreTokens(e.tokens);
      if (!s) continue;
      hits.push({ h: { id: `${set.p}:${e.name}`, set: set.p, name: e.name, label: e.label, full: set.full }, s: s + (SET_BONUS[set.p] ?? 0) - e.tokens.length * 0.35 });
    }
  }
  hits.sort((a, b) => b.s - a.s);
  // don't let one set flood the first page
  const out: ClipHit[] = [], seen = new Map<string, number>(), rest: ClipHit[] = [];
  for (const { h } of hits) { const n = seen.get(h.set) || 0; if (out.length < 36 && n >= 14) rest.push(h); else { out.push(h); seen.set(h.set, n + 1); } }
  return out.concat(rest).slice(0, opts.limit || 400);
}

/** Several searches at once (a category), merged with the best results of each first. */
export async function searchMany(queries: string[], opts: { style?: "all" | "one" | "full"; limit?: number } = {}) {
  const lists = await Promise.all(queries.map((q) => searchClipart(q, { ...opts, limit: 120 })));
  const out: ClipHit[] = [], seen = new Set<string>();
  for (let r = 0; r < 120; r++) for (const l of lists) { const h = l[r]; if (h && !seen.has(h.id)) { seen.add(h.id); out.push(h); } }
  return out.slice(0, opts.limit || 400);
}

/** The drawing for each icon id ("set:name"), fetched a chunk at a time and cached. */
export async function getClipIcons(ids: string[]): Promise<Record<string, ClipIcon>> {
  const out: Record<string, ClipIcon> = {};
  const lib = await loadClipIndex();
  const want = new Map<string, string[]>();
  for (const id of ids) {
    const [p, name] = id.split(":");
    if (p === "fbs") {
      const c = CLIPART.find((x) => x.key === name);
      if (c) out[id] = { id, body: c.svg, w: 100, h: 100, left: 0, top: 0, full: false, label: c.label };
      continue;
    }
    if (!lib) continue;
    const si = lib.idx.sets.findIndex((s) => s.p === p);
    const e = si >= 0 ? lib.entries.find((x) => x.si === si && x.name === name) : null;
    if (!e) continue;
    const key = `${p}-${e.chunk}`;
    if (!want.has(key)) want.set(key, []);
    want.get(key)!.push(id);
  }
  await Promise.all([...want.entries()].map(async ([key, list]) => {
    if (!chunkCache.has(key)) chunkCache.set(key, fetch(`/clipart/c/${key}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
    const chunk = await chunkCache.get(key)!;
    for (const id of list) {
      const [p, name] = id.split(":");
      const d = chunk[name];
      const set = lib!.idx.sets.find((s) => s.p === p)!;
      if (d) out[id] = { id, body: d[0], w: d[1], h: d[2], left: d[3], top: d[4], full: set.full, label: labelOf(name) };
    }
  }));
  return out;
}

/** The first of several candidate icons that exists (templates list a few in case one set lacks a picture). */
export async function firstIcon(cands: string[]): Promise<ClipIcon | null> {
  const got = await getClipIcons(cands);
  for (const c of cands) if (got[c]) return got[c];
  return null;
}

/** Credits for the sets in use (CC BY sets need attribution). */
export async function clipCredits() {
  const lib = await loadClipIndex();
  return lib ? lib.idx.sets : [];
}

/** Make an icon's internal ids unique per copy (full-color icons use gradients with ids). */
export const uniqueIds = (body: string, key: string) =>
  body.replace(/id="([^"]+)"/g, `id="$1-${key}"`).replace(/url\(#([^)]+)\)/g, `url(#$1-${key})`).replace(/href="#([^"]+)"/g, `href="#$1-${key}"`);

export type ClipCategory = { key: string; label: string; emoji: string; subs: { label: string; q: string }[] };
/** Browse categories (modeled on the big custom-shirt sites). Each sub is a search. */
export const CLIP_CATEGORIES: ClipCategory[] = [
  { key: "sports", label: "Sports", emoji: "🏈", subs: [
    { label: "Football", q: "football" }, { label: "Baseball", q: "baseball" }, { label: "Softball", q: "softball" }, { label: "Basketball", q: "basketball" }, { label: "Soccer", q: "soccer" },
    { label: "Volleyball", q: "volleyball" }, { label: "Hockey", q: "hockey" }, { label: "Golf", q: "golf" }, { label: "Tennis", q: "tennis" }, { label: "Track & running", q: "running" },
    { label: "Swimming", q: "swim" }, { label: "Wrestling & boxing", q: "boxing" }, { label: "Cheer", q: "cheer" }, { label: "Bowling", q: "bowling" }, { label: "Lacrosse", q: "lacrosse" },
    { label: "Cycling", q: "bicycle" }, { label: "Fitness", q: "dumbbell" }, { label: "Racing", q: "racing" }, { label: "Martial arts", q: "karate" }, { label: "Skate & ski", q: "skateboard ski" },
  ] },
  { key: "mascots", label: "Mascots & animals", emoji: "🦅", subs: [
    { label: "Eagles & hawks", q: "eagle" }, { label: "Wolves", q: "wolf" }, { label: "Bears", q: "bear" }, { label: "Tigers & wildcats", q: "wildcat" }, { label: "Lions", q: "lion" },
    { label: "Dogs & bulldogs", q: "dog" }, { label: "Horses & mustangs", q: "horse" }, { label: "Bulls & rams", q: "bull" }, { label: "Sharks", q: "shark" }, { label: "Dragons", q: "dragon" },
    { label: "Knights & spartans", q: "knight" }, { label: "Vikings", q: "viking" }, { label: "Pirates", q: "pirate" }, { label: "Bees & hornets", q: "bee" }, { label: "Owls", q: "owl" },
    { label: "Snakes", q: "snake" }, { label: "Paw prints", q: "paw" }, { label: "Birds", q: "bird" }, { label: "Fish", q: "fish" }, { label: "Deer", q: "deer" },
  ] },
  { key: "school", label: "School & college", emoji: "🎓", subs: [
    { label: "Graduation", q: "graduation" }, { label: "Books & pencils", q: "book" }, { label: "Science", q: "science" }, { label: "Art", q: "art" }, { label: "Band & music", q: "band" },
    { label: "Theater", q: "theater" }, { label: "Awards", q: "trophy" }, { label: "Apple & teacher", q: "teacher" }, { label: "School bus", q: "bus" }, { label: "Sports gear", q: "whistle" },
  ] },
  { key: "music", label: "Music & arts", emoji: "🎸", subs: [
    { label: "Notes", q: "music note" }, { label: "Guitars", q: "guitar" }, { label: "Drums", q: "drum" }, { label: "Microphones", q: "microphone" }, { label: "Headphones", q: "headphones" },
    { label: "Piano & keys", q: "piano" }, { label: "Brass & horns", q: "trumpet saxophone" }, { label: "Theater masks", q: "theater" }, { label: "Dance", q: "dance" }, { label: "Painting", q: "palette" },
  ] },
  { key: "holidays", label: "Holidays & seasons", emoji: "🎄", subs: [
    { label: "Christmas", q: "christmas" }, { label: "Halloween", q: "halloween" }, { label: "Thanksgiving", q: "thanksgiving" }, { label: "4th of July", q: "fourth" }, { label: "Valentine's", q: "valentine" },
    { label: "St. Patrick's", q: "patrick" }, { label: "Easter", q: "easter" }, { label: "New Year", q: "newyear" }, { label: "Summer", q: "summer" }, { label: "Winter", q: "snow" }, { label: "Fall", q: "fall" },
  ] },
  { key: "patriotic", label: "Patriotic & service", emoji: "🇺🇸", subs: [
    { label: "USA & flags", q: "usa" }, { label: "Stars", q: "star" }, { label: "Military", q: "military" }, { label: "Navy & anchors", q: "navy" }, { label: "Firefighters", q: "firefighter" },
    { label: "Police", q: "police" }, { label: "EMS & medical", q: "ems" }, { label: "Medals", q: "medal" },
  ] },
  { key: "faith", label: "Faith & church", emoji: "✝️", subs: [
    { label: "Crosses", q: "cross" }, { label: "Church", q: "church" }, { label: "Doves", q: "dove" }, { label: "Praying hands", q: "praying" }, { label: "Bible", q: "bible" }, { label: "Angels", q: "angel" }, { label: "Hearts", q: "heart" },
  ] },
  { key: "causes", label: "Causes & awareness", emoji: "🎗️", subs: [
    { label: "Ribbons", q: "ribbon" }, { label: "Hearts & hands", q: "heart hand" }, { label: "Puzzle pieces", q: "puzzle" }, { label: "Medical", q: "medical" }, { label: "Animal rescue", q: "paw" },
  ] },
  { key: "outdoors", label: "Nature & outdoors", emoji: "🏔️", subs: [
    { label: "Mountains", q: "mountain" }, { label: "Trees", q: "tree" }, { label: "Camping", q: "camping" }, { label: "Sun & moon", q: "sun moon" }, { label: "Stars", q: "star" }, { label: "Flowers", q: "flower" },
    { label: "Weather", q: "weather" }, { label: "Ocean & waves", q: "ocean" }, { label: "Fishing", q: "fishing" }, { label: "Hunting", q: "hunting" },
  ] },
  { key: "travel", label: "Travel & vacation", emoji: "🌴", subs: [
    { label: "Beach", q: "beach" }, { label: "Palm trees", q: "palm" }, { label: "Planes", q: "airplane" }, { label: "Road trip", q: "car" }, { label: "Boats", q: "boat" }, { label: "Maps & compass", q: "compass map" },
  ] },
  { key: "food", label: "Food & drink", emoji: "🍕", subs: [
    { label: "Pizza & burgers", q: "pizza burger" }, { label: "BBQ", q: "bbq" }, { label: "Tacos & chili", q: "taco chili" }, { label: "Coffee", q: "coffee" }, { label: "Beer", q: "beer" },
    { label: "Sweets", q: "donut cupcake ice cream" }, { label: "Chef & kitchen", q: "chef" }, { label: "Fruit", q: "apple fruit" },
  ] },
  { key: "business", label: "Business & jobs", emoji: "🛠️", subs: [
    { label: "Construction", q: "construction" }, { label: "Tools", q: "tools" }, { label: "Auto & mechanic", q: "mechanic" }, { label: "Trucks", q: "truck" }, { label: "Farm", q: "farm" },
    { label: "Landscaping", q: "landscaping" }, { label: "Medical & dental", q: "medical dental" }, { label: "Salon & beauty", q: "salon" }, { label: "Real estate", q: "house" }, { label: "Tech", q: "tech" },
  ] },
  { key: "party", label: "Family & parties", emoji: "🎉", subs: [
    { label: "Birthday", q: "birthday" }, { label: "Wedding", q: "wedding" }, { label: "Bachelorette", q: "bachelorette" }, { label: "Baby", q: "baby" }, { label: "Family", q: "family" }, { label: "Party", q: "party" },
  ] },
  { key: "shapes", label: "Shapes, frames & badges", emoji: "🛡️", subs: [
    { label: "Shields & crests", q: "shield badge" }, { label: "Banners & ribbons", q: "banner ribbon" }, { label: "Laurels & wreaths", q: "laurel" }, { label: "Stars", q: "star" }, { label: "Hearts", q: "heart" },
    { label: "Circles & shapes", q: "circle square triangle hexagon" }, { label: "Arrows", q: "arrow" }, { label: "Crowns", q: "crown" },
  ] },
  { key: "fun", label: "Emoji & fun", emoji: "😎", subs: [
    { label: "Faces", q: "smile" }, { label: "Fire & 100", q: "fire hundred" }, { label: "Skulls", q: "skull" }, { label: "Space", q: "space" }, { label: "Rainbows & unicorns", q: "rainbow unicorn" }, { label: "Gaming", q: "gaming" },
  ] },
];
