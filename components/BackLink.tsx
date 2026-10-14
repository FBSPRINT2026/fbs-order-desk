"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { previousStep, type TrailStep } from "@/lib/navTrail";

/**
 * "← …" at the top of a page (Oct 14, Nick: breadcrumbs): back to the page you came from (the email you were on,
 * the order, the customer), with its name; to the usual list only when you came straight here.
 */
export default function BackLink({ href, label }: { href: string; label: string }) {
  const [prev, setPrev] = useState<TrailStep | null>(null);
  useEffect(() => { setPrev(previousStep()); }, []);
  if (prev) return <Link className="back" href={prev.url} title={`Back to ${prev.label}`}>← {prev.label}</Link>;
  return <Link className="back" href={href}>← {label}</Link>;
}
