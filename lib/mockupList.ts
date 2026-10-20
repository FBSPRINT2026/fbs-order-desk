/**
 * A customer's mockup library shows each mockup once (Oct 20, Nick: a reorder of an order made here "references the
 * mock-up back at 40003… you're not creating new mock-ups… you just want the one version from the original order in
 * their company file"). A reorder or duplicate keeps a row for its own order (proofs, the work order and Send to
 * Printavo read them) pointing at the same picture; the library lists the original only.
 */
export function oneOfEach<T extends { file_path: string; created_at?: string | null }>(rows: T[]): T[] {
  const first = new Map<string, T>();
  for (const r of rows) { const h = first.get(r.file_path); if (!h || String(r.created_at || "") < String(h.created_at || "")) first.set(r.file_path, r); }
  return rows.filter((r) => first.get(r.file_path) === r);
}
