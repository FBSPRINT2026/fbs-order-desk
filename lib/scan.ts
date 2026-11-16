/**
 * The barcode / QR scanners (Nick, Nov 16 2026: "if you just have the page open and you scan it, it automatically brings
 * up that order… with receiving you would scan it and then you would count it in"). A scanner types the code fast and
 * presses Enter. components/ScanWatch.tsx (every shop page, the crew menu and a job's phone menu) catches that anywhere
 * on the page and sends `SCAN_EVENT` with the job number; a page that does something of its own with a scan (Receiving
 * counts it in, Outbound asks label or ship) calls preventDefault on it, and otherwise the job opens.
 */
export const SCAN_EVENT = "fbs:scan";
export type ScanDetail = { n: string; raw: string };

/** a scanned or typed job: the QR's link ("…/j/50000-2"), "50000-2" (a box label) or "#50000" → "50000" */
export function jobCode(t: string): string {
  const s = t.trim();
  return s.match(/\/j\/#?(\d{3,7})(?:-\d{1,3})?/)?.[1] || s.match(/^#?(\d{3,7})(?:-\d{1,3})?$/)?.[1] || "";
}

/** listen for scans on a page: return true from `on` when the page handled it (the job won't be opened) */
export function onScan(on: (d: ScanDetail) => boolean | void) {
  const f = (e: Event) => { if (on((e as CustomEvent<ScanDetail>).detail)) e.preventDefault(); };
  window.addEventListener(SCAN_EVENT, f);
  return () => window.removeEventListener(SCAN_EVENT, f);
}
