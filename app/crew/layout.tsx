import type { Metadata, Viewport } from "next";
import "../j/job.css";

export const metadata: Metadata = { title: "FBS Crew", robots: { index: false }, manifest: "/crew.webmanifest", appleWebApp: { capable: true, title: "FBS Crew", statusBarStyle: "black-translucent" } };
export const viewport: Viewport = { themeColor: "#121925", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function CrewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
