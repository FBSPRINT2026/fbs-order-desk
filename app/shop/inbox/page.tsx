"use client";
import InboxView from "@/components/InboxView";
import { InboxDayBar } from "@/components/MyDayPhone";
import { useRole } from "@/components/RoleContext";

/** Inbox (top of the menu): all your mail, the Outlook Inbox mirrored and sorted by the AI. On an owner's phone, My Day's
 * bottom bar stays with Email lit until an email is opened (Oct 26). */
export default function InboxPage() {
  const { perms } = useRole();
  return <><InboxView mode="mail" />{perms.money && <InboxDayBar />}</>;
}
