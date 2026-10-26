"use client";
import { useState } from "react";
import { sendLaunchTest } from "./actions";

/** A test copy to you, or to anyone you type in (Oct 26, Nick: "send it to Amanda just to see how it shows on her phone") */
export default function SendTest({ email, company = "" }: { email: string; /** the company name shown in the portal picture */ company?: string }) {
  const [to, setTo] = useState(email);
  const [st, setSt] = useState<"" | "busy" | "sent" | string>("");
  const [sentTo, setSentTo] = useState("");
  return (
    <div className="row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
      <div className="field"><label htmlFor="le-to">Send a test to</label><input id="le-to" type="email" value={to} placeholder={email} onChange={(e) => { setTo(e.target.value); setSt(""); }} style={{ width: 260 }} /></div>
      <button type="button" className="btn primary" disabled={st === "busy" || !to.trim()} onClick={async () => { setSt("busy"); const r = await sendLaunchTest(company, to); setSentTo(r.to || ""); setSt(r.ok ? "sent" : r.error || "Couldn't send it."); }}>
        {st === "busy" ? "Sending…" : "Send test"}
      </button>
      <span className="faint" style={{ fontSize: 13, paddingBottom: 9 }}>{st === "sent" ? `Sent to ${sentTo}. It's marked [Test].` : st && st !== "busy" ? st : "One address. It's marked [Test] and isn't counted as sent."}</span>
    </div>
  );
}
