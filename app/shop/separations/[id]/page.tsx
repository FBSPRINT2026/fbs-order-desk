"use client";
import { use } from "react";
import SeparationStudio from "@/components/SeparationStudio";

export default function SeparationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // keyed by the separation: switching locations (Front / Back / Sleeve tabs) starts that one fresh
  return <SeparationStudio key={id} id={id} />;
}
