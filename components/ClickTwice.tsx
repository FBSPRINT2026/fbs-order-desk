"use client";
import { useEffect, useState } from "react";

/**
 * A button that takes two clicks: the first turns it into "Click again to …", the second does it (Nov 3, Nick: a ClickUp
 * job was marked Not an order by a stray click next to Process: "make it so that you have to click it twice"). Goes back
 * by itself after a few seconds. For quiet but costly actions (taking a job off a list), not for ones with their own pop-up.
 */
export default function ClickTwice({ label, again, onConfirm, disabled, className = "btn", title }: {
  label: string; /** the second step's words, e.g. "Click again: not an order" */ again?: string;
  onConfirm: () => void | Promise<void>; disabled?: boolean; className?: string; title?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  return (
    <button type="button" className={className + (armed ? " ctw-armed" : "")} disabled={disabled} title={title}
      onClick={(e) => { e.stopPropagation(); if (!armed) { setArmed(true); return; } setArmed(false); void onConfirm(); }}
      onBlur={() => setArmed(false)}>
      {armed ? again || `Click again: ${label.toLowerCase()}` : label}
    </button>
  );
}
