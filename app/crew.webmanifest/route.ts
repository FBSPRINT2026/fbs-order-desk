/**
 * The crew's own Home Screen app (Nick, Nov 13 2026: an employee's login saved to an iPhone's Home Screen opened the full
 * portal, because the one app manifest (app/manifest.ts) starts at /shop). The crew pages (/crew, /j/<number>, /work)
 * link this one instead, so the icon opens the crew's main menu.
 */
export const dynamic = "force-static";

export function GET() {
  return new Response(JSON.stringify({
    name: "FBS Crew",
    short_name: "FBS Crew",
    description: "FBS Print: count in, the press timer, my time card",
    id: "/crew",
    start_url: "/crew",
    scope: "/",
    display: "standalone",
    background_color: "#121925",
    theme_color: "#121925",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }), { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" } });
}
