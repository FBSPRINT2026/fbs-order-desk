import { qrSvg } from "@/lib/qr";

export const dynamic = "force-static";

/** The sign for the wall (Nov 13, the crew phone views): one QR to portal.fbsprint.com/crew, English and Spanish. Letter, print it. */
export default function CrewSign() {
  const qr = qrSvg("https://portal.fbsprint.com/crew", 2).svg;
  return (
    <div className="crs">
      <style>{`@page{size:letter;margin:0}body{margin:0;background:#fff}.crs{width:8.5in;height:11in;box-sizing:border-box;margin:0 auto;padding:.7in .75in .6in;display:flex;flex-direction:column;align-items:center;color:#121925;font-family:var(--body,system-ui,sans-serif);background:#fff}.crs-bar{align-self:stretch;height:14px;border-radius:7px;background:linear-gradient(90deg,#0e9bd8 0%,#f26660 52%,#fcb122 100%)}.crs img{height:.75in;margin-top:.45in}.crs h1{margin:.2in 0 0;font-family:var(--display,sans-serif);font-stretch:80%;font-weight:900;font-size:84px;line-height:1;text-align:center}.crs h2{margin:.08in 0 0;font-family:var(--display,sans-serif);font-stretch:80%;font-weight:700;font-size:40px;color:#4A566B}.crs-qr{width:4.5in;height:4.5in;margin-top:.4in}.crs-qr svg{width:100%;height:100%;display:block}.crs-url{margin:.2in 0 0;font-size:26px;font-weight:800}.crs-steps{margin-top:auto;align-self:stretch;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;text-align:center;font-size:18px}.crs-steps b{display:block;font-size:30px;font-family:var(--display,sans-serif)}.crs-steps span{color:#5f6b80}.crs-print{position:fixed;top:12px;right:12px;padding:10px 16px;border:0;border-radius:8px;background:#0e9bd8;color:#fff;font:inherit;font-weight:800;cursor:pointer}@media print{.crs-print{display:none}}`}</style>
      <button type="button" className="crs-print" data-print>Print</button>
      <script dangerouslySetInnerHTML={{ __html: "document.querySelector('[data-print]').onclick=function(){print()}" }} />
      <div className="crs-bar" />
      <img src="/brand/fbs-logo.svg" alt="FBS Print" />
      <h1>Scan to start</h1>
      <h2>Escanea para empezar</h2>
      <div className="crs-qr" dangerouslySetInnerHTML={{ __html: qr }} />
      <p className="crs-url">portal.fbsprint.com/crew</p>
      <div className="crs-steps">
        <div><b>1</b>Scan with your phone&apos;s camera<br /><span>Escanea con la cámara</span></div>
        <div><b>2</b>Employee # and PIN, once<br /><span>Nº de empleado y PIN</span></div>
        <div><b>3</b>On the shop Wi-Fi<br /><span>Usa el Wi-Fi del taller</span></div>
      </div>
    </div>
  );
}
