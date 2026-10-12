import type { MetadataRoute } from "next";

/**
 * The portal as an app (Oct 12): added to an iPhone's Home Screen it opens full screen like an app, and can get
 * notifications (Away mode, the Job watcher) — iPhones only allow those for Home Screen apps.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
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
  };
}
