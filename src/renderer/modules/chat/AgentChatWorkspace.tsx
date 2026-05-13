import { MenuUnfoldOutlined } from "@ant-design/icons";
import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { translateUiText } from "@renderer/i18n/uiTranslations";
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
  const { language } = useAppI18n();
  const t = (value: string): string => translateUiText(language, value);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex h-full gap-0.5">
      <div
        className={`shrink-0 transition-[width] duration-200 ${sidebarCollapsed ? "w-10" : "w-64"}`}
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
      <div className="min-w-0 flex-1">
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
