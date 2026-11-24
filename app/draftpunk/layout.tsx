import type { Metadata } from "next";
import "./dp.css";

export const metadata: Metadata = { title: "DraftPunk", description: "Homebrew recipes for the club" };

/**
 * DraftPunk (Nick, Nov 23 2026): a homebrew recipe app like BeerSmith, for Nick and his homebrew club, inside the portal
 * so it needs no new subscription. Its own tables (dp_*, migrations 337–338), its own look (BeerSmith's layout, modernized: light or
 * dark, tinted by the recipe's beer color; dp- classes, app/draftpunk/dp.css) and its own sign-in; nothing here touches the shop.
 */
export default function DraftPunkLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dp-app" data-notranslate>
      {/* Inter for text, Bricolage Grotesque for headings and big numbers */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Inter:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&family=Archivo:wdth,wght@100..125,600..900&family=DM+Sans:wght@400;500;700&display=swap" />
      {children}
    </div>
  );
}
