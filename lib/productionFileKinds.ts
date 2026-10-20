/**
 * What a production file is (Oct 20, Nick: "create some categories of production files… down the road… someone on our
 * fulfillment team… 'let's go in and print the barcode for order 362'… for now it should just be the file, a label of
 * what it is, and the type"). Staff only, like every production file: `art_files.category` (migration 177). Kept as
 * these keys so automations can find a job's barcode, film, mailing list… later.
 */
export const PROD_KINDS = [
  { k: "barcodes", label: "Barcodes / labels", hint: "UPC or SKU barcodes, hang tags, poly bag labels" },
  { k: "mailing", label: "Mailing list / addresses", hint: "Ship-to lists for drop ships and mailing" },
  { k: "packing", label: "Packing instructions", hint: "Folding, bagging, sorting by store, kits" },
  { k: "packing_slip", label: "Packing slip / paperwork", hint: "The customer's paperwork that goes in the box" },
  { k: "film", label: "Film / separations", hint: "Printed films, separated files, spot color seps" },
  { k: "print_art", label: "Print-ready art", hint: "The file we print from: AI, EPS, PDF, PNG" },
  { k: "embroidery", label: "Embroidery file", hint: "DST, EMB, PES…" },
  { k: "old_mockup", label: "Old mockup", hint: "Our earlier mockup, for reference" },
  { k: "customer_mockup", label: "Customer mockup", hint: "The mockup they sent us" },
  { k: "placement", label: "Placement / print guide", hint: "Placement, sizes per garment, position notes" },
  { k: "brand", label: "Style / brand guide", hint: "Their colors, fonts, logo rules" },
  { k: "ink", label: "Ink / color reference", hint: "PMS swatches, ink formulas, color matches" },
  { k: "order_sheet", label: "Size breakdown / order sheet", hint: "Their spreadsheet, store and warehouse sheets" },
  { k: "proof", label: "Approved proof", hint: "The signed-off proof" },
  { k: "photo", label: "Photo", hint: "A real photo: first off the press, finished product, a sample" },
  { k: "other", label: "Other", hint: "Anything else" },
] as const;
export type ProdKind = (typeof PROD_KINDS)[number]["k"];
export const prodKindLabel = (k: string | null | undefined) => PROD_KINDS.find((x) => x.k === k)?.label || "";

/** what kind of file it is, from its name and type: "PDF", "Illustrator", "Embroidery (DST)", "Image", "Spreadsheet"… */
export function fileTypeOf(name: string, mime?: string | null) {
  const e = (name.split("?")[0].split(".").pop() || "").toLowerCase();
  if (/^(dst|emb|pes|exp|jef|vp3|pxf|hus|xxx|vip|sew)$/.test(e)) return `Embroidery (${e.toUpperCase()})`;
  if (e === "pdf" || /pdf/.test(mime || "")) return "PDF";
  if (e === "ai") return "Illustrator";
  if (/^(eps|svg)$/.test(e)) return `Vector (${e.toUpperCase()})`;
  if (/^(psd)$/.test(e)) return "Photoshop";
  if (/^(png|jpe?g|gif|webp|heic|tiff?)$/.test(e) || /^image\//.test(mime || "")) return `Image (${e.toUpperCase() || "picture"})`;
  if (/^(xlsx?|csv|numbers)$/.test(e)) return "Spreadsheet";
  if (/^(docx?|txt|rtf)$/.test(e)) return "Document";
  if (/^(zip|rar|7z)$/.test(e)) return "Zip";
  return e ? e.toUpperCase() : "File";
}

/** a first guess from the name (shown as a suggestion, never saved by itself) */
export function guessProdKind(name: string): ProdKind | "" {
  const n = name.toLowerCase();
  if (/barcode|label|upc|sku|hang ?tag/.test(n)) return "barcodes";
  if (/mailing|address|ship ?to|drop ?ship/.test(n)) return "mailing";
  if (/film|sep(s|aration)?\b/.test(n)) return "film";
  if (/\.(dst|emb|pes|exp|jef|vp3|pxf)$/.test(n)) return "embroidery";
  if (/mock/.test(n)) return "old_mockup";
  if (/proof/.test(n)) return "proof";
  if (/brand|style ?guide/.test(n)) return "brand";
  if (/\.(xlsx?|csv)$/.test(n)) return "order_sheet";
  return "";
}
