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
  sidebarCollapsed?: boolean;
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
  sidebarCollapsed = false,
}: AgentChatWorkspaceProps) => {
  const sidebarWidthClass = sidebarCollapsed
    ? "w-0 min-w-0 max-w-0 basis-0"
    : "w-64 min-w-[16rem] max-w-[16rem] basis-[16rem]";

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden gap-0.5">
      <div
        className={`flex h-full min-h-0 shrink-0 flex-col overflow-hidden ${sidebarWidthClass}`}
      >
        {!sidebarCollapsed ? (
          <ChatSessionList
            scope={scope}
            module={module}
            currentSessionId={currentSessionId}
            onSelectSession={onSelectSession}
            onNewSession={onNewSession}
            sessionKinds={sessionKinds}
          />
        ) : null}
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
