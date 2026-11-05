import type { MetadataRoute } from "next";
import { headers } from "next/headers";

// Private business app: ask search engines not to list it (the setup check stays readable). The public website at
// fbsprint.com (app/site) is listed.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = ((await headers()).get("host") || "").toLowerCase();
  if (/^(www\.)?fbsprint\.com/.test(host)) return { rules: [{ userAgent: "*", allow: "/", disallow: ["/shop", "/portal", "/api"] }] };
  return { rules: [{ userAgent: "*", allow: ["/api/health", "/site"], disallow: "/" }] };
}
