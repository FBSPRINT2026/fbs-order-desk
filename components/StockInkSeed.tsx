"use client";
import { addStockInks } from "@/lib/inkColors";

/**
 * The Ink Room's stocked inks (Dark Brown, Bora Bora Sand, Khaki…) known to every shop page from the first paint, so an
 * ink chip or swatch shows its own color, not gray (Oct 28, Nick: #40200's Dark Brown showed gray on the order page and
 * the proof). Read once by the shop layout; added before the page below it draws.
 */
export default function StockInkSeed({ rows }: { rows: { name: string; hex: string; line: string }[] }) {
  addStockInks(rows);
  return null;
}
