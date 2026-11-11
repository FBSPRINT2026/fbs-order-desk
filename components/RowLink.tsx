"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * A list row that opens a page is a real link (Oct 31, Nick: "in Printavo… when you are in the orders screen, you can
 * right click and open in a new tab. But here you can't do that"): put this first in the row's first cell and give the
 * row `className="rl"`. Its first cell is the link itself (right-click Open in new tab, middle-click, Ctrl/Cmd-click),
 * and a click anywhere else on the row opens the same page. Buttons, checkboxes and other links in the row keep working.
 * `off` (a row picking for a bulk action) leaves the row as it is.
 *
 * The rest of the row is a click, not the link stretched over it (Nov 11, Jorge on Safari: every invoice he clicked
 * opened #33614): Safari doesn't make a table row the box a stretched link fills, so each row's link covered the whole
 * table and the last one won. A row's own click can't land on another row's page in any browser.
 */
export default function RowLink({ href, label, off }: { href: string; label?: string; off?: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null), router = useRouter();
  useEffect(() => {
    const a = ref.current, row = a?.closest("tr.rl, li.rl") as HTMLElement | null;
    if (!a || !row) return;
    const click = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (e.defaultPrevented || t.closest("a, button, input, select, textarea, label, summary, [role=button], [contenteditable]") || (window.getSelection()?.toString() || "").trim()) return;
      if (e.metaKey || e.ctrlKey) { window.open(href, "_blank"); return; }
      router.push(href);
    };
    const aux = (e: MouseEvent) => { if (e.button === 1 && !(e.target as HTMLElement).closest("a, button, input, select, textarea")) { e.preventDefault(); window.open(href, "_blank"); } };
    row.addEventListener("click", click); row.addEventListener("auxclick", aux);
    return () => { row.removeEventListener("click", click); row.removeEventListener("auxclick", aux); };
  }, [href, router]);
  if (off || !href) return null;
  return <Link ref={ref} href={href} className="rl-a" prefetch={false} aria-label={label || "Open"} />;
}
