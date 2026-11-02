/** "We're not charging for this" (Nov 1, Nick: "a dollar sign with a Ghostbusters circle… cross through symbol"): a dollar
 *  sign in a circle with a slash, in the OK color. Used wherever a fee is waived (a PMS already matched on another print). */
export default function NoCharge({ title = "No charge", size = 14 }: { title?: string; size?: number }) {
  return (
    <svg className="nochg" width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={title}>
      <title>{title}</title>
      <circle cx="8" cy="8" r="6.6" fill="none" strokeWidth="1.4" />
      <text x="8" y="11.4" textAnchor="middle">$</text>
      <line x1="3.4" y1="3.4" x2="12.6" y2="12.6" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
