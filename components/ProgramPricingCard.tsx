"use client";
import { useEffect, useMemo, useState } from "react";
import LogoThumb from "@/components/LogoThumb";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/format";
import { useSticky } from "@/lib/useSticky";
import { previewUrls } from "@/lib/designs";
import { LANES, laneState, type Lane } from "@/lib/brands";
import type { Design } from "@/lib/pricing";
import { cardsOf, tiersOf, type Program, type ProgramItem, type ProgramMockup, type RateCard } from "@/lib/programs";
import { programCardStats, type CardStats } from "@/app/shop/program-pricing-actions";

/**
 * The Program tab's rate card (Oct 30, Nick: the tab was "almost unreadable", a wall of form fields). Read only, from the
 * program's own design prices: one tab per end client (the prices' `match.who`), what the deal is (who it applies to,
 * whose garments, setup, the last 6 months), then each decoration's products with the styles we see on their jobs and
 * the price each, the extras the program prices itself, and what's not on the program. Nothing here is set per customer:
 * any program's items draw their own card. The settings stay in ProgramAdmin, behind "Edit the rules".
 *
 * Each price ends with its mockups (Program & training, Oct 30, Nick: "have an item at the end of each line that showed
 * which mock-up it used… that would be an easy training visual"): the saved mockups that ARE that price. Create order puts
 * a garment the price covers straight into that mockup's group (lib/masterMockups.ts). "What leads" says how a job finds
 * the price: by the garment's style (All My Sons) or by the design they name (Peticolas).
 */
type D = Design & { brand_id?: string | null };
type Extra = { id: string; name: string; price: number };
/** a saved mockup of theirs: its newest version (archived = every version is archived) */
type Mk = { n: number; title: string; thumb: string; colors: string[]; archived: boolean };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** one name has the other as whole words ("All My Sons" ~ "all my sons moving"; "AMS" doesn't hit "Williams") */
const sameWords = (a: string, b: string) => { const x = ` ${norm(a)} `, y = ` ${norm(b)} `; return x.trim() !== "" && y.trim() !== "" && (x.includes(y) || y.includes(x)); };
/** the end client's key: the same as programCardStats' (`match.who` joined by "|") */
const whoKey = (it: ProgramItem) => (it.match?.who || []).join("|");
const laneOf = (m: string | undefined): Lane => (m === "embroidery" || m === "dtf" ? m : "screen");
const laneLabel = (l: Lane) => LANES.find((x) => x.id === l)?.label || "Screen print";
const plural = (n: number, w: string) => `${n.toLocaleString("en-US")} ${w}${n === 1 ? "" : "s"}`;
const uniq = (xs: string[]) => { const seen = new Set<string>(); return xs.filter((x) => { const k = norm(x); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };

export default function ProgramPricingCard({ customerId, program, items, ver, editing, onToggleEdit, onEditItem, onAdd, onSaveItem, onSaveProgram, fixedWho }: {
  customerId: string; program: Program; items: ProgramItem[];
  /** one program's prices only (the Programs tab picks the end client): its words; no client chips */ fixedWho?: string[];
  /** save a price's mockups */ onSaveItem: (id: string, patch: Partial<ProgramItem>) => void;
  /** save what leads */ onSaveProgram: (patch: Partial<Program>) => void;
  /** bumps when ProgramAdmin reloads: the numbers are counted again */ ver: number;
  editing: boolean; onToggleEdit: () => void;
  /** open the editor on this design price */ onEditItem: (id: string) => void;
  /** a new design price for this end client */ onAdd: (who: string[]) => void;
}) {
  const sb = createClient();
  const live = useMemo(() => items.filter((i) => i.active && !i.archived_at), [items]);

  // end clients: the active prices grouped by who they're for; prices for anyone are one group named after the program
  const clients = useMemo(() => {
    const m = new Map<string, { key: string; who: string[]; items: ProgramItem[] }>();
    for (const it of live) {
      const k = whoKey(it);
      if (!m.has(k)) m.set(k, { key: k, who: k ? k.split("|") : [], items: [] });
      m.get(k)!.items.push(it);
    }
    return [...m.values()];
  }, [live]);
  const [pick, setPick] = useSticky<string>("program.client", "");
  const fixed = fixedWho?.map(norm).filter(Boolean);
  const cur = fixed ? clients.find((c) => fixed.length ? c.who.some((w) => fixed.includes(norm(w))) : !c.who.length) : clients.find((c) => c.key === pick) || clients[0];

  const [stats, setStats] = useState<CardStats | null>(null);
  useEffect(() => {
    let on = true;
    programCardStats(customerId).then((r) => { if (on) setStats(r.ok ? r.stats : null); }, () => { if (on) setStats(null); });
    return () => { on = false; };
  }, [customerId, ver]);

  // the customer's brands and logos (for each decoration's logos), and the shop's extras (for the extras' names)
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [designs, setDesigns] = useState<D[]>([]);
  const [extraList, setExtraList] = useState<Extra[]>([]);
  const linked = useMemo(() => [...new Set(live.flatMap((i) => i.match?.designs || []))].sort(), [live]);
  useEffect(() => {
    let on = true;
    (async () => {
      const [{ data: bs }, { data: ds }, { data: st }] = await Promise.all([
        sb.from("brands").select("id, name").eq("customer_id", customerId).is("archived_at", null),
        sb.from("designs").select("*").eq("customer_id", customerId).is("archived_at", null).eq("draft", false).not("brand_id", "is", null).order("number").limit(400),
        sb.from("settings").select("data").eq("id", 1).maybeSingle(),
      ]);
      let all = (ds || []) as D[];
      const missing = linked.filter((id) => !all.some((d) => d.id === id));
      if (missing.length) { const { data: more } = await sb.from("designs").select("*").in("id", missing); all = [...all, ...((more || []) as D[])]; }
      const d = (st?.data || {}) as { finishing?: Extra[]; wholesale?: { finishing?: Extra[]; embExtras?: Extra[] } };
      const xs = [...(d.finishing || []), ...(d.wholesale?.finishing || []), ...(d.wholesale?.embExtras || [])];
      if (!on) return;
      setBrands((bs || []) as { id: string; name: string }[]);
      setDesigns(all);
      setExtraList(xs.filter((f, i) => f?.id && xs.findIndex((x) => x.id === f.id) === i));
    })().catch(() => null);
    return () => { on = false; };
  }, [customerId, linked.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // the picked end client's card: the rate card whose words name them, else the main one
  const card: RateCard | null = useMemo(() => {
    const cards = cardsOf(program);
    return (cur && cards.find((c) => (c.match || []).some((m) => cur.who.some((w) => sameWords(m, w))))) || cards[0] || program.rate_card || null;
  }, [program, cur]);

  // each decoration (method + its note, "Screen print · Helper logo") and the logos it uses
  const sections = useMemo(() => {
    if (!cur) return [];
    const theirBrands = brands.filter((b) => cur.who.some((w) => sameWords(b.name, w)));
    const brandLogos = designs.filter((d) => d.brand_id && theirBrands.some((b) => b.id === d.brand_id));
    const m = new Map<string, { key: string; lane: Lane; note: string; items: ProgramItem[] }>();
    for (const it of cur.items) {
      const im = it.imprints?.[0], lane = laneOf(im?.method), note = (im?.notes || "").trim();
      const k = `${lane}|${norm(note)}`;
      if (!m.has(k)) m.set(k, { key: k, lane, note, items: [] });
      m.get(k)!.items.push(it);
    }
    return [...m.values()].map((s) => {
      const imps = s.items.flatMap((i) => i.imprints || []);
      const inks = uniq(imps.flatMap((im) => (im.inks || "").split(",").map((x) => x.trim())));
      const thread = s.lane === "embroidery";
      const inkWords = !inks.length ? "" : inks.length <= 3 ? inks.join(", ") : plural(inks.length, thread ? "thread" : "color");
      const places = uniq(s.items.map((i) => (i.imprints || []).map((im) => [im.location, im.size].map((x) => (x || "").trim()).filter(Boolean).join(" ")).filter(Boolean).join(" + ")));
      const where = places.slice(0, 4).join(", ") + (places.length > 4 ? ", …" : "");
      // the logos: the ones the prices name; else the brand's logos ready for this decoration; else all of the brand's
      const named = designs.filter((d) => s.items.some((i) => (i.match?.designs || []).includes(d.id)));
      const ready = brandLogos.filter((d) => laneState(d, s.lane).ready);
      const logos = named.length ? named : ready.length ? ready : brandLogos;
      return { ...s, title: [laneLabel(s.lane), s.note].filter(Boolean).join(" · "), sub: [inkWords, where].filter(Boolean).join(" · "), logos };
    });
  }, [cur, brands, designs]);

  // their saved mockups (newest version of each number), for each price's Mockup column and its picker
  const design = program.leads === "design";
  const [mks, setMks] = useState<Map<number, Mk>>(new Map());
  const [pickFor, setPickFor] = useState<string>("");
  const [pq, setPq] = useState("");
  useEffect(() => {
    let on = true;
    (async () => {
      const { data } = await sb.from("mockups").select("number, title, file_path, archived_at, created_at, snapshot->lines").eq("customer_id", customerId).not("number", "is", null).order("created_at", { ascending: false }).limit(800);
      const m = new Map<number, Mk>();
      for (const r of (data || []) as { number: number; title: string | null; file_path: string; archived_at: string | null; lines: { color?: string }[] | null }[]) {
        const had = m.get(r.number);
        if (had && !had.archived) continue;
        if (had && r.archived_at) continue;
        m.set(r.number, { n: r.number, title: String(r.title || ""), thumb: (r.file_path || "").replace(/\.png$/i, "-thumb.png"), colors: [...new Set((r.lines || []).map((l) => l.color || "").filter(Boolean))], archived: !!r.archived_at });
      }
      const live = [...m.values()].filter((x) => !x.archived && x.thumb);
      const { data: sg } = live.length ? await sb.storage.from("proofs").createSignedUrls(live.map((x) => x.thumb), 3600) : { data: [] };
      live.forEach((x, i) => { x.thumb = sg?.[i]?.signedUrl || ""; });
      if (on) setMks(m);
    })().catch(() => null);
    return () => { on = false; };
  }, [customerId, ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const setMockups = (it: ProgramItem, list: ProgramMockup[]) => onSaveItem(it.id, { mockups: list });

  // sign the pictures of the logos on screen
  const [urls, setUrls] = useState<Record<string, string>>({});
  const shown = useMemo(() => { const m = new Map<string, D>(); sections.forEach((s) => s.logos.slice(0, 4).forEach((d) => m.set(d.id, d))); return [...m.values()]; }, [sections]);
  useEffect(() => {
    const todo = shown.filter((d) => !(d.id in urls));
    if (!todo.length) return;
    let on = true;
    previewUrls(sb, todo).then((u) => { if (on) setUrls((x) => ({ ...x, ...Object.fromEntries(todo.map((d) => [d.id, ""])), ...u })); }, () => null);
    return () => { on = false; };
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cur) return (
    <section className="panel prs">
      <div className="panel-h prs-h"><div className="prs-ht"><h2>{fixed ? "Price lines" : "Program pricing"}</h2><span className="faint">no prices yet{fixed ? ": tell Claude, or + Product" : ""}</span></div><div className="prs-hr"><Leads program={program} onSave={onSaveProgram} /></div></div>
      <div className="prs-foot prs-noprint"><span className="faint">{design ? "Add each design they order, the words they call it and its mockups." : "Add each product they order, its styles and its mockup."}</span>
        <button type="button" className="btn" onClick={onToggleEdit}>{editing ? "Hide the rules" : "Edit the rules"}</button>
        <button type="button" className="btn primary" onClick={() => onAdd(fixedWho || [])}>{design ? "+ Design" : "+ Product"}</button></div>
    </section>
  );
  const st = stats?.who[cur.key];
  const styleJobs = stats?.styles[cur.key] || {};
  const all = cur.items;
  const allSupplied = all.every((i) => !!i.supplied), noneSupplied = all.every((i) => !i.supplied);
  const allIn = all.every((i) => i.price_mode === "flat" && !!i.supplied);
  const setup = card?.noSetupEver || allIn
    ? { v: "None", s: allIn ? "no screens or digitizing; the price is all in" : "no screens or digitizing on any job" }
    : card?.screenFee != null ? { v: `Screens ${money(+card.screenFee)}`, s: "each, on every job" }
      : { v: "Normal", s: "screens and digitizing as usual" };
  const extras = Object.entries(card?.extraPrices || {}).filter(([, n]) => n != null).map(([id, n]) => {
    const f = extraList.find((x) => x.id === id);
    const name = (f?.name || id.replace(/^[a-z]+_/, "").replace(/_/g, " ")).replace(/\s*\([^)]*\)\s*$/, "").trim();
    return { id, name: name.charAt(0).toUpperCase() + name.slice(1), price: +n, was: f ? +f.price : null };
  });
  // not on the program: the words that keep a job off it, art that's always custom, and the standard-print limits
  const notOn = uniq(all.flatMap((i) => i.match?.not || []));
  const notArt = uniq(all.flatMap((i) => i.match?.notArt || [])).map((w) => `art named ${w}`);
  const limits = sections.flatMap((s) => {
    const mc: number[] = [...new Set<number>(s.items.map((i) => +(i.match?.maxColors || 0)).filter((n) => n > 0))];
    const mp: number[] = [...new Set<number>(s.items.map((i) => +(i.match?.maxPrints || 0)).filter((n) => n > 0))];
    const bits = [...mc.map((n) => `more than ${plural(n, "color")}`), ...mp.map((n) => `more than ${plural(n, "print")}`)];
    return bits.length ? [`${bits.join(" or ")} (${s.title.toLowerCase()})`] : [];
  });
  const otherLogos = all.some((i) => i.match?.designs?.length) ? ["any logo other than the ones above"] : [];
  const notList = [...notOn, ...notArt, ...limits, ...otherLogos];
  const groupName = (c: { who: string[] }) => c.who.length ? c.who.join(" · ") : program.name || "Program";

  const print = () => {
    document.body.classList.add("prs-printing");
    const done = () => { document.body.classList.remove("prs-printing"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print();
  };

  return (
    <section className="panel prs">
      <div className="panel-h prs-h">
        <div className="prs-ht"><h2>{fixed ? "Price lines" : "Program pricing"}</h2><span className="faint">{fixed ? plural(cur.items.length, "price") : plural(clients.length, "end client")}</span></div>
        <div className="prs-hr">
          {!fixed && clients.length > 1 && (
            <div className="chips prs-clients" role="tablist" aria-label="End clients">
              {clients.map((c) => <button key={c.key || "-"} type="button" role="tab" aria-selected={c.key === cur.key} className={"chip" + (c.key === cur.key ? " on" : "")} title={groupName(c)} onClick={() => setPick(c.key)}>{c.who[0] || program.name || "Program"}<span className="chip-n">{c.items.length}</span></button>)}
            </div>
          )}
          <Leads program={program} onSave={onSaveProgram} />
          <button type="button" className="btn prs-noprint" onClick={print}>Print rate card</button>
        </div>
      </div>

      <div className="stats prs-deal">
        <div className="stat"><span className="k">Applies to</span><span className="v">{cur.who.length ? cur.who.map((w, k) => <span key={w}>{k > 0 && " · "}<span className="prs-nw">{w}</span></span>) : "Every order on the program"}</span><small>{cur.who.length ? "in the order name" : "no end client words"}</small></div>
        <div className="stat"><span className="k">Garments</span><span className="v">{allSupplied ? "Customer supplied" : noneSupplied ? "We supply" : "Both"}</span><small>{allSupplied ? "print only, no shirt in the price" : noneSupplied ? "the shirt is in the price" : "see each product"}</small></div>
        <div className="stat"><span className="k">Setup</span><span className="v">{setup.v}</span><small>{setup.s}</small></div>
        <div className="stat"><span className="k">Last 6 months</span><span className="v">{st ? <><span className="prs-nw">{plural(st.jobs, "job")}</span> · <span className="prs-nw">{st.pcs.toLocaleString("en-US")} pcs</span></> : "—"}</span><small>{st ? `${money(st.total)} billed` : cur.who.length ? "counting…" : "by end client only"}</small></div>
      </div>

      {sections.map((s) => (
        <div key={s.key} className="prs-sec">
          <div className="prs-sh">
            <div className="prs-st"><h3>{s.title}</h3>{s.sub && <span className="faint">{s.sub}</span>}</div>
            {s.logos.length > 0 && (
              <div className="prs-logos">
                {s.logos.slice(0, 4).map((d) => (
                  <div key={d.id} className="prs-logo" title={d.name}>
                    <span className="prs-logo-t"><LogoThumb d={d} url={urls[d.id] || ""} /></span>
                    <span className="prs-logo-n"><b data-notranslate>D-{d.number}</b><span className="faint">{d.name}</span></span>
                  </div>
                ))}
                {s.logos.length > 4 && <span className="faint prs-more">+{s.logos.length - 4} more</span>}
              </div>
            )}
          </div>
          <div className="tbl-wrap prs-tw">
            <table className="tbl prs-tbl">
              <thead><tr><th>{design ? "Design" : "Product"}</th><th>{design ? "They call it" : "Styles on the PO"}</th><th className="r">Each</th><th>Mockup</th><th className="prs-noprint" aria-label="Edit" /></tr></thead>
              <tbody>
                {s.items.map((it) => {
                  const what = (it.match?.what || []).map((w) => w.trim()).filter(Boolean);
                  const styles = what.filter((w) => /\d/.test(w)).map((w) => ({ w, n: +(styleJobs[w] || 0) })).sort((a, b) => b.n - a.n);
                  const words = what.filter((w) => !/\d/.test(w));
                  const jobs = styles.reduce((a, x) => a + x.n, 0);
                  const tiers = tiersOf(it);
                  const name = (it.garment || "").split(":")[0].trim() || it.name || "Product";
                  const ml = it.mockups || [];
                  return [
                    <tr key={it.id} onClick={() => onEditItem(it.id)}>
                      <td className="prs-prod"><b>{name}</b>{jobs > 0 && <span className="sub">{plural(jobs, "job")}</span>}</td>
                      <td className="prs-sty">
                        {styles.length || words.length ? (
                          <span className="prs-chips">
                            {styles.map((x, k) => <span key={x.w} className={"chip" + (k === 0 && x.n > 0 ? " on" : "")} title={x.n ? plural(x.n, "job") : "no jobs in 6 months"} data-notranslate>{x.w}</span>)}
                            {words.map((w) => <span key={w} className="chip">{w}</span>)}
                          </span>
                        ) : <span className="faint">any style not above</span>}
                      </td>
                      <td className="r prs-each">
                        {tiers.length ? <>{money(tiers[0].price)}{(tiers.length > 1 || tiers[0].min > 0) && <small>{tiers[0].min > 0 ? `${tiers[0].min}+ pcs` : "any qty"}{tiers.length > 1 ? ` · ${plural(tiers.length - 1, "more break")}` : ""}</small>}</> : <span className="faint">no price</span>}
                      </td>
                      <td className="prs-mkc" onClick={(e) => e.stopPropagation()}>
                        <div className="prs-mks">
                          {ml.map((e, k) => {
                            const m = mks.get(+e.n);
                            const cols = (e.colors || []).filter((c) => c.trim() && !/^any$/i.test(c.trim()));
                            return (
                              <div key={k} className={"prs-mk" + (!m || m.archived ? " gone" : "")}>
                                <a className="prs-mk-pic" href={m && !m.archived ? `/shop/customers/${customerId}?area=artwork&mockup=${e.n}` : undefined} title={m?.title || `M-${e.n}`}>{m?.thumb && !m.archived ? <img src={m.thumb} alt="" /> : <span>{m?.archived ? "archived" : "not found"}</span>}</a>
                                <b data-notranslate>M-{e.n}</b>
                                <input key={cols.join(",")} className="prs-mk-col prs-noprint" defaultValue={cols.join(", ")} placeholder="any color" aria-label={`Garment colors for M-${e.n}`} title="The garment colors this mockup is for (blank = any color)"
                                  onBlur={(ev) => { const v = ev.target.value.split(",").map((c) => c.trim()).filter(Boolean); if (v.join(",") !== cols.join(",")) setMockups(it, ml.map((x, j) => (j === k ? { n: x.n, ...(v.length ? { colors: v } : {}) } : x))); }}
                                  onKeyDown={(ev) => { if (ev.key === "Enter") (ev.target as HTMLInputElement).blur(); }} />
                                <span className="prs-mk-col prs-onlyprint">{cols.join(", ") || "any color"}</span>
                                <button type="button" className="prs-mk-x prs-noprint" aria-label={`Take M-${e.n} off ${name}`} title="Take it off this price" onClick={() => setMockups(it, ml.filter((_, j) => j !== k))}>✕</button>
                              </div>
                            );
                          })}
                          <button type="button" className={"prs-mk-add prs-noprint" + (pickFor === it.id ? " on" : "")} aria-expanded={pickFor === it.id} title="Add the mockup this price uses" onClick={() => { setPickFor(pickFor === it.id ? "" : it.id); setPq(""); }}>+<span>{ml.length ? "Another" : "Mockup"}</span></button>
                        </div>
                      </td>
                      <td className="prs-ed prs-noprint"><button type="button" className="btn icon ghost sm" aria-label={`Edit ${name}`} title="Edit" onClick={(e) => { e.stopPropagation(); onEditItem(it.id); }}>✎</button></td>
                    </tr>,
                    pickFor === it.id ? (
                      <tr key={it.id + "-pick"} className="prs-pick prs-noprint"><td colSpan={5}>
                        <div className="prs-pick-h"><b>Which mockup is {name}?</b><input type="search" value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Find by number or name" aria-label="Find a mockup" /><a className="btn sm" href={`/shop/artwork/mockup?customer=${customerId}&logo=1`} target="_blank" rel="noreferrer" title="Make a logo mockup (no garment, no order); it shows here once saved">New logo mockup</a><button type="button" className="linkbtn" onClick={() => setPickFor("")}>Done</button></div>
                        <div className="prs-pick-g">
                          {[...mks.values()].filter((m) => !m.archived && (!pq.trim() || `M-${m.n} ${m.n} ${m.title}`.toLowerCase().includes(pq.trim().toLowerCase()))).slice(0, 36).map((m) => {
                            const on = ml.some((x) => +x.n === m.n);
                            return (
                              <button key={m.n} type="button" className={"prs-pk" + (on ? " on" : "")} disabled={on} title={m.title} onClick={() => setMockups(it, [...ml, { n: m.n }])}>
                                <span className="prs-pk-pic">{m.thumb ? <img src={m.thumb} alt="" /> : null}</span>
                                <b data-notranslate>M-{m.n}</b><span className="faint">{m.title.split(" — ")[0]}</span>
                              </button>
                            );
                          })}
                          {![...mks.values()].some((m) => !m.archived) && <p className="faint">No saved mockups for this customer yet. Save one in the Mockup Creator, then add it here.</p>}
                        </div>
                      </td></tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {extras.length > 0 && (
        <div className="prs-xs">
          {extras.map((x) => <span key={x.id} className="prs-x">{x.name} <b>{money(x.price)}</b><span className="faint">each{x.was != null && x.was !== x.price ? ` (list ${money(x.was)})` : ""}</span></span>)}
        </div>
      )}

      {notList.length > 0 && <div className="prs-not"><b>Not on the program, priced normally:</b> {notList.join(", ")}.</div>}

      <div className="prs-foot prs-noprint">
        <span className="faint">Matching words, prices, logos, extras and portal settings</span>
        <button type="button" className={"btn" + (editing ? " primary" : "")} aria-expanded={editing} onClick={onToggleEdit}>{editing ? "Hide the rules" : "Edit the rules"}</button>
        <button type="button" className="btn" onClick={() => onAdd(cur.who)}>{design ? "+ Design" : "+ Product"}</button>
      </div>
    </section>
  );
}

/** what picks a price on a job: the garment's style (All My Sons) or the design they name (Peticolas) */
function Leads({ program, onSave }: { program: Program; onSave: (p: Partial<Program>) => void }) {
  const design = program.leads === "design";
  return (
    <div className="prs-leads prs-noprint" role="radiogroup" aria-label="What leads">
      <span className="prs-leads-k">What leads</span>
      <span className="chips">
        <button type="button" role="radio" aria-checked={!design} className={"chip" + (!design ? " on" : "")} title="The style on their PO picks the price; its mockup is the art" onClick={() => onSave({ leads: "garment" })}>The garment</button>
        <button type="button" role="radio" aria-checked={design} className={"chip" + (design ? " on" : "")} title="The design they name picks the price; any garment takes its mockup" onClick={() => onSave({ leads: "design" })}>The design</button>
      </span>
    </div>
  );
}
