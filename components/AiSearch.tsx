"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import SearchInput from "@/components/SearchInput";

/** The big "ask or search anything" box (AI answers + search everything). Speaking into the mic runs it when you stop. */
export default function AiSearch({ placeholder = "Ask AI or search orders, customers, POs, tracking…", className = "" }: { placeholder?: string; className?: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const go = (t: string) => { const x = t.trim(); if (x) router.push(`/shop/search?q=${encodeURIComponent(x)}`); };
  return (
    <form className={"ai-bar " + className} role="search" onSubmit={(e) => { e.preventDefault(); go(q); }}>
      <svg className="ai-bar-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z" /></svg>
      <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Ask AI or search everything" onDictated={go} />
      <button type="submit" className="btn primary ai-bar-go">Ask</button>
    </form>
  );
}
