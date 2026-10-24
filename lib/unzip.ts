/**
 * Opening a .zip in the browser (Oct 23, Nick: the digitizer, Volikes Creative, sends the files back zipped: "RUSH Order
 * Gateway Rebrand.zip" holds Icon Only.DST, Icon Only.EMB and Icon Only.pdf). Reads the zip's directory and inflates
 * each file with the browser's own DecompressionStream; stored (uncompressed) files are copied as they are.
 */
export async function unzip(file: Blob): Promise<File[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // the end of central directory record: the last 22+ bytes, signature 0x06054b50
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("That isn't a zip file.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: File[] = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || /(^|\/)(__MACOSX|\.DS_Store)/.test(name)) continue;
    const lNameLen = dv.getUint16(local + 26, true), lExtraLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(start, start + csize);
    let data: ArrayBuffer;
    if (method === 0) data = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    else if (method === 8) data = await new Response(new Blob([raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
    else continue; // another compression: skipped
    out.push(new File([data], name.split("/").pop() || name));
  }
  return out;
}
