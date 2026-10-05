/**
 * The ink names in a separation file that came back from Separo (or Illustrator, Photoshop…): the spot colors it
 * defines, in the order it lists them. Best effort, read straight from the file's text: DCS 2.0 EPS `%%PlateFile` (Separo's
 * own export: "#2 - 7405 C"), PDF / AI `/Separation /Name`
 * color spaces, EPS `%%DocumentCustomColors` / `%%CMYKCustomColor` comments, PSD channel names don't count (binary).
 */
const SKIP = /^(all|none|cyan|magenta|yellow|black ?\(process\)|process ?(cyan|magenta|yellow|black)|registration)$/i;

const pdfName = (s: string) => s.replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

export function inkNamesFromText(t: string): string[] {
  const out: string[] = [];
  const add = (n: string) => { const x = n.trim().replace(/\s+/g, " "); if (x && !SKIP.test(x) && !out.some((o) => o.toLowerCase() === x.toLowerCase())) out.push(x); };
  // DCS 2.0 EPS (Separo, Photoshop): %%PlateFile: (#2 - 7405 C) EPS #… : one plate per spot color, in print order
  for (const m of t.matchAll(/%%PlateFile:\s*\(([^)]+)\)/g)) { if (/^(cyan|magenta|yellow|black)$/i.test(m[1].trim())) continue; add(m[1].replace(/^#?\d+\s*[-–]\s*/, "")); }
    // EPS: %%DocumentCustomColors: (PMS 286 C) (White) then %%+ (more)
  const dc = t.match(/%%DocumentCustomColors:([^\n]*(?:\n%%\+[^\n]*)*)/);
  if (dc) for (const m of dc[1].matchAll(/\(([^)]+)\)/g)) add(m[1]);
  for (const m of t.matchAll(/%%CMYKCustomColor:\s*[\d.\s]+\(([^)]+)\)/g)) add(m[1]);
  // PDF / AI: [/Separation /PANTONE#20286#20C /DeviceCMYK …] or (name) strings
  for (const m of t.matchAll(/\/Separation\s*\/([^\s/\[\]<>()]+)/g)) add(pdfName(m[1]));
  for (const m of t.matchAll(/\/Separation\s*\(([^)]+)\)/g)) add(m[1]);
  return out.slice(0, 16);
}

/** read the first 12 MB of each file as text and collect the spot color names */
export async function inkNamesFromFiles(files: File[]): Promise<string[]> {
  const all: string[] = [];
  for (const f of files) {
    if (!/\.(eps|ai|pdf|ps)$/i.test(f.name) && !/postscript|pdf|illustrator/i.test(f.type)) continue;
    try {
      const buf = new Uint8Array(await f.slice(0, 12 * 1024 * 1024).arrayBuffer());
      let t = ""; for (let i = 0; i < buf.length; i += 65536) t += String.fromCharCode(...buf.subarray(i, i + 65536));
      for (const n of inkNamesFromText(t)) if (!all.some((o) => o.toLowerCase() === n.toLowerCase())) all.push(n);
    } catch { /* unreadable: the shop types the inks */ }
  }
  return all;
}
