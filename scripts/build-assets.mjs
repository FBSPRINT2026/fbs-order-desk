// Builds the Idea Lab's clip art library and font list into public/ before `next build`.
// Clip art comes from open-licensed icon sets installed as npm packages (@iconify-json/*);
// the font list comes from Google Fonts' public metadata. Anything that fails is skipped:
// the Idea Lab still works with its built-in art and fonts.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const OUT = path.join(ROOT, "public", "clipart");
const CHUNK = 250;

/** Icon sets: who made them, their license, and which icons to keep. Full-color sets can't be recolored. */
const SETS = [
  { p: "game-icons", name: "Game Icons", by: "Lorc, Delapouite & contributors (game-icons.net)", license: "CC BY 3.0", full: false },
  { p: "fluent-emoji-high-contrast", name: "Fluent Emoji (one color)", by: "Microsoft", license: "MIT", full: false },
  { p: "mdi", name: "Material Design Icons", by: "Pictogrammers", license: "Apache 2.0", full: false },
  { p: "icon-park-solid", name: "IconPark", by: "ByteDance", license: "Apache 2.0", full: false },
  { p: "ph", name: "Phosphor", by: "Phosphor Icons", license: "MIT", full: false, only: /-fill$/, strip: /-fill$/ },
  { p: "mingcute", name: "MingCute", by: "MingCute Design", license: "Apache 2.0", full: false, only: /-fill$/, strip: /-fill$/ },
  { p: "tabler", name: "Tabler", by: "Paweł Kuna", license: "MIT", full: false, only: /-filled$/, strip: /-filled$/ },
  { p: "fluent-emoji-flat", name: "Fluent Emoji (full color)", by: "Microsoft", license: "MIT", full: true },
];

// company logos and trademarks never go on a customer's shirt from our library
const BRANDS = /(^|-)(logo|logos|brand|facebook|twitter|instagram|youtube|google|gmail|microsoft|windows|android|apple-logo|ios|github|gitlab|linkedin|pinterest|reddit|snapchat|tiktok|whatsapp|telegram|discord|slack|spotify|netflix|amazon|paypal|visa|mastercard|stripe|bitcoin|ethereum|nfl|nba|mlb|nhl|nascar|disney|pixar|marvel|nike|adidas|puma|pokemon|playstation|xbox|nintendo|steam|twitch|vimeo|dropbox|trello|jira|figma|sketch|adobe|chrome|firefox|safari|opera|edge|linux|ubuntu|debian|fedora|docker|kubernetes|npm|nodejs|react|angular|vue|svelte|python|java|php|ruby|rust|golang|swift|kotlin|wordpress|shopify|etsy|ebay|uber|lyft|airbnb|tesla|bmw|ford|chevrolet|toyota|honda|mercedes|audi|harley|starbucks|mcdonalds|coca|pepsi|wikipedia|patreon|kickstarter|medium|tumblr|flickr|dribbble|behance|mastodon|threads|bluesky|signal|skype|zoom|teams|office|excel|word|powerpoint|onedrive|onenote|outlook|yahoo|bing|duckduckgo|openai|chatgpt|anthropic|claude)(-|$)/;

function loadSet(p) {
  try {
    const pkg = require(`@iconify-json/${p}`);
    const icons = pkg.icons || require(`@iconify-json/${p}/icons.json`);
    let metadata = pkg.metadata;
    if (!metadata) { try { metadata = require(`@iconify-json/${p}/metadata.json`); } catch { metadata = null; } }
    return { icons, metadata };
  } catch (e) {
    console.warn(`[idea-lab] icon set ${p} not installed, skipping (${e && e.message ? e.message.split("\n")[0] : e})`);
    return null;
  }
}

function buildClipart() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, "c"), { recursive: true });
  const sets = [], entries = [], cats = [], catIndex = new Map();
  const catOf = (c) => { if (!catIndex.has(c)) { catIndex.set(c, cats.length); cats.push(c); } return catIndex.get(c); };
  let total = 0;
  for (const s of SETS) {
    const data = loadSet(s.p);
    if (!data) continue;
    const { icons: json, metadata } = data;
    const W = json.width || 16, H = json.height || 16;
    // categories (e.g. mdi "Sport", "Animal") help search; the brand category is dropped entirely
    const iconCat = new Map();
    const skip = new Set();
    for (const [c, names] of Object.entries((metadata && metadata.categories) || json.categories || {})) {
      if (/brand|logo/i.test(c)) { names.forEach((n) => skip.add(n)); continue; }
      names.forEach((n) => { if (!iconCat.has(n)) iconCat.set(n, catOf(c)); });
    }
    const names = Object.keys(json.icons || {}).filter((n) => {
      const ic = json.icons[n];
      if (!ic || ic.hidden || skip.has(n)) return false;
      if (s.only && !s.only.test(n)) return false;
      const base = s.strip ? n.replace(s.strip, "") : n;
      return !BRANDS.test(base);
    }).sort();
    const si = sets.length;
    sets.push({ p: s.p, name: s.name, by: s.by, license: s.license, full: s.full, w: W, h: H, n: names.length });
    for (let k = 0; k < names.length; k += CHUNK) {
      const part = names.slice(k, k + CHUNK), chunk = {};
      for (const n of part) {
        const ic = json.icons[n];
        const w = ic.width || W, h = ic.height || H;
        chunk[n] = [ic.body, w, h, ic.left || 0, ic.top || 0];
      }
      const ci = k / CHUNK;
      fs.writeFileSync(path.join(OUT, "c", `${s.p}-${ci}.json`), JSON.stringify(chunk));
      for (const n of part) {
        const e = [si, n, ci];
        if (iconCat.has(n)) e.push(iconCat.get(n));
        entries.push(e);
      }
    }
    total += names.length;
    console.log(`[idea-lab] ${s.p}: ${names.length} icons`);
  }
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ v: 1, built: new Date().toISOString(), sets, cats, i: entries }));
  console.log(`[idea-lab] clip art library: ${total} icons in ${sets.length} sets`);
}

async function buildFonts() {
  const file = path.join(ROOT, "public", "fonts.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    const res = await fetch("https://fonts.google.com/metadata/fonts", { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const data = JSON.parse(text.slice(text.indexOf("{")));
    const list = (data.familyMetadataList || [])
      .filter((f) => f.family && (f.subsets || []).includes("latin") && !/icons|symbols|emoji/i.test(f.family))
      .map((f) => {
        const weights = [...new Set(Object.keys(f.fonts || {}).filter((k) => /^\d+$/.test(k)).map(Number))].sort((a, b) => a - b);
        const axis = (f.axes || []).find((a) => a.tag === "wght");
        return { f: f.family, c: f.category || "", w: weights.length ? weights : [400], a: axis ? [axis.min, axis.max] : undefined, p: f.popularity || 9999 };
      })
      .sort((a, b) => a.p - b.p);
    if (list.length < 100) throw new Error("font list looks incomplete");
    fs.writeFileSync(file, JSON.stringify({ v: 1, built: new Date().toISOString(), fonts: list }));
    console.log(`[idea-lab] fonts: ${list.length} Google font families`);
  } catch (e) {
    console.warn(`[idea-lab] couldn't build the font list (${e && e.message}); the Idea Lab uses its built-in fonts`);
  }
}

try { buildClipart(); } catch (e) { console.warn("[idea-lab] clip art build failed:", e); }
await buildFonts();
