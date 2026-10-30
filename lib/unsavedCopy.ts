/**
 * The "Unsaved changes found" copy of an order (Oct 24, Nick: "maybe somebody loses their internet connection"), shared
 * by the shop's order page and the customer's order editor so they can't drift.
 *
 * Oct 30, Nick: "this unsaved changes thing is still popping up". It was offering back things nobody typed: the changes
 * the page makes by itself when an order opens (a mockup redrawn, program prices filled, old personalization moved) were
 * kept as "unsaved", and a copy was judged by this computer's clock against the server's. Now:
 *  - only a change a person just made (a click, a key, a paste, a drop in the last few seconds) is kept. What the page
 *    does by itself is done again the next time the order opens, so there's nothing to lose;
 *  - each copy remembers which saved version of the order it was made on (`base`, the order's updated_at). It's offered
 *    back only while the server still has that same version: any save after it (this tab, another tab, another computer)
 *    means it's not unsaved any more. No clocks compared;
 *  - a save that reaches the server drops the copy, or moves it onto the new version when more was typed meanwhile;
 *  - copies from before this (no `base`) are dropped.
 */

export type UnsavedCopy<T> = { at: number; base: string; o: T };

const key = (id: string) => `fbs:unsaved:${id}`;
const TOUCH_MS = 4000;
let lastTouch = 0;
let listening = false;

/** Start noticing a person working on the page (safe to call many times). */
export function watchPerson() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const mark = () => { lastTouch = Date.now(); };
  for (const ev of ["pointerdown", "keydown", "input", "change", "paste", "drop"]) window.addEventListener(ev, mark, { capture: true, passive: true });
}

/** A person did something on the page just now (so a change now is theirs, not the page's own). */
export function personJustActed() {
  return Date.now() - lastTouch < TOUCH_MS;
}

/** Keep a copy of a change in this browser until the server has it, if a person made it. */
export function keepUnsaved<T extends { id: string }>(o: T, base: string | null | undefined) {
  if (!base || !personJustActed()) return;
  try { localStorage.setItem(key(o.id), JSON.stringify({ at: Date.now(), base, o })); } catch { /* storage full or off */ }
}

/**
 * A save reached the server. `startedAt` is when it began, `base` the order's new updated_at (when known). A copy made
 * after the save began holds more typing: it moves onto the new version; anything else is dropped.
 */
export function savedUnsaved(id: string, startedAt: number, base?: string | null) {
  try {
    const raw = localStorage.getItem(key(id));
    if (!raw) return;
    const keep = JSON.parse(raw) as UnsavedCopy<unknown>;
    if (base && keep.at > startedAt) localStorage.setItem(key(id), JSON.stringify({ ...keep, base }));
    else localStorage.removeItem(key(id));
  } catch { /* storage off */ }
}

/** Forget the copy (thrown away, sent, or the page took the server's copy). */
export function dropUnsaved(id: string) {
  try { localStorage.removeItem(key(id)); } catch { /* storage off */ }
}

/**
 * The copy to offer back when the order opens: made by a person, on the version the server still has, within a week,
 * and different from what the server has (`same`). Any other copy is dropped.
 */
export function readUnsaved<T>(id: string, serverBase: string | null | undefined, same: (o: T) => boolean): UnsavedCopy<T> | null {
  try {
    const raw = localStorage.getItem(key(id));
    if (!raw) return null;
    const keep = JSON.parse(raw) as UnsavedCopy<T>;
    if (keep?.o && keep.base && serverBase && keep.base === serverBase && Date.now() - keep.at < 7 * 864e5 && !same(keep.o)) return keep;
    localStorage.removeItem(key(id));
  } catch { /* storage off */ }
  return null;
}
