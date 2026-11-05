/** where a slow page spends its time: laps logged once as "[timing] name a:120 b:480 …" (staff only; read in Vercel's logs) */
export function pageTimer(name: string, on: boolean) {
  const t0 = Date.now(), laps: string[] = [];
  return { lap: (k: string) => { if (on) laps.push(`${k}:${Date.now() - t0}`); }, done: () => { if (on) console.log(`[timing] ${name} ${laps.join(" ")}`); } };
}
