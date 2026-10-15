"use client";
import { useEffect, useState } from "react";
import { addTextMac, listTextMacs, removeTextMac, type TextMac } from "@/app/shop/texts-actions";

const ago = (s: string | null) => { if (!s) return "never"; const m = Math.round((Date.now() - Date.parse(s)) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(s).toLocaleDateString(); };

/**
 * Settings > Texts (Oct 15, Nick): the Mac signed in to Messages sends the texts with customers (and their pictures)
 * to the portal. "Set up a Mac" makes a one-time setup command to paste into Terminal on that Mac.
 */
export default function TextsSetup({ site }: { site: string }) {
  const [macs, setMacs] = useState<TextMac[] | null>(null), [err, setErr] = useState("");
  const [name, setName] = useState(""), [cmd, setCmd] = useState(""), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false);
  const [no, setNo] = useState(false);
  const load = () => listTextMacs().then((r) => (r.ok ? setMacs(r.macs) : /owners/.test(r.error) ? setNo(true) : setErr(r.error)));
  useEffect(() => { void load(); const t = setInterval(() => void load(), 30000); return () => clearInterval(t); }, []);
  const add = async () => {
    setBusy(true); setErr("");
    const r = await addTextMac(name || "Mac mini");
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setCmd(`curl -fsSL ${site}/texts/install.sh | bash -s -- ${r.token}`); setName(""); void load();
  };
  if (no) return null;
  return (
    <section className="panel" id="texts">
    <div className="panel-h"><h2>Texts</h2><span className="faint" style={{ fontSize: 12 }}>Customer texts from the Mac signed in to Messages: saved to the customer, read by the AI for orders and reorders. Owners only.</span></div>
    <div className="panel-b tx-set">
      {err && <div className="pv-err">{err}</div>}
      {macs && macs.length > 0 && <ul className="tx-macs">
        {macs.map((m) => (
          <li key={m.id}>
            <span className={"tx-dot" + (m.last_error ? " bad" : m.last_seen_at && Date.now() - Date.parse(m.last_seen_at) < 15 * 60000 ? " ok" : "")} aria-hidden />
            <span className="tx-m"><b>{m.name}</b><span className="faint">{m.owner.split("@")[0]} · checked {ago(m.last_seen_at)} · {m.texts} text{m.texts === 1 ? "" : "s"} with {m.customers} customer{m.customers === 1 ? "" : "s"}{m.last_text ? ` · latest ${ago(m.last_text)}` : ""}</span>
              {m.last_error && <span className="tx-err">{m.last_error}</span>}</span>
            <button type="button" className="btn sm ghost" onClick={async () => { if (!confirm(`Stop ${m.name} sending texts? The texts already here stay.`)) return; await removeTextMac(m.id); void load(); }}>Stop</button>
          </li>
        ))}
      </ul>}
      {macs && !macs.length && !cmd && <p className="faint">No Mac yet.</p>}
      {cmd ? <div className="tx-cmd">
        <p><b>On the Mac</b> (signed in to Messages, Messages in iCloud on): open <b>Terminal</b>, paste this and press Return. It&apos;s shown once.</p>
        <pre>{cmd}</pre>
        <div className="tx-cmd-b"><button type="button" className="btn sm" onClick={() => { void navigator.clipboard.writeText(cmd); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button><button type="button" className="btn sm ghost" onClick={() => { setCmd(""); setCopied(false); }}>Done</button></div>
        <p className="faint">Then in <b>System Settings → Privacy &amp; Security → Full Disk Access</b>, press <b>+</b> and add <b>FBS Texts</b> (the Finder window it opens). It sends texts with customers every 2 minutes; personal texts stay on the Mac.</p>
      </div> : <div className="tx-add">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Which Mac / whose phone, e.g. Mac mini (Nick)" aria-label="Mac name" />
        <button type="button" className="btn sm primary" disabled={busy} onClick={() => void add()}>{busy ? "Making…" : "Set up a Mac"}</button>
      </div>}
    </div>
    </section>
  );
}
