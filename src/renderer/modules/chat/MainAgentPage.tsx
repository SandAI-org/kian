import { SplitPane } from "@renderer/components/SplitPane";
import { WorkspacePaneControls } from "@renderer/components/WorkspacePaneControls";
import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { AppModule } from "@renderer/modules/app/AppModule";
import { AgentChatWorkspace } from "@renderer/modules/chat/AgentChatWorkspace";
import { DocsModule } from "@renderer/modules/docs/DocsModule";
import type { ChatScope, ChatSessionKind, ModuleType } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api } from "@renderer/lib/api";
import { MAIN_AGENT_INPUT_FOCUS_EVENT } from "@renderer/lib/shortcuts";
import { toggleWindowMaximizeFromChrome } from "@renderer/lib/windowChrome";
import { useSearchParams } from "react-router-dom";

const MAIN_AGENT_SCOPE_ID = "main-agent";
const MAIN_SCOPE: ChatScope = { type: "main" };
const MERGED_SESSION_KINDS: ChatSessionKind[] = ["normal", "digital_avatar"];
const MAIN_AGENT_MODE_STORAGE_KEY = "kian.mainAgent.mode";

type AgentMode = "chat" | "docs" | "app";

const MODES: { key: AgentMode; label: string }[] = [
  { key: "chat", label: "聊天" },
  { key: "docs", label: "文档" },
  { key: "app", label: "应用" },
];

const isAgentMode = (value: string | null): value is AgentMode =>
  value === "chat" ||
  value === "docs" ||
  value === "app";

const getStoredMainAgentMode = (): AgentMode => {
  try {
    const storedMode = window.localStorage.getItem(MAIN_AGENT_MODE_STORAGE_KEY);
    return isAgentMode(storedMode) ? storedMode : "chat";
  } catch {
    return "chat";
  }
};

export const NEW_CURRENT_AGENT_SESSION_EVENT = "main-agent:new-session";

export const MainAgentPage = () => {
  const { t } = useAppI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingRouteSessionId = searchParams.get("session")?.trim() ?? "";
  const shouldFocusInput = searchParams.get("focusInput") === "1";
  const focusInputStamp = searchParams.get("stamp") ?? "";
  const requestedModule = searchParams.get("module");
  const [mode, setMode] = useState<AgentMode>(() => getStoredMainAgentMode());
  const [inputFocusRequestId, setInputFocusRequestId] = useState(0);
  const handledFocusInputStampRef = useRef<string | null>(null);
  const [rightPaneCollapsed, setRightPaneCollapsed] = useState(false);
  const [docsSidebarCollapsed, setDocsSidebarCollapsed] = useState(false);
  const [chatSidebarCollapsed, setChatSidebarCollapsed] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>(
    undefined,
  );
  const [contexts, setContexts] = useState<Record<ModuleType, unknown>>({
    docs: {},
    creation: {},
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
  const handleAppContextChange = useCallback(
    (context: unknown) => {
      updateContext("app", context);
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
  const toggleLeftPane = useCallback(() => {
    if (mode === "chat") {
      setChatSidebarCollapsed((current) => !current);
      return;
    }

    if (mode === "docs") {
      setDocsSidebarCollapsed((current) => !current);
      return;
    }
  }, [mode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(MAIN_AGENT_MODE_STORAGE_KEY, mode);
    } catch {
      return;
    }
  }, [mode]);

  const toggleRightPane = useCallback(() => {
    setRightPaneCollapsed((current) => !current);
  }, []);

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

  useEffect(() => {
    if (
      requestedModule === "docs" ||
      requestedModule === "app"
    ) {
      setMode(requestedModule);
    }
  }, [requestedModule]);

  useEffect(() => {
    if (!shouldFocusInput) {
      return;
    }

    const requestStamp = focusInputStamp || "focus";
    if (handledFocusInputStampRef.current === requestStamp) {
      return;
    }
    handledFocusInputStampRef.current = requestStamp;
    setInputFocusRequestId((current) => current + 1);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("focusInput");
    nextParams.delete("stamp");
    const nextSearch = nextParams.toString();
    const nextUrl = `${window.location.pathname}${
      nextSearch ? `?${nextSearch}` : ""
    }${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [focusInputStamp, searchParams, shouldFocusInput]);

  return (
    <div className="flex h-full min-h-0 flex-col px-5 pt-3 pb-5">
      {/* Header with centered switch tab — matching project module switcher style */}
      <div
        className="drag-region mb-3 grid grid-cols-[1fr_auto_1fr] items-center"
        onDoubleClick={toggleWindowMaximizeFromChrome}
      >
        <div className="justify-self-start">
          {mode === "chat" || mode === "docs" ? (
            <WorkspacePaneControls
              leftCollapsed={
                mode === "chat" ? chatSidebarCollapsed : docsSidebarCollapsed
              }
              rightCollapsed={rightPaneCollapsed}
              onToggleLeft={toggleLeftPane}
              onToggleRight={toggleRightPane}
              showRight={false}
            />
          ) : null}
        </div>
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
                {t(m.label)}
              </button>
            );
          })}
        </div>
        <div className="justify-self-end">
          {mode !== "chat" ? (
            <WorkspacePaneControls
              leftCollapsed={docsSidebarCollapsed}
              rightCollapsed={rightPaneCollapsed}
              onToggleLeft={toggleLeftPane}
              onToggleRight={toggleRightPane}
              showLeft={false}
            />
          ) : null}
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
          <AgentChatWorkspace
            scope={MAIN_SCOPE}
            module="main"
            chatVariant="main"
            currentSessionId={currentSessionId}
            onSelectSession={handleSelectSession}
            onNewSession={handleNewSession}
            onSessionCreated={handleSessionCreated}
            sessionKinds={MERGED_SESSION_KINDS}
            acceptMainInputFocusEvents={mode === "chat"}
            inputFocusRequestId={
              mode === "chat" ? inputFocusRequestId : undefined
            }
            contextSnapshot={contexts}
            hideBorder={false}
            sidebarCollapsed={chatSidebarCollapsed}
          />
        </div>

        {/* Module modes */}
        <div
          className={`absolute inset-0 transition-all duration-300 ease-in-out ${
            mode !== "chat"
              ? "pointer-events-auto translate-x-0 opacity-100"
              : "pointer-events-none translate-x-4 opacity-0"
          }`}
        >
          <SplitPane
            leftCollapsed={false}
            rightCollapsed={rightPaneCollapsed}
            left={
              <div className="h-full min-h-0">
                <div className={mode === "docs" ? "h-full min-h-0" : "hidden"}>
                  <DocsModule
                    projectId={MAIN_AGENT_SCOPE_ID}
                    onContextChange={handleDocsContextChange}
                    sidebarCollapsed={docsSidebarCollapsed}
                    onSidebarCollapsedChange={setDocsSidebarCollapsed}
                  />
                </div>
                <div className={mode === "app" ? "h-full min-h-0" : "hidden"}>
                  <AppModule
                    projectId={MAIN_AGENT_SCOPE_ID}
                    onContextChange={handleAppContextChange}
                  />
                </div>
              </div>
            }
            right={
              <AgentChatWorkspace
                scope={MAIN_SCOPE}
                module="main"
                chatVariant="main"
                currentSessionId={currentSessionId}
                onSelectSession={handleSelectSession}
                onNewSession={handleNewSession}
                onSessionCreated={handleSessionCreated}
                sessionKinds={MERGED_SESSION_KINDS}
                acceptMainInputFocusEvents
                inputFocusRequestId={
                  mode !== "chat" ? inputFocusRequestId : undefined
                }
                contextSnapshot={contexts}
                hideBorder={false}
                historyPresentation="popover"
              />
            }
          />
        </div>

      </div>
    </div>
  );
};
