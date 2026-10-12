/**
 * How a reply ends (Oct 12, Nick: "I don't want my emails to say 'Thanks, FBS Team' and then have my signature, that
 * doesn't make any sense"). The AI's draft can end with its own sign-off and a name or "the FBS Print team"; that's
 * cut, and the person's own sign-off line (Email settings, "Thanks," by default, or none) goes on instead. Their
 * signature is added under it when it's sent.
 */
// a closing line on its own ("Thanks,", "Best regards,", "Talk soon!"), not a sentence that starts with "Thanks for…"
const CLOSERS = /^(thanks|thank you|many thanks|thanks again|thanks so much|thank you so much|thanks a lot|best|best regards|kind regards|regards|warm regards|cheers|sincerely|talk soon|appreciate it|have a great (day|week|weekend)|all the best|take care)[\s,.!]*$/i;
const TEAMISH = /\b(fbs|team|print shop|screen print|the shop)\b/i;

export function fixSignOff(body: string, signOff: string) {
  const lines = String(body || "").replace(/\s+$/, "").split("\n");
  // the last few lines: from a closing line ("Thanks,", "Best,") to the end is the old sign-off (and any name after it)
  let cut = -1;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
    const t = lines[i].trim().replace(/^[-–—]\s*/, "");
    if (!t) continue;
    if (CLOSERS.test(t) && t.length <= 40) { cut = i; break; }
  }
  if (cut < 0) {
    // no closing line: just a trailing "— The FBS Print team" / "FBS Team"
    let i = lines.length - 1;
    while (i >= 0 && !lines[i].trim()) i--;
    if (i >= 0 && TEAMISH.test(lines[i]) && lines[i].trim().length <= 40) cut = i;
  }
  const kept = (cut >= 0 ? lines.slice(0, cut) : lines).join("\n").replace(/\s+$/, "");
  const so = (signOff || "").trim();
  return so ? `${kept}\n\n${so}` : kept;
}

/** what the AI is told about who's writing */
export const writerNote = (writeAs: string, name: string) =>
  writeAs === "shop"
    ? "Write it from the shop (\"we\"). End with a short sign-off line only; no name, team or company under it (the sender's signature goes there)."
    : `Write it as ${name || "the sender"} personally, in the first person ("I", "we" only for the shop's work). End with a short sign-off line only; no name, team or company under it (their signature goes there).`;
