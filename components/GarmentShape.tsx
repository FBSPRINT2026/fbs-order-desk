/**
 * A little garment drawn in its own color (Oct 27, the check-in grid: "I like the little [shirt]… and the color
 * lines"): a tee, a long-sleeve / crewneck, a hoodie, a polo, a hat or a beanie, guessed from what the garment is.
 */
export type GarmentKind = "tee" | "long" | "hoodie" | "polo" | "hat" | "beanie" | "tank";
export function garmentKind(text: string): GarmentKind {
  const t = ` ${text.toLowerCase()} `;
  if (/\bbeanie|\bknit (cap|hat)|\btoque|cuffed knit/.test(t)) return "beanie";
  if (/\b(cap|caps|hat|hats|trucker|snapback|dad hat|flexfit|visor|bucket)\b/.test(t)) return "hat";
  if (/hood/.test(t)) return "hoodie";
  if (/\bpolo|sport shirt/.test(t)) return "polo";
  if (/\btank|sleeveless|muscle/.test(t)) return "tank";
  if (/crew ?neck|sweatshirt|long ?sleeve|\bl\/s\b|\bls\b|fleece|quarter|1\/4|jacket|pullover/.test(t)) return "long";
  return "tee";
}
const PATHS: Record<GarmentKind, string> = {
  tee: "M15 6 L8 10 L3 18 L9 21 L11 18 L11 39 L33 39 L33 18 L35 21 L41 18 L36 10 L29 6 Q22 12 15 6 Z",
  long: "M15 5 L8 9 L2 30 L9 32 L11 22 L11 39 L33 39 L33 22 L35 32 L42 30 L36 9 L29 5 Q22 10 15 5 Z",
  hoodie: "M14 8 Q14 1 22 1 Q30 1 30 8 L36 10 L42 31 L35 33 L33 23 L33 40 L11 40 L11 23 L9 33 L2 31 L8 10 Z M17 8 Q22 14 27 8 Q27 4 22 4 Q17 4 17 8 Z",
  polo: "M15 6 L8 10 L3 18 L9 21 L11 18 L11 39 L33 39 L33 18 L35 21 L41 18 L36 10 L29 6 L25 9 L22 17 L19 9 Z",
  tank: "M15 5 L17 5 Q22 13 27 5 L29 5 L29 12 Q32 16 32 20 L32 39 L12 39 L12 20 Q12 16 15 12 Z",
  hat: "M6 28 Q6 12 22 11 Q38 12 38 28 Z M4 28 L42 28 Q42 33 30 33 L4 31 Z",
  beanie: "M9 32 Q8 12 22 11 Q36 12 35 32 Z M8 31 L36 31 L36 37 L8 37 Z M19 9 A3 3 0 1 0 25 9 A3 3 0 1 0 19 9 Z",
};
export default function GarmentShape({ kind, color, size = 42 }: { kind: GarmentKind; color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden className="gshape">
      <path d={PATHS[kind]} fill={color} fillRule="evenodd" stroke="color-mix(in srgb, currentColor 35%, transparent)" strokeWidth={1} strokeLinejoin="round" />
    </svg>
  );
}
