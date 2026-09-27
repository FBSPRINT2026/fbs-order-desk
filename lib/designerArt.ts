/**
 * Shirt designer building blocks: shirt-friendly fonts (Google Fonts), simple one-color clip art drawn in-house
 * (so there are no license questions), and starter templates.
 * Artboard units: 50 per inch. The default artboard is a 12" x 14" full front print area.
 */
export const UNITS_PER_IN = 50;

export type Font = { name: string; weight: number; css: string; group: "Block" | "Sport" | "Script" | "Fun" | "Classic" };
/** css = the Google Fonts css2 "family=" value */
export const FONTS: Font[] = [
  { name: "Anton", weight: 400, css: "Anton", group: "Block" },
  { name: "Bebas Neue", weight: 400, css: "Bebas+Neue", group: "Block" },
  { name: "Oswald", weight: 600, css: "Oswald:wght@600", group: "Block" },
  { name: "Archivo Black", weight: 400, css: "Archivo+Black", group: "Block" },
  { name: "Montserrat", weight: 800, css: "Montserrat:wght@800", group: "Block" },
  { name: "Staatliches", weight: 400, css: "Staatliches", group: "Block" },
  { name: "Graduate", weight: 400, css: "Graduate", group: "Sport" },
  { name: "Alfa Slab One", weight: 400, css: "Alfa+Slab+One", group: "Sport" },
  { name: "Russo One", weight: 400, css: "Russo+One", group: "Sport" },
  { name: "Black Ops One", weight: 400, css: "Black+Ops+One", group: "Sport" },
  { name: "Bungee", weight: 400, css: "Bungee", group: "Sport" },
  { name: "Pacifico", weight: 400, css: "Pacifico", group: "Script" },
  { name: "Lobster", weight: 400, css: "Lobster", group: "Script" },
  { name: "Dancing Script", weight: 700, css: "Dancing+Script:wght@700", group: "Script" },
  { name: "Permanent Marker", weight: 400, css: "Permanent+Marker", group: "Fun" },
  { name: "Bangers", weight: 400, css: "Bangers", group: "Fun" },
  { name: "Rye", weight: 400, css: "Rye", group: "Fun" },
  { name: "Special Elite", weight: 400, css: "Special+Elite", group: "Fun" },
  { name: "Roboto Slab", weight: 700, css: "Roboto+Slab:wght@700", group: "Classic" },
  { name: "Playfair Display", weight: 700, css: "Playfair+Display:wght@700", group: "Classic" },
];
/** A font by family name: the built-in shirt fonts know their weight; any other Google family defaults to regular. */
export const fontOf = (name: string): Font => FONTS.find((f) => f.name === name) || { name: name || "Anton", weight: 400, css: (name || "Anton").replace(/ /g, "+"), group: "Block" };
export const FONTS_CSS_URL = `https://fonts.googleapis.com/css2?${FONTS.map((f) => `family=${f.css}`).join("&")}&display=swap`;

/** Sun rays, built once */
const rays = Array.from({ length: 12 }, (_, i) => {
  const a = (i * Math.PI) / 6, w = 0.13;
  const p = (r: number, t: number) => `${(50 + r * Math.sin(t)).toFixed(1)},${(50 - r * Math.cos(t)).toFixed(1)}`;
  return `<polygon points="${p(47, a)} ${p(30, a - w)} ${p(30, a + w)}"/>`;
}).join("");

/** One-color clip art in a 100 x 100 box. Filled with the layer's color (currentColor). */
export const CLIPART: { key: string; label: string; group: "Shapes" | "Sports" | "Icons"; svg: string }[] = [
  { key: "star", label: "Star", group: "Icons", svg: `<polygon points="50,4 61.8,36.9 96.6,37.6 68.9,58.8 79.4,93.4 50,73 20.6,93.4 31.1,58.8 3.4,37.6 38.2,36.9"/>` },
  { key: "heart", label: "Heart", group: "Icons", svg: `<path d="M50 90C20 68 4 52 4 31 4 16 15 6 28 6c10 0 17 6 22 14 5-8 12-14 22-14 13 0 24 10 24 25 0 21-16 37-46 59Z"/>` },
  { key: "bolt", label: "Lightning", group: "Icons", svg: `<polygon points="60,2 16,58 46,58 36,98 84,38 54,38 66,2"/>` },
  { key: "paw", label: "Paw print", group: "Icons", svg: `<ellipse cx="50" cy="69" rx="23" ry="19"/><ellipse cx="20" cy="44" rx="9" ry="12" transform="rotate(-24 20 44)"/><ellipse cx="39" cy="24" rx="9.5" ry="13"/><ellipse cx="61" cy="24" rx="9.5" ry="13"/><ellipse cx="80" cy="44" rx="9" ry="12" transform="rotate(24 80 44)"/>` },
  { key: "crown", label: "Crown", group: "Icons", svg: `<path d="M8 76 14 28l20 22 16-32 16 32 20-22 6 48Z"/><rect x="8" y="82" width="84" height="10"/>` },
  { key: "mountains", label: "Mountains", group: "Icons", svg: `<path d="M2 86 36 26l17 30 13-18 32 48Z"/>` },
  { key: "sun", label: "Sun", group: "Icons", svg: `<circle cx="50" cy="50" r="23"/>${rays}` },
  { key: "moon", label: "Moon", group: "Icons", svg: `<path d="M60 6a44 44 0 1 0 34 66A36 36 0 1 1 60 6Z"/>` },
  { key: "flame", label: "Flame", group: "Icons", svg: `<path d="M50 4c8 20 30 30 30 56 0 20-14 36-30 36S20 82 20 64c0-16 10-24 14-34 4 14 10 18 14 20-2-14-4-30 2-46Z"/>` },
  { key: "tree", label: "Pine tree", group: "Icons", svg: `<polygon points="50,4 76,40 64,40 86,70 58,70 58,96 42,96 42,70 14,70 36,40 24,40"/>` },
  { key: "note", label: "Music note", group: "Icons", svg: `<path d="M36 14 88 4v62a13 10 0 1 1-8-9V22L44 29v47a13 10 0 1 1-8-9Z"/>` },
  { key: "trophy", label: "Trophy", group: "Icons", svg: `<path fill-rule="evenodd" d="M28 8h44v6h20v12c0 16-12 24-22 26-4 8-10 12-14 14v12h12v14H32V78h12V66c-4-2-10-6-14-14C20 50 8 42 8 26V14h20Zm-12 14v4c0 10 6 16 12 18-1-6 0-14 0-22Zm68 0H72c0 8 1 16 0 22 6-2 12-8 12-18Z"/>` },
  { key: "anchor", label: "Anchor", group: "Icons", svg: `<g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"><circle cx="50" cy="15" r="9"/><path d="M50 24v66M31 40h38M14 60c3 20 19 30 36 30s33-10 36-30"/></g>` },
  { key: "shield", label: "Shield", group: "Shapes", svg: `<path d="M50 4 90 16v30c0 26-18 42-40 50C28 88 10 72 10 46V16Z"/>` },
  { key: "banner", label: "Banner", group: "Shapes", svg: `<rect x="16" y="30" width="68" height="34"/><path d="M16 38H2l7 12-7 12h14ZM84 38h14l-7 12 7 12H84Z"/>` },
  { key: "circle", label: "Circle", group: "Shapes", svg: `<circle cx="50" cy="50" r="48"/>` },
  { key: "ring", label: "Ring", group: "Shapes", svg: `<circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" stroke-width="7"/>` },
  { key: "square", label: "Square", group: "Shapes", svg: `<rect x="4" y="4" width="92" height="92"/>` },
  { key: "line", label: "Line", group: "Shapes", svg: `<rect x="0" y="46" width="100" height="8"/>` },
  { key: "arrow", label: "Arrow", group: "Shapes", svg: `<polygon points="4,40 64,40 64,20 96,50 64,80 64,60 4,60"/>` },
  { key: "cross", label: "Cross", group: "Shapes", svg: `<polygon points="40,4 60,4 60,30 84,30 84,50 60,50 60,96 40,96 40,50 16,50 16,30 40,30"/>` },
  { key: "basketball", label: "Basketball", group: "Sports", svg: `<g fill="none" stroke="currentColor" stroke-width="5"><circle cx="50" cy="50" r="44"/><path d="M6 50h88M50 6v88M20 17c18 18 18 48 0 66M80 17c-18 18-18 48 0 66"/></g>` },
  { key: "baseball", label: "Baseball", group: "Sports", svg: `<g fill="none" stroke="currentColor" stroke-width="5"><circle cx="50" cy="50" r="44"/><path d="M27 12c14 24 14 52 0 76M73 12c-14 24-14 52 0 76"/><path stroke-width="3" d="M30 22l9-3M33 32l9-2M35 43l9-1M35 55l9 1M33 66l9 2M30 77l9 3M70 22l-9-3M67 32l-9-2M65 43l-9-1M65 55l-9 1M67 66l-9 2M70 77l-9 3"/></g>` },
  { key: "football", label: "Football", group: "Sports", svg: `<path fill-rule="evenodd" d="M50 20c30 0 46 20 46 30S80 80 50 80 4 60 4 50s16-30 46-30ZM30 47v6h40v-6ZM37 40v7h4v-7Zm11 0v7h4v-7Zm11 0v7h4v-7ZM37 53v7h4v-7Zm11 0v7h4v-7Zm11 0v7h4v-7Z"/>` },
  { key: "soccer", label: "Soccer ball", group: "Sports", svg: `<path fill-rule="evenodd" d="M50 4a46 46 0 1 1 0 92 46 46 0 0 1 0-92Zm0 8a38 38 0 1 0 0 76 38 38 0 0 0 0-76Z"/><polygon points="50,32 67,44 61,64 39,64 33,44"/><path fill="none" stroke="currentColor" stroke-width="4" d="M50 32V12M67 44l18-7M61 64l11 17M39 64 28 81M33 44l-18-7"/>` },
];
export const clipartOf = (key: string) => CLIPART.find((c) => c.key === key);

export type TextLayer = { kind: "text"; text: string; font: string; /** font weight (default: the font's own) */ weight?: number; size: number; color: string; stroke: string; strokeW: number; spacing: number; arc: number;
  /** drop shadow color and distance (artboard units) */ shadow?: string; shadowD?: number };
/** Clip art: built-in art by key, or library art ("set:name") with its drawing saved in the layer so designs never break. */
export type ArtLayer = { kind: "art"; art: string; color: string; w: number; body?: string; /** viewBox: left, top, width, height */ vb?: [number, number, number, number]; /** full-color art can't be recolored */ full?: boolean; label?: string };
export type ImgLayer = { kind: "img"; src: string; w: number; h: number; name?: string; /** the other version (with / without background) */ alt?: string; knocked?: boolean };
export type Layer = { id: string; x: number; y: number; rot: number; s: number; hidden?: boolean; /** mirrored left-right */ flip?: boolean; /** can't be moved by accident */ lock?: boolean } & (TextLayer | ArtLayer | ImgLayer);
/** A layer before it gets its id (keeps the text / clip art / picture fields apart). */
export type LayerInit = Layer extends infer L ? (L extends Layer ? Omit<L, "id"> : never) : never;
export type DesignDoc = { v: 1; w: number; h: number; layers: Layer[] };

/** Shirt colors to preview the design on while you work. */
export const SHIRT_BG: { name: string; hex: string }[] = [
  { name: "White", hex: "#FFFFFF" }, { name: "Sport Grey", hex: "#B9BCBF" }, { name: "Black", hex: "#1B1B1B" },
  { name: "Navy", hex: "#1F2A44" }, { name: "Royal", hex: "#1D4F9C" }, { name: "Red", hex: "#C8102E" },
  { name: "Maroon", hex: "#6B1F33" }, { name: "Forest", hex: "#1F3D2B" }, { name: "Gold", hex: "#F1A91C" }, { name: "Sand", hex: "#D8C9A8" },
];
