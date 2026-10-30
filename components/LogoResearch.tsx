"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Design } from "@/lib/pricing";
import { nextSewCode, sewFilesOf, tajimaName, type Brand, type SewFile } from "@/lib/brands";
import { tajimaFile } from "@/components/CustomerBrands";
import { arrange, factLine, factsOf, fmtDay, itemsOf, locsIn, nameOf, Pic, textOf, type Facts, type Item, type Job } from "@/components/artFiles";

/**
 * Find it everywhere (Oct 28, Nick: "now that I've identified a logo… search all the files for embark… we've used this
 * flag X amount of times. Here were the colors… here are DSTs… here's where I found it everywhere. Should I bring these
 * in?… I don't want to bring in the wrong information… we have to add it or ignore it"). Looks through the client's
 * Printavo jobs that name the brand or the logo; for each: its mockup, the DSTs on it (the same file as one on the logo,
 * or a new size), the PMS colors and the spots it went. Every finding is Add or Ignore; nothing is saved until Save.
 */
export type Sew = SewFile & { lastUsed?: { job?: string; date?: string; name?: string; where?: string; dropbox?: string }; source?: string };
export type LogoHistory = { job: string; date?: string; name?: string; where?: string; note?: string };
type D = Design & { brand_id?: string | null };
type Found = { j: Job; list: Item[]; score: number; why: string[]; pms: string[]; locs: string[]; dsts: Item[]; mock?: Item };
type Choice = "add" | "ignore" | undefined;

const PMS = /\b(?:PMS|Pantone)\s*#?\s*(\d{3,4}|Cool Gray \d+|Warm Gray \d+|Black \d?|Reflex Blue|Process Blue|Red 032|Rubine Red)\s*([CU])?\b/gi;
const pmsIn = (t: string) => [...new Set([...t.matchAll(PMS)].map((m) => `PMS ${m[1].replace(/\s+/g, " ")}${m[2] ? ` ${m[2].toUpperCase()}` : " C"}`))];
const sameDst = (a: Facts, b: { stitches: number; wIn: number }) => !!a.stitches && !!b.stitches && Math.abs(a.stitches - b.stitches) / b.stitches <= 0.02 && Math.abs(a.wIn - b.wIn) < 0.06;

export default function LogoResearch({ d, brand, onClose, onDone }: { d: D; brand: Brand | null; onClose: () => void; onDone: (msg: string) => void }) {
  const sb = useMemo(() => createClient(), []);
  const [found, setFound] = useState<Found[] | null>(null);
  const [facts, setFacts] = useState<Record<string, Facts | null>>({});
  const [step, setStep] = useState("Looking through their jobs…");
  const [jobPick, setJobPick] = useState<Record<string, Choice>>({});
  const [dstPick, setDstPick] = useState<Record<string, Choice>>({});
  const [colorPick, setColorPick] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const have = sewFilesOf(d) as Sew[];
  // the words to look for: the brand, and the logo's own name less the brand and generic words ("Embark Flag" → flag)
  const words = useMemo(() => {
    const generic = /^(logo|the|and|front|back|left|right|chest|sleeve|full|new|main|art|file|print|embroidery|vector)$/i;
    const own = d.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !generic.test(w) && !(brand && brand.name.toLowerCase().includes(w)));
    return { brand: (brand?.name || "").split(/\s*\/\s*/)[0].trim(), own };
  }, [d.name, brand]);

  useEffect(() => {
    let on = true;
    (async () => {
      if (!d.customer_id) { setErr("This logo has no customer to look through."); return; }
      // a logo under a brand is looked for in that brand's jobs only: its own words ("flag") are too common across the
      // client's other stores (Oct 28: "flag" pulled in 40 MEI store carts); they rank the brand's jobs instead
      const terms = (words.brand ? [words.brand] : words.own).filter((x) => x && x.length > 2).map((x) => x.replace(/[%,()*]/g, " ").trim());
      let r = sb.from("archived_orders").select("id, visual_id, nickname, order_date, files, search_text").eq("customer_id", d.customer_id).gt("files_total", 0).order("order_date", { ascending: false }).limit(words.brand ? 150 : 80);
      if (terms.length) r = r.or(terms.flatMap((t) => [`nickname.ilike.%${t}%`, `search_text.ilike.%${t}%`]).join(","));
      const { data, error } = await r;
      if (!on) return;
      if (error) { setErr(error.message); return; }
      const jobs = (data || []) as Job[];
      setStep(`Reading ${jobs.length} job${jobs.length === 1 ? "" : "s"}: their DSTs, sewing sheets and mockups…`);
      // every DST and PDF on them read once (size, stitches; a sewing sheet's threads; a mockup's words)
      const fx: Record<string, Facts | null> = {};
      const all = jobs.map((j) => ({ j, list: itemsOf(j) }));
      await Promise.all(all.flatMap(({ list }) => list.filter((i) => i.kind === "sew" || (i.kind === "art" && i.ext === "pdf")).map(async (i) => { fx[i.path] = await factsOf(sb, i.path); })));
      if (!on) return;
      setFacts(fx);
      const out: Found[] = [];
      for (const { j, list: raw } of all) {
        const list = arrange(raw, fx);
        const dsts = list.filter((i) => i.kind === "sew");
        const pdfs = list.filter((i) => (i.kind === "art" || i.kind === "sheet") && /^(pdf|ai)$/.test(i.ext));
        const texts = (await Promise.all(pdfs.slice(0, 4).map((i) => textOf(sb, i.path)))).join(" ");
        const blob = `${j.nickname} ${j.search_text || ""} ${texts}`;
        const why: string[] = [];
        let score = 0;
        const same = dsts.filter((x) => fx[x.path] && have.some((h) => sameDst(fx[x.path]!, h)));
        if (same.length) { score += 5; why.push("the same DST as this logo"); }
        const named = words.own.filter((w) => new RegExp(`\\b${w}`, "i").test(`${blob} ${list.map((i) => i.name).join(" ")}`));
        if (named.length) { score += 3; why.push(`says "${named.join(", ")}"`); }
        if (words.brand && new RegExp(words.brand, "i").test(blob)) { score += 1; if (!why.length) why.push(`a ${words.brand} job`); }
        if (!score) continue;
        const mock = list.find((i) => i.kind === "art" && /^(pdf|ai|png|jpe?g)$/.test(i.ext));
        out.push({ j, list, score, why, pms: pmsIn(blob), locs: locsIn(blob), dsts, mock });
      }
      out.sort((a, b) => b.score - a.score || (b.j.order_date || "").localeCompare(a.j.order_date || ""));
      setFound(out);
      setStep("");
    })().catch((e) => { if (on) setErr(e instanceof Error ? e.message : "Couldn't look through the jobs."); });
    return () => { on = false; };
  }, [sb, d.customer_id, words]); // eslint-disable-line react-hooks/exhaustive-deps

  // the logo's shape (its print size, a sew file on it, or its art): a DST of another shape is likely another logo of
  // the brand (the Embark wordmark next to the Embark flag), so it says so instead of "a size this logo doesn't have"
  const ps = (d.specs as { printSize?: { wIn?: number; hIn?: number } } | null)?.printSize;
  const shape = ps?.wIn && ps?.hIn ? { w: ps.wIn, h: ps.hIn } : have[0]?.wIn && have[0]?.hIn ? { w: have[0].wIn, h: have[0].hIn } : d.width_px && d.height_px ? { w: d.width_px, h: d.height_px } : null;
  const offShape = (f: Facts) => !!shape && !!f.hIn && Math.abs(Math.log((f.wIn / f.hIn) / (shape.w / shape.h))) > 0.15;
  const ratio = (w: number, h: number) => `${(w / h).toFixed(1)} : 1`;
  // the DSTs found, one per file (the same stitches and size across jobs is one file): on the logo already, or new
  const dstGroups = useMemo(() => {
    const g: { key: string; f: Facts; items: Item[]; onLogo?: Sew; jobs: Found[] }[] = [];
    for (const fd of found || []) for (const it of fd.dsts) {
      const f = facts[it.path]; if (!f) continue;
      // a job only of the brand (no logo word, not the same DST) offers its DSTs only when they're this logo's shape:
      // another size of it, most likely
      if (fd.score < 3 && (!shape || offShape(f))) continue;
      const k = g.find((x) => sameDst(f, x.f));
      if (k) { k.items.push(it); if (!k.jobs.includes(fd)) k.jobs.push(fd); } else g.push({ key: it.path, f, items: [it], onLogo: have.find((h) => sameDst(f, h)), jobs: [fd] });
    }
    return g.sort((a, b) => Number(!!b.onLogo) - Number(!!a.onLogo) || Number(offShape(a.f)) - Number(offShape(b.f)) || b.jobs.length - a.jobs.length);
  }, [found, facts]); // eslint-disable-line react-hooks/exhaustive-deps
  const colors = useMemo(() => {
    const m = new Map<string, number>();
    for (const fd of (found || []).filter((x) => x.score >= 3)) for (const p of fd.pms) m.set(p, (m.get(p) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [found]);

  async function file(path: string, name?: string): Promise<File> {
    const { data } = await sb.storage.from("proofs").download(path);
    if (!data) throw new Error(`Couldn't open ${nameOf(path)}`);
    return new File([data], name || nameOf(path), { type: data.type || "application/octet-stream" });
  }
  async function save() {
    setBusy(true); setErr("");
    try {
      const { data: row } = await sb.from("designs").select("specs, inks").eq("id", d.id).maybeSingle();
      const sp = { ...((row?.specs || {}) as Record<string, unknown>) };
      const em = { ...((sp.embroidery || {}) as { files?: Sew[] }) }, files = [...(em.files || [])];
      const done: string[] = [];
      // jobs it ran on: the logo's history, with the spots each one went
      const jobs = (found || []).filter((x) => jobPick[x.j.id] === "add");
      if (jobs.length) {
        const h = [...((sp.history || []) as LogoHistory[])];
        for (const x of jobs) if (!h.some((y) => y.job === x.j.visual_id)) h.push({ job: x.j.visual_id, date: x.j.order_date, name: x.j.nickname.trim(), ...(x.locs.length ? { where: x.locs.join(", ") } : {}) });
        sp.history = h.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        done.push(`${jobs.length} job${jobs.length === 1 ? "" : "s"} added to its history`);
      }
      // DSTs: a new size comes in as the next sew file, with its EMB and sheet; every spot it sewed is kept
      const { takeDigitized } = await import("@/lib/digitizedFiles");
      for (const g of dstGroups.filter((x) => dstPick[x.key] === "add")) {
        const where = [...new Set(g.jobs.flatMap((x) => x.locs))].join(", ");
        const newest = [...g.jobs].sort((a, b) => (b.j.order_date || "").localeCompare(a.j.order_date || ""))[0];
        if (g.onLogo) {
          const i = files.findIndex((f) => sameDst(g.f, f));
          if (i >= 0) files[i] = { ...files[i], placement: [...new Set([...(files[i].placement || "").split(/\s*,\s*/).filter(Boolean), ...where.split(/\s*,\s*/).filter(Boolean)])].join(", ") || files[i].placement, lastUsed: (files[i].lastUsed?.date || "") > (newest.j.order_date || "") ? files[i].lastUsed : { job: newest.j.visual_id, date: newest.j.order_date, name: newest.j.nickname.trim(), where } };
          done.push(`${tajimaName(d.number, Number((files[i]?.code || "E1").slice(1)) || 1)}: where it goes and last used updated`);
          continue;
        }
        const it = g.items[0];
        const code = nextSewCode(files), name = tajimaName(d.number, Number(code.slice(1)));
        const named = await Promise.all([it.path, it.emb, it.sheet].filter(Boolean).map(async (p) => tajimaFile(await file(p!), name)));
        const { set } = await takeDigitized(sb, d.id, named, { link: false });
        files.push({ ...set, code, kind: /hat|cap/i.test(where) ? "cap" : "flat", source: it.path, ...(where ? { placement: where } : {}), lastUsed: { job: newest.j.visual_id, date: newest.j.order_date, name: newest.j.nickname.trim(), where } } as Sew);
        done.push(`${name} added (${g.f.wIn}" × ${g.f.hIn}")`);
      }
      if (files.length) sp.embroidery = { ...em, files };
      // colors: the logo's inks
      const inks = colors.map(([c]) => c).filter((c) => colorPick[c] === "add");
      const patch: Record<string, unknown> = { specs: sp };
      if (inks.length) { patch.inks = [...new Set([...(row?.inks || "").split(/\s*,\s*/).filter(Boolean), ...inks])].join(", "); done.push(`inks: ${inks.join(", ")}`); }
      const { error } = await sb.from("designs").update(patch).eq("id", d.id);
      if (error) throw new Error(error.message);
      onDone(done.length ? `Saved: ${done.join("; ")}` : "Nothing added");
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save."); setBusy(false); }
  }

  const AddIgnore = ({ v, set }: { v: Choice; set: (c: Choice) => void }) => (
    <span className="lr-ai" role="group" aria-label="Add or ignore">
      <button type="button" className={v === "add" ? "on add" : ""} onClick={() => set(v === "add" ? undefined : "add")}>Add</button>
      <button type="button" className={v === "ignore" ? "on" : ""} onClick={() => set(v === "ignore" ? undefined : "ignore")}>Ignore</button>
    </span>
  );
  const strong = (found || []).filter((x) => x.score >= 3), weak = (found || []).filter((x) => x.score < 3);
  const nAdd = Object.values(jobPick).filter((v) => v === "add").length + Object.values(dstPick).filter((v) => v === "add").length + Object.values(colorPick).filter((v) => v === "add").length;
  const jobRow = (x: Found) => (
    <div key={x.j.id} className={"lr-job" + (jobPick[x.j.id] === "ignore" ? " off" : "")}>
      {x.mock ? <Pic sb={sb} path={x.mock.path} /> : <span className="bi-pic"><span className="bi-ext">{x.dsts.length ? "DST" : "—"}</span></span>}
      <div className="lr-jb">
        <b><span className="ordno">#{x.j.visual_id}</span> {x.j.nickname}</b>
        <span className="faint">{fmtDay(x.j.order_date)} · {x.why.join(" · ")}</span>
        {(x.locs.length > 0 || x.pms.length > 0) && <span className="lr-tags">{x.locs.map((l) => <span key={l} className="lr-tag">{l}</span>)}{x.pms.map((p) => <span key={p} className="lr-tag c">{p}</span>)}</span>}
      </div>
      <AddIgnore v={jobPick[x.j.id]} set={(c) => setJobPick((m) => ({ ...m, [x.j.id]: c }))} />
    </div>
  );

  return (
    <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Find it everywhere" onClick={onClose}>
      <div className="dla lr" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="dla-x" aria-label="Close" onClick={onClose}>×</button>
        <h3>Find it everywhere · D-{d.number} {d.name}</h3>
        <p className="dla-sub">Their jobs that name {[words.brand, ...words.own].filter(Boolean).join(" or ") || "it"}. Add what&apos;s right, ignore what isn&apos;t: nothing is saved until you press Save.</p>
        {err && <p className="warnline">{err}</p>}
        {!found ? <div className="aa-empty">{step || "Looking…"}</div> : !found.length ? <div className="aa-empty">No jobs found for it.</div> : (
          <div className="lr-body">
            {dstGroups.length > 0 && <section>
              <h4>Sew files found</h4>
              {dstGroups.map((g) => (
                <div key={g.key} className="lr-row">
                  <span className="bi-pic sm"><span className="bi-ext">DST</span></span>
                  <div className="lr-jb"><b>{factLine(g.f)}</b>
                    <span className="faint">{g.onLogo ? `On this logo already (${tajimaName(d.number, Number((g.onLogo.code || "E1").slice(1)) || 1)})` : offShape(g.f) ? <b className="lr-warn">A different shape from this logo ({ratio(g.f.wIn, g.f.hIn)} vs {ratio(shape!.w, shape!.h)}): may be another logo</b> : "A size this logo doesn't have yet"} · used on {g.jobs.map((x) => `#${x.j.visual_id}`).join(", ")}</span>
                    {[...new Set(g.jobs.flatMap((x) => x.locs))].length > 0 && <span className="lr-tags">{[...new Set(g.jobs.flatMap((x) => x.locs))].map((l) => <span key={l} className="lr-tag">{l}</span>)}</span>}
                  </div>
                  <AddIgnore v={dstPick[g.key]} set={(c) => setDstPick((m) => ({ ...m, [g.key]: c }))} />
                </div>
              ))}
            </section>}
            {colors.length > 0 && <section>
              <h4>Colors found</h4>
              {colors.map(([c, n]) => (
                <div key={c} className="lr-row"><span className="lr-tag c">{c}</span><span className="faint">on {n} job{n === 1 ? "" : "s"}</span><span className="spacer" /><AddIgnore v={colorPick[c]} set={(v) => setColorPick((m) => ({ ...m, [c]: v }))} /></div>
              ))}
            </section>}
            {strong.length > 0 && <section><h4>Jobs it looks like it ran on ({strong.length})</h4>{strong.map(jobRow)}</section>}
            {weak.length > 0 && <section><h4>Other {words.brand || "of their"} jobs ({weak.length}) <span className="faint">check the mockup</span></h4>{weak.map(jobRow)}</section>}
          </div>
        )}
        <div className="dla-acts">
          <span className="faint">{nAdd ? `${nAdd} to add` : "Nothing picked yet"}</span>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={!nAdd || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
