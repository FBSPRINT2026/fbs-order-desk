import { ImageResponse } from "next/og";
import { publicStore } from "@/lib/merchServer";

/**
 * The picture shown when a store link is shared (group texts, Facebook, email): the school's colors and name, the
 * close date on the pennant, and the fundraiser goal.
 */
export const runtime = "nodejs";
export const alt = "School spirit wear store";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const onColor = (hex: string) => {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "#fff";
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.42 ? "#15181E" : "#fff";
};
const day = (iso: string) => new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long", month: "short", day: "numeric" });

/** Big Shoulders (the store's display face) as a static TTF from Google Fonts; the default face if it can't load */
async function display(): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch("https://fonts.googleapis.com/css2?family=Big+Shoulders:wght@900", { headers: { "User-Agent": "Mozilla/4.0" } })).text();
    const url = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : null;
  } catch { return null; }
}

export default async function Image({ params }: { params: Promise<{ slug: string }> | { slug: string } }) {
  const { slug } = await Promise.resolve(params);
  const got = await publicStore(slug).catch(() => null);
  const st = got?.store;
  const c = st?.brand?.primary || "#1F3A8A", a = st?.brand?.accent || "#F2B705";
  const school = st?.brand?.school || st?.name || "School store";
  const goal = +(st?.giveback?.goal || 0);
  const font = await display();
  const fam = font ? "Big Shoulders" : "sans-serif";
  const ini = school.replace(/\b(elementary|middle|high|school|academy|the|of)\b/gi, "").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: c, color: onColor(c), padding: "64px 72px", borderBottom: `16px solid ${a}`, position: "relative" }}>
        <div style={{ position: "absolute", right: -160, top: 40, width: 620, height: 620, borderRadius: 999, border: `48px solid ${onColor(c) === "#fff" ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.06)"}`, display: "flex" }} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 34, opacity: 0.9, display: "flex" }}>{st?.name || "Online store"}</div>
          <div style={{ fontFamily: fam, fontSize: school.length > 22 ? 104 : 132, lineHeight: 0.86, fontWeight: 900, marginTop: 14, maxWidth: 900, display: "flex" }}>{school}</div>
          {st?.brand?.tagline && <div style={{ fontFamily: fam, fontSize: 44, color: a, marginTop: 18, display: "flex" }}>{st.brand.tagline}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", background: a, color: onColor(a), fontFamily: fam, fontSize: 46, padding: "14px 30px 16px 26px", borderRadius: 6 }}>
            {st?.open && st.closes_at ? `Order by ${day(st.closes_at)}` : st && !st.open ? "Ordering is closed" : "Spirit wear pre-order"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", fontSize: 26, opacity: 0.92 }}>
            {goal > 0 && <div style={{ display: "flex" }}>{`Supports ${school} · goal $${goal.toLocaleString("en-US")}`}</div>}
            <div style={{ display: "flex", marginTop: 6 }}>Printed &amp; fulfilled by FBS Print</div>
          </div>
        </div>
        <div style={{ position: "absolute", right: 72, top: 64, width: 150, height: 150, borderRadius: 999, background: "#fff", color: c, border: `8px solid ${a}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: fam, fontSize: 70 }}>{ini}</div>
      </div>
    ),
    { ...size, ...(font ? { fonts: [{ name: "Big Shoulders", data: font, weight: 900 as const, style: "normal" as const }] } : {}) },
  );
}
