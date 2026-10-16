/**
 * Styles for the invoice / quote PDF and the work order (Oct 15, Nick approved the examples: "push it").
 * Rendered in a <style> tag on the print page only, so the letter-size @page rule never reaches other pages.
 */
export const DOC_CSS = `
.pdoc{--ink:#141D2B;--ink2:#3c4658;--ink3:#6b7587;--line:#d6dbe3;--line2:#e8ebf0;--blue:#0e9bd8;--salmon:#f26660;--orange:#fcb122;--fade:linear-gradient(90deg,#0e9bd8 0%,#f26660 52%,#fcb122 100%);--ok:#1a8a5a;
  background:#c9ced6;min-height:100vh;padding:0 12px 24px;color:var(--ink);font-family:"Public Sans",system-ui,-apple-system,"Segoe UI",sans-serif;font-size:11pt;line-height:1.35;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;overflow-x:auto}
.pdoc *{box-sizing:border-box}
.pdoc .print-bar{max-width:8.5in;margin:0 auto;padding:14px 0;display:flex;gap:8px}
.pdoc .sheet{width:8.5in;min-height:11in;background:#fff;margin:0 auto 18px;padding:.42in .45in .32in;display:flex;flex-direction:column;box-shadow:0 2px 12px rgba(20,29,43,.18);position:relative}
.pdoc .disp{font-family:"Archivo","Arial Narrow",sans-serif;font-weight:800;font-stretch:88%;letter-spacing:-.01em}
.pdoc .fade{height:5px;border-radius:5px;background:var(--fade)}
.pdoc .lbl{font-size:9pt;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.06em}
.pdoc .sw{display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid rgba(0,0,0,.25);vertical-align:-2px;margin-right:6px;flex:none}
.pdoc .cb{display:inline-block;width:14px;height:14px;border:1.5px solid var(--ink);border-radius:3px;vertical-align:-2px}
.pdoc .faint{color:var(--ink3)}
.pdoc .foot{margin-top:auto;padding-top:14px;display:flex;justify-content:space-between;gap:12px;font-size:8.5pt;color:var(--ink3)}
.pdoc img{max-width:100%}

/* work order: the job page */
.pdoc .hd{display:grid;grid-template-columns:1fr auto auto;gap:18px;align-items:start}
.pdoc .hd h1{margin:2px 0 0;font-size:34pt;line-height:1}
.pdoc .hd .who{font-size:13pt;margin-top:6px;color:var(--ink2)}
.pdoc .hd .who b{color:var(--ink)}
.pdoc .flags{display:flex;gap:8px;margin:10px 0 0;flex-wrap:wrap}
.pdoc .flag{white-space:nowrap;font-size:9.5pt;font-weight:800;padding:3px 10px;border-radius:6px;letter-spacing:.04em}
.pdoc .flag.cs{background:#e7f5fc;color:#0a6f9c;border:1.5px solid var(--blue)}
.pdoc .flag.pv{background:#fff4e0;color:#8a5a00;border:1.5px solid var(--orange)}
.pdoc .flag.rush{background:#fdeceb;color:#b3261e;border:1.5px solid var(--salmon)}
.pdoc .flag.grp{background:#f2f4f7;color:var(--ink2);border:1.5px solid var(--line)}
.pdoc .due{border:3px solid var(--ink);border-radius:10px;padding:8px 14px;text-align:center;min-width:1.9in}
.pdoc .due .d{font-size:24pt;line-height:1.05;white-space:nowrap}
.pdoc .due small{display:block;font-size:10pt;color:var(--ink2);margin-top:3px;white-space:nowrap}
.pdoc .codes{display:flex;flex-direction:column;align-items:center;gap:4px}
.pdoc .qr{width:.95in;height:.95in}
.pdoc .qr svg{width:100%;height:100%;display:block}
.pdoc .codes small{font-size:7.5pt;color:var(--ink3);text-align:center;max-width:1.1in;line-height:1.15}
.pdoc h2{font-family:"Archivo","Arial Narrow",sans-serif;font-weight:800;font-stretch:88%;font-size:13pt;margin:16px 0 6px;display:flex;align-items:baseline;gap:8px}
.pdoc h2 span{font-family:"Public Sans",sans-serif;font-size:9.5pt;color:var(--ink3);font-weight:600}
.pdoc .hero{display:grid;grid-template-columns:4.6in 1fr;gap:18px;margin-top:12px;align-items:stretch}
.pdoc .mk{background:#f4f5f7;border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:10px;height:4.55in}
.pdoc .mk img.big{flex:1 1 0;min-height:0;width:100%!important;height:100%!important;max-width:none;object-fit:contain;mix-blend-mode:multiply}
.pdoc .mk .more{display:flex;gap:6px;margin-top:6px}
.pdoc .mk .more img{flex:none;object-fit:contain;mix-blend-mode:multiply;width:.85in;height:.75in;background:#fff;border-radius:6px}
.pdoc .mk span{font-size:9pt;color:var(--ink3);margin-top:4px}
.pdoc .mk .none{flex:1;display:grid;place-items:center;font-size:12pt;color:var(--ink3);border-radius:10px;width:100%}
.pdoc .hero.h2l .mk{height:3.7in}
.pdoc .hero.h3l .mk{height:3.1in}
.pdoc .hp{display:flex;flex-direction:column;gap:10px}
.pdoc .pp{border:2px solid var(--ink);border-radius:12px;padding:11px 14px;display:flex;flex-direction:column;gap:4px}
.pdoc .pp .t{font-size:22pt;line-height:1}
.pdoc .pp .s{font-size:12.5pt;color:var(--ink2);display:flex;align-items:center;flex-wrap:wrap;gap:0 4px}
.pdoc .pp .s b{color:var(--ink)}
.pdoc .pp .s.inks{gap:2px 14px}
.pdoc .pp .s.inks .ink{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.pdoc .pp .s.f{font-size:10pt;color:var(--ink3);margin-top:3px}
.pdoc .hp.many .pp{padding:7px 11px;gap:2px}
.pdoc .hp.many .pp .t{font-size:15pt}
.pdoc .hp.many .pp .s{font-size:10.5pt}
.pdoc .warn{font-size:9.5pt;font-weight:800;color:#b3261e;letter-spacing:.03em}
.pdoc table.cnt{width:100%;border-collapse:collapse;font-size:12pt}
.pdoc .cnt th{font-size:9pt;color:var(--ink3);text-transform:uppercase;letter-spacing:.05em;text-align:left;padding:4px 6px;border-bottom:2px solid var(--ink)}
.pdoc .cnt th.sz,.pdoc .cnt td.sz{text-align:center;width:.66in}
.pdoc .cnt td{padding:7px 6px;border-bottom:1px solid var(--line);vertical-align:middle}
.pdoc .cnt td.g b{font-size:13pt}
.pdoc .cnt td.sz b{font-size:20pt}
.pdoc .cnt td.tot{text-align:center;width:.85in;background:#f2f4f7}
.pdoc .cnt td.tot b{font-size:22pt}
.pdoc .cnt tr.counted td{border-bottom:1px solid var(--line)}
.pdoc .cnt tr.counted.last td{border-bottom:2px solid var(--ink)}
.pdoc .cnt tr.counted td.sz div{height:.36in;border:1.5px dashed #9aa3b2;border-radius:5px}
.pdoc .cnt tr.counted td:first-child{font-size:9.5pt;color:var(--ink3);font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.pdoc .cnt tr.counted td:first-child .by{font-size:10.5pt;color:var(--ink2);text-transform:none;letter-spacing:0;font-weight:600;margin-top:8px}
.pdoc .notes{border:1.5px solid var(--line);border-radius:10px;padding:8px 12px;font-size:11pt;min-height:.7in;white-space:pre-wrap}
.pdoc .notes .sn{margin-top:4px}
.pdoc .notes .sn small{color:var(--ink3)}

/* work order: one print up close */
.pdoc .p2h{display:flex;justify-content:space-between;align-items:baseline;gap:12px;border-bottom:2px solid var(--ink);padding-bottom:6px}
.pdoc .p2h .t{font-size:20pt}
.pdoc .p2h .r{font-size:11pt;color:var(--ink2);white-space:nowrap}
.pdoc .loc{display:flex;align-items:baseline;gap:14px;margin:12px 0 8px;flex-wrap:wrap}
.pdoc .loc .n{font-size:30pt;line-height:1}
.pdoc .loc .m{font-size:15pt;color:var(--ink2)}
.pdoc .art{position:relative;border-radius:12px;height:4.6in;overflow:hidden}
.pdoc .art .area{position:absolute;left:50%;transform:translateX(-50%);border:2px dashed rgba(0,0,0,.3);border-radius:4px}
.pdoc .art .area span{position:absolute;left:0;top:-19px;font-size:9pt;color:rgba(0,0,0,.55);white-space:nowrap}
.pdoc .art.dark .area{border-color:rgba(255,255,255,.4)}
.pdoc .art.dark .area span{color:rgba(255,255,255,.7)}
.pdoc .art .pic{position:absolute;left:50%;transform:translateX(-50%);object-fit:contain}
.pdoc .art .dimw{position:absolute;left:50%;transform:translateX(-50%);text-align:center;font-size:14pt;font-weight:800;color:#000;padding-top:12px}
.pdoc .art .dimw:before{content:"";position:absolute;left:0;right:0;top:6px;border-top:2px solid currentColor}
.pdoc .art .dimw:after{content:"";position:absolute;left:0;right:0;top:0;height:12px;border-left:2px solid currentColor;border-right:2px solid currentColor}
.pdoc .art .dimh{position:absolute;display:flex;align-items:center;font-size:14pt;font-weight:800;color:#000;border-left:2px solid currentColor;padding-left:8px}
.pdoc .art.dark .dimw,.pdoc .art.dark .dimh{color:#fff}
.pdoc .art .none{position:absolute;inset:0;display:grid;place-items:center;font-size:14pt;color:rgba(0,0,0,.5)}
.pdoc .art.dark .none{color:rgba(255,255,255,.7)}
.pdoc .specs{display:grid;grid-template-columns:repeat(4,1fr);border:2px solid var(--ink);border-radius:10px;overflow:hidden;margin-top:12px}
.pdoc .sp{padding:7px 10px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}
.pdoc .sp:nth-child(4n){border-right:0}
.pdoc .sp:nth-last-child(-n+4){border-bottom:0}
.pdoc .sp .v{font-size:15pt;font-weight:800;margin-top:1px}
.pdoc .sp .v.fill{height:.3in;border-bottom:1.5px solid #9aa3b2}
.pdoc table.ink{width:100%;border-collapse:collapse;margin-top:10px;font-size:12pt}
.pdoc .ink th{font-size:9pt;color:var(--ink3);text-transform:uppercase;letter-spacing:.05em;text-align:left;padding:4px 8px;border-bottom:2px solid var(--ink)}
.pdoc .ink td{padding:7px 8px;border-bottom:1px solid var(--line)}
.pdoc .ink .w{width:.9in}
.pdoc .ink small{color:var(--ink3);font-size:9.5pt;margin-left:4px}
.pdoc .n2{font-size:10.5pt;color:var(--ink2);margin-top:8px;line-height:1.35;white-space:pre-wrap}

/* invoice / quote */
.pdoc .top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
.pdoc .brand img{height:.7in;display:block}
.pdoc .brand .sub{font-size:9pt;color:var(--ink3);margin-top:6px;white-space:pre-line}
.pdoc .doc{text-align:right}
.pdoc .doc .k{font-size:30pt;line-height:1}
.pdoc .doc .n{font-size:14pt;color:var(--ink2);margin-top:4px}
.pdoc .doc .meta{font-size:10.5pt;color:var(--ink3);margin-top:6px;line-height:1.45}
.pdoc .stamp{display:inline-block;margin-top:8px;border:2.5px solid var(--ok);color:var(--ok);font-weight:800;font-size:13pt;letter-spacing:.12em;padding:3px 12px;border-radius:6px;transform:rotate(-3deg)}
.pdoc .parties{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:18px;margin:22px 0 18px}
.pdoc .parties.two{grid-template-columns:1fr 1fr;gap:28px}
.pdoc .parties .lbl{margin-bottom:4px}
.pdoc .parties > div{font-size:11pt;line-height:1.4;white-space:pre-line;overflow-wrap:anywhere}
.pdoc .job{display:grid;grid-template-columns:1.45in 1fr;gap:8px 16px;border-top:2px solid var(--ink);padding-top:12px;margin-bottom:14px;break-inside:avoid}
.pdoc .job .pic{width:1.45in;border-radius:10px;background:#f6f7f9;padding:6px;align-self:start}
.pdoc .job .pic.none{height:1.2in;display:grid;place-items:center;font-size:9pt;color:var(--ink3);text-align:center}
.pdoc .job .t{font-size:16pt;grid-column:1/-1;padding-bottom:7px;margin-bottom:4px;border-bottom:1.5px solid var(--ink3)}
.pdoc .job .it{margin-top:0}
.pdoc .it{width:100%;border-collapse:collapse;font-size:11pt;margin-top:6px}
.pdoc .it th{font-size:8.5pt;color:var(--ink3);text-transform:uppercase;letter-spacing:.06em;text-align:left;padding:5px 6px;border-bottom:1.5px solid var(--ink)}
.pdoc .it th.r,.pdoc .it td.r,.pdoc .extra td.r{text-align:right;white-space:nowrap}
.pdoc .it td{padding:8px 6px;border-bottom:1px solid var(--line2);vertical-align:top}
.pdoc .chips{display:flex;gap:5px;flex-wrap:wrap;margin-top:5px;background:none;padding:0;border:0;border-radius:0;width:auto}
.pdoc .chip{border:1px solid var(--line);border-radius:6px;padding:1px 7px;font-size:9.5pt;color:var(--ink2);background:#fff;box-shadow:none;height:auto;line-height:1.4}
.pdoc .chip b{color:var(--ink)}
.pdoc .prl{font-size:10pt;color:var(--ink2);margin-top:5px}
.pdoc .prl b{color:var(--ink);font-weight:600}
.pdoc .prl-inks{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:3px}
.pdoc .prl-ink{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-size:9.5pt}
.pdoc .prl-ink i{width:10px;height:10px;border-radius:50%;border:1px solid rgba(0,0,0,.25);display:inline-block;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pdoc .extra{width:100%;border-collapse:collapse;font-size:11pt;margin-top:4px}
.pdoc .extra td{padding:6px 6px;border-bottom:1px solid var(--line2)}
.pdoc .others{margin:-10px 0 6px calc(1.45in + 16px)}
.pdoc .sumw{display:grid;grid-template-columns:1fr 2.9in;gap:24px;margin-top:10px;align-items:start;break-inside:avoid}
.pdoc .pay{border-radius:10px;background:#f6f7f9;padding:12px 14px;font-size:10.5pt;line-height:1.45;color:var(--ink2);white-space:pre-wrap}
.pdoc .pay b{color:var(--ink)}
.pdoc .pay p{margin:0 0 10px}
.pdoc .pay p:last-child{margin:0}
.pdoc .tot{font-size:11.5pt}
.pdoc .tot .r{display:flex;justify-content:space-between;padding:4px 0}
.pdoc .tot .r.big{border-top:2px solid var(--ink);margin-top:4px;padding-top:8px;font-size:15pt;font-weight:800}
.pdoc .tot .bal{margin-top:8px;border-radius:10px;padding:10px 12px;background:#e9f6ef;display:flex;justify-content:space-between;align-items:baseline;font-weight:800}
.pdoc .tot .bal span:last-child{font-size:20pt;color:var(--ok)}
.pdoc .tot .bal.due{background:#fdeceb}
.pdoc .tot .bal.due span:last-child{color:#b3261e}
.pdoc .tot .bal2{font-weight:800}
.pdoc .parties.three{grid-template-columns:1fr 1fr 3.1in;gap:22px}
.pdoc .parties .osum{background:#f6f7f9;border-radius:10px;padding:10px 14px 11px;white-space:normal}
.pdoc .osum dl{display:grid;grid-template-columns:auto 1fr;gap:3px 0;margin:4px 0 0;font-size:10.5pt;line-height:1.35}
.pdoc .osum dt{color:var(--ink3)}
.pdoc .osum dd{margin:0;padding-left:14px;text-align:right;color:var(--ink);overflow-wrap:anywhere}
.pdoc .osum dt.bd,.pdoc .osum dd.bd{border-top:1px solid #dfe3e8;padding-top:6px;margin-top:3px;font-weight:800;color:var(--ink)}
.pdoc .osum dd.bd.ok{color:var(--ok)}
.pdoc .osum dd.nw{white-space:nowrap}
.pdoc .osum-terms{margin-top:4px;font-size:9pt;line-height:1.4;color:var(--ink3)}
.pdoc .pay.empty{background:none;padding:0}
.pdoc .ifoot{margin-top:auto;padding-top:18px}
.pdoc .ifoot .fade{height:4px;margin-bottom:8px}
.pdoc .ifoot div:last-child{display:flex;justify-content:space-between;font-size:9pt;color:var(--ink3)}

.pdoc .mk{background:none;padding:0;border-radius:0}
.pdoc .hero.wide{grid-template-columns:1fr;gap:10px}
.pdoc .hero.wide .mk{height:3.8in}
.pdoc .hero.wide.h2l .mk{height:3.2in}
.pdoc .hero.wide.h3l .mk{height:2.7in}
.pdoc .hero.wide .hp{display:grid;grid-template-columns:repeat(auto-fit,minmax(2.2in,1fr));gap:10px}
.pdoc .hero.wide .hp>.lbl{grid-column:1/-1;margin-bottom:-4px}
.pdoc .hero.wide .pp .t{font-size:18pt}
@media screen and (max-width:840px){.pdoc{padding:0 8px 16px}.pdoc .print-bar{padding:10px 0}}
@page{size:letter;margin:.4in .45in}
@media print{
  html,body{background:#fff!important}
  .pdoc{background:#fff;padding:0;min-height:0;overflow:visible}
  .pdoc .print-bar{display:none}
  .pdoc .sheet{width:auto;min-height:10.1in;margin:0;padding:0;box-shadow:none;break-after:page;zoom:1!important}
  .pdoc .sheet:last-child{break-after:auto}
}
`;
