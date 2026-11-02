"use client";
import ArchivedOrderView from "@/components/ArchivedOrderView";
import type { PvOrder } from "@/lib/archive";
import type { ReactNode } from "react";

/** Client wrapper: artwork comes only from our own storage (signed links made on the server). */
export default function ArchivedPortalView({ o, urls, names, paths, importedAt, actions }: { o: PvOrder; urls: Record<string, string>; names?: Record<string, string>; paths?: Record<string, string>; importedAt: string; /** the Reorder button (components/PortalOldReorder.tsx) */ actions?: ReactNode }) {
  return <ArchivedOrderView o={o} audience="customer" importedAt={importedAt} fileUrl={(u) => urls[u] || ""} names={names} paths={paths} actions={actions} />;
}
