import { MenuUnfoldOutlined } from "@ant-design/icons";
import { SplitPane } from "@renderer/components/SplitPane";
import { IllustrationEmptyFiles } from "@renderer/components/EmptyIllustrations";
import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { translateUiText } from "@renderer/i18n/uiTranslations";
import { DocsModule } from "@renderer/modules/docs/DocsModule";
import type { ChatScope, ModuleType } from "@shared/types";
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@renderer/lib/api";
import { MAIN_AGENT_INPUT_FOCUS_EVENT } from "@renderer/lib/shortcuts";
import { toggleWindowMaximizeFromChrome } from "@renderer/lib/windowChrome";
import { ChatSessionList } from "@renderer/modules/chat/ChatSessionList";
import { getChatSessionsQueryKey } from "@renderer/modules/chat/chatQueryCache";
import { ModuleChatPane } from "@renderer/modules/chat/ModuleChatPane";
import { Button, Typography } from "antd";
import { useNavigate, useSearchParams } from "react-router-dom";

const MAIN_AGENT_SCOPE_ID = "main-agent";
const MAIN_SCOPE: ChatScope = { type: "main" };

type AgentMode = "chat" | "docs" | "digital_avatar";

const MODES: { key: AgentMode; label: string }[] = [
  { key: "chat", label: "聊天" },
  { key: "docs", label: "文档" },
  { key: "digital_avatar", label: "数字分身" },
];

export const NEW_CURRENT_AGENT_SESSION_EVENT = "main-agent:new-session";

export const MainAgentPage = () => {
  const { language } = useAppI18n();
  const t = useCallback(
    (value: string): string => translateUiText(language, value),
    [language],
  );
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingRouteSessionId = searchParams.get("session")?.trim() ?? "";
  const [mode, setMode] = useState<AgentMode>("chat");
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>(
    undefined,
  );
  const [currentDigitalAvatarSessionId, setCurrentDigitalAvatarSessionId] =
    useState<string | undefined>(undefined);
  const [chatSidebarCollapsed, setChatSidebarCollapsed] = useState(false);
  const [digitalAvatarSidebarCollapsed, setDigitalAvatarSidebarCollapsed] =
    useState(false);
  const [contexts, setContexts] = useState<Record<ModuleType, unknown>>({
    docs: {},
    creation: {},
    assets: {},
    app: {},
  });
  const queryClient = useQueryClient();
  const digitalAvatarSessionsQuery = useQuery({
    queryKey: getChatSessionsQueryKey("main", ["digital_avatar"]),
    queryFn: () => api.chat.getSessions(MAIN_SCOPE, { kinds: ["digital_avatar"] }),
  });
  const digitalAvatarSessions = digitalAvatarSessionsQuery.data ?? [];
  const showDigitalAvatarEmptyPage =
    digitalAvatarSessionsQuery.isFetched &&
    !digitalAvatarSessionsQuery.isError &&
    digitalAvatarSessions.length === 0;

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
  const openChannelsSettings = useCallback(() => {
    navigate("/settings?tab=channels");
  }, [navigate]);

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
      currentDigitalAvatarSessionId &&
      digitalAvatarSessions.some(
        (session) => session.id === currentDigitalAvatarSessionId,
      )
    ) {
      return;
    }
    setCurrentDigitalAvatarSessionId(digitalAvatarSessions[0]?.id);
  }, [currentDigitalAvatarSessionId, digitalAvatarSessions]);

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
                {t(m.label)}
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

        <div
          className={`absolute inset-0 transition-all duration-300 ease-in-out ${
            mode === "digital_avatar"
              ? "pointer-events-auto translate-x-0 opacity-100"
              : "pointer-events-none translate-x-4 opacity-0"
          }`}
        >
          {showDigitalAvatarEmptyPage ? (
            <div className="flex h-full items-center justify-center px-6">
              <div className="flex max-w-[560px] flex-col items-center text-center select-none">
                <IllustrationEmptyFiles size={92} />
                <Typography.Text className="!mt-4 !text-[18px] !font-semibold !text-slate-800">
                  {t("开始使用数字分身")}
                </Typography.Text>
                <Typography.Text className="!mt-2 !text-[13px] !leading-6 !text-slate-500">
                  {t("完成下面几步后，安全地将你的机器人开放给其他人。")}
                </Typography.Text>
                <div className="mt-6 flex w-full flex-col gap-3 rounded-[20px] border border-[#e2e8f5] bg-white/85 p-5 text-left shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
                  <div className="flex items-start gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#eef4ff] text-[12px] font-semibold text-[#2f6ff7]">
                      1
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-medium text-slate-800">
                        {t("启用渠道")}
                      </div>
                    </div>
                    <Button type="primary" onClick={openChannelsSettings}>
                      {t("进入渠道页面")}
                    </Button>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#eef4ff] text-[12px] font-semibold text-[#2f6ff7]">
                      2
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-medium text-slate-800">
                        {t("设置拥有者白名单")}
                      </div>
                      <div className="mt-1 text-[12px] leading-5 text-slate-500">
                        {t("不在白名单的用户只能跟你的机器人进行聊天，不能使用工具。")}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#eef4ff] text-[12px] font-semibold text-[#2f6ff7]">
                      3
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-medium text-slate-800">
                        {t("放心地将机器人开放给其他人")}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full gap-0.5">
              <div
                className={`shrink-0 transition-[width] duration-200 ${digitalAvatarSidebarCollapsed ? "w-10" : "w-64"}`}
              >
                {digitalAvatarSidebarCollapsed ? (
                  <div className="flex items-center justify-center">
                    <Button
                      type="text"
                      shape="circle"
                      icon={<MenuUnfoldOutlined />}
                      title={t("展开对话列表")}
                      aria-label={t("展开对话列表")}
                      size="small"
                      onClick={() => setDigitalAvatarSidebarCollapsed(false)}
                    />
                  </div>
                ) : (
                  <ChatSessionList
                    scope={MAIN_SCOPE}
                    module="main"
                    currentSessionId={currentDigitalAvatarSessionId}
                    onSelectSession={setCurrentDigitalAvatarSessionId}
                    onNewSession={() => undefined}
                    sessionKinds={["digital_avatar"]}
                    allowCreate={false}
                    collapsible
                    onCollapse={() => setDigitalAvatarSidebarCollapsed(true)}
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex h-full flex-col">
                  <div className="min-h-0 flex-1">
                    <ModuleChatPane
                      scope={MAIN_SCOPE}
                      module="main"
                      chatVariant="main"
                      contextSnapshot={contexts}
                      hideBorder={false}
                      sessionId={currentDigitalAvatarSessionId}
                      preserveEmptySessionSelection
                      readOnly
                      readOnlyNotice=""
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
