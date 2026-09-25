import type { MetadataRoute } from "next";

// Private business app: ask search engines not to list it (the setup check stays readable).
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/api/health", disallow: "/" }] };
}
