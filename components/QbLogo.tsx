"use client";
import { useId } from "react";

/**
 * QuickBooks' mark, the one Nick sent (Oct 24): a solid circle with "qb" cut out of it. Drawn in the current text
 * color, so it sits in the menu like the other icons and on the order page in QuickBooks green.
 */
export default function QbLogo({ className, title }: { className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={className} viewBox="0 0 24 24" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <mask id={`qb${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" style={{ fill: "#fff", stroke: "none" }} />
        <g style={{ fill: "none", stroke: "#000", strokeWidth: 2.1, strokeLinecap: "round", strokeLinejoin: "round" }}>
          {/* q: the bowl on the left, its stem running down; b: the same turned around, its stem running up */}
          <path d="M9.8 19.4V8.9H7.4a3.25 3.25 0 0 0 0 6.5h1" />
          <path d="M14.2 4.6v10.5h2.4a3.25 3.25 0 0 0 0-6.5h-1" />
        </g>
      </mask>
      <circle cx="12" cy="12" r="11.2" mask={`url(#qb${id})`} style={{ fill: "currentColor", stroke: "none" }} />
    </svg>
  );
}
