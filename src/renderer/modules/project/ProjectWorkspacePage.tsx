import { SplitPane } from "@renderer/components/SplitPane";
import type { MainLayoutOutletContext } from "@renderer/app/MainLayout";
import { WorkspacePaneControls } from "@renderer/components/WorkspacePaneControls";
import { AppModule } from "@renderer/modules/app/AppModule";
import { AgentChatWorkspace } from "@renderer/modules/chat/AgentChatWorkspace";
import { ModuleChatPane } from "@renderer/modules/chat/ModuleChatPane";
import { DocsModule } from "@renderer/modules/docs/DocsModule";
import { api } from "@renderer/lib/api";
import { CHAT_INPUT_FOCUS_EVENT } from "@renderer/lib/shortcuts";
import { getChatSessionsQueryKey } from "@renderer/modules/chat/chatQueryCache";
import type {
  ChatModuleType,
  ChatScope,
  ChatSessionDTO,
  ModuleType,
} from "@shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOutletContext, useParams, useSearchParams } from "react-router-dom";

export const NEW_PROJECT_SESSION_EVENT = "project:new-session";

export type ProjectModuleKey = Extract<
  ChatModuleType,
  "main" | "docs" | "app"
>;

export const resolveProjectModule = (value: string | null): ProjectModuleKey => {
  if (value === "main" || value === "docs" || value === "app") {
    return value;
  }
  return "main";
};

interface ProjectWorkspaceContentProps {
  projectId: string;
  activeModule: ProjectModuleKey;
  activeDocumentId?: string;
  pendingRouteSessionId?: string;
  className?: string;
  rightPaneCollapsed?: boolean;
  docsSidebarCollapsed?: boolean;
  onDocsSidebarCollapsedChange?: (collapsed: boolean) => void;
  chatSidebarCollapsed?: boolean;
  onPendingRouteSessionConsumed?: () => void;
}

export const ProjectWorkspaceContent = ({
  projectId,
  activeModule,
  activeDocumentId,
  pendingRouteSessionId = "",
  className = "h-full min-h-0",
  rightPaneCollapsed = false,
  docsSidebarCollapsed,
  onDocsSidebarCollapsedChange,
  chatSidebarCollapsed = false,
  onPendingRouteSessionConsumed,
}: ProjectWorkspaceContentProps) => {
  const [contexts, setContexts] = useState<Record<ModuleType, unknown>>({
    docs: {},
    creation: {},
    app: {},
  });
  const [currentSessionIds, setCurrentSessionIds] = useState<
    Record<string, string | undefined>
  >({});
  const consumedRouteSessionRef = useRef("");
  const queryClient = useQueryClient();

  const chatScope = useMemo<ChatScope>(
    () => ({ type: "project", projectId }),
    [projectId],
  );
  const scopeKey = projectId;
  const hasScopedSession = Object.prototype.hasOwnProperty.call(
    currentSessionIds,
    scopeKey,
  );
  const cachedCurrentSessionId = useMemo(
    () =>
      queryClient.getQueryData<ChatSessionDTO[]>(
        getChatSessionsQueryKey(scopeKey),
      )?.[0]?.id,
    [queryClient, scopeKey],
  );
  const currentSessionId = hasScopedSession
    ? currentSessionIds[scopeKey]
    : cachedCurrentSessionId;

  const updateContext = useCallback((module: ModuleType, context: unknown) => {
    setContexts((prev) => ({
      ...prev,
      [module]: context,
    }));
  }, []);

  const handleNewSession = useCallback(async () => {
    const created = await api.chat.createSession({
      scope: chatScope,
      module: activeModule,
      title: "",
    });
    setCurrentSessionIds((prev) => ({
      ...prev,
      [scopeKey]: created.id,
    }));
    void queryClient.invalidateQueries({
      queryKey: ["chat-sessions", scopeKey],
    });
  }, [activeModule, chatScope, queryClient, scopeKey]);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      setCurrentSessionIds((prev) => ({
        ...prev,
        [scopeKey]: sessionId,
      }));
    },
    [scopeKey],
  );

  const handleSessionCreated = useCallback(
    (sessionId: string) => {
      setCurrentSessionIds((prev) => ({
        ...prev,
        [scopeKey]: sessionId,
      }));
      void queryClient.invalidateQueries({
        queryKey: ["chat-sessions", scopeKey],
      });
    },
    [queryClient, scopeKey],
  );

  useEffect(() => {
    const onNewSession = () => {
      void handleNewSession();
    };
    window.addEventListener(NEW_PROJECT_SESSION_EVENT, onNewSession);
    return () => {
      window.removeEventListener(NEW_PROJECT_SESSION_EVENT, onNewSession);
    };
  }, [handleNewSession]);

  useEffect(() => {
    if (!pendingRouteSessionId) {
      return;
    }

    setCurrentSessionIds((prev) => ({
      ...prev,
      [scopeKey]: pendingRouteSessionId,
    }));
    consumedRouteSessionRef.current = pendingRouteSessionId;
    void queryClient.invalidateQueries({
      queryKey: ["chat-sessions", scopeKey],
    });
    void queryClient.invalidateQueries({
      queryKey: ["chat-messages", scopeKey, pendingRouteSessionId],
    });

    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event(CHAT_INPUT_FOCUS_EVENT));
    });

    onPendingRouteSessionConsumed?.();
  }, [
    onPendingRouteSessionConsumed,
    pendingRouteSessionId,
    queryClient,
    scopeKey,
  ]);

  useEffect(() => {
    if (pendingRouteSessionId) return;
    if (consumedRouteSessionRef.current) {
      consumedRouteSessionRef.current = "";
      return;
    }

    let cancelled = false;

    const syncProjectSession = async (): Promise<void> => {
      try {
        const sessions = await api.chat.getSessions(chatScope);
        if (cancelled) {
          return;
        }
        setCurrentSessionIds((prev) => {
          const selectedSessionId = prev[scopeKey];
          if (
            selectedSessionId &&
            sessions.some((session) => session.id === selectedSessionId)
          ) {
            return prev;
          }
          return {
            ...prev,
            [scopeKey]: sessions[0]?.id,
          };
        });
      } catch {
        if (!cancelled) {
          setCurrentSessionIds((prev) => ({
            ...prev,
            [scopeKey]: undefined,
          }));
        }
      }
    };

    void syncProjectSession();

    return () => {
      cancelled = true;
    };
  }, [chatScope, pendingRouteSessionId, scopeKey]);

  const left = useMemo(
    () => (
      <div className="h-full min-h-0">
        <div className={activeModule === "docs" ? "h-full min-h-0" : "hidden"}>
          <DocsModule
            projectId={projectId}
            requestedDocumentId={activeDocumentId}
            onContextChange={(ctx) => updateContext("docs", ctx)}
            sidebarCollapsed={docsSidebarCollapsed}
            onSidebarCollapsedChange={onDocsSidebarCollapsedChange}
          />
        </div>
        <div className={activeModule === "app" ? "h-full min-h-0" : "hidden"}>
          <AppModule
            projectId={projectId}
            onContextChange={(ctx) => updateContext("app", ctx)}
          />
        </div>
      </div>
    ),
    [
      activeDocumentId,
      activeModule,
      docsSidebarCollapsed,
      onDocsSidebarCollapsedChange,
      projectId,
      updateContext,
    ],
  );

  return (
    <div className={className}>
      {activeModule === "main" ? (
        <AgentChatWorkspace
          projectId={projectId}
          scope={chatScope}
          module="main"
          chatVariant="project"
          currentSessionId={currentSessionId}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
          onSessionCreated={handleSessionCreated}
          contextSnapshot={contexts}
          sidebarCollapsed={chatSidebarCollapsed}
        />
      ) : (
        <SplitPane
          leftCollapsed={false}
          rightCollapsed={rightPaneCollapsed}
          left={left}
          right={
            activeModule === "docs" ? (
              <AgentChatWorkspace
                projectId={projectId}
                scope={chatScope}
                module={activeModule}
                chatVariant="project"
                currentSessionId={currentSessionId}
                onSelectSession={handleSelectSession}
                onNewSession={handleNewSession}
                onSessionCreated={handleSessionCreated}
                contextSnapshot={contexts}
                historyPresentation="popover"
              />
            ) : (
              <ModuleChatPane
                projectId={projectId}
                scope={chatScope}
                module={activeModule}
                chatVariant="project"
                contextSnapshot={contexts}
                sessionId={currentSessionId}
                onSessionCreated={handleSessionCreated}
              />
            )
          }
        />
      )}
    </div>
  );
};

export const ProjectWorkspacePage = () => {
  const { setWorkspaceHeaderControls } =
    useOutletContext<MainLayoutOutletContext>();
  const { projectId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rightPaneCollapsed, setRightPaneCollapsed] = useState(false);
  const [docsSidebarCollapsed, setDocsSidebarCollapsed] = useState(false);
  const [chatSidebarCollapsed, setChatSidebarCollapsed] = useState(false);
  const activeModule = useMemo(
    () => resolveProjectModule(searchParams.get("module")),
    [searchParams],
  );
  const activeDocumentId = searchParams.get("doc") ?? undefined;
  const pendingRouteSessionId = searchParams.get("session")?.trim() ?? "";

  const handlePendingRouteSessionConsumed = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("session");
    nextParams.delete("source");
    nextParams.delete("stamp");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const toggleLeftPane = useCallback(() => {
    if (activeModule === "main") {
      setChatSidebarCollapsed((current) => !current);
      return;
    }

    if (activeModule === "docs") {
      setDocsSidebarCollapsed((current) => !current);
      return;
    }
  }, [activeModule]);

  const toggleRightPane = useCallback(() => {
    setRightPaneCollapsed((current) => {
      const next = !current;
      return next;
    });
  }, []);

  const workspacePaneControls = useMemo(() => {
    if (activeModule === "main") {
      return {
        left: (
          <WorkspacePaneControls
            leftCollapsed={chatSidebarCollapsed}
            rightCollapsed={false}
            onToggleLeft={toggleLeftPane}
            onToggleRight={toggleRightPane}
            showRight={false}
          />
        ),
      };
    }

    return {
      left: activeModule === "docs" ? (
        <WorkspacePaneControls
          leftCollapsed={docsSidebarCollapsed}
          rightCollapsed={rightPaneCollapsed}
          onToggleLeft={toggleLeftPane}
          onToggleRight={toggleRightPane}
          showRight={false}
        />
      ) : null,
      right: (
        <WorkspacePaneControls
          leftCollapsed={docsSidebarCollapsed}
          rightCollapsed={rightPaneCollapsed}
          onToggleLeft={toggleLeftPane}
          onToggleRight={toggleRightPane}
          showLeft={false}
        />
      ),
    };
  }, [
    activeModule,
    chatSidebarCollapsed,
    docsSidebarCollapsed,
    rightPaneCollapsed,
    toggleLeftPane,
    toggleRightPane,
  ]);

  useEffect(() => {
    setWorkspaceHeaderControls(workspacePaneControls);
  }, [setWorkspaceHeaderControls, workspacePaneControls]);

  useEffect(
    () => () => {
      setWorkspaceHeaderControls({});
    },
    [setWorkspaceHeaderControls],
  );

  return (
    <ProjectWorkspaceContent
      key={projectId}
      projectId={projectId}
      activeModule={activeModule}
      activeDocumentId={activeDocumentId}
      pendingRouteSessionId={pendingRouteSessionId}
      className="h-full min-h-0 px-5 pb-5"
      rightPaneCollapsed={rightPaneCollapsed}
      docsSidebarCollapsed={docsSidebarCollapsed}
      onDocsSidebarCollapsedChange={setDocsSidebarCollapsed}
      chatSidebarCollapsed={chatSidebarCollapsed}
      onPendingRouteSessionConsumed={handlePendingRouteSessionConsumed}
    />
  );
};
