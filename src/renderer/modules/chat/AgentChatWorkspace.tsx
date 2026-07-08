import type {
  ChatSessionDTO,
  ChatModuleType,
  ChatScope,
  ChatSessionKind,
} from "@shared/types";
import { UnorderedListOutlined } from "@ant-design/icons";
import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { api } from "@renderer/lib/api";
import { ChatSessionList } from "@renderer/modules/chat/ChatSessionList";
import { ModuleChatPane } from "@renderer/modules/chat/ModuleChatPane";
import {
  getChatScopeKey,
  getChatSessionsQueryKey,
} from "@renderer/modules/chat/chatQueryCache";
import { useQuery } from "@tanstack/react-query";
import { Button, Popover } from "antd";

interface AgentChatWorkspaceProps {
  projectId?: string;
  scope: ChatScope;
  module: ChatModuleType;
  chatVariant: "project" | "main";
  currentSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onSessionCreated: (sessionId: string) => void;
  contextSnapshot?: unknown;
  sessionKinds?: ChatSessionKind[];
  acceptMainInputFocusEvents?: boolean;
  hideBorder?: boolean;
  sidebarCollapsed?: boolean;
  historyPresentation?: "inline" | "popover" | "none";
}

const isGroupChatSession = (session?: ChatSessionDTO): boolean => {
  if (!session) return false;
  if (session.kind === "group_runtime") return true;
  if (!session.metadataJson) return false;

  try {
    const metadata = JSON.parse(session.metadataJson);
    return metadata?.chatType === "group";
  } catch {
    return false;
  }
};

export const AgentChatWorkspace = ({
  projectId,
  scope,
  module,
  chatVariant,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onSessionCreated,
  contextSnapshot,
  sessionKinds,
  acceptMainInputFocusEvents,
  hideBorder,
  sidebarCollapsed = false,
  historyPresentation = "inline",
}: AgentChatWorkspaceProps) => {
  const { t } = useAppI18n();
  const scopeKey = getChatScopeKey(scope);
  const sessionsQuery = useQuery({
    queryKey: getChatSessionsQueryKey(scopeKey, undefined, true),
    queryFn: () => api.chat.getSessions(scope, { includeHidden: true }),
    enabled: Boolean(currentSessionId),
  });
  const currentSession = sessionsQuery.data?.find(
    (session) => session.id === currentSessionId,
  );
  const effectiveHistoryPresentation = isGroupChatSession(currentSession)
    ? "none"
    : historyPresentation;
  const inlineHistoryCollapsed =
    effectiveHistoryPresentation !== "inline" || sidebarCollapsed;
  const sidebarWidthClass = inlineHistoryCollapsed
    ? "w-0 min-w-0 max-w-0 basis-0"
    : "w-64 min-w-[16rem] max-w-[16rem] basis-[16rem]";
  const sidebarPanelClassName = inlineHistoryCollapsed
    ? sidebarWidthClass
    : `${sidebarWidthClass} rounded-lg bg-[var(--surface-2)] py-3`;
  const shellGapClassName = inlineHistoryCollapsed ? "" : "gap-2";
  const historyList = (
    <ChatSessionList
      scope={scope}
      module={module}
      currentSessionId={currentSessionId}
      onSelectSession={onSelectSession}
      onNewSession={onNewSession}
      sessionKinds={sessionKinds}
    />
  );

  return (
    <div
      className={`flex h-full min-h-0 w-full ${shellGapClassName} overflow-hidden rounded-xl bg-[rgba(var(--surface-rgb),0.78)] p-2 ${
        hideBorder
          ? ""
          : "border border-[var(--stroke)] shadow-[0_2px_12px_rgba(15,23,42,0.04)]"
      }`}
    >
      <div
        className={`flex h-full min-h-0 shrink-0 flex-col overflow-hidden ${sidebarPanelClassName}`}
      >
        {!inlineHistoryCollapsed ? historyList : null}
      </div>
      <div className="min-w-0 flex-1 basis-0 overflow-hidden">
        <div className="mx-auto flex h-full min-h-0 flex-col">
          {effectiveHistoryPresentation === "popover" ? (
            <div className="no-drag mb-2 flex h-9 shrink-0 items-center">
              <Popover
                trigger="hover"
                placement="bottomLeft"
                arrow={false}
                styles={{ body: { overflow: "hidden", padding: 0 } }}
                content={
                  <div
                    className="w-72 py-3"
                    style={{ height: "min(520px, calc(100vh - 160px))" }}
                  >
                    {historyList}
                  </div>
                }
              >
                <Button
                  type="text"
                  size="small"
                  className="!h-9 !w-9 !rounded-xl !bg-[rgba(var(--surface-rgb),0.9)] !text-slate-600 shadow-[0_4px_12px_rgba(15,23,42,0.08)] hover:!bg-[#eef3fc] hover:!text-slate-900"
                  icon={<UnorderedListOutlined />}
                  title={t("对话历史")}
                  aria-label={t("对话历史")}
                />
              </Popover>
            </div>
          ) : null}
          <div className="min-h-0 flex-1">
            <ModuleChatPane
              projectId={projectId}
              scope={scope}
              module={module}
              chatVariant={chatVariant}
              acceptMainInputFocusEvents={acceptMainInputFocusEvents}
              contextSnapshot={contextSnapshot}
              hideBorder
              sessionId={currentSessionId}
              onSessionCreated={onSessionCreated}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
