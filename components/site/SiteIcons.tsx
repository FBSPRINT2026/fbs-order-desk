/** The website's line drawings for each product line (drawn here in the old site's outline style; app/site). */
export type SiteIcon = "shirt" | "cap" | "swatch" | "sign" | "store" | "box";
const P = { fill: "none", stroke: "currentColor", strokeWidth: 2.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export default function SiteIconArt({ name, size = 64 }: { name: SiteIcon; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      {name === "shirt" && <g {...P}><path d="M22 10l-12 6-6 12 8 4 4-6v28h32V26l4 6 8-4-6-12-12-6c-2 4-6 6-10 6s-8-2-10-6z" /><path d="M36 26h7v6c0 2-1.5 3-3.5 3S36 34 36 32z" /><path d="M24 10c2 3 5 4.5 8 4.5s6-1.5 8-4.5" /></g>}
      {name === "cap" && <g {...P}><path d="M10 40c0-14 9-24 22-24s20 9 20 22" /><path d="M10 40c10-4 30-4 42-2l8 4c-6 4-20 6-30 4" /><path d="M32 16c-5 6-6 14-5 24M32 16c4 6 6 13 6 22" /><circle cx="32" cy="14" r="2" /></g>}
      {name === "swatch" && <g {...P}><circle cx="32" cy="32" r="27" /><rect x="22" y="16" width="10" height="32" rx="3" /><path d="M32 20l8 2-6 26-2-1" /><path d="M34 22l9 6-11 18" /><circle cx="27" cy="22" r="1.6" /><path d="M25 30h4M25 36h4M25 42h4" /></g>}
      {name === "sign" && <g {...P}><path d="M40 8l8 8-24 24-11 3 3-11z" /><path d="M36 12l8 8M16 32l8 8" /><path d="M8 54h48" /></g>}
      {name === "store" && <g {...P}><rect x="6" y="14" width="36" height="26" rx="3" /><path d="M18 48h12M24 40v8" /><rect x="44" y="20" width="14" height="28" rx="3" /><path d="M49 43h4" /></g>}
      {name === "box" && <g {...P}><path d="M8 22l24-10 24 10v24L32 56 8 46z" /><path d="M8 22l24 10 24-10M32 32v24" /><path d="M20 17l24 10v8" /></g>}
    </svg>
  );
}
