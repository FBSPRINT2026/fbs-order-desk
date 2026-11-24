/** DraftPunk's line icons (24px grid, drawn with currentColor) */
const P: Record<string, string> = {
  recipes: "M5 4h11l3 3v13H5z M9 9h6 M9 13h6 M9 17h4",
  brews: "M8 3h8v3l-1 2v11a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V8L8 6z M9 12h6",
  tools: "M4 20l7-7 M14 4a4 4 0 0 0-3 6.5L13.5 13A4 4 0 1 0 14 4z",
  equip: "M5 9h14v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z M4 9h16 M8 5h8l1 4H7z",
  stock: "M4 7l8-4 8 4v10l-8 4-8-4z M4 7l8 4 8-4 M12 11v10",
  club: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M16 11a3 3 0 1 0 0-6 M3 20c0-3 2.5-5 5-5s5 2 5 5 M14 15c3 0 6 1.5 6 5",
  import: "M12 3v12 M7 10l5 5 5-5 M5 21h14",
  save: "M5 4h11l3 3v13H5z M8 4v5h7V4 M8 20v-6h8v6",
  scale: "M12 4v16 M5 8l-3 6h6z M19 8l-3 6h6z M5 8h14",
  brewday: "M12 7v5l3 2 M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  print: "M7 9V4h10v5 M6 18H4v-7h16v7h-2 M7 14h10v6H7z",
  export: "M12 15V3 M7 8l5-5 5 5 M5 21h14",
  copy: "M8 8h12v12H8z M4 16V4h12",
  share: "M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M8.6 13.5l6.8 4 M15.4 6.5l-6.8 4",
  plus: "M12 5v14 M5 12h14",
};
export default function Icon({ name }: { name: keyof typeof P | string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {(P[name] || "").split(" M").map((d, i) => <path key={i} d={i ? `M${d}` : d} />)}
    </svg>
  );
}
