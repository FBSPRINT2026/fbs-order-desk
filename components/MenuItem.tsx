import type { ReactNode } from "react";

/**
 * A dropdown item with a tinted icon and a one-line description (Oct 27, Nick: "the Ask AI… looks so plain… do some
 * little thumbnails next to them… just look more dynamic" → option A). Goes inside an `.ot-menu` <a> or <button>:
 *   <button onClick=…><MenuItem icon="chat" tone="blue" title="Order chat" sub="Check the order, say what to change" /></button>
 */
export type MenuIcon = "chat" | "bolt" | "shirt" | "needle" | "grid" | "invoice" | "proof" | "clipboard" | "press" | "label" | "phone" | "copy" | "trash";
export type MenuTone = "blue" | "salmon" | "orange" | "violet" | "green" | "gray" | "danger";

const P: Record<MenuIcon, string> = {
  chat: "M4 5h16v11H9l-5 4zM8 9.5h8M8 12.5h5",
  bolt: "M13 3 4 14h7l-1 7 9-11h-7z",
  shirt: "M8.5 4 3 7l2.2 4 2.8-1.2V20h8V9.8l2.8 1.2L21 7l-5.5-3c-.8 1.6-2 2.5-3.5 2.5S9.3 5.6 8.5 4z",
  needle: "M19.5 4.5 7 17M16.5 4.5h3v3M5 20c1.5-3 4-4.5 6.5-3.5s5 .2 7.5-3",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  invoice: "M6.5 3h11v18l-2.2-1.4-2.1 1.4-2.2-1.4-2.2 1.4-2.3-1.4zM9.5 8h5M9.5 11.5h5M12 15h2.5",
  proof: "M4 5h16v14H4zM4 15.5l4.5-4.5 4 4 2.5-2.5 5 5M15 9.2h.01",
  clipboard: "M9 3.5h6v3H9zM7 5H5v16h14V5h-2M8.5 11.5h7M8.5 15.5h5",
  press: "M3 20V10l5 3v-3l5 3V5h8v15zM7 17h2M12 17h2M17 17h1",
  label: "M3.5 12.5V4h8.5l9 9-8.5 8.5zM8 8h.01",
  phone: "M7.5 3h9a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  trash: "M4 7h16M9.5 7V4h5v3M6 7l1 13h10l1-13M10 11v5M14 11v5",
};

export default function MenuItem({ icon, tone = "blue", title, sub }: { icon: MenuIcon; tone?: MenuTone; title: ReactNode; sub?: ReactNode }) {
  return (
    <span className="mi">
      <span className={"mi-ic " + tone} aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={P[icon]} /></svg></span>
      <span className="mi-t"><span className="mi-1">{title}</span>{sub ? <span className="mi-2">{sub}</span> : null}</span>
    </span>
  );
}
