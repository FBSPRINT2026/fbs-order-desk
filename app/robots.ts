import type { MetadataRoute } from "next";

// Private business app: ask search engines not to list it.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
