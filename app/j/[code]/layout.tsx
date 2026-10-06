import type { Metadata, Viewport } from "next";
import "../job.css";

export const metadata: Metadata = { title: "FBS Job", robots: { index: false }, appleWebApp: { capable: true, title: "FBS Job", statusBarStyle: "black-translucent" } };
export const viewport: Viewport = { themeColor: "#121925", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function JobLayout({ children }: { children: React.ReactNode }) {
  return children;
}
