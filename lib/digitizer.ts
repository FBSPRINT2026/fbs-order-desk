import { designLabel, type Design, type Group, type Imprint } from "@/lib/pricing";
import { lineName, threadByName } from "@/lib/embroidery";
import { nextSewCode, sewFilesOf } from "@/lib/brands";

/**
 * The Digitizer (Oct 27, Nick: "I need to add an AI tool, which is called Digitizer… for now, the only functionality of it
 * is going to be emailing Volikes… sent from Amanda's email… later we'll change that… include the mockup and the
 * original file… our proof version… more like the work order, so it blows up and it sees the image large, it sees the
 * dimensions… you have to be clear that you want it digitized… this is for digitizing, please").
 * The tool: components/tools/DigitizerTool.tsx. Sending: app/api/digitizer/send. Their reply (the zip) is caught by the
 * mail check (lib/mail/process.ts digitizerReply) and waits on Digitizing to be added.
 */
export const DIGITIZER = { name: "Volikes Creative", email: "contact@volikescreative.com", domain: "volikescreative.com" };
/** whose mailbox the request goes out from (Oct 27, Nick: "for today, it's going to be Amanda's email") */
export const DIGITIZE_FROM = "amanda@fbsprint.com";

/** the files back 5 working days before the order is due (never sooner than 2 working days from today) */
export function filesBy(due: string | null | undefined, today = new Date()): Date | null {
  if (!due) return null;
  const back = (d: Date, n: number, dir: 1 | -1) => { const x = new Date(d); while (n > 0) { x.setDate(x.getDate() + dir); if (x.getDay() !== 0 && x.getDay() !== 6) n--; } return x; };
  const by = back(new Date(due + "T12:00:00"), 5, -1);
  const soonest = back(new Date(today.toDateString() + " 12:00"), 2, 1);
  return by < soonest ? soonest : by;
}
export const dayLabel = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "");

export type DigitizeCtx = { number: number; company: string; nickname?: string | null; due?: string | null; g: Group; im: Imprint; d: Design | null; wIn?: number; hIn?: number };

/** the print's threads, written out with their Madeira numbers and PMS */
export const threadsOf = (im: Imprint) => (im.inks || "").split(/\s*,\s*/).filter(Boolean).map((n) => { const t = threadByName(n); return t ? `${t.code} ${t.name}${t.pms.length ? ` (PMS ${t.pms[0].replace(/^PMS\s*/i, "")})` : ""}` : n; });

/** what the sheet and the email list, one line each */
export function specRows(c: DigitizeCtx): [string, string][] {
  const { g, im } = c, emb = im.emb || {};
  const l = (g.lines || [])[0];
  const colors = [...new Set((g.lines || []).map((x) => x.color).filter(Boolean))];
  const pcs = (g.lines || []).reduce((a, x) => a + Object.values(x.sizes || {}).reduce((b, v) => b + (+(v || 0)), 0), 0);
  const size = c.wIn && c.hIn ? `${c.wIn.toFixed(2)}" wide × ${c.hIn.toFixed(2)}" tall` : im.size || "see the art";
  const threads = threadsOf(im);
  // only what they digitize from (Oct 27, Nick: "all you need is the final size… the garment… the thread. Do not put
  // the backing… files back is fine… quantity… [a needed-by date] is going to confuse them")
  return ([
    ["Final size", size],
    ["Garment", `${[l?.brand, l?.style, l?.garment].filter(Boolean).join(" ") || "see the order"}${colors.length ? `, ${colors.join(" / ")}` : ""}`],
    ["Thread", `${lineName(emb.line || "Polyneon 40")}${threads.length ? `: ${threads.join(", ")}` : ""}`],
    ...(emb.puff ? [["Effects", `${emb.puffNote && !/all of it/.test(emb.puffNote) ? emb.puffNote : "3D puff, all of it"} (digitize for 3 mm foam)`]] : emb.metallic ? [["Effects", "Metallic thread"]] : []) as [string, string][],
    ["Files back", "Tajima DST, Wilcom EMB and the production worksheet PDF"],
    ...(sewName(c) ? [["File name", `${sewName(c)} (please name the DST, EMB and worksheet this)`]] : []) as [string, string][],
    ["Quantity", pcs ? `${pcs} pieces` : "see the order"],
  ] as [string, string][]);
}

export const logoName = (c: DigitizeCtx) => (c.d ? designLabel(c.d) : "the logo");
/** the name their files should come back with: D{number}E{n}, the Tajima's name for the logo's next sew file (Oct 27,
 *  Nick: "named like however we're gonna bring it back in… D10252 and D10253") */
export const sewName = (c: DigitizeCtx) => (c.d ? `D${c.d.number}${nextSewCode(sewFilesOf(c.d))}` : "");
/** the sheet's file name: the logos' numbers ("D10252-D10253 digitizing request #40193.pdf") */
export const sheetName = (c: DigitizeCtx | DigitizeCtx[]) => {
  const cs = Array.isArray(c) ? c : [c];
  const nums = [...new Set(cs.map((x) => (x.d ? `D${x.d.number}` : "")).filter(Boolean))];
  return `${nums.join("-") || "Logo"} digitizing request #${cs[0]?.number || ""}.pdf`;
};

/** the email: plainly a digitizing request, the specs, what's attached (the sender's Outlook signature goes under it) */
export function digitizeEmail(c: DigitizeCtx) {
  const size = c.wIn ? `${c.wIn.toFixed(2)}" wide` : c.im.size || "";
  const subject = `FOR DIGITIZING: ${logoName(c)}${size ? `, ${size}` : ""} · FBS #${c.number}`;
  const rows = specRows(c);
  const body = [
    `Hi ${DIGITIZER.name.split(" ")[0]} team,`,
    "",
    "This is a digitizing request. Please digitize the attached logo for embroidery at the size below.",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "Attached: our digitizing sheet (the logo shown large with its dimensions, and the mockup for placement) and the original art file.",
    "",
    "Thank you,",
  ].join("\n");
  return { subject, body };
}

/**
 * A request for every logo on the order that needs digitizing (Oct 27, Nick on #40193: "It should ask for both files…
 * the left chest and then the back… this PDF only asks for one, and so does the email"): one block per logo, what
 * they share said once. One logo is the one-logo email.
 */
export function digitizeEmailMany(cs: DigitizeCtx[]) {
  if (cs.length <= 1) return digitizeEmail(cs[0]);
  const c0 = cs[0];
  const sizeOf = (c: DigitizeCtx) => (c.wIn ? `${c.wIn.toFixed(2)}"` : c.im.size || "");
  const subject = `FOR DIGITIZING: ${cs.length} logos (${cs.map((c) => [c.im.location, sizeOf(c)].filter(Boolean).join(" ")).join(", ")}) · FBS #${c0.number}`;
  const rows = cs.map(specRows);
  // what's the same for every logo (the garment, the quantity) is said once, after them
  const shared = (k: string) => rows.every((r) => (r.find((x) => x[0] === k) || [])[1] === (rows[0].find((x) => x[0] === k) || [])[1]);
  const once = ["Garment", "Quantity", "Files back"].filter(shared);
  const body = [
    `Hi ${DIGITIZER.name.split(" ")[0]} team,`,
    "",
    `This is a digitizing request for ${cs.length} logos. Please digitize each one for embroidery at the size below.`,
    "",
    ...cs.flatMap((c, i) => [
      `Logo ${i + 1}: ${c.im.location} (${logoName(c)})`,
      ...rows[i].filter(([k]) => !once.includes(k)).map(([k, v]) => `${k}: ${v}`),
      "",
    ]),
    ...once.map((k) => { const v = (rows[0].find((x) => x[0] === k) || [])[1] || ""; return k === "Files back" ? `Files back for each logo: ${v}` : `${k}: ${v}`; }),
    "",
    "Attached: our digitizing sheet (one page per logo, each shown large with its dimensions and where it goes) and the original art for each.",
    "",
    "Thank you,",
  ].join("\n");
  return { subject, body };
}
