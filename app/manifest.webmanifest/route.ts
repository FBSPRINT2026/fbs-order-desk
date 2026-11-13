
/**
 * The portal as an app (Oct 12): added to an iPhone's Home Screen it opens full screen like an app, and can get
 * notifications (Away mode, the Job watcher) — iPhones only allow those for Home Screen apps.
 */
export const dynamic = "force-static";

// a route of its own, named in the root layout's metadata (not the app/manifest.ts file convention), so a part of the
// site can name its own app instead: the crew pages link /crew.webmanifest (Nov 13)
export function GET() {
  return new Response(JSON.stringify({
    name: "FBS Portal",
    short_name: "FBS",
    description: "FBS Print: email, orders and production",
    start_url: "/shop",
    scope: "/",
    display: "standalone",
    background_color: "#141D2B",
    theme_color: "#141D2B",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }), { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" } });
}
