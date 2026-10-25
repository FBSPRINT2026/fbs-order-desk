"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Every page's browser title says where you are (Oct 24, Nick: "when you right click the back button… you should be able
 * to see where you were… it shouldn't just all say FBS Order Desk. It should be like invoice 40093, customers, Dear
 * Heart"). Taken from the page's own heading (the `.page-head` h1 every page has: "#40166 Jesus Changes Everything",
 * "Dear Heart Designs", "Reorder Details"), else from the address; the browser keeps it in its history. Print pages
 * name their own (the PDF's file name).
 */
const WORDS: Record<string, string> = { shop: "", portal: "", orders: "Orders", customers: "Customers", inbox: "Email", email: "Email", artwork: "Artwork", mockup: "Mockup Creator", production: "Production", details: "Reorder Details", settings: "Settings", calendar: "Calendar", projects: "Projects", goods: "Goods", statement: "Statement", request: "Order", archive: "Old order", designs: "Designs", separations: "Separations", employees: "Employees", "ink-room": "Ink Room", "merch-stores": "Merch Stores", "my-day": "My Day" };
const fromPath = (p: string) => {
  const parts = p.split("/").filter((x) => x && !/^[0-9a-f-]{20,}$/i.test(x));
  const named = parts.map((x) => (x in WORDS ? WORDS[x] : x.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()))).filter(Boolean);
  return named.slice(-2).reverse().join(" · ");
};
const clean = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 80);

export default function PageTitle() {
  const path = usePathname() || "/";
  useEffect(() => {
    if (path.startsWith("/print")) return;
    const site = path.startsWith("/portal") ? "FBS Print" : "FBS Order Desk";
    const set = () => {
      const h = document.querySelector(".page-head h1, main h1, h1");
      const t = clean(h?.textContent || "") || fromPath(path);
      const want = t ? `${t} · ${site}` : site;
      if (document.title !== want) document.title = want;
    };
    set();
    // the heading often fills in after the data loads (an order's number and name)
    let n = 0;
    const iv = setInterval(() => { set(); if (++n > 20) clearInterval(iv); }, 400);
    const mo = new MutationObserver(() => set());
    const head = document.querySelector(".page-head") || document.querySelector("main");
    if (head) mo.observe(head, { childList: true, subtree: true, characterData: true });
    // and when Next puts its own title back on a navigation
    mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => { clearInterval(iv); mo.disconnect(); };
  }, [path]);
  return null;
}
