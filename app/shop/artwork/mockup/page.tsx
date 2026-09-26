"use client";
import { Suspense } from "react";
import MockupBuilder from "@/components/MockupBuilder";

export default function MockupPage() {
  return <Suspense fallback={<div className="empty">Loading…</div>}><MockupBuilder /></Suspense>;
}
