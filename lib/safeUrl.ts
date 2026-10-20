/** web addresses staff paste or a customer's site gives: fetched by the server only when public (Oct 20) */
/** a public https address (not an IP or a local name) */
export function safeUrl(u: string): URL | null {
  try {
    const x = new URL(u.startsWith("//") ? `https:${u}` : u);
    if (x.protocol !== "https:" && x.protocol !== "http:") return null;
    x.protocol = "https:";
    if (!x.hostname.includes(".") || /^[\d.]+$/.test(x.hostname) || x.hostname.includes(":") || /(^|\.)(localhost|local|internal)$/i.test(x.hostname)) return null;
    return x;
  } catch { return null; }
}
