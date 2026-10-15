"use client";
import { useEffect, useRef, useState } from "react";
import { getCustomerTexts, type TextRow } from "@/app/shop/texts-actions";

const day = (s: string) => new Date(s).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: new Date(s).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
const time = (s: string) => new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** A customer's texts (from the Mac, Settings > Texts), like Messages: theirs on the left, ours on the right, with pictures. Owners only: shows nothing for anyone else. */
export default function CustomerTexts({ customerId }: { customerId: string }) {
  const [t, setT] = useState<TextRow[] | null>(null), [no, setNo] = useState(false), [big, setBig] = useState("");
  /** one conversation, or all of them together (Oct 15, Nick: "texts with Michael and with Kayla") */
  const [only, setOnly] = useState("");
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => { getCustomerTexts(customerId).then((r) => (r.ok ? setT(r.texts) : setNo(true))); }, [customerId]);
  useEffect(() => { const el = end.current?.parentElement; if (el) el.scrollTop = el.scrollHeight; }, [t]);
  if (no || !t || !t.length) return null;
  const convos = [...t.reduce((m, x) => m.set(x.convo, (m.get(x.convo) || 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const shown = only ? t.filter((x) => x.convo === only) : t;
  let last = "", lastConvo = "";
  return (
    <section className="panel ctx-panel">
      <div className="panel-h"><h2>Texts</h2><span className="faint" style={{ fontSize: 12 }}>{t.length} from your phone · owners only</span></div>
      {convos.length > 1 && <div className="ctx-chips" role="group" aria-label="Conversations">
        <button type="button" className={!only ? "on" : ""} onClick={() => setOnly("")}>All <small>{t.length}</small></button>
        {convos.map(([c, n]) => <button key={c} type="button" className={only === c ? "on" : ""} onClick={() => setOnly(c)}>{c} <small>{n}</small></button>)}
      </div>}
      <div className="panel-b ctx">
        {shown.map((m) => {
          const d = day(m.sent_at), sep = d !== last; last = d;
          // in All, who it's with shows whenever the conversation changes
          const head = !only && convos.length > 1 && (sep || m.convo !== lastConvo); lastConvo = m.convo;
          const group = m.convo !== m.who && !m.from_me;
          return (
            <div key={m.id}>
              {sep && <div className="ctx-day">{d}</div>}
              {head && <div className={"ctx-who " + (m.from_me ? "me" : "them")}>{m.from_me ? `To ${m.convo}` : m.convo}</div>}
              {group && <div className="ctx-who them">{m.who}</div>}
              <div className={"ctx-row " + (m.from_me ? "me" : "them")}>
                <div className="ctx-b">
                  {m.files.filter((f) => f.url).map((f) => /^image\//.test(f.type) || /\.(jpe?g|png|gif|webp)$/i.test(f.name)
                    ? <button key={f.url} type="button" className="ctx-img" onClick={() => setBig(f.url)}><img src={f.url} alt={f.name} loading="lazy" /></button>
                    : <a key={f.url} className="ctx-file" href={f.url} target="_blank" rel="noreferrer">{f.name}</a>)}
                  {m.body && <span className="ctx-t">{m.body}</span>}
                </div>
                <span className="ctx-time">{m.chat_name ? `${m.chat_name} · ` : ""}{time(m.sent_at)}</span>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      {big && <div className="ctx-big" onClick={() => setBig("")}><img src={big} alt="" /></div>}
    </section>
  );
}
