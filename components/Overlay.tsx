"use client";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A pop-up's shade and box drawn at the top of the page, not inside whatever it was opened from (Nov 1, Nick: the
 * "Visual mockup" stamps showed through the Reset in Printavo pop-up: it was opened from the order's header, whose own
 * layer sat under the prints). Wrap a `.mk-modal-back` / `.cc-back` in it and it covers everything.
 */
export default function Overlay({ children }: { children?: ReactNode }) {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(true), []);
  return on ? createPortal(children, document.body) : null;
}
