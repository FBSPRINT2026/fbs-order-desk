"use client";
import { useState } from "react";
import PicZoom from "@/components/PicZoom";

/**
 * A group's mockups on the customer's order page (Nov 1, Nick: "take one art and make it fill the panel then any
 * additional art thumbnails below. Then you can click on the thumbnails and it switches to be the large art"). The picked
 * one is shown big; the others sit under it as thumbnails; tapping the big one opens it full screen (PicZoom).
 */
export default function PortalArtView({ pics }: { pics: string[] }) {
  const [at, setAt] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  if (!pics.length) return null;
  const i = Math.min(at, pics.length - 1);
  return (
    <div className="pav">
      <button type="button" className="pav-big" onClick={() => setZoom(i)} aria-label="Open the mockup full size">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={pics[i]} alt="Mockup" />
      </button>
      {pics.length > 1 && (
        <div className="pav-thumbs">
          {pics.map((u, k) => (
            <button key={u} type="button" className={`pav-th${k === i ? " on" : ""}`} onClick={() => setAt(k)} aria-label={`Show mockup ${k + 1}`} aria-pressed={k === i}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      <PicZoom pics={pics.map((url, k) => ({ url, cap: pics.length > 1 ? `Mockup ${k + 1}` : "Mockup" }))} at={zoom} onClose={() => setZoom(null)} />
    </div>
  );
}
