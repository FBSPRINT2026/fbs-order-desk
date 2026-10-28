"use client";
import LogoThumb from "@/components/LogoThumb";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { digitizeState } from "@/lib/digitizeStatus";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import { useCan, useRole } from "@/components/RoleContext";
import { previewUrls } from "@/lib/designs";
import { designLabel, type Design, type Group, type Imprint } from "@/lib/pricing";
import { readDst, type DstInfo } from "@/lib/dst";
import DstPreview from "@/components/DstPreview";
import { guessHex } from "@/lib/mockup";
import { takeDigitized, type DigitizedSet } from "@/lib/digitizedFiles";
import SewSequence, { sheetHex } from "@/components/SewSequence";
import { lineName, threadByName } from "@/lib/embroidery";
import { tajimaName } from "@/lib/brands";
import SewoutCapture from "@/components/SewoutCapture";
import { SEWOUT_EMAILS } from "@/lib/customerContact";
import { approveSewoutAnother, remindSewoutAction } from "@/app/shop/sewout-actions";
import DigitizerTool from "@/components/tools/DigitizerTool";
import { DIGITIZER } from "@/lib/digitizer";

/**
 * Digitizing (Oct 23, Nick: "instead of separations, under embroidery… it'll say digitizing… once you create an order
 * from a new artwork, you will email the digitizing company and request the file at the size and give them the details,
 * what kind of garment it goes on… they'll give you back an embroidery file and a DST… eventually I'd like to see if you
 * can do a basic digitizing"). Every embroidered logo on an open order:
 *   - Needs digitizing → the request written out for the digitizer (size, garment and fabric, placement, threads,
 *     effects, the files we want back), copied or opened in your mail: nothing is sent by itself
 *   - Requested → waiting on the file; Digitized → its DST is on file (stitches, colors, size read from it), for this
 *     order and every reorder of the logo
 * A DST dropped here is read (lib/dst.ts) and kept on the logo (designs.specs.embroidery.files).
 * Then the sew-out (Oct 24, Nick: "we do a sew out… take a picture… automatically send an email for approval"): the photo
 * of the sewn sample, cropped, saved and emailed to the customer to approve (components/SewoutCapture.tsx, lib/sewouts.ts)
 *   - Sew-out sent → waiting on the customer; Approved → on file with the logo for every reorder
 */
type O = { id: string; number: number; nickname: string | null; status: string; due_date: string | null; groups: Group[] | null; customers?: { company?: string; name?: string } | null };
type EmbFile = DigitizedSet;
type EmbSpecs = { files?: EmbFile[]; request?: { at: string; by: string; size: string; via?: string; /** sent back for these changes (app/api/digitizer/changes) */ changes?: string } | null;
  /** the digitizer's answer, caught by the mail check (lib/mail/process.ts digitizerReply): its files are added on their
   *  own (lib/digitizerAuto.ts); `add_error` when they couldn't be (then Add their files does it by hand) */
  reply?: { at: string; from: string; subject: string; files: { name: string; path: string; type: string; size: number }[]; added_at?: string; add_error?: string } | null };
type Item = { key: string; o: O; g: Group; im: Imprint; d: Design | null };
type Filter = "need" | "asked" | "done" | "sent" | "ok" | "all";
type State = Exclude<Filter, "all">;
type Sw = { id: string; order_id: string; imprint_id: string; version: number; photo_path: string; status: "pending" | "approved" | "changes"; sent_at: string | null; sent_to: string | null; viewed_at: string | null; view_count: number; decided_at: string | null; decided_name: string | null; customer_comment: string; archived_at: string | null; created_at: string };
const embOf = (d: Design | null): EmbSpecs => ((d?.specs as { embroidery?: EmbSpecs } | null)?.embroidery) || {};

export default function Digitizing() {
  const canEdit = useCan("digitizing");
  const { email } = useRole();
  const [orders, setOrders] = useState<O[] | null>(null);
  const [designs, setDesigns] = useState<Record<string, Design>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [filter, setFilter] = useSticky<Filter>("digitizing.filter", "need");
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState(""), [busy, setBusy] = useState("");
  // our digitizer (Oct 23, Nick): Volikes Creative, volikescreative.com
  // the Digitizer open for one print (components/tools/DigitizerTool.tsx)
  const [tool, setTool] = useState<{ orderId: string; imprintId: string } | null>(null);
  const [sws, setSws] = useState<Sw[]>([]), [swUrls, setSwUrls] = useState<Record<string, string>>({}), [msg, setMsg] = useState("");

  async function load() {
    const sb = createClient();
    const { data, error } = await sb.from("orders").select("id, number, nickname, status, due_date, groups, customers(company, name)").not("status", "in", "(completed,request)").order("number", { ascending: false }).limit(400);
    if (error) { setErr(error.message); return; }
    const os = ((data || []) as unknown as O[]).filter((o) => (o.groups || []).some((g) => (g.imprints || []).some((im) => im.method === "embroidery")));
    const ids = [...new Set(os.flatMap((o) => (o.groups || []).flatMap((g) => (g.imprints || []).filter((im) => im.method === "embroidery" && im.design_id).map((im) => im.design_id!))))];
    const { data: ds } = ids.length ? await sb.from("designs").select("*").in("id", ids) : { data: [] };
    const map = Object.fromEntries(((ds || []) as Design[]).map((d) => [d.id, d]));
    // the sew-outs on these orders, newest first, with their photos (read before the list shows, so each print's state is right)
    const { data: sw } = os.length ? await sb.from("sewouts").select("*").in("order_id", os.map((o) => o.id)).order("version", { ascending: false }) : { data: [] };
    const list = (sw || []) as Sw[];
    setSws(list); setDesigns(map); setOrders(os);
    if (list.length) { const { data: su } = await sb.storage.from("proofs").createSignedUrls(list.map((x) => x.photo_path), 3600); setSwUrls(Object.fromEntries(list.map((x, i) => [x.id, su?.[i]?.signedUrl || ""]))); }
    void previewUrls(sb, Object.values(map)).then(setUrls).catch(() => null);
  }
  useEffect(() => { void load(); }, []);

  const items: Item[] = useMemo(() => (orders || []).flatMap((o) => (o.groups || []).flatMap((g) => (g.imprints || []).filter((im) => im.method === "embroidery").map((im) => ({ key: `${o.id}:${im.id}`, o, g, im, d: im.design_id ? designs[im.design_id] || null : null })))), [orders, designs]);
  const swOf = (it: Item) => sws.filter((x) => x.order_id === it.o.id && x.imprint_id === it.im.id);
  // the one answer for where a print is (lib/digitizeStatus.ts): the order's print stamps use the same
  const stateOf = (it: Item): State => digitizeState(it.im, it.d, swOf(it).find((x) => !x.archived_at)).state;
  // opened from an order's print stamp (?open=<order>:<print>): that print's tab, opened and scrolled to
  const openParam = useRef(typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("open") || "" : "");
  useEffect(() => {
    const k = openParam.current; if (!k || !orders) return;
    const it = items.find((x) => x.key === k); if (!it) return;
    openParam.current = "";
    setFilter(stateOf(it)); setOpen(k);
    setTimeout(() => document.querySelector(`[data-dgz="${CSS.escape(k)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 150);
  }, [orders, items, sws]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = items.filter((it) => filter === "all" || stateOf(it) === filter);
  const count = (f: Filter) => items.filter((it) => f === "all" || stateOf(it) === f).length;

  /** what the digitizer needs, written out */
  /** what the digitizer needs, written out: Volikes Creative asks for the final size, placement, fabric and colors,
   *  the machine format, what it's for, the due date and the quantity (volikescreative.com) */
  const requestText = (it: Item) => {
    const l = (it.g.lines || [])[0], im = it.im, emb = im.emb || {};
    const threadsTxt = (im.inks || "").split(/\s*,\s*/).filter(Boolean).map((n) => { const t = threadByName(n); return t ? `${t.code} ${t.name}${t.pms.length ? ` (PMS ${t.pms[0].replace(/^PMS\s*/i, "")})` : ""}` : n; });
    const colors = [...new Set((it.g.lines || []).map((x) => x.color).filter(Boolean))];
    const pcs = (it.g.lines || []).reduce((a, x) => a + Object.values(x.sizes || {}).reduce((b, v) => b + (+(v || 0)), 0), 0);
    const due = it.o.due_date ? new Date(it.o.due_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";
    return [
      `Digitizing request: ${it.d ? designLabel(it.d) : "logo"} for ${it.o.customers?.company || it.o.customers?.name || "customer"} (FBS order #${it.o.number}${it.o.nickname ? `, ${it.o.nickname}` : ""})`,
      "",
      `Final size: ${im.size || "see art"}${im.stitches && im.emb?.stitchesFrom !== "file" ? ` (we estimate about ${im.stitches.toLocaleString()} stitches)` : ""}`,
      `Placement: ${im.location}${im.drop ? `, ${im.drop}" below the collar` : ""}`,
      `Garment and fabric: ${[l?.brand, l?.style, l?.garment].filter(Boolean).join(" ") || "see order"}${colors.length ? `, ${colors.join(" / ")}` : ""}`,
      `Backing: ${emb.backing || "cutaway"}${emb.topping && emb.topping !== "None" ? `, with ${emb.topping}` : ""}`,
      `Thread colors: ${lineName(emb.line || "Polyneon 40")}${threadsTxt.length ? `: ${threadsTxt.join(", ")}` : ""}`,
      emb.puff ? `Effects: ${emb.puffNote && !/all of it/.test(emb.puffNote) ? emb.puffNote : "3D puff, all of it"} (please digitize for 3 mm foam)${emb.puffWarn ? `. Size check: ${emb.puffWarn}` : ""}` : emb.metallic ? "Effects: metallic thread" : "",
      "Machine format: Tajima DST to sew, plus the Wilcom EMB (we edit in Hatch) and the production worksheet PDF (stitch count, size, color stops).",
      `Quantity: ${pcs ? `${pcs} pieces` : "see order"}${due ? ` · needed by ${due}` : ""}`,
      "",
      "Art is attached.",
    ].filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");
  };

  const [checking, setChecking] = useState(false);
  async function checkNow() {
    setChecking(true); setMsg("");
    try {
      const r = await fetch("/api/digitizer/check", { method: "POST", cache: "no-store" });
      const j = await r.json().catch(() => ({})) as { added?: number };
      const n = j.added;
      setMsg(typeof n === "number" ? (n ? `Added the digitizer's files on ${n} logo${n === 1 ? "" : "s"}.` : "Checked: nothing new from the digitizer.") : r.ok ? "Checked the mail." : "Couldn't check the mail right now.");
    } catch { setMsg("Couldn't check the mail right now."); }
    setChecking(false);
    void load();
  }
  async function markAsked(it: Item) {
    if (!it.d) return;
    setBusy(it.key);
    const sb = createClient();
    const sp = (it.d.specs || {}) as Record<string, unknown>;
    const { error } = await sb.from("designs").update({ specs: { ...sp, embroidery: { ...embOf(it.d), request: { at: new Date().toISOString(), by: email || "", size: it.im.size || "" } } } }).eq("id", it.d.id);
    setBusy("");
    if (error) setErr(error.message); else void load();
  }
  // what the digitizer sends back: the zip, or the DST (to sew), EMB (to edit in Hatch) and PDF worksheet
  async function takeFiles(it: Item, list: File[]) {
    if (!it.d) return;
    setBusy(it.key); setErr("");
    try {
      const sb = createClient();
      const { set, info } = await takeDigitized(sb, it.d.id, list);
      if (!set.path) throw new Error("Couldn't save the DST.");
      // the order's print takes the file's stitch count (its price follows)
      const groups = (it.o.groups || []).map((g) => ({ ...g, imprints: (g.imprints || []).map((im) => (im.id === it.im.id ? { ...im, stitches: info.stitches, emb: { ...(im.emb || {}), stitchesFrom: "file" as const, file: set } } : im)) }));
      await sb.from("orders").update({ groups }).eq("id", it.o.id);
      void load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't read those files."); }
    setBusy("");
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Digitizing</h1><div className="eyebrow">Embroidered logos on open orders: ask the digitizer, then bring the DST in</div></div>
        <div className="row">
          {/* read Amanda's mailbox now and add any digitizer files that came in (Oct 28, Nick: "add a check now button…";
              then "move the check now button all the way to the right… of the top panel") */}
          <button type="button" className="btn" disabled={checking} title="Read the mail now and add the digitizer's files that came in" onClick={() => void checkNow()}>{checking ? "Checking the mail…" : "Check now"}</button>
        </div>
      </div>
      {err && <div className="pv-err">{err}</div>}
      {msg && <div className="pv-err sow-msg" role="status">{msg}</div>}
      <section className="panel">
        <div className="panel-b stack" style={{ gap: 10 }}>
          <div className="toolbar">
            <div className="chips" role="tablist">
              {([["need", "Needs digitizing"], ["asked", "Requested"], ["done", "Needs sew-out"], ["sent", "Waiting on approval"], ["ok", "Approved or sewn before"], ["all", "All"]] as [Filter, string][]).map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={filter === k} className={"chip" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>{l} <span className="pill-n">{orders ? count(k) : "…"}</span></button>
              ))}
            </div>
          </div>
          {!orders ? <div className="faint">Loading…</div> : !shown.length ? <div className="faint">{filter === "need" ? "Nothing waiting to be digitized. An embroidered print on an order shows up here until its DST is in." : "Nothing here."}</div> : (
            <div className="tbl-wrap"><table className="tbl dgz">
              <thead><tr><th>Logo</th><th>Order</th><th>Print</th><th>Stitches</th><th>State</th><th /></tr></thead>
              <tbody>{shown.map((it) => {
                const st = stateOf(it), e = embOf(it.d), f = it.im.emb?.file || e.files?.[0];
                return (
                  <FragmentRow key={it.key} it={it} pic={it.d ? urls[it.d.id] : ""} st={st} f={f} req={e.request} open={open === it.key} toggle={() => setOpen(open === it.key ? null : it.key)}
                    canEdit={canEdit} busy={busy === it.key} text={requestText(it)} reply={e.reply || null} onSend={() => setTool({ orderId: it.o.id, imprintId: it.im.id })} onAsked={() => void markAsked(it)} onDst={(files) => void takeFiles(it, files)}
                    sws={swOf(it)} swUrls={swUrls} onSew={(m) => { setMsg(m); setTimeout(() => setMsg(""), 6000); void load(); }} />
                );
              })}</tbody>
            </table></div>
          )}
          <p className="faint" style={{ fontSize: 12.5 }}>Send to {DIGITIZER.name} opens the Digitizer: the email, the digitizing sheet and the original art, sent from Amanda&apos;s mailbox when you press Send. Their reply's files are added here on their own (Check now reads the mail right away).</p>
          {tool && <DigitizerTool orderId={tool.orderId} imprintId={tool.imprintId} onClose={() => setTool(null)} onSent={() => void load()} />}
        </div>
      </section>
    </>
  );
}

const CHG_OUTRO = "Please send back the updated DST, EMB and worksheet. Thank you!";
const STATE: Record<State, [string, string]> = { need: ["Needs digitizing", "var(--danger)"], asked: ["Requested", "var(--warn)"], done: ["Needs sew-out", "var(--fbs-blue)"], sent: ["Waiting on approval", "var(--warn)"], ok: ["Approved", "var(--ok)"] };
const day = (s: string) => new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });

function FragmentRow({ it, pic, st, f, req, open, toggle, canEdit, busy, text, reply, onSend, onAsked, onDst, sws, swUrls, onSew }: { it: Item; pic: string; st: State; f?: EmbFile; req?: EmbSpecs["request"]; open: boolean; toggle: () => void; canEdit: boolean; busy: boolean; text: string; reply: EmbSpecs["reply"]; onSend: () => void; onAsked: () => void; onDst: (f: File[]) => void; sws: Sw[]; swUrls: Record<string, string>; onSew: (m: string) => void }) {
  // their files, from the email they came on, added like files dropped in
  const [taking, setTaking] = useState(false);
  async function takeReply() {
    if (!reply?.files.length) return;
    setTaking(true);
    const sb = createClient();
    const got: File[] = [];
    for (const x of reply.files) { const { data } = await sb.storage.from("proofs").download(x.path); if (data) got.push(new File([data], x.name, { type: x.type || data.type })); }
    setTaking(false);
    if (got.length) onDst(got);
  }
  const [how, setHow] = useState<string | null>(null), [swBusy, setSwBusy] = useState(false);
  // Send back for changes (Oct 28, Nick): what needs to change, written up as Amanda's reply on their last email
  const [chg, setChg] = useState<string | null>(null), [chgNote, setChgNote] = useState(""), [chgBusy, setChgBusy] = useState(false);
  const chgIntro = `Hi team, thanks for sending this over. On the ${it.im.location || "logo"}${it.d ? ` (D-${it.d.number}${it.d.name ? ` ${it.d.name}` : ""})` : ""} for FBS #${it.o.number}, we need the following changes:`;
  const draftChanges = () => "";
  async function sendChanges() {
    if (!it.d || chg === null || !chgNote.trim()) return;
    setChgBusy(true);
    const body = [chgIntro, "", chgNote.trim(), "", CHG_OUTRO].join("\n");
    const r = await fetch("/api/digitizer/changes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ designId: it.d.id, body, changes: chgNote.trim() }) });
    const j = await r.json().catch(() => ({})) as { error?: string };
    setChgBusy(false);
    if (!r.ok) { onSew(j.error || "Couldn't send it."); return; }
    setChg(null); setChgNote("");
    onSew(`Sent back to ${DIGITIZER.name.split(" ")[0]} for changes. Their fixed file comes in here by itself.`);
  }
  // the steps it goes through, with when each happened
  const live = sws.find((x) => !x.archived_at);
  const steps: { k: string; label: string; sub?: string; state: "" | "d" | "n" }[] = (() => {
    const fAt = (f as EmbFile | undefined)?.at;
    const done = [!!req || !!f, !!f && !(req?.changes && req.at > (fAt || "")), !!live, live?.status === "approved", st === "ok"];
    const subs = [req ? `${req.changes ? "Changes asked" : "Asked"} ${day(req.at)}` : f ? "On file" : "", fAt ? `${day(fAt)}${reply ? " · from " + DIGITIZER.name.split(" ")[0] : ""}` : "", live ? day(live.created_at) : "", live?.decided_at ? day(live.decided_at) : live?.sent_at ? `Sent ${day(live.sent_at)}` : "", st === "ok" ? "Kept for reorders" : ""];
    const labels = [req?.changes && req.at > (fAt || "") ? "Changes asked" : "Requested", "Files in", "Sew-out", "Customer approval", "On file"];
    const next = done.findIndex((x) => !x);
    return labels.map((label, i) => ({ k: label, label, sub: subs[i], state: done[i] ? "d" : i === next ? "n" : "" }));
  })();
  const [copied, setCopied] = useState(false);
  // the DST, read once the row is opened (drawn thread by thread: components/DstPreview.tsx)
  const [dstInfo, setDstInfo] = useState<DstInfo | null>(null);
  const dstColors = f?.ws?.sequence.length ? f.ws.sequence.map(sheetHex) : (it.im.inks || "").split(/\s*,\s*/).map((n) => threadByName(n)?.hex || "").filter(Boolean);
  useEffect(() => {
    if (!open || !f) return;
    let live = true;
    void (async () => {
      const sb = createClient();
      const { data } = await sb.storage.from("proofs").download(f.path);
      if (!data || !live) return;
      try { setDstInfo(readDst(await data.arrayBuffer())); } catch { /* not readable */ }
    })();
    return () => { live = false; };
  }, [open, f, it.im.inks]);
  return (
    <>
      <tr className={open ? "on" : ""} data-dgz={it.key} onClick={toggle} style={{ cursor: "pointer" }}>
        <td><span className="dgz-logo">{pic && it.d ? <span className="dgz-pic"><LogoThumb d={it.d} url={pic} shirt={(it.g.lines || [])[0]?.color} inkMap={it.im.inkMap?.map} /></span> : null}<b>{it.d ? designLabel(it.d) : "No logo yet"}</b></span></td>
        <td><Link className="ordno" href={`/shop/orders/${it.o.id}`} onClick={(e) => e.stopPropagation()}>#{it.o.number}</Link><div className="sub">{it.o.customers?.company || it.o.customers?.name || ""}{it.o.nickname ? ` · ${it.o.nickname}` : ""}</div></td>
        <td>{it.im.location}<div className="sub">{it.im.size || "size not set"}</div></td>
        <td className="num">{(f?.stitches || it.im.stitches || 0) ? (f?.stitches || it.im.stitches)!.toLocaleString() : "—"}<div className="sub">{f ? "from the DST" : it.im.stitches ? "estimate" : ""}</div></td>
        <td><span className="pill" style={{ ["--sc" as string]: STATE[st][1] }}><span className="pill-t">{STATE[st][0]}</span></span>{reply && !f && reply.files.length ? <div className="sub" style={{ color: "var(--ok)" }}>Files came in {day(reply.at)}</div> : req && st === "asked" ? <div className="sub">{day(req.at)}{req.via === "email" ? " · emailed" : ""}</div> : st === "sent" && sws[0]?.sent_at ? <div className="sub">{day(sws[0].sent_at)}{sws[0].viewed_at ? " · opened" : ""}</div> : null}</td>
        <td className="faint">{open ? "▾" : "▸"}</td>
      </tr>
      {open && (
        <tr className="dgz-more"><td colSpan={6}>
          {/* the logo's way through digitizing (Oct 28, Nick: "rethink the layout of this and make it look a little nicer") */}
          <div className="dgz-steps">{steps.map((x) => <div key={x.k} className={x.state}><b>{x.label}</b><small>{x.sub || "\u00a0"}</small></div>)}</div>
          <div className={"dgz-grid" + (f ? "" : " nofile")}>
            {f && <div className="dgz-card dgz-pic-big">
              {dstInfo ? <DstPreview info={dstInfo} colors={dstColors} fabric={guessHex(it.g.lines?.[0]?.color || "") || "#F4F4F1"} width={260} /> : <div className="emb-dst faint">Reading the file…</div>}
              <div className="sub">On {it.g.lines?.[0]?.color || "the garment"}</div>
            </div>}
            <div className="stack" style={{ gap: 12, minWidth: 0 }}>
              {f && <div className="dgz-card">
                <div className="dgz-head">
                  <div><div className="imp-l">Sew file</div><b className="dgz-code">{it.d ? tajimaName(it.d.number, Number(((f as EmbFile & { code?: string }).code || "E1").slice(1)) || 1) : f.name}{it.im.location ? ` · ${it.im.location}` : ""}</b><div className="sub">{f.name}</div></div>
                  <span className="spacer" />
                  {canEdit && it.d && <button type="button" className="btn" onClick={() => setChg(chg === null ? draftChanges() : null)}>Send back to {DIGITIZER.name.split(" ")[0]} for changes</button>}
                  {canEdit && st !== "ok" && <SewoutCapture orderId={it.o.id} imprintId={it.im.id} label={sws.length ? "Take a new sew-out photo" : "Take the sew-out photo"} onDone={onSew} />}
                </div>
                <div className="dgz-facts">
                  <div><span className="imp-l">Size</span><b>{f.wIn}&quot; × {f.hIn}&quot;</b>{it.im.size && <small>asked {it.im.size}</small>}</div>
                  <div><span className="imp-l">Stitches</span><b>{f.stitches.toLocaleString()}</b><small>from the DST</small></div>
                  <div><span className="imp-l">Threads</span><b>{f.ws?.threads.length || f.colors}</b>{f.ws && <small>{f.ws.stops} stop{f.ws.stops === 1 ? "" : "s"} · {f.ws.trims} trim{f.ws.trims === 1 ? "" : "s"}</small>}</div>
                  <div><span className="imp-l">Price</span><b>{st === "ok" ? "Firm" : "Firm after sew-out"}</b></div>
                </div>
                <div className="dgz-chips">
                  {(f.ws?.threads.length ? f.ws.threads.map((t) => ({ k: `${t.needle}${t.code}`, hex: sheetHex(t), label: `${t.chart && t.chart !== "Default" ? t.chart.replace(/ ?(PolyNeon|Classic) ?40/i, "") + " " : ""}${t.code} ${t.name} · needle ${t.needle}` })) : (it.im.inks || "").split(/\s*,\s*/).filter(Boolean).map((n) => ({ k: n, hex: threadByName(n)?.hex || "#ccc", label: n }))).map((t) => <span key={t.k} className="dgz-chip"><i style={{ background: t.hex }} />{t.label}</span>)}
                  <span className="spacer" />
                  {f.path && <a className="dgz-chip" href={`/api/files/open?${new URLSearchParams({ p: f.path, n: f.name })}`} target="_blank" rel="noreferrer">DST</a>}
                  {f.emb && <a className="dgz-chip" href={`/api/files/open?${new URLSearchParams({ p: f.emb.path, n: f.emb.name })}`} target="_blank" rel="noreferrer">EMB (Hatch)</a>}
                  {f.sheet && <a className="dgz-chip" href={`/api/files/open?${new URLSearchParams({ p: f.sheet.path, n: f.sheet.name })}`} target="_blank" rel="noreferrer">Worksheet</a>}
                </div>
                {chg !== null && <div className="dgz-chg">
                  {/* only what needs to change is typed; the thanks before it and the ask after it are always the same
                      (Oct 28, Nick: "just put what we need to change… the middle part would only be changeable") */}
                  <div className="imp-l">What needs to change</div>
                  <div className="dgz-mail">
                    <div className="dgz-mail-h">To {DIGITIZER.name.split(" ")[0]}, as a reply on their last email, from Amanda&apos;s mailbox</div>
                    <p>{chgIntro}</p>
                    <textarea rows={4} autoFocus placeholder={`Make it 3" wide, not ${f.wIn}".\nThe small letters are too thin to sew clean.`} value={chgNote} onChange={(e) => setChgNote(e.target.value)} />
                    <p>{CHG_OUTRO}</p>
                  </div>
                  <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                    <span className="faint" style={{ fontSize: 12 }}>Their file goes with it for reference. Nothing is sent until Send.</span>
                    <button type="button" className="btn" onClick={() => setChg(null)}>Cancel</button>
                    <button type="button" className="btn primary" disabled={chgBusy || !chgNote.trim()} onClick={() => void sendChanges()}>{chgBusy ? "Sending…" : "Send"}</button>
                  </div>
                </div>}
              </div>}
              {f?.ws && <div className="dgz-card"><SewSequence ws={f.ws} open /></div>}
              {(sws.length > 0 || (!f && st !== "need")) && <div className="dgz-card">
                <div className="imp-l">Sew-out</div>
                {!sws.length && <div className="faint" style={{ fontSize: 12.5 }}>Sew a sample, take its picture and crop it{SEWOUT_EMAILS ? ": it's emailed to the customer to approve" : ". It gets an approval page in the customer's portal and a PDF (customer emails are off, so nothing is sent)"}. Once approved it&apos;s kept with the logo for reorders.</div>}
                {sws.length > 0 && <div className="sow-list">{sws.map((x) => (
                  <div key={x.id} className={"sow-item" + (x.archived_at ? " old" : "")}>
                    {swUrls[x.id] ? <a href={swUrls[x.id]} target="_blank" rel="noreferrer"><img src={swUrls[x.id]} alt={`Sew-out version ${x.version}`} /></a> : <img alt="" />}
                    <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                      <div><b>Version {x.version}</b> <span className="pill" style={{ ["--sc" as string]: x.status === "approved" ? "var(--ok)" : x.status === "changes" ? "var(--danger)" : x.archived_at ? "var(--ink-3)" : "var(--warn)" }}><span className="pill-t">{x.status === "approved" ? "Approved" : x.status === "changes" ? "Changes asked" : x.archived_at ? "Replaced" : "Waiting"}</span></span></div>
                      <div className="sub">{x.sent_at ? `Sent ${day(x.sent_at)} to ${x.sent_to}` : `Saved ${day(x.created_at)} · not emailed`}{x.viewed_at ? ` · opened ${day(x.viewed_at)}${x.view_count > 1 ? ` (${x.view_count}×)` : ""}` : x.sent_at ? " · not opened yet" : ""}</div>
                      {x.decided_at && <div className="sub">{x.decided_name} · {day(x.decided_at)}</div>}
                      {x.customer_comment && <div style={{ fontSize: 13 }}>“{x.customer_comment}”</div>}
                      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                        <a className="ap-link" href={`/print/${it.o.id}?sewout=${x.id}`} target="_blank" rel="noreferrer">Approval PDF</a>
                        {canEdit && !x.archived_at && x.status === "pending" && <>
                          {SEWOUT_EMAILS && x.sent_at && <button type="button" className="lc-link" disabled={swBusy} onClick={() => { setSwBusy(true); void remindSewoutAction(x.id).then((r) => { setSwBusy(false); onSew(r.ok ? "Reminder sent." : r.error || "Couldn't send it."); }); }}>Remind them</button>}
                          <button type="button" className="lc-link" onClick={() => setHow(how === x.id ? null : x.id)}>Approved another way…</button>
                        </>}
                      </div>
                      {how === x.id && <div className="row" style={{ gap: 6 }}>
                        <input type="text" autoFocus placeholder="How they approved it (a call, an email…)" onKeyDown={(e) => { if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value; setSwBusy(true); void approveSewoutAnother(x.id, v).then((r) => { setSwBusy(false); setHow(null); onSew(r.ok ? "Marked approved." : r.error || "Couldn't save it."); }); } }} />
                        <span className="faint" style={{ fontSize: 12 }}>Enter to save</span>
                      </div>}
                    </div>
                  </div>
                ))}</div>}
              </div>}
            </div>
          </div>
          <details className="dgz-ask" open={!f}>
            <summary><span>{req?.changes ? `Sent back for changes · ${day(req.at)}` : req ? `What we asked ${DIGITIZER.name.split(" ")[0]} for · ${day(req.at)}` : "The request for the digitizer"}</span>
              <span className="row" style={{ gap: 6, marginLeft: "auto" }} onClick={(e) => e.stopPropagation()}>
                <button type="button" className="btn sm" onClick={(e) => { e.preventDefault(); void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? "Copied" : "Copy"}</button>
                {canEdit && it.d && <button type="button" className={"btn sm" + (st === "need" ? " primary" : "")} onClick={(e) => { e.preventDefault(); onSend(); }}>{st === "need" ? `Send to ${DIGITIZER.name.split(" ")[0]}` : "Send again"}</button>}
                {canEdit && st === "need" && it.d && <button type="button" className="btn sm ghost" disabled={busy} title="Sent some other way" onClick={(e) => { e.preventDefault(); onAsked(); }}>Mark requested</button>}
                {canEdit && reply && !f && reply.files.length > 0 && <button type="button" className="btn sm primary" disabled={busy || taking} title={`${reply.subject} (${reply.files.map((x) => x.name).join(", ")})`} onClick={(e) => { e.preventDefault(); void takeReply(); }}>{taking ? "Getting them…" : `Add their files (${reply.files.length})`}</button>}
                {canEdit && it.d && <label className="btn sm" style={{ cursor: "pointer" }} title="The zip they send back, or the DST with the EMB and the PDF">{busy ? "Reading…" : f ? "Replace the files" : "Add the digitizer's files"}<input type="file" hidden multiple accept=".zip,.dst,.DST,.emb,.EMB,.pdf" onChange={(e) => { const x = [...(e.target.files || [])]; e.target.value = ""; if (x.length) onDst(x); }} /></label>}
              </span>
            </summary>
            {req?.changes && <div className="dgz-chgnote"><b>Changes asked:</b> {req.changes}</div>}
            <pre className="dgz-text">{text}</pre>
          </details>
        </td></tr>
      )}
    </>
  );
}
