"use client";
import AiWorkbench from "@/components/AiWorkbench";
import AiTools from "@/components/AiTools";
import { useSticky } from "@/lib/useSticky";

/** AI Workbench: the chat, and the Tools (every AI tool on the site, the same one each place it shows up: lib/aiTools.ts) */
export default function WorkbenchTabs({ name }: { name: string }) {
  const [tab, setTab] = useSticky<"chat" | "tools">("wb.tab", "chat");
  const ICON = { chat: <path d="M4 5h16v11H8l-4 4z" />, tools: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /> };
  return (
    <>
      <nav className="aa-nav ot-nav wb-tabs" aria-label="AI Workbench">
        {([["chat", "Chat"], ["tools", "Tools"]] as ["chat" | "tools", string][]).map(([k, l]) => (
          <button key={k} type="button" className={"aa-tab" + (tab === k ? " on" : "")} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)} aria-label={l} title={l}>
            <svg className="ot-ic" viewBox="0 0 24 24" aria-hidden>{ICON[k]}</svg><span className="ot-l">{l}</span>
          </button>
        ))}
      </nav>
      {tab === "chat" ? <AiWorkbench name={name} /> : <AiTools />}
    </>
  );
}
