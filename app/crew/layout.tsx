import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import ScanWatch from "@/components/ScanWatch";
import StationShell from "@/components/StationShell";
import { stationOf } from "@/lib/stations";
import { getViewer } from "@/lib/supabase/server";
import "../j/job.css";

export const metadata: Metadata = { title: "FBS Crew", robots: { index: false }, // our own EN · ES switch translates these pages; the phone browser translating them too gave "Montando" for Setting up (Nick, Nov 16 2026)
  other: { google: "notranslate" }, manifest: "/crew.webmanifest", appleWebApp: { capable: true, title: "FBS Crew", statusBarStyle: "black-translucent" } };
export const viewport: Viewport = { themeColor: "#121925", width: "device-width", initialScale: 1, viewportFit: "cover" };

// a shop computer (FBS-PRESS) gets the same top bar as every shop computer: one search, View details, Print work order,
// Print box label (Nick, Nov 23 2026: "that same search bar on all the shop views"); a phone doesn't
export default async function CrewLayout({ children }: { children: ReactNode }) {
  const v = await getViewer().catch(() => null);
  const station = v?.email ? stationOf(v.email) : null;
  if (station) return <><StationShell station={station} page={children} /><ScanWatch mode="crew" /></>;
  return <>{children}<ScanWatch mode="crew" /></>;
}
