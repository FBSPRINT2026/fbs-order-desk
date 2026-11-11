import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prodKindLabel } from "@/lib/productionFileKinds";

/**
 * A simple order (the portal's answers and files, or a ClickUp job brought in as a request) as an incoming message, so
 * the one Create order tool reads it like an email (app/shop/actions.ts simpleOrderActivity) and a finished order made
 * from it can be saved as a worked example (lib/ai/orderExamples.ts sourceActivity), however the order was built.
 */
export async function simpleOrderSource(admin: SupabaseClient, orderId: string, email: string): Promise<{ ok: true; activityId: string; text: string } | { ok: false; error: string }> {
    const { data: o } = await admin.from("orders").select("id, number, customer_id, nickname, due_date, delivery_method, ship_to, po_number, notes, submitted_at, simple_order").eq("id", orderId).maybeSingle();
    if (!o?.simple_order) return { ok: false, error: "This isn't a simple order." };
    const s = o.simple_order as { about?: string; qty?: number | null; garments?: string; method?: string; by?: string; /** the file the Order helper said has the sizes, or "message" */ sizes_in?: string; /** what staff told the Order helper */ helper_note?: string };
    const { data: cust } = await admin.from("customers").select("company, name, email").eq("id", o.customer_id).maybeSingle();
    // the files they sent with it (simple_order.files: uploaded in the portal, or brought in from their ClickUp job)
    // The request's own list is the record: a ClickUp job brought in as a request has its files only there, not on
    // art_files (Nov 3, Nick: Reimagine #40461's PDF wasn't in Resources), so each listed file counts, with its art_files
    // row when there is one, plus anything uploaded to the request in the portal
    const listed = ((s as { files?: { path: string; name?: string; kind?: string }[] }).files || []).filter((f) => f?.path);
    const { data: all } = await admin.from("art_files").select("name, file_path, file_type, category").eq("order_id", orderId);
    const rows = (all || []) as { name: string; file_path: string; file_type: string | null; category: string | null }[];
    const typeOf = (p: string) => /\.pdf$/i.test(p) ? "application/pdf" : /\.png$/i.test(p) ? "image/png" : /\.jpe?g$/i.test(p) ? "image/jpeg" : /\.(ai|eps)$/i.test(p) ? "application/postscript" : /\.svg$/i.test(p) ? "image/svg+xml" : "";
    const files = [
      ...listed.map((f) => rows.find((r) => r.file_path === f.path) || { name: f.name || f.path.split("/").pop() || "File", file_path: f.path, file_type: typeOf(f.path), category: f.kind || null }),
      ...rows.filter((r) => r.file_path.startsWith("requests/") && !listed.some((f) => f.path === r.file_path)),
    ];
    const sizes = await Promise.all((files || []).map(async (f) => {
      const dir = String(f.file_path).replace(/\/[^/]+$/, ""), base = String(f.file_path).split("/").pop() || "";
      const { data: l } = await admin.storage.from("proofs").list(dir, { search: base, limit: 5 });
      return (l || []).find((x) => x.name === base)?.metadata?.size as number | undefined;
    }));
    // what each file is, when staff said so (the Order helper, Production files' labels): "Not needed" files stay with
    // the request but aren't read; a vendor's order confirmation is read for who, when and its number, never for sizes
    // (Nov 6, Nick: "it gives us the who it was ordered from, when it's coming, and the order number… But it's not good to
    // take the sizes off of": one confirmation can cover several of their orders)
    const atts = (files || []).map((f, i) => ({ f, i })).filter(({ f }) => f.category !== "not_needed").slice(0, 12).map(({ f, i }) => ({ name: String(f.name), path: String(f.file_path), type: String(f.file_type || ""), size: sizes[i] || 0 }));
    const sizesIn = s.sizes_in || "";
    const sizeSet = new Set(sizesIn.split("|").filter(Boolean));
    const kindWord = (c: string | null, path: string) => (sizeSet.has(path) ? `HAS THE SIZES${c === "supplier_order" ? " (a vendor order confirmation)" : ""}: take its sizes and quantities${sizeSet.size > 1 ? ", added to the other files marked HAS THE SIZES" : ""}`
      : c === "supplier_order" ? "a vendor order confirmation: who the blanks were ordered from, when they arrive and the vendor's order number only; it can cover several orders, so NEVER take sizes or quantities from it"
      : c === "order_sheet" ? "their PO" : c === "art" || c === "print_art" ? "art" : c === "film" ? "their own separations (films), printed as sent: not the art to separate"
      : c === "customer_mockup" ? "their mockup" : c ? prodKindLabel(c).toLowerCase() || "a file" : "a file");
    const kindOf = new Map((files || []).map((f) => [String(f.file_path), kindWord(f.category, String(f.file_path))]));
    const body = [
      `${cust?.company || cust?.name || "The customer"} sent this order from our customer portal as a "simple order": they answered a few questions and uploaded files instead of filling in the order form. It is order #${o.number}; fill it in from what they sent.`,
      s.about ? `What they need, in their words:\n${s.about}` : "",
      o.nickname ? `Order name: ${o.nickname}` : "",
      o.due_date ? `Need it by: ${o.due_date}` : "",
      s.method ? `Decoration: ${({ screen: "screen printing", embroidery: "embroidery", transfer: "transfers (DTF)", mixed: "mixed (more than one kind)" } as Record<string, string>)[s.method] || s.method}` : "",
      o.po_number ? `Their PO #: ${o.po_number}` : "",
      s.qty ? `How many pieces: ${s.qty}` : "",
      s.garments ? `The garments (what they know): ${s.garments}` : "",
      // the form's Pickup is its default, so it never hides the address on their paperwork (Nov 10, Nick: 18 All My Sons
      // orders came in as "Pickup" and were made with no ship-to, though every PO had one): the PO's Ship To wins
      o.delivery_method === "ship" && (o.ship_to || "").trim() ? `How they'll get it: ship to ${o.ship_to}`
        : o.delivery_method === "deliver" && (o.ship_to || "").trim() ? `How they'll get it: local delivery to ${o.ship_to}`
        // the form's own default isn't something they said (Nov 10, #40514: "the form says pickup" was read as their choice,
        // and its carrier words hid the customer's shipping default and kept the order from teaching it): no carrier words here
        : `How they'll get it: not chosen on the form. A Ship To address on their PO or another file means it goes there: put that whole address block in ship_to (name, ATTN, street, city) and set delivery to ship. Leave delivery empty unless their files say how.`,
      atts.length ? `Their files: ${atts.map((f) => `${f.name} (${kindOf.get(f.path)})`).join("; ")}` : "",
      sizeSet.has("message") ? `The sizes and quantities are in their message above${sizeSet.size > 1 ? " (with the files marked HAS THE SIZES)" : ", not in a file"}.` : "",
      s.helper_note ? `Staff say: ${s.helper_note}` : "",
    ].filter(Boolean).join("\n\n");
    const ext = `portal-simple:${orderId}`;
    const row = { customer_id: o.customer_id, kind: "portal", direction: "in", subject: `Simple order #${o.number}${o.nickname ? `: ${o.nickname}` : ""}`, body, from_email: s.by || cust?.email || "", to_email: "",
      external_id: ext, thread_id: ext, occurred_at: o.submitted_at || new Date().toISOString(), order_id: null,
      meta: { source: "portal", from_name: cust?.name || cust?.company || "", attachments: atts, att_checked: true, into_order: orderId }, created_by: email };
    const { data: have } = await admin.from("activities").select("id").eq("external_id", ext).maybeSingle();
    if (have) { const { error } = await admin.from("activities").update(row).eq("id", have.id); if (error) return { ok: false, error: error.message }; return { ok: true, activityId: have.id as string, text: row.subject }; }
    const { data: made, error } = await admin.from("activities").insert(row).select("id").single();
    if (error || !made) return { ok: false, error: error?.message || "Couldn't bring it in." };
    return { ok: true, activityId: made.id as string, text: row.subject };
}
