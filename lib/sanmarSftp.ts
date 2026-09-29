import "server-only";

/**
 * SanMar's SFTP (ftp.sanmar.com:2200): catalog files (SanMarPI bulk/delta CSVs, sanmar_pdd.txt) and, later, order files.
 * Login in Vercel env vars SANMAR_SFTP_USERNAME / SANMAR_SFTP_PASSWORD (from SanMar's one-time link). Read-only use.
 */
export const sanmarSftpConfigured = () => !!(process.env.SANMAR_SFTP_USERNAME?.trim() && process.env.SANMAR_SFTP_PASSWORD?.trim());

export type SftpEntry = { path: string; size: number; modified: string; dir: boolean };

/** Lists the top folder and one level of subfolders (names, sizes, dates). */
export async function sanmarSftpList(maxSub = 6): Promise<SftpEntry[]> {
  // @ts-ignore -- no type package installed; only Client is used
  const { Client } = (await import("ssh2")) as unknown as { Client: new () => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const conn = new Client();
  return new Promise<SftpEntry[]>((resolve, reject) => {
    const fail = (e: unknown) => { try { conn.end(); } catch { /* closed */ } reject(e instanceof Error ? e : new Error(String(e))); };
    const timer = setTimeout(() => fail(new Error("SanMar's FTP didn't answer in time.")), 25000);
    conn.on("error", (e: Error) => { clearTimeout(timer); fail(new Error(/auth/i.test(e.message) ? "SanMar's FTP rejected the username or password." : e.message)); });
    conn.on("ready", () => {
      conn.sftp((err: Error | undefined, sftp: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (err) { clearTimeout(timer); return fail(err); }
        type Item = { filename: string; attrs: { size: number; mtime: number; isDirectory: () => boolean } };
        const read = (dir: string) => new Promise<Item[]>((res, rej) => sftp.readdir(dir, (e: Error | undefined, list: Item[]) => (e ? rej(e) : res(list || []))));
        const toEntry = (base: string, it: Item): SftpEntry => ({ path: (base === "." ? "" : base + "/") + it.filename, size: it.attrs.size, modified: new Date(it.attrs.mtime * 1000).toISOString(), dir: it.attrs.isDirectory() });
        (async () => {
          const top = (await read(".")).filter((i) => !i.filename.startsWith(".")).map((i) => toEntry(".", i));
          const out = [...top];
          for (const d of top.filter((e) => e.dir).slice(0, maxSub)) {
            try { out.push(...(await read(d.path)).filter((i) => !i.filename.startsWith(".")).map((i) => toEntry(d.path, i))); } catch { /* no access to that folder */ }
          }
          return out;
        })().then((r) => { clearTimeout(timer); conn.end(); resolve(r); }, (e) => { clearTimeout(timer); fail(e); });
      });
    });
    conn.connect({ host: "ftp.sanmar.com", port: 2200, username: process.env.SANMAR_SFTP_USERNAME!.trim(), password: process.env.SANMAR_SFTP_PASSWORD!.trim(), readyTimeout: 20000 });
  });
}
