/**
 * The dashboard greeting: never the customer's name. Holidays get their own line;
 * otherwise good morning / afternoon / evening by the viewer's own clock.
 */
function nthWeekday(y: number, m: number, weekday: number, n: number) { const d = new Date(y, m, 1); const add = (weekday - d.getDay() + 7) % 7; return new Date(y, m, 1 + add + (n - 1) * 7).getDate(); }
function lastWeekday(y: number, m: number, weekday: number) { const d = new Date(y, m + 1, 0); return d.getDate() - ((d.getDay() - weekday + 7) % 7); }
function easter(y: number) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451); const mo = Math.floor((h + l - 7 * m + 114) / 31) - 1, da = ((h + l - 7 * m + 114) % 31) + 1; return [mo, da]; }

export function holiday(now = new Date()): string | null {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  if (m === 0 && d === 1) return "Happy New Year!";
  if (m === 1 && d === 14) return "Happy Valentine's Day!";
  if (m === 2 && d === 17) return "Happy St. Patrick's Day!";
  const [em, ed] = easter(y); if (m === em && d === ed) return "Happy Easter!";
  if (m === 4 && d === nthWeekday(y, 4, 0, 2)) return "Happy Mother's Day!";
  if (m === 4 && d === lastWeekday(y, 4, 1)) return "Happy Memorial Day!";
  if (m === 5 && d === nthWeekday(y, 5, 0, 3)) return "Happy Father's Day!";
  if (m === 6 && d === 4) return "Happy 4th of July!";
  if (m === 8 && d === nthWeekday(y, 8, 1, 1)) return "Happy Labor Day!";
  if (m === 9 && d === 31) return "Happy Halloween!";
  if (m === 10 && d === 11) return "Happy Veterans Day!";
  const tg = nthWeekday(y, 10, 4, 4);
  if (m === 10 && d === tg) return "Happy Thanksgiving!";
  if (m === 10 && d === tg - 1) return "Happy Thanksgiving week!";
  if (m === 11 && d === 24) return "Merry Christmas Eve!";
  if (m === 11 && d === 25) return "Merry Christmas!";
  if (m === 11 && d === 31) return "Happy New Year's Eve!";
  if (m === 11 && d >= 15) return "Happy holidays!";
  return null;
}
export function greeting(now = new Date()): string {
  const h = holiday(now);
  if (h) return h;
  const hr = now.getHours();
  return hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
}
