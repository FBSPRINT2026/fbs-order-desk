import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "FBS Work", description: "Log time on each job", manifest: "/crew.webmanifest", appleWebApp: { capable: true, title: "FBS Crew", statusBarStyle: "black-translucent" } };
export const viewport: Viewport = { themeColor: "#121925", width: "device-width", initialScale: 1, maximumScale: 1 };

export default function WorkLayout({ children }: { children: React.ReactNode }) {
  return children;
}
