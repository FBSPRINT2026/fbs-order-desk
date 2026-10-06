import { Atkinson_Hyperlegible, Big_Shoulders_Display } from "next/font/google";
import "../store.css";

// the store's two faces: a condensed athletic display (the school's banner) and a very legible body for parents on phones
const display = Big_Shoulders_Display({ subsets: ["latin"], weight: ["600", "800", "900"], variable: "--sf-display" });
const body = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], variable: "--sf-body" });

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return <div className={`sf-root ${display.variable} ${body.variable}`}>{children}</div>;
}
