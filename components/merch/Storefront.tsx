"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { unlockStore } from "@/app/s/actions";
import type { PublicProduct, PublicStore } from "@/lib/merchServer";
import { bySize, isYouthSize, storeImg } from "@/lib/merch";
import { brandVars, day, money, price, useBag, useRoute, type Route } from "./sf/kit";
import { Footer, Hero, HowItWorks, notYet, StoreProgress, TopBar } from "./sf/Chrome";
import ProductView from "./sf/ProductView";
import BagDrawer from "./sf/BagDrawer";
import Checkout from "./sf/Checkout";

export { brandVars } from "./sf/kit";

/**
 * The public merch store (no sign-in; parents on phones). The front page, an item, the bag and checkout are all on the
 * store's own address (?item=…, ?bag=1, ?checkout=1), so Back works and tapping the school's name always comes home.
 */
export default function Storefront({ store, products, preview, staxToken, initial }: { store: PublicStore; products: PublicProduct[]; preview: boolean; staxToken: string; initial?: Route }) {
  const router = useRouter();
  const { route, go } = useRoute(initial || { view: "home" });
  const bag = useBag(store.slug, products);
  const [toast, setToast] = useState(0);
  const bagPushed = useRef(false);
  const canBuy = store.open || preview;
  const item = route.view === "item" ? products.find((p) => p.id === route.item) || null : null;

  // a link to an item that's gone: back to the front page
  useEffect(() => { if (route.view === "item" && !item) go({ view: "home" }, { replace: true }); }, [route.view, item, go]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(0), 4500); return () => clearTimeout(t); }, [toast]);

  if (store.locked) return <Locked store={store} />;

  const home = () => go({ view: "home" });
  const openBag = () => { bagPushed.current = true; setToast(0); go({ ...route, bag: true }); };
  const closeBag = () => { if (bagPushed.current) { bagPushed.current = false; history.back(); } else go({ ...route, bag: false }, { replace: true }); };
  const toCheckout = () => { const fromBag = route.bag; bagPushed.current = false; go({ view: "checkout" }, { replace: fromBag }); };
  const soon = notYet(store);
  const closedNote = soon ? `This store opens ${store.opens_at ? day(store.opens_at) : "soon"}.` : "This store is closed and isn't taking orders.";
  const preorder = store.closes_at ? `Printed after the store closes ${day(store.closes_at, false)}.` : "";

  return (
    <div className="sf-page" style={brandVars(store.brand)}>
      <a className="sf-skip" href="#sf-main">Skip to the store</a>
      <TopBar store={store} count={bag.count} onHome={home} onBag={canBuy || bag.count ? openBag : undefined} back={route.view === "checkout" ? { label: "← Keep shopping", onClick: home } : undefined} />
      {preview && !store.open && <div className="sf-staff"><div className="sf-wrap"><b>Staff preview.</b> Shoppers {soon ? "can't order yet" : "can't order: the store is closed"}. You can still place a test order (no charge).</div></div>}

      {route.view === "home" && (
        <>
          <Hero store={store} />
          {store.open || soon ? <HowItWorks store={store} /> : null}
          <main id="sf-main" className="sf-wrap sf-main">
            {!store.open && !soon && <StoreProgress store={store} />}
            {store.welcome && (
              <figure className="sf-note">
                <blockquote>{store.welcome}</blockquote>
                {store.contactName && <figcaption>— {store.contactName}{store.brand?.school ? `, ${store.brand.school}` : ""}</figcaption>}
              </figure>
            )}
            <div className="sf-shop-h"><h2>{canBuy ? "Shop the store" : soon ? "Coming to the store" : "What was in the store"}</h2><span>{products.length} item{products.length === 1 ? "" : "s"}</span></div>
            <div className="sf-grid">
              {products.map((p) => <Tile key={p.id} p={p} slug={store.slug} onOpen={() => go({ view: "item", item: p.id })} />)}
              {!products.length && <p className="sf-empty-grid">{soon ? "Items are on their way. Check back when the store opens." : "No items in this store."}</p>}
            </div>
          </main>
        </>
      )}

      {route.view === "item" && item && (
        <main id="sf-main" className="sf-wrap sf-main">
          <ProductView key={item.id} p={item} bag={bag} canBuy={canBuy} closedNote={closedNote} onBack={home} onAdded={(n) => setToast(n)} />
        </main>
      )}

      {route.view === "checkout" && (
        <main id="sf-main" className="sf-wrap sf-main">
          {!bag.loaded ? null : !bag.live.length ? (
            <div className="sf-co-empty"><h1>Your bag is empty</h1><p>Add something from the store first.</p><button type="button" className="sf-btn" onClick={home}>Shop the store</button></div>
          ) : !canBuy ? (
            <div className="sf-co-empty"><h1>Not taking orders</h1><p>{closedNote}</p><button type="button" className="sf-btn" onClick={home}>Back to the store</button></div>
          ) : (
            <Checkout store={store} bag={bag} preview={preview} staxToken={staxToken} onEditBag={openBag}
              onDone={(token) => { bag.clear(); router.push(`/s/${store.slug}/o/${token}?new=1`); }} />
          )}
        </main>
      )}

      <Footer store={store} />

      {route.view === "home" && bag.count > 0 && !route.bag && (
        <div className="sf-bagbar" role="region" aria-label="Your bag">
          <button type="button" onClick={openBag}><span><b>{bag.count} item{bag.count === 1 ? "" : "s"}</b> · {money(bag.subtotal)}</span><span>View bag</span></button>
        </div>
      )}
      {toast > 0 && !route.bag && (
        <div className="sf-toast" role="status">
          <span><b>Added {toast} to your bag.</b></span>
          <button type="button" onClick={openBag}>View bag</button>
        </div>
      )}
      {route.bag && <BagDrawer bag={bag} canBuy={canBuy} preorder={preorder} onClose={closeBag} onCheckout={toCheckout} />}
    </div>
  );
}

/** A product on the front page: the picture, the colors, the price. */
function Tile({ p, slug, onOpen }: { p: PublicProduct; slug: string; onOpen: () => void }) {
  const [hover, setHover] = useState(0);
  const prices = Object.values(p.prices), min = Math.min(...prices);
  const c = p.colors[hover] || p.colors[0];
  const sizes = p.sizes.slice().sort(bySize);
  const youth = sizes.some(isYouthSize), adult = sizes.some((z) => !isYouthSize(z));
  return (
    <a className="sf-tile" href={`/s/${slug}?item=${p.id}`} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); onOpen(); }}>
      <div className="sf-tile-ph">{c && (c.image || c.photo) ? <img src={storeImg(c.image || c.photo)} alt={`${p.name} in ${c.name}`} loading="lazy" /> : null}</div>
      <div className="sf-tile-b">
        <h3 data-notranslate>{p.name}</h3>
        <p className="sf-tile-price">{prices.length ? price(min) : ""}</p>
        <p className="sf-tile-sub">{youth && adult ? "Youth & adult sizes" : youth ? "Youth sizes" : `${sizes[0] || ""}${sizes.length > 1 ? `–${sizes[sizes.length - 1]}` : ""}`}</p>
        {p.colors.length > 1 && (
          <div className="sf-dots" onMouseLeave={() => setHover(0)}>
            {p.colors.map((x, i) => <i key={x.name} style={{ background: x.hex }} title={x.name} onMouseEnter={() => setHover(i)} />)}
            <span>{p.colors.length} colors</span>
          </div>
        )}
      </div>
    </a>
  );
}

function Locked({ store }: { store: PublicStore }) {
  const router = useRouter();
  const [pass, setPass] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  return (
    <div className="sf-page" style={brandVars(store.brand)}>
      <TopBar store={store} count={0} onHome={() => router.refresh()} />
      <Hero store={store} compact />
      <main className="sf-wrap sf-main sf-narrow">
        <form className="sf-sec" onSubmit={async (e) => { e.preventDefault(); setBusy(true); const r = await unlockStore(store.slug, pass); setBusy(false); if (!r.ok) setErr(r.error || "That password isn't right."); else router.refresh(); }}>
          <h2>This store has a password</h2>
          <p className="sf-sec-p">Your school or group sent it with the store link.</p>
          <div className="sf-f"><label htmlFor="sf-pass">Password</label><input id="sf-pass" value={pass} onChange={(e) => { setPass(e.target.value); setErr(""); }} autoFocus autoCapitalize="none" /></div>
          {err && <p className="sf-err" role="alert">{err}</p>}
          <button className="sf-btn big" style={{ marginTop: 14 }} disabled={busy || !pass.trim()}>{busy ? "Checking…" : "Open the store"}</button>
        </form>
      </main>
      <Footer store={store} />
    </div>
  );
}
