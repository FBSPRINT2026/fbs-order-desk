"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import GroupEditor from "@/components/GroupEditor";
import type { NeckLabelSet } from "@/lib/neckLabels";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/format";
import { calcOrder, newGroup, priceList, requestHints, requestProblems, uid, PREVIEWABLE_TYPES, type Design, type Garment, type Group, type Message, type Order, type Settings } from "@/lib/pricing";
import { attachMockupToRequest, describeMyOrder, discardRequest, myReorderables, ownMockupUploadUrl, readMyPo, reorderInto, requestFileUrl, saveOwnMockup, saveRequest, sendSimpleOrder, submitRequest, type PoRead, type Reorderable, type RqFile } from "@/app/portal/request-actions";
import { unzip } from "@/lib/unzip";
import { uploadMyLogo } from "@/lib/customerUpload";
import { customerMessage } from "@/app/portal/actions";
import { saveGoodsInfo } from "@/app/portal/goods-actions";
import GoodsInfoFields, { cleanGoodsInfo, type GoodsInfoValue } from "@/components/GoodsInfoFields";

function imageSize(f: File): Promise<{ w: number; h: number } | null> {
  return new Promise((res) => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => { res({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 }); URL.revokeObjectURL(url); };
    img.onerror = () => { res(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

/** The customer's order builder: garments, sizes, print locations and logos, no prices. */
export default function RequestEditor({ neckSets = [], initial, settings, catalog: cat0, designs: d0, designUrls: u0, messages: m0, savedMockups, pickMockups = [], mockupUrls: mu0, mockupHref, preview, backHref, aiAssist, goodsInfo: gi0 }: {
  /** their tag label sets on file (Tag Print) */ neckSets?: NeckLabelSet[];
  initial: Order; settings: Settings; catalog: Garment[]; designs: Design[]; designUrls: Record<string, string>; messages: Message[];
  /** wholesale: where their goods are coming from (null on retail orders) */ goodsInfo?: GoodsInfoValue | null;
  savedMockups: { path: string; name: string }[];
  /** their saved mockups (one per set) to choose for a group */ pickMockups?: { id: string; number: number | null; name: string; colors: number; when: string; thumb: string }[];
  mockupUrls: Record<string, string>; mockupHref: string; preview: boolean; backHref: string; aiAssist?: boolean;
}) {
  const [mUrls, setMUrls] = useState(mu0);
  void savedMockups;
  const [goods, setGoods] = useState<GoodsInfoValue | null>(gi0 || null);
  const [upBusy, setUpBusy] = useState("");
  const router = useRouter();
  const [o, setO] = useState<Order>(initial);
  const [catalog, setCatalog] = useState(cat0);
  const [designs, setDesigns] = useState(d0);
  const [urls, setUrls] = useState(u0);
  const [msgs, setMsgs] = useState(m0);
  const [armed, setArmed] = useState("");
  const [lookingUp, setLookingUp] = useState("");
  const [state, setState] = useState("");
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(o);
  const calc = useMemo(() => calcOrder(o, settings, []), [o, settings]);
  const prices = priceList(settings, o.price_type);
  // an approved wholesale account sees its prices, like our order screen, and sends it to us to confirm (Oct 24, Nick:
  // "if the customer is an approved wholesale client, then they should be able to submit and see pricing… send to FBS for
  // confirmation"); retail looks the same with the prices left off, and we price it
  const ws = o.price_type === "wholesale";
  const sendLabel = ws ? "Send to FBS for confirmation" : "Send to FBS for pricing";
  const arm = (k: string) => { setArmed(k); setTimeout(() => setArmed((a) => (a === k ? "" : a)), 3500); };

  async function flush() {
    if (preview) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const x = latest.current;
    setState("Saving…");
    const r = await saveRequest(x.id, { groups: x.groups, nickname: x.nickname, due_date: x.due_date, notes: x.notes, po_number: x.po_number || "", delivery_method: x.delivery_method || "pickup", ship_to: x.ship_to || "" });
    setState(r.ok ? "Saved" : "");
    if (r.ok) try { localStorage.removeItem(`fbs:unsaved:${x.id}`); } catch { /* storage off */ }
    if (!r.ok) setErr(r.error || "Couldn't save.");
  }
  function patch(fn: (d: Order) => void) {
    setO((prev) => {
      const n = structuredClone(prev); fn(n); latest.current = n;
      // a copy in this browser until the server has it (Oct 24, Nick: a dropped connection shouldn't lose their order)
      try { localStorage.setItem(`fbs:unsaved:${n.id}`, JSON.stringify({ at: Date.now(), o: n })); } catch { /* storage off */ }
      return n;
    });
    setState("Editing…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 800);
  }
  useEffect(() => () => { if (timer.current) flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // changes that never reached us (the connection dropped): offered back on the next open
  const [recover, setRecover] = useState<{ at: number; o: Order } | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`fbs:unsaved:${initial.id}`);
      const keep = raw ? (JSON.parse(raw) as { at: number; o: Order }) : null;
      if (keep?.o && Date.now() - keep.at < 7 * 864e5 && JSON.stringify(keep.o.groups) + (keep.o.nickname || "") !== JSON.stringify(initial.groups) + (initial.nickname || "")) setRecover(keep);
      else if (raw) localStorage.removeItem(`fbs:unsaved:${initial.id}`);
    } catch { /* storage off */ }
  }, [initial.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function lookupStyle(style: string, styleID?: number, supplier?: string): Promise<Garment | null> {
    const key = style.trim().toUpperCase();
    if (!key || lookingUp === key) return null;
    setLookingUp(key);
    try {
      const r = await fetch(`/api/ss/lookup?${styleID ? `styleid=${styleID}` : `style=${encodeURIComponent(key)}`}${supplier === "sanmar" ? "&supplier=sanmar" : ""}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.garment) { setErr(j.error || "Couldn't find that style."); return null; }
      const g = j.garment as Garment;
      setCatalog((c) => [...c.filter((x) => x.id !== g.id), g].sort((a, b) => a.style.localeCompare(b.style)));
      return g;
    } finally { setLookingUp(""); }
  }

  async function uploadLogo(f: File, name: string): Promise<Design | null> {
    if (preview) return null;
    setErr("");
    try {
      const r = await uploadMyLogo(createClient(), f, name, { draft: true });
      setDesigns((x) => [r.design, ...x.filter((d) => d.id !== r.design.id)]);
      if (r.url) setUrls((x) => ({ ...x, [r.design.id]: r.url }));
      return r.design;
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed."); return null; }
  }


  /** Tag Print with no tag on file: their tag art, kept with the group (Oct 24, Nick: "let them upload there") */
  async function uploadTag(f: File): Promise<{ path: string; name: string } | null> {
    if (preview) return null;
    try {
      const t = await requestFileUrl(o.id, f.name);
      if (!t.ok || !t.path || !t.token) throw new Error(t.error || "Upload isn't available right now.");
      const up = await createClient().storage.from("proofs").uploadToSignedUrl(t.path, t.token, f, { contentType: f.type || undefined });
      if (up.error) throw new Error(up.error.message);
      if (/^image\//.test(f.type)) setMUrls((u) => ({ ...u, [t.path!]: URL.createObjectURL(f) }));
      return { path: t.path, name: f.name };
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed."); return null; }
  }
  /** A mockup the customer made in their own software (picture or PDF). */
  async function uploadOwnMockup(gi: number, f: File) {
    if (preview) return;
    setErr(""); setUpBusy(o.groups[gi].id);
    try {
      const t = await ownMockupUploadUrl(f.name);
      if (!t.ok) throw new Error(t.error);
      const up = await createClient().storage.from("proofs").uploadToSignedUrl(t.path, t.token, f, { contentType: f.type || undefined });
      if (up.error) throw new Error(up.error.message);
      const r = await saveOwnMockup({ path: t.path, name: f.name.replace(/\.[^.]+$/, ""), isImage: /^image\//.test(f.type) });
      if (!r.ok) throw new Error(r.error);
      if (r.url) setMUrls((u) => ({ ...u, [t.path]: r.url }));
      patch((d) => { const g = d.groups[gi]; g.customerMockups = [...(g.customerMockups || []), { path: t.path, name: f.name }]; });
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed."); }
    setUpBusy("");
  }
  // "describe your order" (AI, when the shop turned it on)
  const [desc, setDesc] = useState("");
  const [descBusy, setDescBusy] = useState(false);
  const [descNote, setDescNote] = useState("");
  async function describe() {
    setDescBusy(true); setErr(""); setDescNote("");
    await flush();
    const r = await describeMyOrder(o.id, desc);
    setDescBusy(false);
    if (!r.ok || !r.groups) return setErr(r.error || "We couldn't read that.");
    patch((d) => { d.groups = r.groups!; if (r.nickname && !d.nickname) d.nickname = r.nickname; if (r.due_date && !d.due_date) d.due_date = r.due_date; });
    setDesc("");
    setDescNote(`We filled in ${r.added} group${r.added === 1 ? "" : "s"} below. Please check the styles, colors and sizes, and upload your logo on each print location.${r.questions?.length ? ` We'll also need: ${r.questions.join("; ")}.` : ""}`);
  }
  const problems = [...requestProblems(o.groups), ...(o.delivery_method && o.delivery_method !== "pickup" && !(o.ship_to || "").trim() ? [`Add the address to ${o.delivery_method === "ship" ? "ship" : "deliver"} to`] : [])];
  const hints = problems.length ? [] : requestHints(o.groups);

  // the mockup, beside the prints (Oct 24, Nick: "start out by saying create mockup or upload your own existing mockup… in the
  // imprint screen"): made in our Mockup Creator for this group, or their own file
  const mkLink = (q: string) => `${mockupHref}${mockupHref.includes("?") ? "&" : "?"}${q}`;
  // the order's changes are saved before going to the Mockup Creator
  const goMock = async (q: string) => { await flush(); window.location.href = mkLink(q); };
  const mockupBtns = (g: Group, gi: number) => {
    const own = (g.customerMockups || []).length > 0;
    return (
      <div className="rq-mk-acts">
        {g.reprintOf && <span className="faint rq-reo">Same prints as {g.reprintOf}</span>}
        {g.reprintOf && <button type="button" className="btn sm" title="Change the prints: location, size, colors or art" onClick={() => patch((d) => { delete d.groups[gi].reprintOf; })}>Change the prints</button>}
        {g.fromMockup
          ? <button type="button" className="btn sm" onClick={() => goMock(`mockup=${g.fromMockup!.id}&request=${o.id}&group=${g.id}`)}>Edit mockup</button>
          : <button type="button" className={"btn sm" + (own ? "" : " primary")} onClick={() => goMock(`request=${o.id}&group=${g.id}`)}>Create mockup</button>}
        {!g.fromMockup && !own && pickMockups.length > 0 && <button type="button" className="btn sm" onClick={() => setPickFor(g.id)}>Choose a saved mockup</button>}
        {!g.fromMockup && (
          <label className="btn sm" style={{ cursor: "pointer" }}>{upBusy === g.id ? "Uploading…" : "Upload your own mockup"}
            <input type="file" hidden accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadOwnMockup(gi, f); }} />
          </label>
        )}
        {own && !g.fromMockup && <button type="button" className="btn sm ghost" onClick={() => patch((d) => { d.groups[gi].customerMockups = []; })}>Remove mockup</button>}
      </div>
    );
  };

  // Choose a saved mockup: it goes into the group like one made for it (garments, colors, prints)
  const [pickFor, setPickFor] = useState("");
  const [picking, setPicking] = useState("");
  async function pickMockup(id: string) {
    if (preview || !pickFor) return;
    setPicking(id); setErr("");
    await flush();
    const r = await attachMockupToRequest(o.id, pickFor, id);
    if (!r.ok) { setPicking(""); return setErr(r.error || "Couldn't add the mockup."); }
    window.location.reload();
  }

  // leaving a draft asks first (Oct 24, Nick: "if you're in draft mode… do you want to save this or not? And then if they
  // click not, then it exits, nothing happens to it"); a refresh keeps it, every change is saved as you go
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  useEffect(() => {
    if (!o.draft || preview) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const u = new URL(a.href, location.href);
      if (u.origin !== location.origin || u.pathname === location.pathname || u.pathname.startsWith("/portal/mockup")) return;
      e.preventDefault(); e.stopPropagation();
      setLeaveTo(u.pathname + u.search);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [o.draft, preview]);

  // Have a PO, or just want to send the details? (Oct 24, Nick: "they upload the PO and it fills out the form and they can
  // confirm all the details… And there's just upload a simple order… when's it due, where's it going, about how many
  // units, upload art, upload PO. If you have it, tell us about the goods")
  const [poBusy, setPoBusy] = useState("");
  const [poRead, setPoRead] = useState<{ read: PoRead; files: RqFile[] } | null>(null);
  const [simple, setSimple] = useState<{ name: string; about: string; due: string; po: string; method: "" | "screen" | "embroidery" | "transfer" | "mixed"; qty: string; goodsOn: boolean; garments: string; files: RqFile[]; note: string } | null>(null);
  const [simpleBusy, setSimpleBusy] = useState("");
  async function upFiles(list: File[], kind: RqFile["kind"]): Promise<RqFile[]> {
    const out: RqFile[] = [];
    for (const f0 of list) {
      // a .zip is opened here and each file sent on its own, so we can read them
      let fs: File[] = [f0];
      if (/\.zip$/i.test(f0.name)) { try { const x = await unzip(f0); if (x.length) fs = x.slice(0, 20); } catch { /* sent as the zip */ } }
      for (const f of fs) {
        if (f.size > 50 * 1024 * 1024) throw new Error(`${f.name} is too big (50 MB at most). Send a smaller copy, or a link in Questions for us.`);
        const t = await requestFileUrl(o.id, f.name);
        if (!t.ok || !t.path || !t.token) throw new Error(t.error || "Upload isn't available right now.");
        const up = await createClient().storage.from("proofs").uploadToSignedUrl(t.path, t.token, f, { contentType: f.type || undefined });
        if (up.error) throw new Error(up.error.message);
        out.push({ path: t.path, name: f.name, type: f.type || "", size: f.size, kind });
      }
    }
    return out;
  }
  const openSimple = (files: RqFile[] = [], note = "") => setSimple({ name: o.nickname || "", about: "", due: o.due_date || "", po: o.po_number || "", method: "", qty: "", goodsOn: false, garments: "", files, note });
  // Place a reorder (Oct 24, Nick: "search and click… update the quantities… pull it into the form… or they can just copy
  // and paste like, hey, let's reorder")
  const asQ = (backHref.match(/[?&]as=([^&]+)/) || [])[1] || "";
  const [re, setRe] = useState<{ q: string; list: Reorderable[] | null; pick: string; busy: string; text: string } | null>(null);
  useEffect(() => {
    if (!re) return;
    const t = setTimeout(() => { void myReorderables(re.q).then((list) => setRe((x) => (x ? { ...x, list } : x))); }, re.list ? 250 : 0);
    return () => clearTimeout(t);
  }, [re?.q, !!re]); // eslint-disable-line react-hooks/exhaustive-deps
  async function pullReorder() {
    if (!re?.pick) return;
    setRe({ ...re, busy: "Pulling it in…" });
    await flush();
    const r = await reorderInto(o.id, re.pick);
    if (!r.ok || !r.groups) { setRe((x) => (x ? { ...x, busy: "" } : x)); return setErr(r.error || "Couldn't pull that order in."); }
    patch((d) => { d.groups = r.groups!; if (r.nickname && !d.nickname) d.nickname = r.nickname; });
    setRe(null);
    setDescNote(`We filled in the form from ${r.label}. Change the sizes and quantities, then send it to us.`);
  }
  async function sendReorderText() {
    if (!re?.text.trim()) return;
    setRe({ ...re, busy: "Sending…" });
    await flush();
    const r = await sendSimpleOrder(o.id, { name: o.nickname || "Reorder", about: re.text, files: [], delivery: o.delivery_method || "pickup", ship_to: o.ship_to || "" });
    if (!r.ok) { setRe((x) => (x ? { ...x, busy: "" } : x)); return setErr(r.error || "Couldn't send it."); }
    try { localStorage.removeItem(`fbs:unsaved:${o.id}`); } catch { /* off */ }
    router.push(`/portal/orders/${o.id}?sent=1`);
  }
  async function uploadPo(list: File[]) {
    if (preview || !list.length) return;
    setErr(""); setPoBusy("Uploading…");
    let files: RqFile[] = [];
    try { files = await upFiles(list, "po"); } catch (e) { setPoBusy(""); return setErr(e instanceof Error ? e.message : "Upload failed."); }
    setPoBusy("Reading your PO… this can take a minute");
    await flush();
    const r = await readMyPo(o.id, files);
    setPoBusy("");
    if (!r.ok || !r.read) return openSimple(files, r.error || "We couldn't read that PO. Send it to us as is and we'll fill it in.");
    setPoRead({ read: r.read, files });
  }
  function applyPo() {
    const r = poRead?.read; setPoRead(null);
    if (!r) return;
    patch((d) => {
      d.groups = r.groups;
      if (r.nickname && !d.nickname) d.nickname = r.nickname;
      if (r.due_date && !d.due_date) d.due_date = r.due_date;
      if (r.po_number && !d.po_number) d.po_number = r.po_number;
      if (r.delivery && !(d.ship_to || "").trim()) { d.delivery_method = r.delivery as Order["delivery_method"]; if (r.ship_to) d.ship_to = r.ship_to; }
    });
    setDescNote(`We filled in the form from your PO. Check the styles, colors and sizes, add a mockup for each group, then send it to us.${r.questions.length ? ` We'll also need: ${r.questions.join("; ")}.` : ""}`);
  }
  async function addSimpleFiles(list: File[], kind: RqFile["kind"]) {
    if (!simple || !list.length) return;
    setSimpleBusy("Uploading…"); setErr("");
    try { const got = await upFiles(list, kind); setSimple((x) => (x ? { ...x, files: [...x.files, ...got].slice(0, 20) } : x)); }
    catch (e) { setErr(e instanceof Error ? e.message : "Upload failed."); }
    setSimpleBusy("");
  }
  async function sendSimple() {
    if (!simple) return;
    setSimpleBusy("Sending…"); setErr("");
    await flush();
    if (goods && simple.goodsOn) { const g = await saveGoodsInfo(o.id, cleanGoodsInfo(goods)); if (!g.ok) { setSimpleBusy(""); return setErr(g.error || "Couldn't save the goods info."); } }
    const r = await sendSimpleOrder(o.id, { name: simple.name, about: simple.about, due: simple.due || null, po: simple.po, method: simple.method, qty: +simple.qty || null, delivery: o.delivery_method || "pickup", ship_to: o.ship_to || "", garments: simple.garments, files: simple.files });
    if (!r.ok) { setSimpleBusy(""); return setErr(r.error || "Couldn't send it."); }
    try { localStorage.removeItem(`fbs:unsaved:${o.id}`); } catch { /* off */ }
    router.push(`/portal/orders/${o.id}?sent=1`);
  }

  // what's missing shows when they try to send (Oct 24, Nick: "get rid of that yellow before you send it in. That can pop
  // up if they don't do something right")
  const [missing, setMissing] = useState<string[] | null>(null);
  function trySend() { if (problems.length) { setMissing(problems); return; } void send(); }
  async function send() {
    setBusy(true); setErr("");
    await flush();
    // wholesale: where the goods come from (optional) goes into the order's goods conversation
    if (goods) { const g = await saveGoodsInfo(o.id, cleanGoodsInfo(goods)); if (!g.ok) { setBusy(false); return setErr(g.error || "Couldn't save the goods info."); } }
    const r = await submitRequest(o.id);
    setBusy(false);
    if (!r.ok) return setErr(r.error || "Couldn't send it in.");
    router.push(`/portal/orders/${o.id}?sent=1`);
  }
  async function ask() {
    if (!q.trim()) return;
    const r = await customerMessage(o.id, q);
    if (!r.ok) return setErr(r.error || "Couldn't send your question.");
    setMsgs((m) => [...m, { id: uid(), order_id: o.id, author_type: "customer", author_email: "", author_name: "You", body: q.trim(), read_at: null, created_at: new Date().toISOString() } as Message]);
    setQ("");
  }

  return (
    <main className="p-main rq">
      {leaveTo && (
        <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Keep this draft?" onClick={() => setLeaveTo(null)}>
          <div className="dla" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h3>Keep this as a draft?</h3>
            <p className="dla-sub">It hasn&apos;t been sent to us. Keep it to finish later (under Orders → Drafts), or discard it and nothing is kept.</p>
            <div className="dla-acts">
              <button type="button" className="btn ghost" onClick={() => setLeaveTo(null)}>Keep editing</button>
              <button type="button" className="btn ghost danger" onClick={async () => { const to = leaveTo; setLeaveTo(null); const r = await discardRequest(o.id); if (r.ok) router.push(to); else setErr(r.error || ""); }}>Discard</button>
              <button type="button" className="btn primary" autoFocus onClick={async () => { const to = leaveTo; setLeaveTo(null); await flush(); router.push(to); }}>Keep draft</button>
            </div>
          </div>
        </div>
      )}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div><Link href={backHref} className="back">← Dashboard</Link></div>
          <h1 style={{ margin: "6px 0 0" }}>Build Your Order</h1>
        </div>
        <div className="row"><span className="save-state">{state}</span>
          {/* Draft beside Discard (Oct 24, Nick: "put the word draft… right next to discard") */}
          {o.draft ? <span className="pill" style={{ ["--sc" as string]: "var(--ink-3)" }} title="Not sent to us yet"><span className="pill-t">Draft</span></span> : <span className="faint" style={{ fontSize: 12.5 }}>#{o.number}</span>}
          <button type="button" className={"btn ghost danger" + (armed === "discard" ? " armed" : "")} disabled={preview} onClick={async () => { if (armed !== "discard") return arm("discard"); const r = await discardRequest(o.id); if (r.ok) router.push(backHref); else setErr(r.error || ""); }}>{armed === "discard" ? (o.draft ? "Discard this draft?" : "Delete this order?") : o.draft ? "Discard" : "Delete"}</button>
          <button type="button" className="btn primary" disabled={preview || busy} onClick={trySend}>{busy ? "Sending…" : sendLabel}</button>
        </div>
      </div>
      <div className="rq-note">{ws
        ? <>Add your garments, sizes and where each logo goes. <b>Your wholesale prices are shown.</b> Send it to us to confirm: we&apos;ll check everything and put it through.</>
        : <>Add your garments, sizes and where each logo goes. <b>You won&apos;t see prices yet:</b> we&apos;ll check everything, price it and send it back for your final OK.</>}</div>
      {err && <div className="banner" role="alert">{err}</div>}
      {recover && !preview && (
        <div className="draft-bar" role="alert">
          <span><b>We found changes that didn&apos;t save.</b> From {new Date(recover.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}; the connection may have dropped. Bring them back?</span>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={() => { try { localStorage.removeItem(`fbs:unsaved:${o.id}`); } catch { /* off */ } setRecover(null); }}>Throw them away</button>
          <button type="button" className="btn primary" onClick={() => { const r = recover; setRecover(null); patch((d) => { d.groups = r.o.groups; d.nickname = r.o.nickname; d.due_date = r.o.due_date; d.notes = r.o.notes; d.po_number = r.o.po_number; d.delivery_method = r.o.delivery_method; d.ship_to = r.o.ship_to; }); }}>Bring them back</button>
        </div>
      )}

      {/* the order on the left; their goods and questions for us beside it, like our order screen (Oct 24, Nick) */}
      <div className="rq-cols">
      <div className="rq-main stack">
      {aiAssist && (
        <section className="ai-box">
          <h3>✦ Describe your order and we&apos;ll fill in the form</h3>
          <textarea rows={3} aria-label="Describe your order" placeholder={'e.g. "50 black Gildan 5000 tees, 10 S, 20 M, 15 L, 5 XL, white logo on the front and our website on the back, need them by Oct 20"'} value={desc} disabled={preview} onChange={(e) => setDesc(e.target.value)} />
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn sm primary" disabled={preview || descBusy || desc.trim().length < 10} onClick={describe}>{descBusy ? "Filling in…" : "Fill in the form"}</button>
            <span className="faint" style={{ fontSize: 12 }}>You can check and change everything before you send it.</span>
          </div>
          {descNote && <div className="okmsg">{descNote}</div>}
        </section>
      )}

      <section className="panel"><div className="panel-b stack" style={{ gap: 12 }}>
        <div className="grid g3">
          <div className="field"><label htmlFor="rq-name">Order name</label><input id="rq-name" type="text" placeholder="e.g. Team shirts" value={o.nickname || ""} disabled={preview} onChange={(e) => patch((d) => { d.nickname = e.target.value; })} /></div>
          <div className="field"><label htmlFor="rq-date">Need it by (in-hands date)</label><input id="rq-date" type="date" value={o.due_date || ""} disabled={preview} onChange={(e) => patch((d) => { d.due_date = e.target.value || null; })} /></div>
          <div className="field"><label htmlFor="rq-po">Your PO # (optional)</label><input id="rq-po" type="text" value={o.po_number || ""} disabled={preview} onChange={(e) => patch((d) => { d.po_number = e.target.value; })} /></div>
        </div>
        <div className="grid g3">
          <div className="field"><label htmlFor="rq-del">How you&apos;ll get it</label>
            <select id="rq-del" value={o.delivery_method || "pickup"} disabled={preview} onChange={(e) => patch((d) => { d.delivery_method = e.target.value as Order["delivery_method"]; })}>
              <option value="pickup">I&apos;ll pick it up</option><option value="ship">Ship it to me</option><option value="deliver">Local delivery</option>
            </select></div>
          {(o.delivery_method || "pickup") !== "pickup" && <div className="field" style={{ gridColumn: "span 2" }}><label htmlFor="rq-ship">{o.delivery_method === "ship" ? "Ship to" : "Deliver to"}</label><textarea id="rq-ship" rows={2} placeholder="Name, street, city, state, ZIP" value={o.ship_to || ""} disabled={preview} onChange={(e) => patch((d) => { d.ship_to = e.target.value; })} /></div>}
        </div>
        <div className="field"><label htmlFor="rq-notes">Order notes <span className="faint" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>for production: shipping, packing, who it&apos;s for</span></label><textarea id="rq-notes" rows={2} placeholder="e.g. Ship to our Tulsa store · fold and bag each shirt · these are for our fall event" value={o.notes || ""} disabled={preview} onChange={(e) => patch((d) => { d.notes = e.target.value; })} /></div>
        {/\?/.test(o.notes || "") && <div className="rq-q-hint">Is that a question? Ask it in <b>Questions for us</b> on the right so we can answer it. Order notes are for production details.</div>}
      </div></section>

      <fieldset disabled={preview || descBusy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className={"stack ord rq-ord" + (ws ? " ws" : " np-ord")}>
        {o.groups.map((g, gi) => (
          // the mockup they made shows with the prints (Oct 24, Nick: ordered from a mockup, "it doesn't bring in the mock-up")
          <GroupEditor key={g.id} gi={gi} g={g.mockupThumbs?.length ? g : { ...g, mockupThumbs: (g.customerMockups || []).filter((m) => !/\.pdf$/i.test(m.path)).map((m) => m.path) }} thumbUrls={mUrls} fixed={!!g.fromMockup} printsFixed={!!g.reprintOf} gc={calc.groups[gi]}
            mockupExtra={mockupBtns(g, gi)} sizesBelow onUploadTag={uploadTag} neckSets={neckSets}
            needMockup={pickMockups.length ? "Start with a mockup: create one, upload your own, or choose one you've already made. Your prints fill in from it." : "Start with a mockup: create one or upload your own. Your prints fill in from it."} settings={settings} prices={prices} catalog={catalog} canRemove={o.groups.length > 1}
            armed={armed} arm={arm} hidePrices={!ws} update={(fn) => patch((d) => fn(d.groups[gi]))}
            onSaveToCatalog={() => {}} onLookup={lookupStyle} lookingUp={lookingUp}
            designs={designs} designUrls={urls} onUploadDesign={uploadLogo}
            onDuplicate={() => patch((d) => { const s = d.groups[gi]; d.groups.splice(gi + 1, 0, { ...structuredClone(s), id: uid(), lines: s.lines.map((l) => ({ ...l, id: uid() })), imprints: s.imprints.map((x) => ({ ...x, id: uid() })) } as Group); })}
            onRemove={() => patch((d) => { d.groups.splice(gi, 1); })} />
        ))}
        <button type="button" className="btn" style={{ alignSelf: "flex-start" }} onClick={() => patch((d) => { d.groups.push(newGroup()); })}>+ Add another group</button>
      </fieldset>
      </div>
      <aside className="rq-side stack">
      {/* the side cards: a short title, one line under it (Oct 24, Nick: "these side panels look really bad… just says have PO or simple order") */}
      <section className="rq-card">
        <h3>Skip the form</h3>
        <div className="rq-fast rq-fast3">
          <label className={"rq-fast-o" + (preview || poBusy ? " off" : "")} title="We read your PO and fill in the form; you check it before it's sent">
            <span className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M12 17v-6M9 14l3-3 3 3" /></svg></span>
            <b>{poBusy ? "Reading…" : "Upload PO"}</b>
            <input type="file" hidden multiple disabled={preview || !!poBusy} accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xlsm,.csv,.tsv,.txt,.docx,.zip,application/pdf,image/*" onChange={(e) => { const l = Array.from(e.target.files || []) as File[]; e.target.value = ""; void uploadPo(l); }} />
          </label>
          <button type="button" className="rq-fast-o" disabled={preview || !!poBusy} onClick={() => openSimple()} title="A few questions and your files; we build it for you">
            <span className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></svg></span>
            <b>Simple order</b>
          </button>
        <button type="button" className="rq-fast-o" disabled={preview || !!poBusy} onClick={() => setRe({ q: "", list: null, pick: "", busy: "", text: "" })} title="Pick a past order; it fills in the form and you change the quantities">
          <span className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5" /></svg></span>
          <b>Place a reorder</b>
        </button>
        </div>
        {poBusy && <p className="rq-card-busy">{poBusy}</p>}
      </section>
      {goods && (
        <section className="rq-card">
          <h3>Your goods</h3>
          <p>Where your garments are coming from. Tracking can be added later.</p>
          <GoodsInfoFields v={goods} onChange={setGoods} disabled={preview} />
        </section>
      )}

      <section className="rq-card">
        <h3>Questions for us</h3>
        <p>We reply right here.</p>
        {msgs.map((m) => <div key={m.id} className={"aa-msg " + (m.author_type === "staff" ? "shop" : "cust")}><div className="aa-msg-h"><b>{m.author_name}</b><span className="faint">{new Date(m.created_at).toLocaleString()}</span></div><div className="aa-msg-b">{m.body}</div></div>)}
        <textarea rows={2} placeholder="How soon can you have it? Will this art print well?" value={q} disabled={preview} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="btn sm" style={{ alignSelf: "flex-end" }} disabled={preview || !q.trim()} onClick={ask}>Send question</button>
      </section>
      </aside>
      </div>

      {re && (
        <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Place a reorder" onClick={() => !re.busy && setRe(null)}>
          <div className="dla rq-re" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="dla-x" aria-label="Close" disabled={!!re.busy} onClick={() => setRe(null)}>×</button>
            <h3>Place a reorder</h3>
            <p className="dla-sub">Pick the order: it fills in the form with the same garments and prints, and you change the quantities.</p>
            <input type="search" autoFocus placeholder="Search by order # or name" value={re.q} onChange={(e) => setRe({ ...re, q: e.target.value, pick: "" })} aria-label="Search your past orders" />
            <div className="rq-re-list" role="listbox" aria-label="Your past orders">
              {re.list === null ? <div className="faint">Loading…</div> : re.list.length ? re.list.map((x) => (
                <div key={x.ref} role="option" tabIndex={0} aria-selected={re.pick === x.ref} className={"rq-re-row" + (re.pick === x.ref ? " on" : "")} onClick={() => setRe({ ...re, pick: x.ref })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setRe({ ...re, pick: x.ref }); } }}>
                  <span className="rq-re-pic">{x.pic ? <img src={x.pic} alt="" loading="lazy" /> : <span>#{x.number}</span>}</span>
                  <span className="rq-re-t"><b>#{x.number}</b> <span className="nm">{x.name || "Order"}</span><small className="faint">{x.when ? new Date(x.when + "T12:00").toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : ""}{x.qty ? ` · ${x.qty} pcs` : ""}</small></span>
                  {x.href && <a className="btn sm" href={`${x.href}${asQ ? `?as=${asQ}` : ""}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>View</a>}
                </div>
              )) : <div className="faint">{re.q ? "No orders match that." : "No past orders yet."}</div>}
            </div>
            <div className="field"><label htmlFor="rq-re-t">Or just tell us</label><textarea id="rq-re-t" rows={2} placeholder="e.g. Reorder #1234, same as last time but 50 more in black" value={re.text} onChange={(e) => setRe({ ...re, text: e.target.value })} /></div>
            <div className="dla-acts">
              <span className="faint" style={{ fontSize: 12, marginRight: "auto" }}>{re.busy}</span>
              {re.text.trim() && !re.pick
                ? <button type="button" className="btn primary" disabled={!!re.busy || preview} onClick={() => void sendReorderText()}>Send it to FBS</button>
                : <button type="button" className="btn primary" disabled={!!re.busy || !re.pick || preview} onClick={() => void pullReorder()}>Pull it into the form</button>}
            </div>
          </div>
        </div>
      )}
      {poRead && (
        <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Does this look right?" onClick={() => setPoRead(null)}>
          <div className="dla rq-po" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="dla-x" aria-label="Close" onClick={() => setPoRead(null)}>×</button>
            <h3>Does this look right?</h3>
            <p className="dla-sub">Here&apos;s what we read on your PO: {poRead.read.pieces} pieces.{poRead.read.po_number ? ` PO # ${poRead.read.po_number}.` : ""}{poRead.read.due_date ? ` Needed by ${new Date(poRead.read.due_date + "T12:00").toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}.` : ""}</p>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Garment</th><th>Color</th><th>Sizes</th><th style={{ textAlign: "right" }}>Qty</th></tr></thead>
              <tbody>{poRead.read.lines.map((l, i) => <tr key={i}><td>{l.garment}{l.group ? <div className="sub">{l.group}</div> : null}</td><td>{l.color || "—"}</td><td>{l.sizes || "—"}</td><td style={{ textAlign: "right" }}>{l.qty}</td></tr>)}</tbody>
            </table></div>
            {poRead.read.ship_to && <p className="dla-sub">{poRead.read.delivery === "deliver" ? "Deliver" : "Ship"} to: {poRead.read.ship_to}</p>}
            {poRead.read.questions.length > 0 && <p className="dla-sub">We&apos;ll also need: {poRead.read.questions.join("; ")}.</p>}
            <div className="dla-acts">
              <button type="button" className="btn ghost" onClick={() => { const f = poRead.files; setPoRead(null); openSimple(f, "Tell us what we got wrong, and we'll fill it in from your PO."); }}>Not quite: send it to us as is</button>
              <button type="button" className="btn primary" autoFocus onClick={applyPo}>Yes, fill in the form</button>
            </div>
          </div>
        </div>
      )}

      {simple && (
        <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Send a simple order" onClick={() => !simpleBusy && setSimple(null)}>
          <div className="dla rq-simple" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="dla-x" aria-label="Close" disabled={!!simpleBusy} onClick={() => setSimple(null)}>×</button>
            <h3>Send a simple order</h3>
            <p className="dla-sub">{simple.note || "Tell us the basics and upload what you have. We'll build it and send you a confirmation."}</p>
            {err && <div className="banner" role="alert">{err}</div>}
            <div className="stack" style={{ gap: 12 }}>
              {/* Nick, Oct 24: "order name, need it by, PO… then screen printing, embroidery, transfer, or mixed, and how many
                  pieces… basic description… toggle… information about your goods… upload PO, upload art, files or a zip" */}
              <div className="grid g3">
                <div className="field"><label htmlFor="so-name">Order name</label><input id="so-name" type="text" placeholder="e.g. Fall 5K" value={simple.name} onChange={(e) => setSimple({ ...simple, name: e.target.value })} /></div>
                <div className="field"><label htmlFor="so-due">Need it by</label><input id="so-due" type="date" value={simple.due} onChange={(e) => setSimple({ ...simple, due: e.target.value })} /></div>
                <div className="field"><label htmlFor="so-po">PO # (optional)</label><input id="so-po" type="text" value={simple.po} onChange={(e) => setSimple({ ...simple, po: e.target.value })} /></div>
              </div>
              <div className="so-row2">
                <div className="field"><label>Decoration</label>
                  <div className="so-seg" role="radiogroup" aria-label="Decoration">
                    {([["screen", "Screen printing"], ["embroidery", "Embroidery"], ["transfer", "Transfers"], ["mixed", "Mixed"]] as const).map(([k, t]) => (
                      <button key={k} type="button" role="radio" aria-checked={simple.method === k} className={simple.method === k ? "on" : ""} onClick={() => setSimple({ ...simple, method: simple.method === k ? "" : k })}>{t}</button>
                    ))}
                  </div>
                </div>
                <div className="field"><label htmlFor="so-qty">How many pieces</label><input id="so-qty" type="number" min={1} inputMode="numeric" placeholder="e.g. 150" value={simple.qty} onChange={(e) => setSimple({ ...simple, qty: e.target.value })} /></div>
              </div>
              <div className="field"><label htmlFor="so-about">Description</label><textarea id="so-about" rows={3} placeholder="e.g. Black tees, our logo on the front, sponsors on the back" value={simple.about} onChange={(e) => setSimple({ ...simple, about: e.target.value })} /></div>
              <label className="so-toggle"><input type="checkbox" checked={simple.goodsOn} onChange={(e) => setSimple({ ...simple, goodsOn: e.target.checked })} /><span className="so-sw" aria-hidden /><span>Tell us about the garments{goods ? " you're sending" : ""}</span></label>
              {simple.goodsOn && (
                <div className="so-goods stack" style={{ gap: 10 }}>
                  <div className="field"><label htmlFor="so-g">Style and colors</label><input id="so-g" type="text" placeholder={goods ? "e.g. Next Level 6210, Banana Cream" : "e.g. Gildan 5000 in black, or “help me pick”"} value={simple.garments} onChange={(e) => setSimple({ ...simple, garments: e.target.value })} /></div>
                  {goods && <GoodsInfoFields v={goods} onChange={setGoods} />}
                </div>
              )}
              <div className="field"><label>Files</label>
                <div className="rq-so-up">
                  {([["po", "Upload PO"], ["art", "Upload art"], ["other", "Files or a .zip"]] as const).map(([k, label]) => (
                    <label key={k} className={"btn sm" + (simpleBusy ? " disabled" : "")} style={{ cursor: "pointer" }}>{label}
                      <input type="file" hidden multiple disabled={!!simpleBusy} onChange={(e) => { const l = Array.from(e.target.files || []) as File[]; e.target.value = ""; void addSimpleFiles(l, k); }} />
                    </label>
                  ))}
                </div>
                {simple.files.length > 0 && <ul className="rq-so-files">{simple.files.map((f, i) => (
                  <li key={f.path}><span className="pill">{f.kind === "po" ? "PO" : f.kind === "art" ? "Art" : "File"}</span><span className="nm">{f.name}</span>
                    <button type="button" className="btn sm ghost" aria-label={`Remove ${f.name}`} onClick={() => setSimple({ ...simple, files: simple.files.filter((_, j) => j !== i) })}>Remove</button></li>
                ))}</ul>}
              </div>
            </div>
            <div className="dla-acts">
              <span className="faint" style={{ fontSize: 12, marginRight: "auto" }}>{simpleBusy}</span>
              <button type="button" className="btn ghost" disabled={!!simpleBusy} onClick={() => setSimple(null)}>Cancel</button>
              <button type="button" className="btn primary" disabled={!!simpleBusy || preview || (simple.about.trim().length < 5 && !simple.files.length && !simple.name.trim())} onClick={() => void sendSimple()}>Send to FBS</button>
            </div>
          </div>
        </div>
      )}

      {pickFor && (
        <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Choose a saved mockup" onClick={() => !picking && setPickFor("")}>
          <div className="dla rq-pick" onClick={(e) => e.stopPropagation()}>
            <h3>Choose a saved mockup</h3>
            <p className="dla-sub">Its shirts, colors and prints go into this group. Then add your sizes.</p>
            <div className="rq-pick-grid">
              {pickMockups.map((m) => (
                <button key={m.id} type="button" className="rq-pick-c" disabled={!!picking || preview} onClick={() => pickMockup(m.id)}>
                  <span className="rq-pick-img">{m.thumb ? <img src={m.thumb} alt="" /> : null}</span>
                  <b>{m.number ? `M-${m.number}` : m.name}</b>
                  <small>{[m.number ? m.name : "", m.colors > 1 ? `${m.colors} colors` : ""].filter(Boolean).join(" · ")}</small>
                  {picking === m.id && <small>Adding…</small>}
                </button>
              ))}
            </div>
            <div className="dla-acts"><button type="button" className="btn ghost" disabled={!!picking} onClick={() => setPickFor("")}>Cancel</button></div>
          </div>
        </div>
      )}


      {missing && (
        <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Almost there" onClick={() => setMissing(null)}>
          <div className="dla" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <button type="button" className="dla-x" aria-label="Close" onClick={() => setMissing(null)}>×</button>
            <h3>Almost there</h3>
            <p className="dla-sub">Before we can take it:</p>
            <ul className="rq-missing">{(problems.length ? problems : missing).map((p) => <li key={p}>{p}</li>)}</ul>
            <div className="dla-acts"><button type="button" className="btn primary" autoFocus onClick={() => setMissing(null)}>OK</button></div>
          </div>
        </div>
      )}
      {hints.length > 0 && (
        <div className="rq-hint">
          <b>Helpful if you know them</b> <span className="faint">(optional, we can figure these out with you):</span>
          <ul>{hints.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      <div className="rq-foot">
        <span><b>{calc.qty}</b> pieces</span>{ws && calc.qty > 0 && <span>Total <b className="num">{money(calc.total - calc.tax)}</b> <span className="faint">before tax</span></span>}<span className="spacer" />
        <button type="button" className="btn primary" disabled={preview || busy} onClick={trySend}>{busy ? "Sending…" : sendLabel}</button>
      </div>
    </main>
  );
}
