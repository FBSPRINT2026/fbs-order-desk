/**
 * A .zip opened into its files (Nick, Nov 23 2026: Separo's download, "Pasted art-1.zip", is separation.eps + original.png +
 * readme.txt, and uploading it gave an error). Any zip of art or separations works the same: its files are used as if
 * they'd been picked one by one; notes (.txt) and system files are left out.
 */
export async function openZips(fs: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const f of fs) {
    if (!(/\.zip$/i.test(f.name) || /zip/i.test(f.type))) { out.push(f); continue; }
    const { unzip } = await import("@/lib/unzip");
    const inner = await unzip(f).catch(() => [] as File[]);
    out.push(...inner.filter((x) => !/\.(txt|md|rtf|url|html?)$/i.test(x.name)).map((x) => withType(x)));
  }
  return out;
}
export const withType = (f: File) => f.type ? f : new File([f], f.name.replace(/^.*\//, ""), { type: /\.png$/i.test(f.name) ? "image/png" : /\.jpe?g$/i.test(f.name) ? "image/jpeg" : /\.eps$/i.test(f.name) ? "application/postscript" : /\.pdf$/i.test(f.name) ? "application/pdf" : /\.svg$/i.test(f.name) ? "image/svg+xml" : "" });
