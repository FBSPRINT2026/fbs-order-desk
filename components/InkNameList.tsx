"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { inkChoices } from "@/lib/inkColors";
import { loadInkFormulas } from "@/lib/inkFormulas";

/**
 * THE list of ink names a typed ink box offers (a <datalist>): the Ink Room's stocked inks, the standard names, every PMS
 * on the chart and every PMS the Ink Room has a formula for, read in once per page (Nov 18, Nick: PMS 2170 C couldn't
 * be picked in the Mockup Creator). The Mockup Creator, the Separation Studio and the production mockup all use it.
 */
export default function InkNameList({ id }: { id: string }) {
  const [, setN] = useState(0);
  useEffect(() => { loadInkFormulas(createClient()).then(setN).catch(() => {}); }, []);
  return <datalist id={id}>{inkChoices({ pms: true }).map((n) => <option key={n} value={n} />)}</datalist>;
}
