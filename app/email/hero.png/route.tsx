import { ImageResponse } from "next/og";
import { siteUrl } from "@/lib/email";

/**
 * The launch email's portal picture with the customer's own company name where it said "Your Company" (Oct 26, Nick:
 * "instead of saying your company, it just said the company name on file, like on your left… varied by the customer").
 * /email/hero.png?n=On%20Your%20Left: the bottom half of the portal picture (public/email/launch/hero-bottom-blank.png)
 * with the name drawn in. Public, like the email's other pictures; it only ever shows the name it's given.
 */
export const runtime = "nodejs";

let bold: ArrayBuffer | null | undefined;
async function boldFont(): Promise<ArrayBuffer | null> {
  if (bold !== undefined) return bold;
  try {
    const css = await (await fetch("https://fonts.googleapis.com/css2?family=Arimo:wght@700", { headers: { "User-Agent": "Mozilla/4.0" } })).text();
    const url = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/)?.[1];
    bold = url ? await (await fetch(url)).arrayBuffer() : null;
  } catch { bold = null; }
  return bold;
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const name = (u.searchParams.get("n") || "Your Company").replace(/\s+/g, " ").trim().slice(0, 42) || "Your Company";
  const v = u.searchParams.get("v") || "";
  const font = await boldFont();
  const size = name.length > 30 ? 26 : name.length > 22 ? 31 : 36;
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 555, display: "flex", position: "relative" }}>
        <img src={`${siteUrl()}/email/launch/hero-bottom-blank.png?v=${encodeURIComponent(v)}`} width={1200} height={555} style={{ position: "absolute", left: 0, top: 0 }} />
        <div style={{ position: "absolute", left: 102, top: 26, height: 44, maxWidth: 980, display: "flex", alignItems: "center", fontSize: size, fontWeight: 700, color: "#141D2B", fontFamily: font ? "Arimo" : "sans-serif", whiteSpace: "nowrap", overflow: "hidden" }}>{name}</div>
      </div>
    ),
    { width: 1200, height: 555, fonts: font ? [{ name: "Arimo", data: font, weight: 700, style: "normal" }] : undefined, headers: { "Cache-Control": "public, max-age=31536000, immutable" } },
  );
}
