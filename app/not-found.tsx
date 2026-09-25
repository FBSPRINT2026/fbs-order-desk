import Link from "next/link";

export default function NotFound() {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Page not found</h1>
        <p className="muted" style={{ margin: 0 }}>This order may have been removed, or it belongs to a different email address.</p>
        <Link className="btn primary" href="/">Go to your orders</Link>
      </div>
    </div>
  );
}
