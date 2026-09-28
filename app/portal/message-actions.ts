"use server";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { mergeSettings } from "@/lib/pricing";
import { attachNote, cleanAttachments, withFiles, type Attachment, type HubMsg } from "@/lib/messages";

type Result = { ok: boolean; error?: string };
const fail = (e: unknown): Result => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong. Try again." });

/**
 * Whose messages: the signed-in customer's own account, or (staff) the customer being previewed with ?as=.
 * Row security decides what a customer can read; the server key is only used after that check.
 */
async function who(as?: string) {
  const { supabase, user, email, isStaff } = await getViewer();
  if (!user) throw new Error("Please sign in again.");
  const admin = createAdminClient();
  if (isStaff) {
    if (!as) throw new Error("Open a customer's portal preview first.");
    const { data: c } = await admin.from("customers").select("id,name,company,email").eq("id", as).maybeSingle();
    if (!c) throw new Error("Customer not found.");
    return { admin, email, preview: true, customers: [c] };
  }
  const { data: cs } = await supabase.from("customers").select("id,name,company,email");
  if (!cs?.length) throw new Error("We couldn't find your account.");
  return { admin, email, preview: false, customers: cs };
}
const sign = (admin: ReturnType<typeof createAdminClient>) => async (paths: string[]) => {
  const { data } = await admin.storage.from("proofs").createSignedUrls(paths, 3600);
  return (data || []).map((d) => d.signedUrl || null);
};

/** Every message on the account (general and per order), oldest first, with links to their files. */
export async function portalMessages(as?: string): Promise<{ ok: boolean; error?: string; messages?: HubMsg[] }> {
  try {
    const { admin, customers } = await who(as);
    const ids = customers.map((c) => c.id);
    const { data: os } = await admin.from("orders").select("id").in("customer_id", ids).neq("status", "quote");
    const oids = (os || []).map((o) => o.id);
    const { data } = await admin.from("messages").select("id, order_id, project_id, topic, author_type, author_name, body, created_at, read_at, attachments")
      .or(`customer_id.in.(${ids.join(",")})${oids.length ? `,order_id.in.(${oids.join(",")})` : ""}`).order("created_at").limit(2000);
    return { ok: true, messages: await withFiles(data || [], sign(admin)) };
  } catch (e) { return fail(e); }
}

/** Step 1 of attaching a file: a one-time link to upload it straight into the customer's message folder. */
export async function portalAttachUrl(fileName: string): Promise<{ ok: boolean; error?: string; path?: string; token?: string }> {
  try {
    const { admin, customers, preview } = await who();
    if (preview) return { ok: false, error: "This is a preview." };
    const path = `messages/${customers[0].id}/${crypto.randomUUID()}/${fileName.replace(/[^\w.\-]+/g, "_").slice(-120) || "file"}`;
    const { data, error } = await admin.storage.from("proofs").createSignedUploadUrl(path);
    if (error || !data) return { ok: false, error: error?.message || "Upload isn't available right now." };
    return { ok: true, path, token: data.token };
  } catch (e) { return fail(e); }
}

/** The customer sends a message: general (no order) or about one of their orders. The shop gets an email. */
export async function portalSend(orderId: string | null, body: string, files: Attachment[] = [], topic = "", projectId: string | null = null): Promise<Result> {
  try {
    const { admin, email, customers, preview } = await who();
    if (preview) return { ok: false, error: "This is a preview. Customers send messages from their own login." };
    const cust = customers[0];
    const attachments = cleanAttachments(files, cust.id);
    const text = body.trim().slice(0, 5000);
    if (!text && !attachments.length) return { ok: false, error: "Write a message first." };
    let number: number | null = null;
    if (orderId) {
      // row security: the customer can only see their own orders
      const { supabase } = await getViewer();
      const { data: o } = await supabase.from("orders").select("id, number").eq("id", orderId).maybeSingle();
      if (!o) return { ok: false, error: "We couldn't find that order." };
      number = o.number;
    }
    let projectName = "";
    if (!orderId && projectId) {
      const { supabase } = await getViewer();
      const { data: pr } = await supabase.from("projects").select("id, name").eq("id", projectId).maybeSingle();
      if (!pr) return { ok: false, error: "We couldn't find that project." };
      projectName = pr.name;
    }
    const author = cust.name || email;
    const tp = orderId && topic === "goods" ? "goods" : "";
    const { error } = await admin.from("messages").insert({ order_id: orderId, customer_id: orderId ? null : cust.id, project_id: orderId ? null : projectName ? projectId : null, topic: tp, author_type: "customer", author_email: email, author_name: author, body: text, attachments });
    if (error) return { ok: false, error: error.message };
    if (SHOP_NOTIFY_EMAIL) {
      const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
      const shop = mergeSettings(s?.data).shop.name;
      const link = orderId ? `${siteUrl()}/shop/orders/${orderId}` : `${siteUrl()}/shop/customers/${cust.id}?area=messages`;
      await sendEmail({ to: SHOP_NOTIFY_EMAIL, subject: number ? `New ${tp ? "goods " : ""}message on #${number}` : projectName ? `New message on project ${projectName}` : `New message from ${cust.company || author}`,
        html: emailLayout(shop, number ? `${author} wrote about #${number}` : `${author} wrote`, (text || "(no text)") + attachNote(attachments, "the order desk"), "Open", link) });
    }
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** The customer opened a conversation: the shop's messages in it are now read. */
export async function portalMarkRead(orderId: string | null, topic = "", projectId: string | null = null): Promise<Result> {
  try {
    const { admin, customers, preview } = await who();
    if (preview) return { ok: true };
    let q = admin.from("messages").update({ read_at: new Date().toISOString() }).eq("author_type", "staff").is("read_at", null);
    if (orderId) {
      const { supabase } = await getViewer();
      const { data: o } = await supabase.from("orders").select("id").eq("id", orderId).maybeSingle();
      if (!o) return { ok: false };
      q = q.eq("order_id", orderId).eq("topic", topic === "goods" ? "goods" : "");
    } else if (projectId) q = q.is("order_id", null).eq("project_id", projectId).in("customer_id", customers.map((c) => c.id));
    else q = q.is("order_id", null).is("project_id", null).in("customer_id", customers.map((c) => c.id));
    await q;
    return { ok: true };
  } catch (e) { return fail(e); }
}
