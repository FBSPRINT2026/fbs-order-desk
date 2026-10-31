"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import ProgramPricingCard from "@/components/ProgramPricingCard";
import LogoThumb from "@/components/LogoThumb";
import { TrainingChat } from "@/components/OrderTrainingAdmin";
import { previewUrls, uploadDesign } from "@/lib/designs";
import { trainingWords, type Training } from "@/lib/orderTrainings";
import type { Design } from "@/lib/pricing";
import type { Program, ProgramItem } from "@/lib/programs";

/**
 * The customer's Programs tab (Oct 30, Nick: "click on an account and say program, click new program, just talk. And
 * then upload art… a training could be just, you know, create one order and then show… this is exactly how it should go
 * in every time"). One program per end client (Nine18: All My Sons, Armstrong, AOC, Junk.com): its price lines with the
 * mockup that IS each one, its rules in words, its art and the orders it learned from, with Claude's chat beside it to
 * talk it into shape or to point at an order ("this is how it goes every time"). A program is a training
 * (order_trainings: name, the words that pick it from a job, its rules) and the program prices for the same end client
 * (program_items.match.who). Older settings sit under More settings (ProgramAdmin).
 */
type Ex = { id: string; order_id: string; title: string; confirmed_by: string; confirmed_at: string; active: boolean };
type Prog = { key: string; name: string; words: string[]; training: Training | null; items: ProgramItem[] };
const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const post = async (body: Record<string, unknown>) => {
  const r = await fetch("/api/ai/training", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json().catch(() => ({ ok: false }))) as { ok: boolean; id?: string; error?: string };
};
const initials = (n: string) => (n.match(/\b[A-Za-z0-9]/g) || []).slice(0, 3).join("").toUpperCase() || "P";

export default function ProgramsTab({ customerId, program, items, ver, editing, onToggleEdit, onEditItem, onAdd, onSaveItem, onSaveProgram, onReload }: {
  customerId: string; program: Program | null; items: ProgramItem[]; ver: number; /** the program and its prices changed (the chat applied) */ onReload: () => void;
  editing: boolean; onToggleEdit: () => void; onEditItem: (id: string) => void; onAdd: (who: string[]) => void;
  onSaveItem: (id: string, patch: Partial<ProgramItem>) => void; onSaveProgram: (patch: Partial<Program>) => void;
}) {
  const sb = useMemo(() => createClient(), []);
  const [trainings, setTrainings] = useState<Training[] | null>(null);
  const [company, setCompany] = useState("");
  const [pick, setPick] = useSticky<string>(`programs.pick.${customerId}`, "");
  const [adding, setAdding] = useState<"" | "name" | "busy">("");
  const [newName, setNewName] = useState("");
  const [teach, setTeach] = useState<string>("");
  const [auto, setAuto] = useState("");
  const load = useCallback(async () => {
    const [{ data: ts }, { data: c }] = await Promise.all([
      sb.from("order_trainings").select("id, customer_id, name, when_words, rules, updated_at, updated_by").eq("customer_id", customerId).is("archived_at", null).order("created_at"),
      sb.from("customers").select("company, name").eq("id", customerId).maybeSingle(),
    ]);
    setTrainings((ts || []) as Training[]);
    setCompany(String(c?.company || c?.name || "Customer"));
  }, [sb, customerId]);
  useEffect(() => { void load(); }, [load, ver]);

  // the programs: every training, and the price lines' end clients no training covers yet
  const progs: Prog[] = useMemo(() => {
    const live = items.filter((i) => i.active && !i.archived_at);
    const out: Prog[] = (trainings || []).map((t) => {
      const ws = trainingWords(t.when_words).map(norm);
      return { key: norm(t.name) || t.id, name: t.name || "Untitled program", words: trainingWords(t.when_words), training: t, items: live.filter((it) => { const who = (it.match?.who || []).map(norm); return ws.length ? who.some((w) => ws.includes(w)) : !who.length; }) };
    });
    for (const it of live) {
      if (out.some((p) => p.items.includes(it))) continue;
      const who = it.match?.who || [];
      const k = norm(who[0] || program?.name || "Program");
      const p = out.find((x) => x.key === k);
      if (p) { p.items.push(it); continue; }
      out.push({ key: k, name: who[0] || program?.name || "Program", words: who, training: null, items: [it] });
    }
    return out;
  }, [trainings, items, program?.name]);
  const cur = progs.find((p) => p.key === pick) || progs[0] || null;

  const start = async () => {
    const name = newName.trim();
    if (!name) return;
    setAdding("busy");
    const r = await post({ action: "create", customerId, name, when: name });
    setAdding("");
    if (!r.ok) return;
    setNewName(""); await load(); setPick(norm(name)); setTeach(norm(name));
  };
  /** a program with prices only: its training is made the first time someone talks to it */
  const ensure = async () => {
    if (!cur) return null;
    if (cur.training) return cur.training.id;
    const r = await post({ action: "create", customerId, name: cur.name, when: cur.words.join(", ") || cur.name });
    if (r.ok) await load();
    return r.ok ? r.id || null : null;
  };

  if (trainings === null) return <div className="gb-empty">Loading…</div>;
  return (
    <div className="pgs">
      <div className="pgs-list" role="tablist" aria-label="Programs">
        {progs.map((p) => (
          <button key={p.key} type="button" role="tab" aria-selected={cur?.key === p.key} className={"pgs-p" + (cur?.key === p.key ? " on" : "")} onClick={() => { setPick(p.key); setAdding(""); }}>
            <span className="pgs-i" aria-hidden="true">{initials(p.name)}</span>
            <span className="pgs-t"><b>{p.name}</b><small>{p.items.length ? `${p.items.length} price${p.items.length === 1 ? "" : "s"}` : "no prices yet"}{p.training?.rules.trim() ? " · rules" : ""}</small></span>
          </button>
        ))}
        {adding ? (
          <div className="pgs-new">
            <input type="text" autoFocus value={newName} placeholder="Who is it for? e.g. Armstrong" aria-label="New program name" onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void start(); if (e.key === "Escape") setAdding(""); }} />
            <button type="button" className="btn primary" disabled={!newName.trim() || adding === "busy"} onClick={() => void start()}>{adding === "busy" ? "Starting…" : "Start"}</button>
            <button type="button" className="linkbtn" onClick={() => setAdding("")}>Cancel</button>
          </div>
        ) : <button type="button" className="pgs-p pgs-add" onClick={() => setAdding("name")}>+ New program</button>}
      </div>

      {!cur ? (
        <section className="panel"><div className="panel-b"><p className="faint">No programs yet. Click <b>+ New program</b>, name it for who it&apos;s for, then show Claude one order or tell it how their orders go.</p></div></section>
      ) : (
        <div className="pgs-cols">
          <div className="pgs-main">
            {teach === cur.key && <TeachCard name={cur.name} customerId={customerId} onPick={(msg) => { setTeach(""); setAuto(msg); }} onClose={() => setTeach("")} />}
            <div className="pgs-head">
              <h2>{cur.name}</h2>
              <span className="faint">{cur.words.length ? <>Used when the job says {cur.words.map((w, i) => <span key={w}>{i ? " or " : ""}<b>{w}</b></span>)}</> : "Used on every job of theirs"} · {program?.leads === "design" ? "the design picks the price" : "the garment picks the price"}</span>
              <span className="spacer" />
              {teach !== cur.key && <button type="button" className="btn" onClick={() => setTeach(cur.key)}>Teach it an order</button>}
            </div>
            {program ? <ProgramPricingCard customerId={customerId} program={program} items={items} ver={ver} editing={editing} fixedWho={cur.words}
              onToggleEdit={onToggleEdit} onEditItem={onEditItem} onAdd={onAdd} onSaveItem={onSaveItem} onSaveProgram={onSaveProgram} />
              : <section className="panel"><div className="panel-b"><p className="faint">No price lines yet. Tell Claude their prices, or show it an order, and it adds them.</p></div></section>}
            <RulesPanel key={cur.training?.id || cur.key} training={cur.training} onSaved={load} />
            <ArtPanel customerId={customerId} words={cur.words} items={cur.items} />
            <LearnedPanel customerId={customerId} words={[cur.name, ...cur.words]} />
          </div>
          <TrainingChat key={cur.key} trainingId={cur.training?.id || ""} customerId={customerId} customerName={`${company} · ${cur.name}`} ensure={ensure}
            base={{ training: cur.training?.rules || "", name: cur.training?.name || cur.name, when: cur.training?.when_words || cur.words.join(", ") }}
            autoSend={auto} onAutoSent={() => setAuto("")}
            onApplied={() => { void load(); onReload(); }} />
        </div>
      )}
    </div>
  );
}

/** + New program → how do you want to teach it? (Oct 30, Nick: "create one order and then show… point to email, point
 *  to ClickUp… make order… or you could just start out by talking") */
function TeachCard({ name, customerId, onPick, onClose }: { name: string; customerId: string; onPick: (msg: string) => void; onClose: () => void }) {
  const [no, setNo] = useState("");
  const n = no.replace(/\D/g, "");
  return (
    <section className="panel pgs-teach">
      <div className="panel-h"><h2>Teach {name}</h2><span className="faint">two ways; either way every change shows marked before Apply</span><span className="spacer" /><button type="button" className="linkbtn" onClick={onClose}>Close</button></div>
      <div className="panel-b pgs-teach-b">
        <div className="pgs-way on">
          <b>Show it one order (easiest)</b>
          <span className="faint">An order you already made just right for them. Claude writes the program from it: the price lines with each group&apos;s mockup, the rules (job name, groups, logos, personalization, shipping), and keeps it as the first example.</span>
          <div className="row"><input type="text" inputMode="numeric" value={no} placeholder="Order #, e.g. 40284" aria-label="Order number" onChange={(e) => setNo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && n) onPick(`Look at #${n}. This is how ${name} orders go every time: write this program from it (the rules and the price lines with each group's mockup) and keep it as an example.`); }} />
            <button type="button" className="btn primary" disabled={n.length < 4} onClick={() => onPick(`Look at #${n}. This is how ${name} orders go every time: write this program from it (the rules and the price lines with each group's mockup) and keep it as an example.`)}>Learn from it</button></div>
          <span className="faint">No order yet? Make one from their ClickUp job or email with <Link href="/shop/clickup">Create order</Link>, fix it until it&apos;s right, then come back with its number.</span>
        </div>
        <div className="pgs-way">
          <b>Talk to it</b>
          <span className="faint">Tell the chat on the right how {name}&apos;s orders go, or tap + to drop their PO, price list, old invoices or logos.</span>
          <button type="button" className="btn" onClick={() => onPick(`This is a new program for ${name}. Ask me what you need to know to make their orders, one question at a time.`)}>Start talking</button>
        </div>
      </div>
      <input type="hidden" value={customerId} readOnly />
    </section>
  );
}

/** the rules as short cards, one per section of the training ("JOB:", "SHIPPING:"…), with Edit for the full text */
function RulesPanel({ training, onSaved }: { training: Training | null; onSaved: () => void }) {
  const sb = useMemo(() => createClient(), []);
  const [edit, setEdit] = useState(false);
  const [t, setT] = useState(training?.rules || "");
  const [state, setState] = useState("");
  useEffect(() => { setT(training?.rules || ""); }, [training?.rules]);
  const cards = useMemo(() => (training?.rules || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = p.match(/^([A-Z0-9][A-Z0-9 &/'’().,-]{1,48}?)(?::|\s*\(|\n)\s*([\s\S]*)$/);
    return m && m[1] === m[1].toUpperCase() && /[A-Z]{3}/.test(m[1]) ? { h: m[1].replace(/[,(]+$/, "").trim(), b: m[2].trim() } : { h: "", b: p };
  }), [training?.rules]);
  const save = async () => {
    if (!training) return;
    setState("Saving…");
    const { error } = await sb.from("order_trainings").update({ rules: t.trim(), updated_at: new Date().toISOString() }).eq("id", training.id);
    setState(error ? "Couldn't save: " + error.message : "Saved");
    if (!error) { setEdit(false); onSaved(); }
  };
  return (
    <section className="panel">
      <div className="panel-h"><h2>Rules in words</h2><span className="faint">what Create order follows on these jobs; change them by talking to Claude, or Edit</span><span className="spacer" />{training && <button type="button" className="btn" onClick={() => setEdit((x) => !x)}>{edit ? "Done" : "Edit"}</button>}</div>
      <div className="panel-b">
        {!training || !training.rules.trim() ? <p className="faint">No rules yet. Show Claude one of their orders or tell it how their orders go.</p>
          : edit ? (
            <div className="stack">
              <textarea className="pgs-rules-ed" rows={16} value={t} onChange={(e) => setT(e.target.value)} aria-label="The rules" />
              <div className="row"><button type="button" className="btn primary" disabled={t === training.rules} onClick={() => void save()}>Save</button><span className="faint">{state}</span></div>
            </div>
          ) : (
            <div className="pgs-rules">{cards.map((c, i) => <div key={i} className="pgs-rule">{c.h && <b>{c.h}</b>}<span>{c.b}</span></div>)}</div>
          )}
      </div>
    </section>
  );
}

/** their logos for this program (the brand named like it, else the logos its mockups use), and drop new ones in */
function ArtPanel({ customerId, words, items }: { customerId: string; words: string[]; items: ProgramItem[] }) {
  const sb = useMemo(() => createClient(), []);
  const [ds, setDs] = useState<Design[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [brandId, setBrandId] = useState<string | null>(null);
  const load = useCallback(async () => {
    const ws = words.map(norm);
    const { data: bs } = await sb.from("brands").select("id, name").eq("customer_id", customerId).is("archived_at", null);
    const b = ((bs || []) as { id: string; name: string }[]).find((x) => ws.includes(norm(x.name)) || ws.some((w) => norm(x.name).includes(w) && w.length > 3));
    setBrandId(b?.id || null);
    const nums = [...new Set(items.flatMap((it) => (it.mockups || []).map((m) => +m.n)))];
    const { data: mk } = nums.length ? await sb.from("mockups").select("design_ids").eq("customer_id", customerId).in("number", nums).is("archived_at", null) : { data: [] };
    const ids = [...new Set(((mk || []) as { design_ids: string[] | null }[]).flatMap((m) => m.design_ids || []))];
    const q = sb.from("designs").select("*").eq("customer_id", customerId).is("archived_at", null).eq("draft", false).order("number");
    const { data } = b ? await q.or(`brand_id.eq.${b.id}${ids.length ? `,id.in.(${ids.join(",")})` : ""}`) : ids.length ? await q.in("id", ids) : { data: [] };
    const list = (data || []) as Design[];
    setDs(list);
    if (list.length) setUrls(await previewUrls(sb, list));
  }, [sb, customerId, words.join("|"), items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  const upload = async (files: File[]) => {
    const { data: u } = await sb.auth.getUser();
    for (const [i, f] of files.entries()) {
      setBusy(`Adding ${i + 1} of ${files.length}…`);
      try {
        const d = await uploadDesign(sb, { file: f, customer_id: customerId, name: f.name.replace(/\.[^.]+$/, ""), by: u.user?.email || "", saved: true });
        if (brandId) await sb.from("designs").update({ brand_id: brandId }).eq("id", d.id);
      } catch (e) { setBusy(`${f.name}: ${e instanceof Error ? e.message : "couldn't add it"}`); return; }
    }
    setBusy(""); await load();
  };
  return (
    <section className="panel">
      <div className="panel-h"><h2>Their art</h2><span className="faint">the logos this program uses; drop new ones in{brandId ? " (filed under its brand)" : ""}</span><span className="spacer" /><Link className="linkbtn" href={`/shop/customers/${customerId}?area=artwork`}>All their artwork</Link></div>
      <div className="panel-b">
        <div className="pgs-art" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = [...e.dataTransfer.files]; if (f.length) void upload(f); }}>
          {(ds || []).map((d) => (
            <Link key={d.id} href={`/shop/artwork/${d.id}`} className="pgs-logo" title={d.name}>
              <span className="pgs-logo-t"><LogoThumb d={d} url={urls[d.id] || ""} /></span>
              <b data-notranslate>D-{d.number}</b><span className="faint">{d.name}</span>
            </Link>
          ))}
          <label className="pgs-drop">{busy || <>Drop logos here<br />or click to add</>}<input type="file" hidden multiple accept=".ai,.eps,.pdf,.svg,.png,.jpg,.jpeg" onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; if (f.length) void upload(f); }} /></label>
        </div>
      </div>
    </section>
  );
}

/** the orders this program learned from (worked examples whose title says its words) */
function LearnedPanel({ customerId, words }: { customerId: string; words: string[] }) {
  const [ex, setEx] = useState<Ex[] | null>(null);
  useEffect(() => { fetch(`/api/ai/examples?customerId=${customerId}`).then((r) => r.json()).then((j) => setEx(j.examples || [])).catch(() => setEx([])); }, [customerId]);
  const ws = words.map(norm).filter((w) => w.length > 1);
  const mine = (ex || []).filter((e) => ws.some((w) => ` ${norm(e.title)} `.includes(` ${w} `)));
  return (
    <section className="panel">
      <div className="panel-h"><h2>Learned from</h2><span className="faint">orders marked right; the closest two are read with each new job</span></div>
      <div className="panel-b">
        {ex === null ? <p className="faint">Loading…</p> : !mine.length ? <p className="faint">None yet: the next order of theirs marked right (or one you show Claude) is the first.</p> : (
          <div className="pgs-ex">{mine.map((e) => <span key={e.id} className={e.active ? "" : "off"}><Link href={`/shop/orders/${e.order_id}`}><b>{e.title}</b></Link><span className="faint"> · {new Date(e.confirmed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {e.confirmed_by.split("@")[0]}{e.active ? "" : " · not used"}</span></span>)}</div>
        )}
      </div>
    </section>
  );
}
