"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import type { Group } from "@/lib/pricing";
import { guessHex } from "@/lib/mockup";
import { fixDesignArt, type ArtAction } from "@/lib/artFix";
import { MicButton } from "@/components/SearchInput";
import { QuickLook, canQuickLook, type MailFile } from "@/components/MailFolders";
import { aiOrderFix, applyOrderFixChanges, markOrderChecked, noteArtChange, saveOrderLesson } from "@/app/shop/ai-actions";
import type { OrderChange } from "@/lib/ai/orderFix";

/**
 * THE order check after it's made (Oct 23, Nick: "the right panel opens. That never closes until I say, yes, we've got
 * everything right… or no, we got to make these changes… my team should be able to just talk to you… you should learn
 * from it… I don't want my account manager to have to open up Illustrator"). One tool (lib/aiTools.ts "order-review"):
 * the end of Create order, and an order's page.
 *
 * A conversation that stays open (Oct 23, Nick: "keep the order panel open the entire time. It never closes until I say
 * order is right… you make the mock-up and you stay open. Then I should be able to click around the order, look at the
 * mock-up and say… you had smalls and extra smalls in the wrong category… you make the changes… does everything look
 * right now?… and then you close it"): OrderCheckDock keeps it on the right on every shop page until Yes (or Close for
 * now), and each round (what was said, what changed) is kept for this tab, so a page change or reload doesn't lose it.
 *   - what was made: each group's mockup, garments (sizes, extras stamped), prints (where, size, height, inks, art changes)
 *   - Check it for me: the AI compares it with what the customer sent and suggests changes
 *   - Say what to change (typed or spoken): order changes (sizes, colors, prints, extras, date) are made, art fixes drawn
 *     on the logo here; the order page showing it reloads by itself
 *   - a lesson for this customer, ticked to remember (their next Create order reads it first)
 *   - Yes, it's right: closes. Every correction is kept for the overnight review (lib/ai/orderFix.ts).
 */
type O = { id: string; number: number; nickname: string; customer_id: string | null; groups: Group[]; due_date: string | null; firm?: boolean; customers?: { name?: string; company?: string } | null };
type Art = OrderChange & { state: "doing" | "done" | "error"; err?: string };
type Round = { you: string; reply: string; applied: string[]; art: Art[]; suggest: OrderChange[]; rule?: string };
/** their PO first, then their mockup and art, then the last job's */
const RES_RANK = ["order_sheet", "customer_mockup", "print_art", "old_mockup", "barcodes"];
const RES_LABEL: Record<string, string> = { order_sheet: "Order sheet / PO", customer_mockup: "Their mockup", old_mockup: "Last job's mockup", print_art: "Their art", barcodes: "Barcodes" };
type Saved = { rounds: Round[]; lesson: { on: boolean; text: string } };

const SIZE_ORDER = ["0-3M", "3-6M", "6-12M", "12M", "18M", "24M", "2T", "3T", "4T", "5T", "YXS", "YS", "YM", "YL", "YXL", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "OS"];
const sizeRun = (sz: Record<string, unknown> | undefined) => Object.entries(sz || {}).filter(([, v]) => +(v || 0) > 0)
  .sort((a, b) => (SIZE_ORDER.indexOf(a[0]) + 1 || 99) - (SIZE_ORDER.indexOf(b[0]) + 1 || 99)).map(([k, v]) => `${k} ${v}`).join(", ");
const keyOf = (id: string) => `fbs:orderCheck:${id}`;
const readSaved = (id: string): Saved | null => { try { const x = sessionStorage.getItem(keyOf(id)); return x ? (JSON.parse(x) as Saved) : null; } catch { return null; } };

/** the order page showing this order saves what's typed there first, and reloads after a change */
async function pageSaves(orderId: string) {
  await new Promise<void>((res) => {
    const d = { orderId, handled: false, done: () => res() };
    window.dispatchEvent(new CustomEvent("fbs:order-save", { detail: d }));
    if (!d.handled) res(); else setTimeout(res, 4000);
  });
}
const pageReloads = (orderId: string) => window.dispatchEvent(new CustomEvent("fbs:order-changed", { detail: { orderId } }));

export default function OrderReview({ orderId, onClose, did, next }: { orderId: string; onClose: () => void; /** what Create order did, folded */ did?: string[]; /** Create order's own link to the Mockup Creator (keeps the email) */ next?: string }) {
  const sb = useRef(createClient()).current;
  const saved0 = useRef(typeof window !== "undefined" ? readSaved(orderId) : null).current;
  const [o, setO] = useState<O | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [rounds, setRounds] = useState<Round[]>(() => (saved0?.rounds || []).map((r) => ({ ...r, art: r.art.map((a) => (a.state === "doing" ? { ...a, state: "done" as const } : a)) })));
  const [pick, setPick] = useState<Record<number, boolean>>({});
  const [lesson, setLesson] = useState(saved0?.lesson || { on: true, text: "" });
  const [stale, setStale] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  // Order resources (Oct 23, Nick: "keep the production documents… at the bottom… pops up and pops down… looking back at
  // the original documents at the same time… call that order resources, like the purchase order, the work order"):
  // what the customer sent (their PO, mockup, art), then our work order, quote and proof, opened right here
  const [resOpen, setResOpen] = useState(false);
  const [res, setRes] = useState<MailFile[]>([]);
  useEffect(() => {
    void sb.from("art_files").select("id, name, category, file_path").eq("order_id", orderId).order("created_at").then(({ data }) => {
      setRes((data || []).map((f) => ({ key: f.id as string, name: f.name as string, label: `${RES_LABEL[(f.category as string) || ""] || "File"}: ${f.name}`,
        href: `/api/files/open?${new URLSearchParams({ p: f.file_path as string, n: f.name as string })}`, rank: RES_RANK.indexOf((f.category as string) || "") + 1 || 9 }))
        .filter(canQuickLook).sort((a, b) => a.rank - b.rank).map(({ rank: _r, ...x }) => x)); // eslint-disable-line @typescript-eslint/no-unused-vars
    });
  }, [sb, orderId]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { try { sessionStorage.setItem(keyOf(orderId), JSON.stringify({ rounds, lesson })); } catch { /* */ } }, [rounds, lesson, orderId]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [rounds.length, busy]);

  const load = useCallback(async () => {
    const { data } = await sb.from("orders").select("id, number, nickname, customer_id, groups, due_date, firm, customers(name, company)").eq("id", orderId).maybeSingle();
    if (data) setO(data as unknown as O);
  }, [sb, orderId]);
  // the mockup is made on another page or tab: its pictures show here when it's saved
  useEffect(() => { void load(); const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 6000); const f = () => void load(); window.addEventListener("focus", f); return () => { clearInterval(t); window.removeEventListener("focus", f); }; }, [load]);
  const thumbKey = (o?.groups || []).flatMap((g) => g.mockupThumbs || []).join("|");
  useEffect(() => {
    const ps = thumbKey ? thumbKey.split("|").filter((p) => p && !urls[p]) : [];
    if (!ps.length) return;
    void sb.storage.from("proofs").createSignedUrls(ps, 3600).then(({ data }) => { const m: Record<string, string> = {}; ps.forEach((p, i) => { if (data?.[i]?.signedUrl) m[p] = data[i].signedUrl; }); setUrls((u) => ({ ...u, ...m })); });
  }, [thumbKey, sb]); // eslint-disable-line react-hooks/exhaustive-deps

  const who = o?.customers?.company || o?.customers?.name || "this customer";
  const mockHref = (g: Group) => `/shop/artwork/mockup?order=${orderId}&group=${g.id}${(g.mockupThumbs || []).length ? "" : "&auto=1"}`;
  const onMockupPage = typeof window !== "undefined" && window.location.pathname.startsWith("/shop/artwork/mockup");
  const last = rounds[rounds.length - 1];
  const changed = rounds.some((r) => r.applied.length || r.art.length);
  /** what's been said and done so far, for the next ask */
  const earlier = rounds.map((r) => `- Staff: ${r.you} → ${[...r.applied, ...r.art.filter((a) => a.state !== "error").map((a) => a.say)].join("; ") || r.reply.slice(0, 300)}`).join("\n");

  /** the mockup pictures made again with the fixed art (Oct 23, Nick: "the little visual thumbnails that blow up didn't get
   *  updated in real time"): the Mockup Creator runs out of sight, saves, and says so; then the order shows the new ones */
  const [remaking, setRemaking] = useState(false);
  async function remakeMockups(groupIds: string[]) {
    if (!groupIds.length) return;
    setRemaking(true);
    for (const gid of groupIds) {
      await new Promise<void>((res) => {
        const f = document.createElement("iframe");
        f.setAttribute("aria-hidden", "true"); f.tabIndex = -1;
        f.style.cssText = "position:fixed;left:-12000px;top:0;width:1400px;height:900px;border:0;opacity:0;pointer-events:none";
        const end = () => { window.removeEventListener("message", on); clearTimeout(t); f.remove(); res(); };
        const on = (e: MessageEvent) => { if (e.origin === location.origin && e.data?.type === "fbs:mockup-saved" && e.data.group === gid) end(); };
        const t = setTimeout(end, 60_000);
        window.addEventListener("message", on);
        f.src = `/shop/artwork/mockup?order=${orderId}&group=${gid}&auto=1&quiet=1`;
        document.body.appendChild(f);
      });
    }
    setRemaking(false); setStale(false);
    void load(); pageReloads(orderId);
  }

  /** a change the mockup shows (a print's inks, size, spot; a garment's color): its mockup is made again too */
  async function remakeFor(cs: OrderChange[]) {
    if (!o) return;
    const ids = new Set<string>();
    for (const c of cs) {
      const g = c.what === "print" ? o.groups.find((x) => x.imprints.some((im) => im.id === c.id)) : c.what === "line" && c.field === "color" ? o.groups.find((x) => x.lines.some((l) => l.id === c.id)) : null;
      if (g && (g.mockupThumbs || []).length && c.field !== "underbase" && c.field !== "colors") ids.add(g.id);
    }
    await remakeMockups([...ids]);
  }

  /** the art fixes, drawn on each logo here, then said on its print */
  async function runArt(ri: number, art: OrderChange[]) {
    if (!o || !art.length) return;
    const byPrint = new Map<string, OrderChange[]>();
    for (const c of art) byPrint.set(c.id, [...(byPrint.get(c.id) || []), c]);
    const fixedGroups = new Set<string>();
    for (const [pid, cs] of byPrint) {
      const g = o.groups.find((x) => x.imprints.some((im) => im.id === pid)), im = g?.imprints.find((x) => x.id === pid);
      const mark = (state: "done" | "error", e?: string) => setRounds((rs) => rs.map((r, i) => (i !== ri ? r : { ...r, art: r.art.map((a) => (a.id === pid ? { ...a, state, err: e } : a)) })));
      if (!g || !im?.design_id) { mark("error", "That print has no logo"); continue; }
      const f = await fixDesignArt(sb, im.design_id, cs.map((c) => c.field as ArtAction), { shirt: guessHex(g.lines[0]?.color || ""), widthIn: parseFloat(String(im.size || "")) || undefined, say: cs.map((c) => c.say) });
      if (!f.ok) { mark("error", f.error); continue; }
      for (const c of cs) await noteArtChange(orderId, pid, c.say).catch(() => null);
      mark("done"); setStale(true);
      if ((g.mockupThumbs || []).length) fixedGroups.add(g.id);
    }
    void load(); pageReloads(orderId);
    void remakeMockups([...fixedGroups]);
  }

  async function ask(m: "review" | "change") {
    const said = text.trim();
    if (m === "change" && !said) { setErr("Say what to change first."); return; }
    setBusy(m === "review" ? "Comparing it with what the customer sent…" : "Making the changes…"); setErr("");
    setPending(m === "review" ? "Check it for me" : said); if (m === "change") setText("");
    if (m === "change") await pageSaves(orderId);
    const r = await aiOrderFix(orderId, m === "change" ? said : "", m, earlier);
    setBusy(""); setPending(null);
    if (!r.ok) { setErr(r.error); if (m === "change") setText(said); return; }
    const x = r.r;
    const ri = rounds.length;
    if (m === "review") {
      setRounds((rs) => [...rs, { you: "Check it for me", reply: x.reply, applied: [], art: [], suggest: x.changes, rule: x.rule }]);
      setPick(Object.fromEntries(x.changes.map((_, i) => [i, true])));
    } else {
      setRounds((rs) => [...rs, { you: said, reply: x.reply, applied: x.applied, art: x.art.map((a) => ({ ...a, state: "doing" as const })), suggest: [], rule: x.rule }]);
      setText("");
      if (x.applied.length) pageReloads(orderId);
      void runArt(ri, x.art);
      if (x.applied.length && !x.art.length) void remakeFor(x.changes);
      void load();
    }
    if (x.lesson) setLesson({ on: true, text: x.lesson });
  }

  async function makeSuggested() {
    if (!last) return;
    const ri = rounds.length - 1;
    const ch = last.suggest.filter((_, i) => pick[i]);
    if (!ch.length) return;
    setBusy("Making the changes…"); setErr("");
    await pageSaves(orderId);
    const r = await applyOrderFixChanges(orderId, ch);
    setBusy("");
    if (!r.ok) { setErr(r.error); return; }
    const art = ch.filter((c) => c.what === "art");
    setRounds((rs) => rs.map((x, i) => (i !== ri ? x : { ...x, applied: r.applied, art: art.map((a) => ({ ...a, state: "doing" as const })), suggest: [] })));
    if (r.applied.length) pageReloads(orderId);
    void runArt(ri, art);
    if (r.applied.length && !art.length) void remakeFor(ch);
    void load();
  }

  /** Oct 23 (#40127, Nick: "it made the order, but didn't even make the mock-up"): a print with art and no mockup yet
   *  gets one. Create order goes to the Mockup Creator by itself; from anywhere else Yes opens it (in a new tab, opened
   *  first so the browser doesn't block it). */
  const needMock = o?.groups.find((g) => g.imprints.some((im) => im.design_id) && !(g.mockupThumbs || []).length) || null;
  async function done() {
    if (needMock && !onMockupPage) window.open(next && next.includes("/mockup?") ? next : mockHref(needMock), "_blank", "noopener");
    setBusy("Saving…");
    if (lesson.on && lesson.text.trim()) await saveOrderLesson(orderId, lesson.text).catch(() => null);
    await markOrderChecked(orderId).catch(() => null);
    setBusy("");
    try { sessionStorage.removeItem(keyOf(orderId)); } catch { /* */ }
    onClose();
  }

  if (!o) return <div className="ap orv"><p className="faint">Opening the order…</p></div>;
  const working = rounds.some((r) => r.art.some((a) => a.state === "doing"));
  const lastRule = [...rounds].reverse().find((r) => r.rule)?.rule;
  const send = () => { if (text.trim() && !busy) void ask("change"); };
  const yesLabel = needMock && !onMockupPage ? "Yes, make the mockup" : changed ? "Yes, it\u2019s right now" : "Yes, it\u2019s right";
  // like a text thread (Oct 23, Nick: "make it like an iPhone chat"): the order up top, the thread, and the box at the bottom
  return (
    <div className="ap orv chat" role="group" aria-label="Check the order">
      <div className="orv-top">
        <div className="orv-top-h"><b>#{o.number}</b><span className="faint">{o.nickname}</span><button type="button" className="ap-link" onClick={onClose} title="Hide it; it comes back with Check or change it on the order">Close for now</button></div>
        {o.groups.map((g) => (
          <section key={g.id} className="orv-g">
            <div className="orv-pics">
              {(g.mockupThumbs || []).filter((p) => urls[p]).slice(0, 1).map((p) => <a key={p} href={mockHref(g)} target="_blank" rel="noreferrer" className="ap-pic"><img src={urls[p]} alt="The mockup" /></a>)}
              {!(g.mockupThumbs || []).length && (onMockupPage
                ? <span className="ap-pic orv-none"><span>Making the mockup…</span></span>
                : <a className="ap-pic orv-none" href={mockHref(g)} target="_blank" rel="noreferrer"><span>No mockup yet</span></a>)}
            </div>
            <div className="orv-d">
              {g.lines.map((l) => (
                <div key={l.id} className="orv-l" data-notranslate>
                  <b>{[l.brand, l.style].filter(Boolean).join(" ")}</b> · {l.color || "no color"} · {Object.values(l.sizes || {}).reduce<number>((a, v) => a + (+(v || 0)), 0)} pcs
                  {sizeRun(l.sizes as Record<string, unknown>) && <span className="faint"> ({sizeRun(l.sizes as Record<string, unknown>)})</span>}
                  {l.extras && <span className="gl-stamp orv-stamp"><span>{l.extrasPrint === false ? "Not printed extras" : "Printed extras"}</span><span>· {l.extrasFree === false ? "charged" : "no charge"}</span></span>}
                </div>
              ))}
              {g.imprints.map((im) => (
                <div key={im.id} className="orv-p" data-notranslate>
                  <b>{im.location}</b> · {parseFloat(String(im.size || "")) > 0 ? `${parseFloat(String(im.size))}" wide` : "standard size"} · {im.drop ? `${im.drop}" below the collar` : "normal height"}{im.inks ? ` · ${im.inks}` : ""}{im.underbase ? " + white underbase" : ""}
                  {(im.artChanges || []).length > 0 && <ul className="orv-art">{im.artChanges!.map((t, i) => <li key={i}>{t}</li>)}</ul>}
                </div>
              ))}
              {!onMockupPage && <a className="ap-link" href={mockHref(g)} target="_blank" rel="noreferrer">{(g.mockupThumbs || []).length ? "Open the mockup ›" : "Make the mockup ›"}</a>}
            </div>
          </section>
        ))}
      </div>

      <div className="orv-thread" aria-live="polite">
        <div className="bub them">
          <p>#{o.number} is made. Did I get everything right?</p>
          <p className="bub-sub">Click around the order and the mockup. Tell me anything that&apos;s off and I&apos;ll fix it. Nothing goes to the customer.</p>
          {did && did.length > 0 && <details className="orv-did"><summary>What I did ({did.length})</summary><ul>{did.map((x, i) => <li key={i}>{x}</li>)}</ul></details>}
        </div>
        {rounds.map((r, ri) => {
          const isLast = ri === rounds.length - 1;
          const didSome = r.applied.length > 0 || r.art.length > 0;
          return (
            <div key={ri} className="bub-pair">
              <div className="bub me"><p>{r.you}</p></div>
              <div className="bub them">
                {r.reply && <p>{r.reply}</p>}
                {r.applied.length > 0 && <ul className="orv-done">{r.applied.map((t, i) => <li key={i}>{t}</li>)}</ul>}
                {r.art.length > 0 && <ul className="orv-done">{r.art.map((a, i) => <li key={i} className={a.state}>{a.say}{a.state === "doing" ? <span className="faint"> · changing the logo…</span> : a.state === "error" ? <span className="err-t"> · {a.err}</span> : <span className="orv-tag">On the proof</span>}</li>)}</ul>}
                {isLast && r.suggest.length > 0 && <>
                  <ul className="orv-sug">{r.suggest.map((c, i) => <li key={i}><label><input type="checkbox" checked={!!pick[i]} onChange={(e) => setPick((p) => ({ ...p, [i]: e.target.checked }))} /> {c.say}{c.what === "art" && <span className="orv-tag">On the proof</span>}</label></li>)}</ul>
                  <button type="button" className="btn primary sm" onClick={() => void makeSuggested()} disabled={!!busy}>Make {Object.values(pick).filter(Boolean).length === 1 ? "this change" : "these changes"}</button>
                </>}
                {isLast && didSome && !working && <p className="bub-q">Does everything look right now?</p>}
              </div>
            </div>
          );
        })}
        {busy && <>{pending && <div className="bub me"><p>{pending}</p></div>}<div className="bub them typing" aria-label={busy}><i /><i /><i /></div></>}
        {remaking && <p className="bub-note">Making the mockup again with the new art…</p>}
        {stale && !working && !remaking && <p className="bub-note">{onMockupPage ? "The logo changed and the shirt on the left shows it now. Save the mockup to the order so its picture shows it too." : <>The logo changed: <a className="ap-link" href={mockHref(o.groups[0])} target="_blank" rel="noreferrer">open the mockup</a> and save it again so its picture shows it.</>}</p>}
        {lesson.text && <label className="orv-lesson"><input type="checkbox" checked={lesson.on} onChange={(e) => setLesson((l) => ({ ...l, on: e.target.checked }))} /> <span>Remember for {who}:</span><input type="text" value={lesson.text} onChange={(e) => setLesson((l) => ({ ...l, text: e.target.value }))} aria-label="What to remember" /></label>}
        {lastRule && <p className="bub-note">For tonight&apos;s review: {lastRule}</p>}
        {err && <div className="err">{err}</div>}
        <div ref={endRef} />
      </div>

      <div className="orv-compose">
        <div className="orv-box">
          <textarea ref={box} rows={1} value={text} onChange={(e) => { setText(e.target.value); setErr(""); const t = e.target; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 140) + "px"; }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={rounds.length ? "Anything else?" : "Tell me what to change"} aria-label="What to change" />
          <MicButton target={() => box.current} append keepListening off={!!busy} label="Say what to change (click again when you're done)" />
          <button type="button" className="orv-send" onClick={send} disabled={!!busy || !text.trim()} aria-label="Make the changes" title="Make the changes (Enter)">↑</button>
        </div>
        <div className="orv-quick">
          {res.length > 0 && <button type="button" className="chip orv-rsc-h" onClick={() => setResOpen(true)} title="What came in with the order (their PO, mockup, art), opened in the middle of the screen">Order resources <span className="orv-rsc-n">{res.length}</span></button>}
          <span className="spacer" />
          <button type="button" className="chip" onClick={() => void ask("review")} disabled={!!busy}>{rounds.length ? "Check it again for me" : "Check it for me"}</button>
          <button type="button" className="chip ok" onClick={() => void done()} disabled={!!busy || working} title={needMock && !onMockupPage ? "Saves it and makes the mockup in a new tab" : "Saves it and closes"}>{yesLabel}</button>
        </div>
      </div>
      {resOpen && res.length > 0 && typeof document !== "undefined" && createPortal(<QuickLook files={res} at={0} strip title="Order resources" onClose={() => setResOpen(false)} />, document.body)}
    </div>
  );
}

/** the order check, open on the right of every shop page until it's closed (the end of Create order, an order's
 *  "Check or change it"): which order is kept for this tab, so going to the Mockup Creator and back keeps it open */
const DOCK_KEY = "fbs:orderCheck";
type DockState = { orderId: string; did?: string[] };
export function openOrderCheck(orderId: string, did?: string[]) {
  const st: DockState = { orderId, did };
  try { sessionStorage.setItem(DOCK_KEY, JSON.stringify(st)); } catch { /* */ }
  window.dispatchEvent(new CustomEvent("fbs:order-check", { detail: st }));
}

export function OrderCheckDock() {
  const [st, setSt] = useState<DockState | null>(null);
  useEffect(() => {
    if (window.self !== window.top) return; // the Mockup Creator made out of sight (remakeMockups): no second check in it
    try { const x = sessionStorage.getItem(DOCK_KEY); if (x) setSt(JSON.parse(x) as DockState); } catch { /* */ }
    const on = (e: Event) => setSt((e as CustomEvent<DockState | null>).detail);
    window.addEventListener("fbs:order-check", on);
    return () => window.removeEventListener("fbs:order-check", on);
  }, []);
  useEffect(() => {
    if (!st) return;
    window.dispatchEvent(new CustomEvent("fbs:dock", { detail: { open: true } }));
    return () => { window.dispatchEvent(new CustomEvent("fbs:dock", { detail: { open: false } })); };
  }, [st]);
  if (!st) return null;
  const close = () => { try { sessionStorage.removeItem(DOCK_KEY); } catch { /* */ } setSt(null); };
  return (
    <div className="dla-bg dock wide" role="dialog" aria-label="Check the order">
      <div className="dla qo wide"><OrderReview key={st.orderId} orderId={st.orderId} did={st.did} onClose={close} /></div>
    </div>
  );
}
