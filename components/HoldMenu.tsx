"use client";
import { useEffect, useState } from "react";
import { addTask, inboxItemExtras, setEventStatus, type CalEvent } from "@/app/shop/myday-actions";
import { TbIcon } from "@/components/MailFolders";

/**
 * Press and hold an email in the Inbox (phones; Oct 15, Nick: "hold down the email… bring up the AI assistant, set a
 * reminder, or whatever… give you some AI options"): a peek at it, the AI's two best next steps for it, tell the
 * Assistant what to do, a reminder on My Day, any event the AI found, the order buttons on customer email, and the moves.
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
const BELL = <svg viewBox="0 0 24 24" aria-hidden><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" /></svg>;

/** the AI's two best next steps, from what it already knows about the email (no wait) */
function picks(i: HoldItem): HoldWhat[] {
  if (i.customer && i.reorder) return ["reorder", "reply"];
  if (i.customer && i.needs) return ["reply", "order"];
  if (i.customer) return ["reply", "talk"];
  if (i.bucket === "todo") return ["reply", "archive"];
  if (i.bucket === "event") return ["open", "archive"];
  if (i.bucket === "fyi" || i.bucket === "news" || i.bucket === "receipt") return ["archive", "news"];
  return ["reply", "archive"];
}

export default function HoldMenu({ it, onPick, onClose, flash }: { it: HoldItem; onPick: (w: HoldWhat) => void; onClose: () => void; flash: (t: string) => void }) {
  const [evs, setEvs] = useState<CalEvent[]>([]);
  const [remind, setRemind] = useState(""), [pickDay, setPickDay] = useState(false), [bhAsk, setBhAsk] = useState(false);
  useEffect(() => {
    let live = true;
    inboxItemExtras(it.id).then((r) => { if (live && r.ok) setEvs(r.events.filter((e) => e.status === "suggested")); }).catch(() => null);
    return () => { live = false; };
  }, [it.id]);
  // a reminder on My Day, saying who and what (not tied to the email, so archiving it doesn't close the reminder)
  const remindOn = async (day: string, label: string) => {
    setRemind("…");
    const r = await addTask({ title: `Follow up: ${it.name} · ${it.subject || "(no subject)"}`.slice(0, 200), due: day, area: "shop", notes: it.summary });
    if (r.ok) { flash(`Reminder on My Day for ${label}.`); onClose(); } else { setRemind(""); flash(r.error); }
  };
  const go = (w: HoldWhat) => { if (w === "blackhole" && it.customer) { setBhAsk(true); return; } onPick(w); };
  const top = picks(it);
  return (
    <div className="pbar-bg hold-bg" onClick={onClose}>
      <div className="pbar-sheet hold" role="menu" aria-label={`Email from ${it.name}`} onClick={(e) => e.stopPropagation()}>
        <div className="ps-grab" aria-hidden />
        <button type="button" className="hold-peek" onClick={() => onPick("open")}>
          <span className="hold-p1"><b>{it.name}</b><time>{it.when}</time></span>
          <span className="hold-p2">{it.subject || "(no subject)"}</span>
          {it.summary && it.summary !== it.subject && <span className="hold-p3">{it.summary}</span>}
          <span className="hold-tags">{it.urgent && <span className="itag urg">Urgent</span>}{it.needs && <span className="itag rep">Needs reply</span>}{it.customer && <span className="itag cus">Customer</span>}</span>
        </button>

        <div className="hold-ai">
          <div className="hold-ai-h"><i aria-hidden>✦</i>Suggested</div>
          <div className="hold-top">
            {top.map((w, k) => <button key={w} type="button" className={"hold-b" + (k === 0 ? " primary" : "")} onClick={() => go(w)}>{w === "talk" ? MIC : ICON[w]}<span>{LABEL[w]}</span></button>)}
          </div>
          <button type="button" className="hold-talk" onClick={() => onPick("talk")}>{MIC}<span><b>Tell the AI what to do</b><small>“Remind me Monday to call her” · “Tell him Friday works”</small></span></button>
        </div>

        {evs.length > 0 && <>
          <div className="pbar-t">The AI found</div>
          {evs.map((e) => (
            <div key={e.id} className="hold-ev">
              <span aria-hidden>📅</span>
              <span><b>{e.title}</b><small>{e.day ? dayName(e.day) : ""}{e.starts_at ? ` · ${new Date(e.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</small></span>
              <button type="button" className="hold-chip on" onClick={async () => { setEvs((x) => x.filter((y) => y.id !== e.id)); const r = await setEventStatus(e.id, "added"); flash(r.ok ? "On your calendar." : r.error); }}>Add to calendar</button>
            </div>
          ))}
        </>}

        <div className="pbar-t">{BELL}Remind me</div>
        <div className="hold-chips">
          <button type="button" className="hold-chip" disabled={!!remind} onClick={() => void remindOn(ymd(new Date()), "today")}>Later today</button>
          <button type="button" className="hold-chip" disabled={!!remind} onClick={() => void remindOn(ymd(plus(1)), "tomorrow")}>Tomorrow</button>
          <button type="button" className="hold-chip" disabled={!!remind} onClick={() => void remindOn(ymd(nextMonday()), dayName(ymd(nextMonday())))}>Monday</button>
          {pickDay ? <input type="date" className="hold-date" min={ymd(new Date())} autoFocus onChange={(e) => e.target.value && void remindOn(e.target.value, dayName(e.target.value))} aria-label="Remind me on" />
            : <button type="button" className="hold-chip" disabled={!!remind} onClick={() => setPickDay(true)}>Pick a day…</button>}
        </div>

        {it.customer && <>
          <div className="pbar-t">Order</div>
          <div className="ps-grid three">
            {(["order", "reorder", "goods"] as const).map((w) => <button key={w} type="button" className="ps-t" onClick={() => onPick(w)}>{ICON[w]}<span>{LABEL[w]}</span></button>)}
          </div>
        </>}

        <div className="pbar-t">Move</div>
        {bhAsk ? <div className="hold-ask">
          <span><b>{it.name} is a customer.</b> Black Hole sends their email straight to the Black Hole from now on.</span>
          <button type="button" className="hold-chip" onClick={() => setBhAsk(false)}>Keep</button>
          <button type="button" className="hold-chip danger" onClick={() => onPick("blackhole!")}>Black Hole</button>
        </div> : <div className="ps-grid">
          {(["archive", "news", "blackhole", "reply"] as const).map((w) => <button key={w} type="button" className={"ps-t" + (w === "blackhole" ? " danger" : "")} onClick={() => go(w)}>{ICON[w]}<span>{LABEL[w]}</span></button>)}
        </div>}
        <button type="button" className="pbar-cancel" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
