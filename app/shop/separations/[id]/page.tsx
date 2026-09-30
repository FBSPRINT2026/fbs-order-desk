"use client";
import { use } from "react";
import SeparationStudio from "@/components/SeparationStudio";

export default function SeparationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <SeparationStudio id={id} />;
}
