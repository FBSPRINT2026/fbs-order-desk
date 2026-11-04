"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Portal intro emails is part of Portal customers now (Nov 4, Nick: "put those together into one tool"): this address opens
 * it (app/shop/customers/contacts). The server actions in ./actions stay here and are used there.
 */
export default function IntroEmails() {
  const r = useRouter();
  useEffect(() => { r.replace("/shop/customers/contacts"); }, [r]);
  return <p className="faint">Opening Portal customers…</p>;
}
