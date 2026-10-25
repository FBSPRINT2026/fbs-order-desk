"use client";
import { useState } from "react";
import { sendLaunchTest } from "./actions";

export default function SendTest({ email }: { email: string }) {
  const [st, setSt] = useState<"" | "busy" | "sent" | string>("");
  return (
    <div className="row" style={{ gap: 10, alignItems: "center" }}>
      <button type="button" className="btn primary" disabled={st === "busy"} onClick={async () => { setSt("busy"); const r = await sendLaunchTest(); setSt(r.ok ? "sent" : r.error || "Couldn't send it."); }}>
        {st === "busy" ? "Sending…" : "Send a test to me"}
      </button>
      <span className="faint" style={{ fontSize: 13 }}>{st === "sent" ? `Sent to ${email}. Check your inbox.` : st && st !== "busy" ? st : `Goes only to ${email}.`}</span>
    </div>
  );
}
