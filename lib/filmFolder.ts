"use client";
/**
 * "Print films": the portal writes the films straight into FilmMaker's hot folder on the film PC, and FilmMaker prints
 * whatever lands there. The folder is picked once in the browser (Chrome / Edge: the File System Access API), kept in
 * this browser (IndexedDB), and written to on every Print with no save dialog. Browsers without it (Safari, Firefox,
 * phones) download the file instead.
 */
type Perm = "granted" | "denied" | "prompt";
export type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?: (o: { mode: "readwrite" }) => Promise<Perm>;
  requestPermission?: (o: { mode: "readwrite" }) => Promise<Perm>;
};
const DB = "fbs-films", STORE = "folders", KEY = "filmmaker";

function db(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((ok, no) => { const q = f(d.transaction(STORE, mode).objectStore(STORE)); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); });
}

/** this browser can write into a folder (Chrome and Edge on a computer) */
export const folderPrintable = () => typeof window !== "undefined" && "showDirectoryPicker" in window && typeof indexedDB !== "undefined";

/** the hot folder picked on this computer, if any */
export async function savedFolder(): Promise<DirHandle | null> {
  if (!folderPrintable()) return null;
  try { return ((await tx("readonly", (s) => s.get(KEY))) as DirHandle | undefined) || null; } catch { return null; }
}

/** pick the hot folder (must run from a click) */
export async function pickFolder(): Promise<DirHandle> {
  const pick = (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandle> }).showDirectoryPicker;
  const h = await pick({ id: "filmmaker-hot-folder", mode: "readwrite", startIn: "desktop" });
  await tx("readwrite", (s) => s.put(h, KEY));
  return h;
}

export async function forgetFolder() { try { await tx("readwrite", (s) => s.delete(KEY)); } catch { /* nothing saved */ } }

/**
 * ask for the hot folder right away, while the click still counts (Oct 22, Jose on #40092: "Failed to execute
 * 'requestPermission'… User activation is required": the films took longer to make than the browser lets a click
 * count, so asking afterwards failed). Pass the folder already loaded on the page so nothing slow comes first.
 */
export async function allowFolder(h?: DirHandle | null): Promise<"granted" | "no-folder" | "denied"> {
  const d = h || (await savedFolder());
  if (!d) return "no-folder";
  let p: Perm = (await d.queryPermission?.({ mode: "readwrite" })) ?? "granted";
  if (p !== "granted") { try { p = (await d.requestPermission?.({ mode: "readwrite" })) ?? "denied"; } catch { p = "denied"; } }
  return p === "granted" ? "granted" : "denied";
}

/**
 * write the films into the hot folder (must run from a click: the browser may ask once to allow it again).
 * "no-folder": none picked yet; "denied": the browser wasn't allowed; "gone": the folder was moved or deleted.
 */
export async function sendToFolder(bytes: Uint8Array, name: string): Promise<"sent" | "no-folder" | "denied" | "gone"> {
  const h = await savedFolder();
  if (!h) return "no-folder";
  // allowed already (allowFolder, at the click); asking again here would fail once the click has expired
  let p: Perm = (await h.queryPermission?.({ mode: "readwrite" })) ?? "granted";
  if (p !== "granted") { try { p = (await h.requestPermission?.({ mode: "readwrite" })) ?? "denied"; } catch { p = "denied"; } }
  if (p !== "granted") return "denied";
  try {
    // Chrome writes to "name.crswap" and renames it when done, so FilmMaker never picks up half a file
    const f = await h.getFileHandle(name, { create: true });
    const w = await f.createWritable();
    await w.write(bytes as unknown as BufferSource); await w.close();
    return "sent";
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotFoundError") return "gone";
    throw e;
  }
}
