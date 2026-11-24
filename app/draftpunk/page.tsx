import type { Metadata } from "next";

export const metadata: Metadata = { title: "DraftPunk", description: "Homebrew recipes for the club" };

/**
 * DraftPunk (Nick, Nov 23 2026): a homebrew recipe app like BeerSmith, for Nick and his homebrew club, living inside the
 * portal so it needs no new subscription. Its own tables (dp_*, migration 337) and its own look (dp- classes); nothing
 * here touches the shop. Built out in its own project; this is its front door until then.
 */
export default function DraftPunk() {
  return (
    <main className="dp-door" data-notranslate>
      <style>{`
        .dp-door{min-height:100vh;display:grid;place-items:center;background:#16120e;color:#f3e6cf;padding:24px 16px;font-family:var(--body),system-ui,sans-serif}
        .dp-door .dp-card{max-width:520px}
        .dp-door h1{font:800 clamp(40px,9vw,72px)/1 var(--display),system-ui,sans-serif;margin:0 0 12px;color:#e8a13a;letter-spacing:-.02em}
        .dp-door p{font-size:16px;line-height:1.55;margin:0 0 10px;color:#d9c9ad}
        .dp-door .dp-soon{display:inline-block;margin-top:8px;padding:6px 12px;border:1px solid #e8a13a;border-radius:6px;color:#e8a13a;font-size:14px}
      `}</style>
      <div className="dp-card">
        <h1>DraftPunk</h1>
        <p>Build your recipes, brew them, and keep every batch. Each brewer has their own login and recipes; share the good ones with the club.</p>
        <span className="dp-soon">Coming soon</span>
      </div>
    </main>
  );
}
