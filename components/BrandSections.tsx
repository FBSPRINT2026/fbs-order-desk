"use client";
import { useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { BrandEdit } from "@/components/BrandAssistant";
import CustomerStyleGuides from "@/components/CustomerStyleGuides";
import CustomerBrandColors from "@/components/CustomerBrandColors";
import CustomerBrandPrint from "@/components/CustomerBrandPrint";
import CustomerNeckLabels from "@/components/CustomerNeckLabels";
import CustomerPreferredGoods from "@/components/CustomerPreferredGoods";

/**
 * A customer's Brand standards, showing only what's on file (Oct 21, Nick: "if we didn't specify anything other than
 * the tags, all you should show in there is just the tags… no other brand standards"). The rest is one "+ Add" on the
 * title line: picking a kind shows its editor and unlocks editing. Nothing here saves on its own.
 */
type Kind = "guides" | "colors" | "print" | "neck" | "goods";
const KINDS: { k: Kind; label: string }[] = [
  { k: "goods", label: "Preferred goods" }, { k: "neck", label: "Neck tag" }, { k: "guides", label: "Style guide" }, { k: "colors", label: "Brand colors" }, { k: "print", label: "Print sizes, rules, how prints are made" },
];

export default function BrandSections({ customerId, company }: { customerId: string; company: string }) {
  const sb = useMemo(() => createClient(), []);
  const { setEditing, slot } = useContext(BrandEdit);
  const [has, setHas] = useState<Set<Kind> | null>(null);
  const [added, setAdded] = useState<Set<Kind>>(new Set());
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    sb.from("customers").select("style_guides, brand_colors, brand_print, neck_labels, preferred_goods").eq("id", customerId).maybeSingle().then(({ data }) => {
      const d = (data || {}) as { preferred_goods?: unknown[]; style_guides?: { path?: string; archived?: boolean }[]; brand_colors?: unknown[]; brand_print?: { sizes?: unknown[]; hit?: string; soft?: boolean; rules?: unknown[] }; neck_labels?: { id?: string; archived?: boolean }[] };
      const on = new Set<Kind>();
      if ((d.preferred_goods || []).length) on.add("goods");
      if ((d.style_guides || []).some((g) => g?.path && !g.archived)) on.add("guides");
      if ((d.brand_colors || []).length) on.add("colors");
      const bp = d.brand_print || {};
      if ((bp.sizes || []).length || bp.hit || bp.soft || (bp.rules || []).length) on.add("print");
      if ((d.neck_labels || []).some((s) => s?.id && !s.archived)) on.add("neck");
      setHas(on);
    });
  }, [sb, customerId]);
  if (!has) return null;
  const show = (k: Kind) => has.has(k) || added.has(k);
  const missing = KINDS.filter((x) => !show(x.k));
  const shown = KINDS.length - missing.length;
  const pick = (k: Kind) => { setAdded((a) => new Set(a).add(k)); setEditing(true); setMenu(false); };
  const addBtn = missing.length > 0 && (
    <span className="bsx-add">
      <button type="button" className="bai-edit" onClick={() => setMenu((x) => !x)} aria-expanded={menu}>+ Add</button>
      {menu && (
        <span className="bsx-menu" role="menu">
          {missing.map((x) => <button key={x.k} type="button" role="menuitem" onClick={() => pick(x.k)}>{x.label}</button>)}
        </span>
      )}
    </span>
  );
  return (
    <>
      {slot && addBtn ? createPortal(addBtn, slot) : null}
      {show("goods") && <CustomerPreferredGoods customerId={customerId} />}
      {show("neck") && <CustomerNeckLabels customerId={customerId} />}
      {show("guides") && <CustomerStyleGuides customerId={customerId} />}
      {show("colors") && <CustomerBrandColors customerId={customerId} company={company} />}
      {show("print") && <CustomerBrandPrint customerId={customerId} />}
      {missing.length > 0 && <p className="bsx-none">{shown ? "No other brand standards." : "No brand standards yet."}</p>}
    </>
  );
}
