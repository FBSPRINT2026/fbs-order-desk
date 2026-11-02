/**
 * An Outlook email dragged out of Outlook (a .msg file) read in the browser (Nov 1, Nick: "I want to be able to drag
 * in an email from Outlook… doesn't this have the message and the attachments?"). No library: a .msg is a Compound
 * File (the old Office container: sectors, a FAT, a directory of streams), and the email's fields are streams named
 * by their property ("__substg1.0_0037001F" is the subject); each attachment is a storage of its own with its name
 * and its bytes. Strings are UTF-16 (…001F) or the sender's code page (…001E, read as Latin-1).
 */
export type MsgAttachment = { name: string; type: string; data: Uint8Array };
export type OutlookMsg = { subject: string; from: string; fromEmail: string; to: string; cc: string; date: string; body: string; attachments: MsgAttachment[] };

type Entry = { name: string; type: number; left: number; right: number; child: number; start: number; size: number };
const END = 0xfffffffe, FREE = 0xffffffff;

function cfb(buf: ArrayBuffer) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  if (dv.getUint32(0, true) !== 0xe011cfd0 || dv.getUint32(4, true) !== 0xe11ab1a1) throw new Error("That isn't an Outlook email (.msg).");
  const shift = dv.getUint16(0x1e, true), miniShift = dv.getUint16(0x20, true), size = 1 << shift, miniSize = 1 << miniShift;
  const nFat = dv.getUint32(0x2c, true), dir0 = dv.getUint32(0x30, true), cutoff = dv.getUint32(0x38, true);
  const miniFat0 = dv.getUint32(0x3c, true), difat0 = dv.getUint32(0x44, true);
  const at = (s: number) => (s + 1) * size;
  // the FAT's own sectors: 109 in the header, the rest in the DIFAT chain
  const fatSecs: number[] = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) { const s = dv.getUint32(0x4c + i * 4, true); if (s !== FREE) fatSecs.push(s); }
  for (let d = difat0, guard = 0; d !== END && d !== FREE && fatSecs.length < nFat && guard < 10000; guard++) {
    for (let i = 0; i < size / 4 - 1 && fatSecs.length < nFat; i++) { const s = dv.getUint32(at(d) + i * 4, true); if (s !== FREE) fatSecs.push(s); }
    d = dv.getUint32(at(d) + size - 4, true);
  }
  const fat: number[] = [];
  for (const s of fatSecs) for (let i = 0; i < size / 4; i++) fat.push(dv.getUint32(at(s) + i * 4, true));
  const chain = (s: number, t: number[]) => { const out: number[] = []; for (let g = 0; s !== END && s !== FREE && s < t.length && g < 1e6; g++) { out.push(s); s = t[s]; } return out; };
  const read = (s: number, len: number) => { const out = new Uint8Array(len); let o = 0; for (const c of chain(s, fat)) { const n = Math.min(size, len - o); if (n <= 0) break; out.set(u8.subarray(at(c), at(c) + n), o); o += n; } return out; };
  // the directory
  const dirBytes = (() => { const cs = chain(dir0, fat); const b = new Uint8Array(cs.length * size); cs.forEach((c, i) => b.set(u8.subarray(at(c), at(c) + size), i * size)); return b; })();
  const ddv = new DataView(dirBytes.buffer);
  const entries: Entry[] = [];
  for (let o = 0; o + 128 <= dirBytes.length; o += 128) {
    const nl = ddv.getUint16(o + 0x40, true);
    let name = ""; for (let i = 0; i + 1 < nl - 2 + 1 && i < 64; i += 2) { const ch = ddv.getUint16(o + i, true); if (!ch) break; name += String.fromCharCode(ch); }
    entries.push({ name, type: dirBytes[o + 0x42], left: ddv.getUint32(o + 0x44, true), right: ddv.getUint32(o + 0x48, true), child: ddv.getUint32(o + 0x4c, true), start: ddv.getUint32(o + 0x74, true), size: ddv.getUint32(o + 0x78, true) });
  }
  const root = entries[0];
  const miniStream = root ? read(root.start, root.size) : new Uint8Array();
  const miniFat: number[] = [];
  for (const s of chain(miniFat0, fat)) for (let i = 0; i < size / 4; i++) miniFat.push(dv.getUint32(at(s) + i * 4, true));
  const data = (e: Entry) => {
    if (e.size >= cutoff) return read(e.start, e.size);
    const out = new Uint8Array(e.size); let o = 0;
    for (const c of chain(e.start, miniFat)) { const n = Math.min(miniSize, e.size - o); if (n <= 0) break; out.set(miniStream.subarray(c * miniSize, c * miniSize + n), o); o += n; }
    return out;
  };
  /** a storage's children (its red-black tree, walked) */
  const kids = (e: Entry) => {
    const out: Entry[] = [], stack = [e.child], seen = new Set<number>();
    while (stack.length) { const i = stack.pop()!; if (i === FREE || i >= entries.length || seen.has(i)) continue; seen.add(i); const x = entries[i]; out.push(x); stack.push(x.left, x.right); }
    return out;
  };
  return { root, kids, data };
}

const utf16 = (b: Uint8Array) => { let s = ""; for (let i = 0; i + 1 < b.length; i += 2) { const c = b[i] | (b[i + 1] << 8); if (!c) break; s += String.fromCharCode(c); } return s; };
const latin1 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i++) { if (!b[i]) break; s += String.fromCharCode(b[i]); } return s; };

export function readMsg(buf: ArrayBuffer): OutlookMsg {
  const f = cfb(buf);
  const props = (list: Entry[]) => {
    const m = new Map<string, Entry>();
    for (const e of list) { const k = /^__substg1\.0_([0-9A-F]{8})$/i.exec(e.name)?.[1]?.toUpperCase(); if (k) m.set(k, e); }
    const str = (tag: string) => { const u = m.get(`${tag}001F`); if (u) return utf16(f.data(u)); const a = m.get(`${tag}001E`); return a ? latin1(f.data(a)) : ""; };
    const bin = (tag: string) => { const e = m.get(`${tag}0102`); return e ? f.data(e) : null; };
    return { str, bin };
  };
  const top = f.kids(f.root);
  const p = props(top);
  let body = p.str("1000");
  if (!body.trim()) {
    const html = p.bin("1013") || (p.str("1013") ? new TextEncoder().encode(p.str("1013")) : null);
    if (html) body = new TextDecoder().decode(html).replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ");
  }
  const fromEmail = p.str("5D01") || p.str("0C1F") || p.str("0065");
  const attachments: MsgAttachment[] = [];
  for (const st of top.filter((e) => e.type === 1 && /^__attach_version1\.0_/i.test(e.name))) {
    const a = props(f.kids(st));
    const data = a.bin("3701");
    if (!data || !data.length) continue; // an attached email or an OLE object: not a file
    const name = a.str("3707") || a.str("3704") || a.str("3001") || "attachment";
    attachments.push({ name, type: a.str("370E") || "", data });
  }
  return { subject: p.str("0037"), from: p.str("0C1A") || p.str("0042"), fromEmail: /@/.test(fromEmail) ? fromEmail : "", to: p.str("0E04"), cc: p.str("0E03"), date: "", body: body.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(), attachments };
}
