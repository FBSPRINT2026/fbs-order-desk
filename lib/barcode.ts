// Code 128 (set B) barcode as SVG. No outside libraries.
// Scanners read it like typing, so it works anywhere a keyboard would.

const PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232","2331112",
];
const START_B = 104;
const START_C = 105;
const CODE_B = 100; // switch from set C to set B
const STOP = 106;

/**
 * Module widths (bar, space, bar, …) for a Code 128 barcode of `text`.
 * Digit runs use set C (two digits per symbol, a shorter barcode); anything else uses set B.
 */
export function code128Modules(text: string): number[] {
  const clean = [...text].filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126).join("");
  const values: number[] = [];
  const lead = (clean.match(/^\d+/) || [""])[0];
  const cLen = lead.length - (lead.length % 2); // even number of leading digits
  if (cLen >= 4 || (cLen >= 2 && cLen === clean.length)) {
    values.push(START_C);
    for (let i = 0; i < cLen; i += 2) values.push(+clean.slice(i, i + 2));
    if (cLen < clean.length) {
      values.push(CODE_B);
      for (const ch of clean.slice(cLen)) values.push(ch.charCodeAt(0) - 32);
    }
  } else {
    values.push(START_B);
    for (const ch of clean) values.push(ch.charCodeAt(0) - 32);
  }
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103, STOP);
  return values.flatMap((v) => PATTERNS[v].split("").map(Number));
}

/** An SVG string for the barcode, stretched to the given size. */
export function code128Svg(text: string, heightUnits = 50): { svg: string; width: number } {
  const mods = code128Modules(text);
  const quiet = 10;
  let x = quiet;
  let rects = "";
  mods.forEach((w, i) => {
    if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="${heightUnits}"/>`;
    x += w;
  });
  const width = x + quiet;
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${heightUnits}" preserveAspectRatio="none" shape-rendering="crispEdges"><rect width="${width}" height="${heightUnits}" fill="#fff"/><g fill="#000">${rects}</g></svg>`, width };
}
