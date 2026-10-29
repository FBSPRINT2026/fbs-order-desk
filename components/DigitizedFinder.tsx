"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { expandFiles, takeDigitized, type DigitizedSet } from "@/lib/digitizedFiles";
import { readDst, type DstInfo } from "@/lib/dst";
import { findDigitizedDropbox, findDigitizedEmails, takeDropboxDigitized, takeEmailDigitized, type DbxHit, type MailHit } from "@/app/shop/digitized-finder-actions";

/**
 * "Already digitized?" (Oct 29, Nick: "you're assuming it always has to be digitized… I have this one already… there
 * should be something… already digitized, click here… brings up a finder… go in the email, Amanda's email, and find it…
 * or… on the server… treat it just like a package: you need to upload the DST, the EMB, and the PDF… then… do we need to
 * do a sew-out? Yes or no"). THE one finder for a print's existing stitch files: the button under an order's print that
 * needs digitizing, and the Already digitized box, both open it.
 *   - Email: the shop's mailboxes, emails with a DST or EMB attached, the best matches for the logo first
 *   - Dropbox: stitch files named like it (a PDF worksheet beside them comes too)
 *   - This computer: the zip, or the DST, EMB and PDF
 * The package shows what's in (the DST is needed; the EMB and the worksheet are asked for), the DST is read (size,
 * stitches), and the answer to "Do we need a sew-out?" says where the print goes: Needs sew-out, or ready to sew.
 */
type Tab = "email" | "dropbox" | "computer";
const day = (s: string) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "America/Chicago" }) : "");
const inch = (n: number) => `${Math.round(n * 100) / 100}"`;

export default function DigitizedFinder({ designId, where, hint, onClose, onDone }: {
  designId: string | null;
  /** "#40188 · Embark LL Bean Tote · Between handles · D-10286 Embark E" */ where: string;
  /** the words to look for first (the logo's name, the order's name) */ hint: string;
  onClose: () => void;
  /** the files are kept with the logo; `sewout`: the print still needs its sew-out */
  onDone: (set: DigitizedSet, info: DstInfo, sewout: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>("email");
  const [q, setQ] = useState(hint);
  const [mail, setMail] = useState<MailHit[] | null>(null), [dbx, setDbx] = useState<DbxHit[] | null>(null);
  const [picked, setPicked] = useState(""), [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const [files, setFiles] = useState<File[]>([]), [info, setInfo] = useState<DstInfo | null>(null);

  async function search(t = tab, text = q) {
    setErr(""); setBusy("search");
    if (t === "email") { const r = await findDigitizedEmails(text); if (r.ok) setMail(r.list); else setErr(r.error); }
    if (t === "dropbox") { const r = await findDigitizedDropbox(text); if (r.ok) setDbx(r.list); else setErr(r.error); }
    setBusy("");
  }
  useEffect(() => { void search("email", hint); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === "dropbox" && dbx === null && q.trim()) void search("dropbox"); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  /** the package from storage paths (what the server brought in) */
  async function fromStorage(list: { path: string; name: string; type: string }[]) {
    const sb = createClient(), got: File[] = [];
    for (const x of list) { const { data } = await sb.storage.from("proofs").download(x.path); if (data) got.push(new File([data], x.name, { type: x.type || data.type })); }
    await take(got);
  }
  /** the package: zips opened, the DST read */
  async function take(list: File[]) {
    setErr("");
    try {
      // added to what's there: a file of a kind already in is replaced by the new one (an EMB from another tab)
      const got = await expandFiles(list), kind = (f: File) => (f.name.match(/\.(dst|emb|pdf)$/i)?.[1] || "").toLowerCase();
      const all = [...got, ...files.filter((f) => !got.some((g) => kind(g) && kind(g) === kind(f)))];
      const dst = all.find((f) => /\.dst$/i.test(f.name));
      if (!dst) { setFiles(all); setInfo(null); setErr("No DST in those. It's the file the machine sews: add it too."); return; }
      setInfo(readDst(await dst.arrayBuffer()));
      // one DST, its EMB and worksheet (the same name, else the first of each)
      const base = dst.name.replace(/\.[^.]+$/, "").toLowerCase();
      const pick = (re: RegExp) => all.filter((f) => re.test(f.name)).sort((a, b) => Number(b.name.toLowerCase().startsWith(base)) - Number(a.name.toLowerCase().startsWith(base)))[0];
      setFiles([dst, pick(/\.emb$/i), pick(/\.pdf$/i)].filter(Boolean) as File[]);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't read those files."); }
  }
  async function pickMail(h: MailHit) {
    setPicked(h.key); setBusy("take"); setErr("");
    const r = await takeEmailDigitized(h.accountId, h.folder, h.uid, h.messageId);
    if (!r.ok) { setErr(r.error); setBusy(""); return; }
    await fromStorage(r.files); setBusy("");
  }
  async function pickDbx(h: DbxHit) {
    setPicked(h.path); setBusy("take"); setErr("");
    // the stitch file and what sits beside it with the same name (its EMB and worksheet)
    const base = h.name.replace(/\.[^.]+$/, "").toLowerCase();
    const near = (dbx || []).filter((x) => x.folder === h.folder && x.name.replace(/\.[^.]+$/, "").toLowerCase() === base).map((x) => x.path);
    const r = await takeDropboxDigitized([...new Set([h.path, ...near])]);
    if (!r.ok) { setErr(r.error); setBusy(""); return; }
    await fromStorage(r.files); setBusy("");
  }
  async function finish(sewout: boolean) {
    setBusy("save"); setErr("");
    try {
      const { set, info: i } = await takeDigitized(createClient(), designId, files);
      onDone(set, i, sewout);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't keep the files."); setBusy(""); }
  }

  const has = useMemo(() => ({ dst: files.find((f) => /\.dst$/i.test(f.name)), emb: files.find((f) => /\.emb$/i.test(f.name)), pdf: files.find((f) => /\.pdf$/i.test(f.name)) }), [files]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Find the digitized files" onClick={() => !busy && onClose()} onKeyDown={(e) => { if (e.key === "Escape" && !busy) onClose(); }}>
      <div className="dla dgf" onClick={(e) => e.stopPropagation()}>
        <h3>Find the digitized files</h3>
        <p className="dla-sub" data-notranslate>{where}</p>
        <div className="toolbar dgf-bar" data-toolbar>
          <div className="chips" role="tablist">
            {([["email", "Email"], ["dropbox", "Dropbox"], ["computer", "This computer"]] as [Tab, string][]).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={"chip" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab !== "computer" && <form className="dgf-q" onSubmit={(e) => { e.preventDefault(); void search(); }}>
            <input type="search" value={q} placeholder={tab === "email" ? "Logo, order or customer name" : "File name"} aria-label="Search" onChange={(e) => setQ(e.target.value)} />
            <button type="submit" className="btn sm" disabled={!!busy}>{busy === "search" ? "Looking…" : "Search"}</button>
          </form>}
        </div>

        {tab === "email" && <div className="dgf-list">
          <div className="faint dgf-hint">Emails with a DST or EMB attached, in the shop&apos;s mailboxes. Best matches first.</div>
          {mail === null ? <div className="faint">Looking…</div> : !mail.length ? <div className="faint">No emails with stitch files match. Try the logo&apos;s or customer&apos;s name.</div> : mail.map((h) => (
            <button key={h.key} type="button" className={"dgf-hit" + (picked === h.key ? " on" : "")} disabled={busy === "take"} onClick={() => void pickMail(h)}>
              <span className="dgf-t"><b data-notranslate>{h.subject}</b><span className="faint"> · {h.from} · {day(h.date)} · {h.account.split("@")[0]}&apos;s {/sent/i.test(h.folder) ? "sent mail" : h.folder.toLowerCase() === "inbox" ? "inbox" : h.folder}</span></span>
              <span className="dgf-files">{h.files.map((f) => <span key={f} data-notranslate>{f}</span>)}</span>
              {picked === h.key && busy === "take" && <span className="faint">Bringing the files in…</span>}
            </button>
          ))}
        </div>}

        {tab === "dropbox" && <div className="dgf-list">
          <div className="faint dgf-hint">Stitch files in Dropbox named like it; the worksheet PDF beside it comes along.</div>
          {dbx === null ? <div className="faint">{q.trim() ? "Looking…" : "Type a name to look for."}</div> : !dbx.length ? <div className="faint">Nothing in Dropbox by that name.</div> : dbx.filter((h) => /\.(dst|emb|zip)$/i.test(h.name)).map((h) => (
            <button key={h.path} type="button" className={"dgf-hit" + (picked === h.path ? " on" : "")} disabled={busy === "take"} onClick={() => void pickDbx(h)}>
              <span className="dgf-t"><b data-notranslate>{h.name}</b><span className="faint"> · {day(h.date)}</span></span>
              <span className="faint dgf-path" data-notranslate>{h.folder}</span>
            </button>
          ))}
        </div>}

        {tab === "computer" && <label className="dgf-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void take([...e.dataTransfer.files]); }}>
          <b>Drop the zip, or the DST, EMB and PDF here</b>
          <span className="faint">or click to pick them</span>
          <input type="file" hidden multiple accept=".zip,.dst,.DST,.emb,.EMB,.pdf" onChange={(e) => { const x = [...(e.target.files || [])]; e.target.value = ""; if (x.length) void take(x); }} />
        </label>}

        {/* the package: one DST to sew, its EMB to edit in Hatch, the worksheet with the stops and threads */}
        <div className="dgf-pack">
          {([["DST", has.dst, "To sew · needed"], ["EMB", has.emb, "To edit in Hatch"], ["PDF worksheet", has.pdf, "Stops and threads"]] as [string, File | undefined, string][]).map(([k, f, s]) => (
            <div key={k} className={"dgf-slot" + (f ? " ok" : "")}><b>{f ? "✓ " : ""}{k}</b><span className="faint" data-notranslate>{f ? f.name : s}</span></div>
          ))}
        </div>
        {info && <div className="dgf-read">Read from the DST: <b>{inch(info.wIn)} × {inch(info.hIn)} · {info.stitches.toLocaleString()} stitches · {info.colors} color{info.colors === 1 ? "" : "s"}</b>. The order&apos;s print takes these, and its price follows.{(!has.emb || !has.pdf) && <span className="dgf-miss"> {[!has.emb && "the EMB", !has.pdf && "the worksheet"].filter(Boolean).join(" and ")} {!has.emb && !has.pdf ? "are" : "is"} missing: add {!has.emb && !has.pdf ? "them" : "it"} from another tab if you have {!has.emb && !has.pdf ? "them" : "it"}.</span>}</div>}
        {err && <div className="pv-err">{err}</div>}
        {info && has.dst && <div className="dgf-ask">
          <b>Do we need a sew-out?</b>
          <span className="faint">Yes when it&apos;s never been sewn, or its size or thread changed. No when it&apos;s been sewn before and approved.</span>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn primary" disabled={!!busy} onClick={() => void finish(true)}>{busy === "save" ? "Keeping the files…" : "Yes, it goes to Needs sew-out"}</button>
            <button type="button" className="btn" disabled={!!busy} onClick={() => void finish(false)}>No, it&apos;s ready to sew</button>
          </div>
        </div>}
        <div className="dla-acts"><button type="button" className="btn" disabled={busy === "save"} onClick={onClose}>Cancel</button></div>
      </div>
    </div>,
    document.body,
  );
}
