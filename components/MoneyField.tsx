"use client";
import { useState, type InputHTMLAttributes } from "react";

/**
 * A money box: always shows two decimals (2.40, not 2.4) when you're not typing in it (Nov 10, Nick: "make the pricing
 * always default to 2 digits… it just bothers me that it's 12 times 2.4 instead of 12 times 2.40"). While it has focus it
 * shows exactly what's typed, so the cursor never jumps. Every price box on the site is one of these (an
 * `<input type="number" step="0.01">` otherwise): use it for any new money field. A box with a defaultValue (not
 * controlled) is left as it is.
 */
export default function MoneyField(props: InputHTMLAttributes<HTMLInputElement>) {
  const [typing, setTyping] = useState(false);
  const { value, onFocus, onBlur, ...rest } = props;
  if (value === undefined) return <input type="number" step="0.01" {...rest} onFocus={onFocus} onBlur={onBlur} />;
  const raw = value == null ? "" : String(value);
  const n = raw.trim() === "" ? NaN : Number(raw);
  const shown = typing || isNaN(n) ? raw : n.toFixed(2);
  return (
    <input type="number" step="0.01" {...rest} value={shown}
      onFocus={(e) => { setTyping(true); onFocus?.(e); }}
      onBlur={(e) => { setTyping(false); onBlur?.(e); }} />
  );
}
