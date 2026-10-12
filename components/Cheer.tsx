"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Cheer mode (Oct 12, Nick: "Amanda needs a lot of positive affirmation… when she completes a task it does a little
 * firework, just in her mode"). For whoever has it on (staff.cheer; on for Amanda, a switch on My Day for anyone):
 * finishing something sets off fireworks in the shop's colors and a short kind note, with how many wins today.
 * Anything in the portal says it finished something with cheerWin(); with Cheer mode off nothing shows.
 */
export type WinKind = "todo" | "sent" | "archived";
export function cheerWin(kind: WinKind, opts: { allDone?: boolean } = {}) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("fbs:win", { detail: { kind, ...opts } }));
}
/** My Day's switch tells the page right away (and saves it) */
export function setCheerOn(on: boolean) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("fbs:cheer-mode", { detail: { on } }));
}

const LINES: Record<WinKind, [string, string][]> = {
  todo: [
    ["Look at you go, {name}!", "That one's off your plate."],
    ["Nailed it.", "Seriously, you're on a roll today."],
    ["Another one down!", "The shop runs better because of you."],
    ["You're crushing it.", "Everyone here is lucky to have you."],
    ["Boom. Done.", "Take a breath, you earned it."],
    ["That's how it's done!", "One less thing on your mind."],
  ],
  sent: [
    ["Sent! Nicely done, {name}.", "Clear, kind and handled."],
    ["Reply sent.", "They're lucky to be working with you."],
    ["Off it goes!", "You make this look easy."],
  ],
  archived: [
    ["Inbox, lighter.", "Way to stay on top of it, {name}."],
    ["Handled.", "Little by little, you're clearing the deck."],
    ["One less email!", "You're running a tight ship."],
  ],
};
const ALL_DONE: [string, string] = ["All done, {name}!", "Every single one. Go grab a coffee, you earned it."];
const COLORS = ["#0E9BD8", "#F26660", "#FCB122", "#7C5CE0", "#2BB673", "#FFFFFF"];
type P = { x: number; y: number; vx: number; vy: number; life: number; decay: number; c: string; r: number; tw: boolean };

/** today's wins, kept on this device */
function winsToday() {
  const k = `fbs:wins:${new Date().toLocaleDateString("en-CA")}`;
  try { const n = Number(localStorage.getItem(k) || 0) + 1; localStorage.setItem(k, String(n)); return n; } catch { return 0; }
}

export default function Cheer({ on: start, name }: { on: boolean; name: string }) {
  const [on, setOn] = useState(start), [note, setNote] = useState<{ big: string; small: string; n: number; all: boolean } | null>(null), [show, setShow] = useState(false);
  const cv = useRef<HTMLCanvasElement | null>(null), parts = useRef<P[]>([]), running = useRef(false), turn = useRef<Record<string, number>>({}), hide = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setOn(start), [start]);
  useEffect(() => {
    const m = (e: Event) => setOn(!!(e as CustomEvent<{ on: boolean }>).detail.on);
    window.addEventListener("fbs:cheer-mode", m);
    return () => window.removeEventListener("fbs:cheer-mode", m);
  }, []);
  useEffect(() => {
    if (!on) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const c = cv.current, cx = c?.getContext("2d");
    const size = () => { if (!c || !cx) return; const d = window.devicePixelRatio || 1; c.width = window.innerWidth * d; c.height = window.innerHeight * d; cx.setTransform(d, 0, 0, d, 0, 0); };
    size(); window.addEventListener("resize", size);
    const burst = (x: number, y: number, n: number, power: number) => {
      const c1 = COLORS[Math.floor(Math.random() * 5)], c2 = COLORS[Math.floor(Math.random() * 6)];
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.2, v = power * (0.55 + Math.random() * 0.6);
        parts.current.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: 0.012 + Math.random() * 0.012, c: Math.random() < 0.7 ? c1 : c2, r: 2 + Math.random() * 2.2, tw: Math.random() < 0.3 });
      }
    };
    const loop = () => {
      if (!cx) return;
      cx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      parts.current = parts.current.filter((p) => p.life > 0);
      for (const p of parts.current) {
        p.vx *= 0.985; p.vy = p.vy * 0.985 + 0.06; p.x += p.vx; p.y += p.vy; p.life -= p.decay;
        cx.globalAlpha = Math.max(0, p.tw ? p.life * (0.5 + Math.random() * 0.5) : p.life);
        cx.fillStyle = p.c; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, Math.PI * 2); cx.fill();
      }
      cx.globalAlpha = 1;
      if (parts.current.length) requestAnimationFrame(loop); else running.current = false;
    };
    const win = (e: Event) => {
      const { kind, allDone } = (e as CustomEvent<{ kind: WinKind; allDone?: boolean }>).detail;
      const n = winsToday();
      if (!calm) {
        // from where you tapped (when we know it), then a few across the top; a bigger show when everything's done
        const at = lastTap.current && Date.now() - lastTap.current.t < 4000 ? lastTap.current : { x: window.innerWidth / 2, y: window.innerHeight * 0.45 };
        burst(at.x, at.y, 46, 5.2);
        const shots = allDone ? 6 : 2;
        for (let k = 0; k < shots; k++) setTimeout(() => burst(window.innerWidth * (0.15 + Math.random() * 0.7), window.innerHeight * (0.12 + Math.random() * 0.3), 60, 6 + Math.random() * 2), 180 + k * 260);
        if (!running.current) { running.current = true; requestAnimationFrame(loop); }
      }
      const set = LINES[kind] || LINES.todo, i = (turn.current[kind] = (turn.current[kind] ?? Math.floor(Math.random() * set.length)) + 1) % set.length;
      const [big, small] = allDone ? ALL_DONE : set[i];
      const first = name || "you";
      setNote({ big: big.replace("{name}", first), small: small.replace("{name}", first), n, all: !!allDone }); setShow(true);
      if (hide.current) clearTimeout(hide.current);
      hide.current = setTimeout(() => setShow(false), allDone ? 3600 : 2600);
    };
    window.addEventListener("fbs:win", win);
    return () => { window.removeEventListener("fbs:win", win); window.removeEventListener("resize", size); };
  }, [on, name]);
  // where the last tap was, so the fireworks start from the button you pressed
  const lastTap = useRef<{ x: number; y: number; t: number } | null>(null);
  useEffect(() => {
    if (!on) return;
    const t = (e: PointerEvent) => { lastTap.current = { x: e.clientX, y: e.clientY, t: Date.now() }; };
    window.addEventListener("pointerdown", t, true);
    return () => window.removeEventListener("pointerdown", t, true);
  }, [on]);
  if (!on) return null;
  return (
    <>
      <canvas ref={cv} className="ch-fx" aria-hidden />
      <div className={"ch-note" + (show ? " show" : "")} role="status" aria-live="polite">
        {note && <><p className="ch-big">{note.big}</p><p className="ch-small">{note.small}</p>{note.n > 0 && <span className="ch-n">{note.all || note.n >= 5 ? "🔥 " : ""}{note.n} {note.n === 1 ? "win" : "wins"} today</span>}</>}
      </div>
    </>
  );
}
