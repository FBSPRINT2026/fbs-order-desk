"use client";
import type { Design } from "@/lib/pricing";
import { lineColor } from "@/lib/mockup";
import { LogoFace, LogoPic, PaintedPic, onShirtsOf } from "@/components/LogoOnShirts";

/**
 * THE small logo picture, for every list and row that shows a logo (Oct 28, Nick: "these little preview boxes are wrong
 * here… I have to tell you everywhere when there's a problem that's universal… you just fix it in one spot at a time").
 * One look everywhere, the same as the Artwork page's tiles (components/LogoOnShirts.tsx LogoFace): the logo's own
 * first background when it has one; on an order, painted in the inks it prints in (Imprint.inkMap) on that garment's
 * color; else the art with its background square taken off, on the garment color when known, white otherwise (a dark
 * tile for a white logo). Never the raw upload with its red or black square.
 *
 * Size it with the wrapping element (`.lt` fills its box). Any place that shows a logo uses this, not an <img>.
 */
export default function LogoThumb({ d, url, shirt, inkMap, className }: {
  d: Pick<Design, "id" | "name" | "specs">;
  /** the logo's picture (its preview), signed */ url: string;
  /** the garment color it's printed on, when known (an order's line) */ shirt?: string;
  /** the print's ink map (Imprint.inkMap.map): the logo painted in its inks */ inkMap?: Record<string, { hex: string; name: string }> | null;
  className?: string;
}) {
  if (!url) return <span className={"lt " + (className || "")} />;
  return (
    <span className={"lt " + (className || "")}>
      {inkMap && Object.keys(inkMap).length && shirt
        ? <PaintedPic url={url} map={inkMap} shirt={shirt} alt={d.name} />
        : shirt || onShirtsOf(d).length
          ? <LogoFace d={d} urls={{ [d.id]: url }} shirt={shirt || undefined} printed={shirt ? { shirt } : null} />
          : <LogoPic url={url} alt={d.name} cut />}
    </span>
  );
}

/**
 * A logo as an order's print shows it: painted in that print's inks (or threads) on its garment's color. Every place that
 * shows a print's logo uses this, so a tile can't come out different from the order's own picture (Oct 29, Nick: "these
 * little squares aren't showing accurately again": the Digitizing line's tiles left out the garment color).
 */
export function PrintThumb({ d, url, print, lines, className }: {
  d: Pick<Design, "id" | "name" | "specs">; url: string;
  print: { inkMap?: { map?: Record<string, { hex: string; name: string }> | null } | null };
  /** the print's group's garments: the first with a color is the one it's shown on, in its picked color when it has one */ lines?: { color?: string; hex?: string }[] | null;
  className?: string;
}) {
  return <LogoThumb d={d} url={url} shirt={lineColor((lines || []).find((l) => l.color || l.hex)) || undefined} inkMap={print.inkMap?.map} className={className} />;
}

