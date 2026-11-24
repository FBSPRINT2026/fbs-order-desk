/**
 * The Draft Punk Homebrew Club emblem (their own mark, from Nick's photos, Nov 24 2026: the logo on the keezer): a
 * bottle cap crossed by an X, with wheat, a hop, a water drop and a flask in its four corners. Drawn in currentColor,
 * the four ingredients cut out of it in the page's background.
 */
const N = 21; // crimps on a crown cap
const cap = (() => {
  const pts: string[] = [];
  for (let i = 0; i < N * 2; i++) {
    const a = (Math.PI * 2 * i) / (N * 2) - Math.PI / 2, r = i % 2 ? 44 : 48;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
})();

export default function Emblem({ size = 32, title = "Draft Punk Homebrew Club" }: { size?: number; title?: string }) {
  const cut = "var(--dp-card, #fff)";
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={title} style={{ flex: "none" }}>
      <path d={cap} fill="currentColor" strokeLinejoin="round" stroke="currentColor" strokeWidth="2" />
      {/* the X */}
      <path d="M27 27L73 73M73 27L27 73" stroke={cut} strokeWidth="2.6" strokeLinecap="round" />
      {/* wheat, top */}
      <g fill={cut}>
        <rect x="49" y="18" width="2" height="22" rx="1" />
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <ellipse cx="46.2" cy={22 + i * 4.2} rx="2.1" ry="3.4" transform={`rotate(-28 46.2 ${22 + i * 4.2})`} />
            <ellipse cx="53.8" cy={22 + i * 4.2} rx="2.1" ry="3.4" transform={`rotate(28 53.8 ${22 + i * 4.2})`} />
          </g>
        ))}
        <ellipse cx="50" cy="17.5" rx="1.8" ry="3" />
      </g>
      {/* hop, left */}
      <g fill={cut}>
        <rect x="27.6" y="38.5" width="1.4" height="4" rx=".7" />
        {[[28.3, 44, 5.5], [28.3, 49.5, 6.4], [28.3, 55.3, 5.4], [28.3, 60, 3.6]].map(([x, y, w], i) => (
          <path key={i} d={`M${x - w},${y} Q${x},${y + 4.6} ${x + w},${y} Q${x},${y - 2.2} ${x - w},${y}Z`} />
        ))}
      </g>
      {/* water drop, right */}
      <path d="M72 38c3.6 5.6 6.4 9.4 6.4 13.4a6.4 6.4 0 0 1-12.8 0c0-4 2.8-7.8 6.4-13.4z" fill={cut} />
      {/* flask, bottom */}
      <g fill={cut}>
        <path d="M46.6 61.5h6.8v1.6h-1v6.2l6.4 10.4c.8 1.4-.2 3.1-1.8 3.1H43c-1.6 0-2.6-1.7-1.8-3.1l6.4-10.4v-6.2h-1z" />
      </g>
      <g fill="currentColor"><circle cx="48.4" cy="77" r="1.2" /><circle cx="51.8" cy="74.6" r=".9" /><circle cx="52.4" cy="78.6" r="1" /></g>
    </svg>
  );
}
