import type { Metadata } from "next";
import "./dp.css";

export const metadata: Metadata = { title: "DraftPunk", description: "Homebrew recipes for the club" };

/**
 * DraftPunk (Nick, Nov 23 2026): a homebrew recipe app like BeerSmith, for Nick and his homebrew club, inside the portal
 * so it needs no new subscription. Its own tables (dp_*, migrations 337–338), its own look (an 80s amber DOS screen,
 * dp- classes, app/draftpunk/dp.css) and its own sign-in; nothing here touches the shop.
 */
export default function DraftPunkLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dp-crt" data-notranslate>
      {/* the pixel fonts: VT323 for the screen, Press Start 2P for the title */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" />
      {children}
    </div>
  );
}
