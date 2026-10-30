/* Pure HTML pieces for emails (no server code), so a page that builds an email on screen uses the same ones. */
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/**
 * Pieces every email uses, built so mail programs show them right (Oct 30, Nick: the proof email's picture was squashed,
 * the quote's picture didn't show, and the button showed as a highlighted link). Mail programs ignore object-fit and
 * drop drawn boxes, and some strip a link's padding and color:
 * - emailButton: the button is a colored table cell (Outlook keeps it) with white text in the link and a span inside it;
 * - emailThumb: a picture keeps its shape: a fixed width, height left to the picture, centered in a square tile;
 * - EMAIL_DOC_PIC: the little document picture for a quote or invoice (a real image, public/email/quote-doc.png).
 */
export function emailButton(url: string, label: string, color = "#0E9BD8") {
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto"><tr><td bgcolor="${color}" style="background:${color};border-radius:6px;mso-padding-alt:12px 26px"><a href="${url}" style="display:inline-block;padding:12px 26px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;line-height:1.2;border-radius:6px;background:${color}"><span style="color:#ffffff">${escape(label)}</span></a></td></tr></table>`;
}
export function emailThumb(src: string, size = 56, href = "") {
  const img = `<img src="${src}" width="${size}" alt="" style="display:block;width:${size}px;max-width:${size}px;height:auto;max-height:${size}px;margin:0 auto;border:0" />`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="${size}" style="width:${size}px;border:1px solid #E6EAF0;border-radius:6px;background:#FFFFFF"><tr><td width="${size}" height="${size}" align="center" valign="middle" style="width:${size}px;height:${size}px;text-align:center;vertical-align:middle;border-radius:6px;overflow:hidden">${href ? `<a href="${href}">${img}</a>` : img}</td></tr></table>`;
}
