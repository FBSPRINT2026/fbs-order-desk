/**
 * The shop at 90% (Oct 23, Nick: "the site should naturally look how it does at 90% zoom… everything takes up too much
 * space right now at 100%… I don't want to have a whole bunch of issues"). On a computer the shop pages are drawn at
 * 0.9 with CSS zoom on <html>, and the browser's own measurements are turned back into the page's units, the way the
 * browser's zoom does it, so every drag, menu, picker and drawing tool keeps working without being changed one by one:
 *   - getBoundingClientRect / getClientRects, mouse and touch positions, the window's size: ÷ 0.9
 *   - elementFromPoint (takes page units): × 0.9; an SVG's screen matrix: ÷ 0.9
 *   - viewport units in the CSS (100vh, 60vw…) are divided by --pz (app/globals.css), so full-height layouts still fill
 *     the window
 * Phones and tablets (a touch screen, or a window under 1000px) stay at 100%. Runs as an inline script in the shop's
 * layout before the page draws (PAGE_SCALE_JS), so nothing jumps.
 */
export const PAGE_SCALE = 0.9;

export const PAGE_SCALE_JS = `(function(){
  if (window.__fbsScale) return; window.__fbsScale = 1;
  var Z = ${PAGE_SCALE}, root = document.documentElement;
  var want = function(){ try { return window.matchMedia("(pointer: fine)").matches && screen.width >= 1000 && root.clientWidth * (window.__fbsZ || 1) >= 1000; } catch (e) { return false; } };
  var apply = function(){ var on = want(); window.__fbsZ = on ? Z : 1; root.style.zoom = on ? String(Z) : ""; root.style.setProperty("--pz", on ? String(Z) : "1"); };
  window.__fbsZ = 1; apply();
  window.addEventListener("resize", function(){ var was = window.__fbsZ; apply(); if (was !== window.__fbsZ) window.dispatchEvent(new Event("resize")); });
  var z = function(){ return window.__fbsZ || 1; };
  var EP = Element.prototype, gb = EP.getBoundingClientRect, gc = EP.getClientRects;
  EP.getBoundingClientRect = function(){ var r = gb.call(this), k = z(); return k === 1 ? r : new DOMRect(r.x / k, r.y / k, r.width / k, r.height / k); };
  EP.getClientRects = function(){ var l = gc.call(this), k = z(); if (k === 1) return l; var a = []; for (var i = 0; i < l.length; i++) { var r = l[i]; a.push(new DOMRect(r.x / k, r.y / k, r.width / k, r.height / k)); } a.item = function(n){ return a[n] || null; }; return a; };
  var fix = function(proto, name){ var d = Object.getOwnPropertyDescriptor(proto, name); if (!d || !d.get) return; Object.defineProperty(proto, name, { configurable: true, enumerable: d.enumerable, get: function(){ return d.get.call(this) / z(); } }); };
  ["clientX", "clientY", "pageX", "pageY", "x", "y"].forEach(function(n){ fix(MouseEvent.prototype, n); });
  if (window.Touch) ["clientX", "clientY", "pageX", "pageY"].forEach(function(n){ fix(Touch.prototype, n); });
  ["innerWidth", "innerHeight"].forEach(function(n){ var d = Object.getOwnPropertyDescriptor(window, n); if (!d || !d.get) return; Object.defineProperty(window, n, { configurable: true, enumerable: true, get: function(){ return d.get.call(window) / z(); }, set: d.set }); });
  var efp = Document.prototype.elementFromPoint, efps = Document.prototype.elementsFromPoint;
  Document.prototype.elementFromPoint = function(x, y){ var k = z(); return efp.call(this, x * k, y * k); };
  if (efps) Document.prototype.elementsFromPoint = function(x, y){ var k = z(); return efps.call(this, x * k, y * k); };
  if (window.SVGGraphicsElement) { var sc = SVGGraphicsElement.prototype.getScreenCTM; SVGGraphicsElement.prototype.getScreenCTM = function(){ var m = sc.call(this), k = z(); if (!m || k === 1) return m; m.a /= k; m.b /= k; m.c /= k; m.d /= k; m.e /= k; m.f /= k; return m; }; }
})();`;
