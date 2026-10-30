/**
 * The files picked in a file input, kept (Oct 30, Nick: "when I add the sew files, it doesn't do anything"): an input's
 * FileList is live, so clearing the input (value = "", done so the same file can be picked again) empties it. A handler
 * that reads the files after an await then sees none ("No DST in those files"). Every file input passes its files
 * through this before clearing.
 */
export function heldFiles(list: FileList | null | undefined): FileList | null {
  if (!list) return null;
  try { const dt = new DataTransfer(); for (const f of Array.from(list)) dt.items.add(f); return dt.files; } catch { return list; }
}
