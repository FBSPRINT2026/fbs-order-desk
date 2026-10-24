"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { lastSettingsPage } from "@/components/SettingsTabs";

/** Settings opens where you were last (Oct 24: Settings is tabs now, each its own page) */
export default function SettingsHome() {
  const router = useRouter();
  useEffect(() => { router.replace(lastSettingsPage()); }, [router]);
  return <div className="empty">Opening Settings…</div>;
}
