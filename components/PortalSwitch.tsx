"use client";

/**
 * "Show in their portal": one switch, the same everywhere, at the right end of a section's title line (the shop's Design
 * catalog, Brand standards…). Blue when it's showing (Oct 24, Nick: "make the show in their portal buttons all look the
 * same and put them in the same place").
 */
export default function PortalSwitch({ on, onChange, what }: { on: boolean; onChange: (v: boolean) => void; /** for the tooltip: "this catalog" */ what: string }) {
  return (
    <button type="button" className={"btn sm portal-sw" + (on ? " on" : "")} aria-pressed={on}
      title={on ? `They can see ${what} in their portal. Click to hide it.` : `Let them see ${what} in their portal`} onClick={() => onChange(!on)}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>{on
        ? <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>
        : <><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 4-.8" /></>}</svg>
      {on ? "Shown in their portal" : "Show in their portal"}
    </button>
  );
}
