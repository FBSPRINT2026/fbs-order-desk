"use client";
import type { Design } from "@/lib/pricing";
import { lineColor, mainLine } from "@/lib/mockup";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LogoFace, LogoPic, PaintedPic, onShirtsOf } from "@/components/LogoOnShirts";

/** a logo background's own picture (Edit logo → Backgrounds, specs.onShirts[0].path), signed once per page: the tile is
 *  that picture, as the Artwork page shows it (Nick, Nov 16 2026: the AMS logos on the customer's Brands list came out as
 *  a white box, the raw .ai preview with its knocked-out letters filled white, while the Artwork page was right) */
const OWN = new Map<string, Promise<string>>();
function useOwnPic(path: string): string {
  const [u, setU] = useState("");
  useEffect(() => {
    if (!path) return;
    let on = true;
    if (!OWN.has(path)) OWN.set(path, createClient().storage.from("proofs").createSignedUrl(path, 3600).then((r) => r.data?.signedUrl || "").catch(() => ""));
    OWN.get(path)!.then((x) => { if (on) setU(x); });
    return () => { on = false; };
  }, [path]);
  return u;
}

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
  const own = onShirtsOf(d)[0]?.path || "", ownUrl = useOwnPic(!shirt || !inkMap ? own : "");
  if (!url) return <span className={"logo-thumb " + (className || "")} />;
  return (
    <span className={"logo-thumb " + (className || "")}>
      {inkMap && Object.keys(inkMap).length && shirt
        ? <PaintedPic url={url} map={inkMap} shirt={shirt} alt={d.name} />
        : shirt || onShirtsOf(d).length
          ? <LogoFace d={d} urls={{ [d.id]: url, ...(own && ownUrl ? { [own]: ownUrl } : {}) }} shirt={shirt || undefined} printed={shirt ? { shirt } : null} />
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
  return <LogoThumb d={d} url={url} shirt={lineColor(mainLine(lines || [])) || undefined} inkMap={print.inkMap?.map} className={className} />;
}

