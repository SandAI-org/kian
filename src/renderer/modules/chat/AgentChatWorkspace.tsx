import { MenuUnfoldOutlined } from "@ant-design/icons";
import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { Button } from "antd";
import { useState } from "react";
import type {
  ChatModuleType,
  ChatScope,
  ChatSessionKind,
} from "@shared/types";
import { ChatSessionList } from "@renderer/modules/chat/ChatSessionList";
import { ModuleChatPane } from "@renderer/modules/chat/ModuleChatPane";

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
}

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
}: AgentChatWorkspaceProps) => {
  const { t } = useAppI18n();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarWidthClass = sidebarCollapsed
    ? "w-10 min-w-[2.5rem] max-w-[2.5rem] basis-[2.5rem]"
    : "w-64 min-w-[16rem] max-w-[16rem] basis-[16rem]";

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden gap-0.5">
      <div
        className={`flex h-full min-h-0 shrink-0 flex-col overflow-hidden ${sidebarWidthClass}`}
      >
        {sidebarCollapsed ? (
          <div className="flex items-center justify-center">
            <Button
              type="text"
              shape="circle"
              icon={<MenuUnfoldOutlined />}
              title={t("展开对话列表")}
              aria-label={t("展开对话列表")}
              size="small"
              onClick={() => setSidebarCollapsed(false)}
            />
          </div>
        ) : (
          <ChatSessionList
            scope={scope}
            module={module}
            currentSessionId={currentSessionId}
            onSelectSession={onSelectSession}
            onNewSession={onNewSession}
            sessionKinds={sessionKinds}
            collapsible
            onCollapse={() => setSidebarCollapsed(true)}
          />
        )}
      </div>
      <div className="min-w-0 flex-1 basis-0">
        <div className="mx-auto h-full">
          <ModuleChatPane
            projectId={projectId}
            scope={scope}
            module={module}
            chatVariant={chatVariant}
            acceptMainInputFocusEvents={acceptMainInputFocusEvents}
            contextSnapshot={contextSnapshot}
            hideBorder={hideBorder}
            sessionId={currentSessionId}
            onSessionCreated={onSessionCreated}
          />
        </div>
      </div>
    </div>
  );
};
