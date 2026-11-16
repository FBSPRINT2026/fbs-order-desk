import type { Metadata, Viewport } from "next";
import ScanWatch from "@/components/ScanWatch";
import "../j/job.css";

export const metadata: Metadata = { title: "FBS Crew", robots: { index: false }, // our own EN · ES switch translates these pages; the phone browser translating them too gave "Montando" for Setting up (Nick, Nov 16 2026)
  other: { google: "notranslate" }, manifest: "/crew.webmanifest", appleWebApp: { capable: true, title: "FBS Crew", statusBarStyle: "black-translucent" } };
export const viewport: Viewport = { themeColor: "#121925", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function CrewLayout({ children }: { children: React.ReactNode }) {
  return <>{children}<ScanWatch mode="crew" /></>;
}
