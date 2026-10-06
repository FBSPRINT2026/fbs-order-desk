import "../store.css";

/**
 * The store's two faces: a condensed athletic display (the school's banner) and a very legible body for parents on
 * phones. Loaded as a plain stylesheet (React puts it in <head>); if it can't load, the store falls back to system fonts.
 */
const FONTS = "https://fonts.googleapis.com/css2?family=Big+Shoulders:wght@600;800;900&family=Atkinson+Hyperlegible:wght@400;700&display=swap";

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="stylesheet" href={FONTS} precedence="default" />
      <div className="sf-root">{children}</div>
    </>
  );
}
