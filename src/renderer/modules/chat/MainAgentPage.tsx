import { MenuUnfoldOutlined } from "@ant-design/icons";
import { SplitPane } from "@renderer/components/SplitPane";
import { DocsModule } from "@renderer/modules/docs/DocsModule";
import type { ChatScope, ModuleType } from "@shared/types";
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api } from "@renderer/lib/api";
import { MAIN_AGENT_INPUT_FOCUS_EVENT } from "@renderer/lib/shortcuts";
import { toggleWindowMaximizeFromChrome } from "@renderer/lib/windowChrome";
import { ChatSessionList } from "@renderer/modules/chat/ChatSessionList";
import { ModuleChatPane } from "@renderer/modules/chat/ModuleChatPane";
import { Button } from "antd";
import { useSearchParams } from "react-router-dom";

const MAIN_AGENT_SCOPE_ID = "main-agent";
const MAIN_SCOPE: ChatScope = { type: "main" };

type AgentMode = "chat" | "docs";

const MODES: { key: AgentMode; label: string }[] = [
  { key: "chat", label: "聊天" },
  { key: "docs", label: "文档" },
];

export const NEW_CURRENT_AGENT_SESSION_EVENT = "main-agent:new-session";

export const MainAgentPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingRouteSessionId = searchParams.get("session")?.trim() ?? "";
  const [mode, setMode] = useState<AgentMode>("chat");
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>(
    undefined,
  );
  const [chatSidebarCollapsed, setChatSidebarCollapsed] = useState(false);
  const [contexts, setContexts] = useState<Record<ModuleType, unknown>>({
    docs: {},
    creation: {},
    assets: {},
    app: {},
  });
  const queryClient = useQueryClient();

  const updateContext = useCallback((module: ModuleType, context: unknown) => {
    setContexts((prev) => ({
      ...prev,
      [module]: context,
    }));
  }, []);
  const handleDocsContextChange = useCallback(
    (context: unknown) => {
      updateContext("docs", context);
    },
    [updateContext],
  );

  const handleNewSession = useCallback(async () => {
    const created = await api.chat.createSession({
      scope: MAIN_SCOPE,
      module: "main",
      title: "",
    });
    setCurrentSessionId(created.id);
    void queryClient.invalidateQueries({ queryKey: ["chat-sessions", "main"] });
  }, [queryClient]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setCurrentSessionId(sessionId);
  }, []);

  const handleSessionCreated = useCallback(
    (sessionId: string) => {
      setCurrentSessionId(sessionId);
      void queryClient.invalidateQueries({
        queryKey: ["chat-sessions", "main"],
      });
    },
    [queryClient],
  );

  // Listen for CMD+N new session event
  useEffect(() => {
    const handler = () => {
      void handleNewSession();
    };
    window.addEventListener(NEW_CURRENT_AGENT_SESSION_EVENT, handler);
    return () =>
      window.removeEventListener(NEW_CURRENT_AGENT_SESSION_EVENT, handler);
  }, [handleNewSession]);

  useEffect(() => {
    if (!pendingRouteSessionId) {
      return;
    }

    setCurrentSessionId(pendingRouteSessionId);
    void queryClient.invalidateQueries({
      queryKey: ["chat-sessions", "main"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["chat-messages", "main", pendingRouteSessionId],
    });
    if (mode !== "chat") {
      setMode("chat");
    }
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event(MAIN_AGENT_INPUT_FOCUS_EVENT));
    });

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("session");
    nextParams.delete("source");
    nextParams.delete("stamp");
    setSearchParams(nextParams, { replace: true });
  }, [
    mode,
    pendingRouteSessionId,
    queryClient,
    searchParams,
    setSearchParams,
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col px-5 pt-3 pb-5">
      {/* Header with centered switch tab — matching project module switcher style */}
      <div
        className="drag-region mb-3 flex justify-center"
        onDoubleClick={toggleWindowMaximizeFromChrome}
      >
        <div className="drag-region flex items-center gap-2 rounded-full border border-[#dce5f4] bg-white/90 p-1 shadow-[0_4px_16px_rgba(15,23,42,0.05)]">
          {MODES.map((m) => {
            const active = mode === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setMode(m.key)}
                className={`no-drag rounded-full px-4 py-1.5 text-sm font-semibold transition-all duration-300 ${
                  active
                    ? "bg-[#2f6ff7] text-white shadow-[0_6px_12px_rgba(47,111,247,0.32)]"
                    : "text-slate-600 hover:bg-[#eef3fc] hover:text-slate-900"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content area with smooth transition */}
      <div className="relative min-h-0 flex-1">
        {/* Chat mode */}
        <div
          className={`absolute inset-0 transition-all duration-300 ease-in-out ${
            mode === "chat"
              ? "pointer-events-auto translate-x-0 opacity-100"
              : "pointer-events-none -translate-x-4 opacity-0"
          }`}
        >
          <div className="flex h-full gap-0.5">
            <div
              className={`shrink-0 transition-[width] duration-200 ${chatSidebarCollapsed ? "w-10" : "w-64"}`}
            >
              {chatSidebarCollapsed ? (
                <div className="flex items-center justify-center">
                  <Button
                    type="text"
                    shape="circle"
                    icon={<MenuUnfoldOutlined />}
                    title="展开对话列表"
                    aria-label="展开对话列表"
                    size="small"
                    onClick={() => setChatSidebarCollapsed(false)}
                  />
                </div>
              ) : (
                <ChatSessionList
                  scope={MAIN_SCOPE}
                  module="main"
                  currentSessionId={currentSessionId}
                  onSelectSession={handleSelectSession}
                  onNewSession={handleNewSession}
                  collapsible
                  onCollapse={() => setChatSidebarCollapsed(true)}
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="mx-auto h-full">
                <ModuleChatPane
                  scope={MAIN_SCOPE}
                  module="main"
                  chatVariant="main"
                  acceptMainInputFocusEvents={mode === "chat"}
                  contextSnapshot={contexts}
                  hideBorder={false}
                  sessionId={currentSessionId}
                  onSessionCreated={handleSessionCreated}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Docs mode */}
        <div
          className={`absolute inset-0 transition-all duration-300 ease-in-out ${
            mode === "docs"
              ? "pointer-events-auto translate-x-0 opacity-100"
              : "pointer-events-none translate-x-4 opacity-0"
          }`}
        >
          <SplitPane
            left={
              <DocsModule
                projectId={MAIN_AGENT_SCOPE_ID}
                onContextChange={handleDocsContextChange}
                chatScope={MAIN_SCOPE}
                chatModule="main"
                currentSessionId={currentSessionId}
                onSelectSession={handleSelectSession}
                onNewSession={handleNewSession}
              />
            }
            right={
              <ModuleChatPane
                scope={MAIN_SCOPE}
                module="main"
                chatVariant="main"
                acceptMainInputFocusEvents={mode === "docs"}
                contextSnapshot={contexts}
                sessionId={currentSessionId}
                onSessionCreated={handleSessionCreated}
              />
            }
          />
        </div>
      </div>
    </div>
  );
};
