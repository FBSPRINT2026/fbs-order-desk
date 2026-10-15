"use client";
import { useEffect, useRef, useState } from "react";
import { addTask, inboxItemExtras, setEventStatus, type CalEvent } from "@/app/shop/myday-actions";
import { holdSummary, type HoldSummary } from "@/app/shop/hold-actions";
import { TbIcon } from "@/components/MailFolders";

/**
 * Press and hold an email in the Inbox (phones; Oct 15, Nick: "hold down the email… bring up the AI assistant, set a
 * reminder, or whatever… give you some AI options"; then "smaller, a more in-depth AI summary, no move tools, the
 * reminders on one line"): who and what, the AI's summary (the details and what they need next), its two best next
 * steps and the mic, any event it found, Remind me, and the order buttons on customer email.
 */
export type HoldWhat = "talk" | "reply" | "open" | "order" | "reorder" | "goods" | "archive" | "news" | "blackhole" | "blackhole!";
export type HoldItem = { id: string; name: string; subject: string; summary: string; when: string; customer: boolean; needs: boolean; urgent: boolean; reorder: boolean; bucket: string | null };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plus = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const nextMonday = () => { const d = new Date(), k = (8 - d.getDay()) % 7 || 7; return plus(k); };
const dayName = (s: string) => new Date(s + "T12:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

const LABEL: Record<HoldWhat, string> = { talk: "Tell the AI", reply: "Reply", open: "Open", order: "New order", reorder: "Reorder", goods: "Order goods", archive: "Archive", news: "News", blackhole: "Black Hole", "blackhole!": "Black Hole" };
const ICON: Partial<Record<HoldWhat, React.ReactNode>> = { reply: TbIcon.reply, open: TbIcon.file, order: TbIcon.order, reorder: TbIcon.repeat, goods: TbIcon.goods, archive: TbIcon.archive, news: TbIcon.news, blackhole: TbIcon.ban };
const MIC = <svg viewBox="0 0 24 24" aria-hidden><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>;
const BELL = <svg viewBox="0 0 24 24" aria-label="Remind me"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" /></svg>;

/** the AI's two best next steps, from what it already knows about the email (no wait); the mic is always there too */
function picks(i: HoldItem): HoldWhat[] {
  if (i.customer && i.reorder) return ["reorder", "reply"];
  if (i.customer) return ["reply", "order"];
  return ["reply", "open"];
}

export default function HoldMenu({ it, onPick, onClose, flash }: { it: HoldItem; onPick: (w: HoldWhat) => void; onClose: () => void; flash: (t: string) => void }) {
  const [evs, setEvs] = useState<CalEvent[]>([]);
  const [sum, setSum] = useState<HoldSummary | "err" | null>(null);
  const [remind, setRemind] = useState(""), [pickDay, setPickDay] = useState(false);
  // flick it down to close (Oct 15, Nick): follows the finger from the top of the sheet; far or fast enough, it goes
  const sheet = useRef<HTMLDivElement | null>(null), drag = useRef<{ y: number; t: number; on: boolean } | null>(null);
  const [dy, setDy] = useState(0), [going, setGoing] = useState(false);
  const shut = () => { setGoing(true); setDy(sheet.current?.offsetHeight || 600); setTimeout(onClose, 180); };
  useEffect(() => {
    let live = true;
    inboxItemExtras(it.id).then((r) => { if (live && r.ok) setEvs(r.events.filter((e) => e.status === "suggested")); }).catch(() => null);
    holdSummary(it.id).then((r) => { if (live) setSum(r.ok ? r.summary : "err"); }).catch(() => live && setSum("err"));
    return () => { live = false; };
  }, [it.id]);
  // a reminder on My Day, saying who and what (not tied to the email, so archiving it doesn't close the reminder)
  const remindOn = async (day: string, label: string) => {
    setRemind("…");
    const r = await addTask({ title: `Follow up: ${it.name} · ${it.subject || "(no subject)"}`.slice(0, 200), due: day, area: "shop", notes: it.summary });
    if (r.ok) { flash(`Reminder on My Day for ${label}.`); onClose(); } else { setRemind(""); flash(r.error); }
  };
  const top = picks(it);
  const mon = ymd(nextMonday());
  return (
    <div className={"pbar-bg hold-bg" + (going ? " going" : "")} onClick={shut}>
      <div ref={sheet} className={"pbar-sheet hold" + (drag.current?.on ? " dragging" : "")} role="menu" aria-label={`Email from ${it.name}`} onClick={(e) => e.stopPropagation()}
        style={dy ? { transform: `translateY(${dy}px)` } : undefined}
        onTouchStart={(e) => { if (going) return; drag.current = (sheet.current?.scrollTop || 0) <= 0 ? { y: e.touches[0].clientY, t: e.timeStamp, on: false } : null; }}
        onTouchMove={(e) => { const d = drag.current; if (!d) return; const v = e.touches[0].clientY - d.y; if (!d.on && v < 6) { if (v < -6) drag.current = null; return; } d.on = true; setDy(Math.max(0, v)); }}
        onTouchEnd={(e) => { const d = drag.current; drag.current = null; if (!d?.on) return; const v = dy / Math.max(1, e.timeStamp - d.t); if (dy > 90 || v > 0.5) shut(); else setDy(0); }}>
        <div className="ps-grab" aria-hidden />
        <div className="hold-in">
          <div className="hold-peek" role="button" tabIndex={0} onClick={() => onPick("open")} onKeyDown={(e) => e.key === "Enter" && onPick("open")}>
            <span className="hold-p1"><b>{it.name}</b>{it.urgent && <span className="itag urg">Urgent</span>}{it.needs && <span className="itag rep">Needs reply</span>}<time>{it.when}</time></span>
            <span className="hold-p2">{it.subject || "(no subject)"}</span>
          </div>

          <div className="hold-ai">
            <div className="hold-ai-h"><i aria-hidden>✦</i>Summary</div>
            {sum === null ? <div className="hold-wait">{it.summary || "Reading the email…"}<span className="hold-dots" aria-label="Reading the email" /></div>
              : sum === "err" ? <div className="hold-sum1">{it.summary || "Couldn't read this one. Open it to see."}</div>
              : <>
                <ul className="hold-pts">{sum.points.map((p, k) => <li key={k}>{p}</li>)}</ul>
                {sum.next && <div className="hold-next"><b>Next:</b> {sum.next}</div>}
              </>}
            <div className="hold-top">
              {top.map((w, k) => <button key={w} type="button" className={"hold-b" + (k === 0 ? " primary" : "")} onClick={() => onPick(w)}>{w === "talk" ? MIC : ICON[w]}<span>{LABEL[w]}</span></button>)}
              <button type="button" className="hold-b hold-mic" onClick={() => onPick("talk")} aria-label="Tell the AI what to do" title="Tell the AI what to do">{MIC}</button>
            </div>
          </div>

          {evs.map((e) => (
            <div key={e.id} className="hold-ev">
              <span aria-hidden>📅</span>
              <span><b>{e.title}</b><small>{e.day ? dayName(e.day) : ""}{e.starts_at ? ` · ${new Date(e.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</small></span>
              <button type="button" className="hold-chip on" onClick={async () => { setEvs((x) => x.filter((y) => y.id !== e.id)); const r = await setEventStatus(e.id, "added"); flash(r.ok ? "On your calendar." : r.error); }}>Add</button>
            </div>
          ))}

          {/* one line (Oct 15, Nick) */}
          <div className="hold-line" aria-label="Remind me">
            <span className="hold-lab">{BELL}</span>
            {pickDay ? <input type="date" className="hold-date" min={ymd(new Date())} autoFocus onChange={(e) => e.target.value && void remindOn(e.target.value, dayName(e.target.value))} aria-label="Remind me on" />
              : <>
                <button type="button" className="hold-chip" disabled={!!remind} onClick={() => void remindOn(ymd(new Date()), "today")}>Today</button>
                <button type="button" className="hold-chip" disabled={!!remind} onClick={() => void remindOn(ymd(plus(1)), "tomorrow")}>Tomorrow</button>
                <button type="button" className="hold-chip" disabled={!!remind} onClick={() => void remindOn(mon, dayName(mon))}>Monday</button>
                <button type="button" className="hold-chip" disabled={!!remind} onClick={() => setPickDay(true)}>Pick…</button>
              </>}
          </div>

          {it.customer && <div className="hold-line" aria-label="Order">
            <span className="hold-lab">{TbIcon.order}</span>
            {(["order", "reorder", "goods"] as const).filter((w) => !top.includes(w)).map((w) => <button key={w} type="button" className="hold-chip" onClick={() => onPick(w)}>{LABEL[w]}</button>)}
          </div>}
        </div>
      </div>
    </div>
  );
}
