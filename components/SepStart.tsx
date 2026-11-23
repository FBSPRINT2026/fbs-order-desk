"use client";

/**
 * "What would you like to do?" when a separation is opened (Nick, Nov 23 2026: Jose "should be able to say… 1, I would
 * like to try to see if you can make the separations… 2, I need to make my own separations, and there should be a link
 * there to download the film… one file with the art set to a PMS color… already has the crop marks, already has the
 * description… then he could upload it back… 3, I'm going to make it in Separo and then upload back"). The choice is
 * kept on the separation (settings.path) and learned from: which way the shop goes for which art.
 */
export type SepPath = "studio" | "own" | "separo";
export default function SepStart({ title, colors, ready, busy, onPick, onStarter, artUrl, onClose }: {
  title: string; colors: number; ready: boolean; busy: string;
  onPick: (p: SepPath) => void;
  /** downloads the starter file (the art in its spot colors, targets and the job's lines) */
  onStarter: () => void;
  artUrl: string; onClose: () => void;
}) {
  return (
    <div className="sst-bg" role="dialog" aria-modal>
      <div className="sst">
        <div className="sst-h"><div><h2>What would you like to do?</h2><p data-notranslate>{title}{colors ? ` · ${colors} color${colors === 1 ? "" : "s"}` : ""}</p></div><button type="button" className="btn sm" onClick={onClose}>✕</button></div>
        <div className="sst-opts">
          <button type="button" className="sst-o" onClick={() => onPick("studio")}>
            <span className="sst-ic sst-a">1</span>
            <span><b>Try our separations</b><small>Opens the Studio: check the proof and the ruler, then Print Films. It asks if they printed right.</small></span>
          </button>
          <div className="sst-o">
            <span className="sst-ic sst-b">2</span>
            <span><b>I&apos;ll make my own in Illustrator</b><small>Download the starter file: the art at print size, each color its own spot swatch, with the targets and the job written on it. Make your films, then save them back here.</small>
              <span className="sst-row">
                <button type="button" className="btn primary sm" disabled={!ready || !!busy} onClick={onStarter}>{busy || (ready ? "Download the starter file" : "Getting the art ready…")}</button>
                <button type="button" className="btn sm" onClick={() => onPick("own")}>Upload my films</button>
              </span>
            </span>
          </div>
          <div className="sst-o">
            <span className="sst-ic sst-c">3</span>
            <span><b>I&apos;ll make it in Separo</b><small>Download the art, separate it in Separo, then drop Separo&apos;s zip back here.</small>
              <span className="sst-row">
                {artUrl && <a className="btn sm" href={artUrl} target="_blank" rel="noreferrer">Download the art</a>}
                <a className="btn sm" href="https://separo.io" target="_blank" rel="noreferrer">Open Separo ↗</a>
                <button type="button" className="btn primary sm" onClick={() => onPick("separo")}>Upload what came back</button>
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
