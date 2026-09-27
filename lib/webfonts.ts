"use client";
/**
 * Fonts for the Idea Lab: the full Google Fonts library (list built into /public/fonts.json at deploy time),
 * grouped into shirt-friendly styles, loaded one font at a time as they're used.
 */
import { FONTS } from "@/lib/designerArt";

export type WebFont = { f: string; c: string; w: number[]; a?: [number, number]; p: number };

/** Shirt styles (a font can be in more than one). Names that Google doesn't have are simply skipped. */
export const FONT_STYLES: { key: string; label: string; fonts: string[] }[] = [
  { key: "popular", label: "Popular on shirts", fonts: ["Anton", "Bebas Neue", "Oswald", "Graduate", "Alfa Slab One", "Permanent Marker", "Pacifico", "Archivo Black", "Montserrat", "Bangers", "Lobster", "Staatliches", "Russo One", "Black Ops One", "Dancing Script", "Rye", "Bungee", "Teko", "Passion One", "Luckiest Guy", "Righteous", "Kaushan Script", "Special Elite", "Playfair Display", "Roboto Slab", "Fjalla One", "Titan One", "Shrikhand", "Yellowtail", "Monoton"] },
  { key: "athletic", label: "Athletic & varsity", fonts: ["Graduate", "Alfa Slab One", "Russo One", "Black Ops One", "Bungee", "Teko", "Oswald", "Anton", "Squada One", "Saira Stencil One", "Big Shoulders Display", "Kanit", "Racing Sans One", "Faster One", "Orbitron", "Play", "Chakra Petch", "Bowlby One SC", "Holtwood One SC", "Ultra", "Passion One", "Changa One", "Keania One", "Iceland", "Audiowide", "Aldrich", "Exo 2", "Saira Condensed", "Barlow Condensed", "Sarpanch", "Jockey One", "Stint Ultra Expanded", "Bungee Inline", "Graduate", "Freckle Face"] },
  { key: "block", label: "Bold block", fonts: ["Anton", "Bebas Neue", "Archivo Black", "Oswald", "Montserrat", "Staatliches", "Fjalla One", "League Gothic", "Passion One", "Titan One", "Bowlby One", "Rubik Mono One", "Dela Gothic One", "Poppins", "Inter", "Roboto Condensed", "Barlow", "Work Sans", "Raleway", "Lato", "Open Sans", "Nunito", "Archivo Narrow", "Antonio", "Six Caps", "Francois One", "Paytone One", "Days One", "Black Han Sans", "Lilita One"] },
  { key: "script", label: "Script", fonts: ["Pacifico", "Lobster", "Dancing Script", "Great Vibes", "Satisfy", "Kaushan Script", "Yellowtail", "Sacramento", "Allura", "Alex Brush", "Parisienne", "Cookie", "Courgette", "Damion", "Mr Dafoe", "Marck Script", "Leckerli One", "Norican", "Pinyon Script", "Tangerine", "Italianno", "Rochester", "Arizonia", "Lobster Two", "Style Script", "Oleo Script", "Grand Hotel", "Niconne", "Berkshire Swash", "Playball", "Carattere", "Birthstone Bounce", "Meow Script", "Sofia", "Bad Script"] },
  { key: "hand", label: "Handwritten & marker", fonts: ["Permanent Marker", "Caveat", "Amatic SC", "Indie Flower", "Shadows Into Light", "Patrick Hand", "Gochi Hand", "Rock Salt", "Covered By Your Grace", "Architects Daughter", "Reenie Beanie", "Homemade Apple", "Nothing You Could Do", "Kalam", "Gloria Hallelujah", "Just Another Hand", "Coming Soon", "Schoolbell", "Walter Turncoat", "Sedgwick Ave Display", "Caveat Brush", "Neucha", "Mansalva", "Knewave", "Sriracha"] },
  { key: "fun", label: "Fun & display", fonts: ["Bangers", "Luckiest Guy", "Chewy", "Fredoka", "Baloo 2", "Lilita One", "Titan One", "Bungee Shade", "Righteous", "Shrikhand", "Chango", "Fascinate", "Monoton", "Fugaz One", "Sniglet", "Boogaloo", "Carter One", "Knewave", "Bubblegum Sans", "Concert One", "Creepster", "Nosifer", "Frijole", "Rubik Bubbles", "Rubik Glitch", "Bungee Spice", "Londrina Solid", "Coiny", "Modak", "Spicy Rice"] },
  { key: "western", label: "Western & vintage", fonts: ["Rye", "Smokum", "Ewert", "Sancreek", "Diplomata", "Diplomata SC", "Holtwood One SC", "Abril Fatface", "Ultra", "Emblema One", "Vast Shadow", "Alfa Slab One", "Chela One", "Limelight", "Poiret One", "Josefin Slab", "Old Standard TT", "Bevan", "Arvo", "Zilla Slab", "Rubik Dirt", "Special Elite", "Oldenburg", "Wellfleet", "Graduate"] },
  { key: "gothic", label: "Old English & gothic", fonts: ["UnifrakturMaguntia", "UnifrakturCook", "Pirata One", "New Rocker", "Grenze Gotisch", "Metal Mania", "Jacquard 24", "Germania One", "Almendra", "MedievalSharp", "Cinzel Decorative", "Uncial Antiqua", "IM Fell English SC", "Eagle Lake", "Fondamento"] },
  { key: "stencil", label: "Stencil & military", fonts: ["Black Ops One", "Saira Stencil One", "Allerta Stencil", "Stardos Stencil", "Special Elite", "Wallpoet", "Big Shoulders Stencil Display", "Emblema One", "Gugi", "Orbitron", "Share Tech Mono", "Sarpanch"] },
  { key: "serif", label: "Classic serif", fonts: ["Playfair Display", "Roboto Slab", "Merriweather", "Lora", "Libre Baskerville", "Cinzel", "Cormorant Garamond", "EB Garamond", "Crimson Text", "Abril Fatface", "Bitter", "DM Serif Display", "Prata", "Yeseva One", "Rozha One", "Alike", "Spectral", "Noto Serif", "PT Serif", "Domine"] },
];

let listP: Promise<WebFont[]> | null = null;
/** Every Google font family (most popular first); the built-in shirt fonts when the list isn't available. */
export function loadFontList(): Promise<WebFont[]> {
  if (!listP) {
    listP = fetch("/fonts.json").then((r) => (r.ok ? r.json() : null)).then((j: { fonts: WebFont[] } | null) => j?.fonts?.length ? j.fonts : null).catch(() => null)
      .then((list) => list || FONTS.map((f, i) => ({ f: f.name, c: f.group, w: [f.weight], p: i })));
  }
  return listP;
}

const plus = (s: string) => s.replace(/ /g, "+");
/** The weight we use for a family: its heaviest up to the one asked for (bold 700 by default for shirts reads well, but regular when that's all there is). */
export function pickWeight(font: WebFont | undefined, want = 400) {
  if (!font) return want;
  if (font.a) return Math.max(font.a[0], Math.min(font.a[1], want));
  const ok = font.w.filter((w) => w <= want);
  return ok.length ? ok[ok.length - 1] : font.w[0];
}
/** Whether a bolder weight exists for this family. */
export const hasBold = (font: WebFont | undefined, from: number) => !!font && (font.a ? font.a[1] > from : font.w.some((w) => w > from));
export const boldOf = (font: WebFont | undefined, from: number) => (font?.a ? Math.min(font.a[1], Math.max(700, from + 100)) : font?.w.find((w) => w > from && w >= 600) || font?.w.find((w) => w > from) || from);

/** css2 "family=" value for a family at one weight. */
export const cssFamily = (family: string, weight: number) => `${plus(family)}${weight !== 400 ? `:wght@${weight}` : ""}`;

const loaded = new Map<string, Promise<void>>();
/** Load one font (family + weight) so text can be drawn and measured with it. */
export function loadFont(family: string, weight = 400): Promise<void> {
  const key = `${family}:${weight}`;
  if (typeof document === "undefined") return Promise.resolve();
  if (!loaded.has(key)) {
    loaded.set(key, new Promise<void>((res) => {
      const ln = document.createElement("link");
      ln.rel = "stylesheet";
      ln.href = `https://fonts.googleapis.com/css2?family=${cssFamily(family, weight)}&display=swap`;
      ln.onload = () => { document.fonts?.load?.(`${weight} 40px '${family}'`).then(() => res(), () => res()); };
      ln.onerror = () => res();
      document.head.appendChild(ln);
      setTimeout(res, 5000);
    }));
  }
  return loaded.get(key)!;
}

/** Show a font in the font list: loads that one font (only fonts scrolled into view are fetched). */
export function previewFont(family: string, weight: number) { void loadFont(family, weight); }
