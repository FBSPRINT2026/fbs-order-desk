import "./globals.css";
import type { Metadata, Viewport } from "next";
import PageTitle from "@/components/PageTitle";
import ToolbarFit from "@/components/ToolbarFit";
import TableFit from "@/components/TableFit";

// appleWebApp: from the Home Screen the portal opens as its own app (full screen), which iPhones need for notifications
export const metadata: Metadata = { title: "FBS Order Desk", description: "Quotes, invoices, production and customer portal", appleWebApp: { capable: true, title: "FBS", statusBarStyle: "default" } };
// maximumScale 1: iPhones don't zoom the page in when you tap into a search or reply box (pinch-zoom still works,
// iOS ignores it for that) (Oct 12: Amanda's page stayed zoomed in after searching her email)
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=IBM+Plex+Mono:wght@400;500;600&family=Public+Sans:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>{children}<ToolbarFit /><TableFit /><PageTitle /></body>
    </html>
  );
}
