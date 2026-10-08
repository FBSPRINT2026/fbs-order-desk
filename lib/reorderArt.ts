"use client";
import { createClient } from "@/lib/supabase/client";
import { uploadDesign } from "@/lib/designs";
import { artFromMockupPdf, filmFor, measureFilm, type ArtPiece, type FilmPiece } from "@/lib/printavoArt";
import type { EODraft } from "@/lib/emailOrderShared";
import { bodyOf, REF_BODY } from "@/lib/garmentBody";

/**
 * A reorder of an old Printavo job whose mockup is our Illustrator PDF (from the Inbox or the archive's Reorder):
 *  1. the art is pulled out of the mockup (front and back), saved as the customer's designs and put on the prints with
 *     the size and drop it had; size and ink are marked "production confirms" (they're readings, not the real thing);
 *  2. the job's film in Dropbox (FBS Film Folder/<customer>) is found and measured: its size replaces the reading.
 * Returns the films used, to copy onto the new order's production files (attachFilms).
 */
export async function pullReorderArt(x: EODraft, o: { customerId: string; jobLabel?: string; jobDate?: string; onStep?: (s: string) => void }): Promise<{ draft: EODraft; films: { id: string; name: string }[]; notes: string[] }> {
  const films: { id: string; name: string }[] = [], notes: string[] = [];
  if (!x.groups.some((g) => g.imprints.some((im) => !im.design_id))) return { draft: x, films, notes };
  const y = JSON.parse(JSON.stringify(x)) as EODraft, sb = createClient();
  const pulled: { imId: string; widthIn: number; heightIn: number }[] = [];
  for (const g of y.groups) {
    if (!g.pvArt?.length || g.imprints.every((im) => im.design_id)) continue;
    o.onStep?.("Pulling the art from the old Printavo mockup…");
    let got: ArtPiece[] = [], from = "";
    for (const f of g.pvArt) {
      const { data: su } = await sb.storage.from("proofs").createSignedUrl(f.path, 600);
      if (!su?.signedUrl) continue;
      const res = await fetch(su.signedUrl).catch(() => null);
      if (!res?.ok) continue;
      got = await artFromMockupPdf(await res.arrayBuffer(), y.nickname || "Art").catch(() => []);
      if (got.length) { from = f.name; break; }
    }
    if (g.pvArt?.length && !got.length) notes.push("The old mockup has no separate art to pull (it's one flat picture).");
    // the mockup photo shows the garment the size of an adult tee: on a toddler or baby piece the art is smaller
    const body = bodyOf({ sizes: [...new Set(g.lines.flatMap((l) => Object.keys(l.sizes || {})))] });
    const kw = body.widthIn / REF_BODY.widthIn < 0.97 ? body.widthIn / REF_BODY.widthIn : 1, kl = body.lengthIn / REF_BODY.lengthIn < 0.97 ? body.lengthIn / REF_BODY.lengthIn : 1;
    const q = (v: number) => Math.round(v * 4) / 4;
    got = got.map((p) => ({ ...p, widthIn: q(p.widthIn * kw), heightIn: q(p.heightIn * kw), dropIn: q(p.dropIn * kl), offIn: q(p.offIn * kw) }));
    const used = new Set<ArtPiece>();
    for (const im of g.imprints) {
      if (im.design_id || /sleeve/i.test(im.location)) continue;
      const side = /back|yoke|shoulder/i.test(im.location) ? "back" : "front";
      const pc = got.filter((p) => !used.has(p) && p.side === side).sort((a, b) => b.widthIn - a.widthIn)[0];
      if (!pc) continue;
      used.add(pc);
      const dsg = await uploadDesign(sb, { file: pc.file, customer_id: o.customerId, name: `${y.nickname || "Art"} ${side}`, colors: 1, inks: pc.ink, notes: `Pulled from ${from}`, method: im.method });
      im.design_id = dsg.id;
      im.size = `${pc.widthIn}" wide`;
      im.location = side === "back" ? (pc.widthIn <= 4.5 && pc.dropIn < 3.5 ? "Upper Back (Yoke)" : pc.widthIn <= 8 ? "Medium Back" : "Full Back")
        : pc.widthIn > 8 ? "Full Front" : pc.widthIn > 5 ? "Medium Front" : Math.abs(pc.offIn) >= 1.75 ? (pc.offIn > 0 ? "Left Chest" : "Right Chest") : "Center Chest";
      im.drop = String(pc.dropIn);
      if (!im.inks) { im.inks = pc.ink; im.colors = 1; }
      im.notes = [im.notes, `Art, size (${pc.widthIn}" wide) and placement (${pc.dropIn}" down) from the old mockup; ink looks like ${pc.ink} (${pc.hex})`].filter(Boolean).join(". ").slice(0, 300);
      im.confirm = { size: true, ink: true, why: `Reorder of ${from.replace(/ mockup\.pdf$/, "")}: size and placement measured off the old mockup, ink guessed from its color` };
      pulled.push({ imId: im.id, widthIn: pc.widthIn, heightIn: pc.heightIn });
    }
  }
  // the film folder in Dropbox has the real print sizes (and the art itself when the old mockup didn't give it up)
  const bare = y.groups.flatMap((g) => g.imprints.filter((im) => !im.design_id && !/sleeve/i.test(im.location)).map((im) => ({ g, im })));
  if (pulled.length || bare.length) {
    o.onStep?.("Looking for the film in Dropbox…");
    const q = y.nickname || (o.jobLabel || "").replace(/^#\d+\s*/, "").replace(/\s*\(Printavo\)$/, "");
    const r = await fetch(`/api/dropbox/film?customer=${encodeURIComponent(o.customerId)}&q=${encodeURIComponent(q)}&date=${encodeURIComponent(o.jobDate || "")}`).catch(() => null);
    const j = r?.ok ? await r.json().catch(() => null) as { films?: { id: string; name: string; score: number }[]; folder?: string | null; error?: string } | null : null;
    if (!j) notes.push("Dropbox couldn't be searched for the film.");
    else if (!j.folder) notes.push("No film folder found for this customer in Dropbox (link it on the customer page).");
    const cands = (j?.films || []).filter((z) => z.score > 0 && /\.(ai|pdf)$/i.test(z.name)).slice(0, 3);
    if (j?.folder && !cands.length) notes.push(`No film in ${j.folder.replace(/^\/FBS Film Folder\//i, "")} matches "${q}".`);
    for (const f of cands) {
      const c = await fetch("/api/dropbox/film", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id }) }).then((z) => z.json()).catch(() => null) as { url?: string } | null;
      if (!c?.url) continue;
      let fp: FilmPiece[] = [];
      try { fp = await measureFilm(await (await fetch(c.url)).arrayBuffer(), bare.length > 0, y.nickname || "Art"); } catch { notes.push(`${f.name} couldn't be read (save it PDF-compatible in Illustrator).`); continue; }
      if (!fp.length) continue;
      let hit = false;
      for (const pu of pulled) {
        const m = filmFor(pu.widthIn, pu.heightIn, fp);
        if (!m) continue;
        hit = true;
        for (const g of y.groups) for (const im of g.imprints) if (im.id === pu.imId) {
          im.size = `${Math.round(m.widthIn * 4) / 4}" wide`; im.sizeFrom = "film";
          // the film has the real size; the ink is still a guess and placement came from the mockup
          im.confirm = { size: false, ink: true, why: `Size from the film ${f.name}; placement from the old mockup, ink guessed from its color` };
          im.notes = `${(im.notes || "").replace(/size \([\d.]+" wide\) and /, "")}. Size from the film: ${f.name} (${m.widthIn}" × ${m.heightIn}")`.slice(0, 300);
        }
      }
      // prints the mockup gave nothing for: the film's art (the biggest pieces first, fronts first) at its real size
      const left = fp.filter((p) => p.file).sort((a, b) => b.widthIn * b.heightIn - a.widthIn * a.heightIn);
      for (const { g, im } of bare.sort((a, b) => Number(/back|yoke/i.test(a.im.location)) - Number(/back|yoke/i.test(b.im.location)))) {
        const p = left.shift(); if (!p?.file) break;
        hit = true;
        const dsg = await uploadDesign(sb, { file: p.file, customer_id: o.customerId, name: `${y.nickname || "Art"} (from film)`, colors: im.colors || 1, inks: im.inks || "", notes: `From the film ${f.name}`, method: im.method });
        im.design_id = dsg.id;
        im.size = `${Math.round(p.widthIn * 4) / 4}" wide`; im.sizeFrom = "film";
        // the location by size, judged as on an adult tee (a 5" print on a onesie is its full front)
        const body = bodyOf({ sizes: [...new Set(g.lines.flatMap((l) => Object.keys(l.sizes || {})))] });
        const adultW = p.widthIn / Math.min(1, body.widthIn / REF_BODY.widthIn);
        if (!/back|yoke/i.test(im.location)) im.location = adultW > 8 ? "Full Front" : adultW > 5 ? "Medium Front" : "Center Chest";
        im.confirm = { size: true, ink: true, why: `Art and size (${p.widthIn}" × ${p.heightIn}") from the film ${f.name}; placement is the standard one and the ink isn't on file` };
        im.notes = [im.notes, `Art and size from the film: ${f.name} (${p.widthIn}" × ${p.heightIn}")`].filter(Boolean).join(". ").slice(0, 300);
      }
      if (hit) { films.push({ id: f.id, name: f.name }); break; }
    }
  }
  if (notes.length) y.artNotes = notes;
  return { draft: y, films, notes };
}

/** the films a reorder used, into the order's production files */
export async function attachFilms(orderId: string, films: { id: string }[]) {
  for (const f of films) await fetch("/api/dropbox/film", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id, orderId }) }).catch(() => null);
}
