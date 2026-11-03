"use client";
import { useState } from "react";
import { pickAccount } from "@/app/portal/account-actions";

/** the account picker's buttons (app/portal/choose) */
export default function AccountChooser({ accounts }: { accounts: { id: string; name: string; sub: string }[] }) {
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  return (
    <div className="pac-list">
      {accounts.map((a) => (
        <button key={a.id} type="button" className="pac-acct" disabled={!!busy} onClick={async () => {
          setBusy(a.id); setErr("");
          const r = await pickAccount(a.id);
          if (r.ok) window.location.href = "/portal"; else { setErr(r.error || "Couldn't open it."); setBusy(""); }
        }}>
          <span className="pac-ic" aria-hidden>{a.name.slice(0, 1).toUpperCase()}</span>
          <span className="pac-t"><b>{a.name}</b><small>{busy === a.id ? "Opening…" : a.sub}</small></span>
        </button>
      ))}
      {err && <p className="pac-err" role="alert">{err}</p>}
    </div>
  );
}
