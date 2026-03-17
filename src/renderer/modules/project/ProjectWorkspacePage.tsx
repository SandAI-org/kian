import { SplitPane } from "@renderer/components/SplitPane";
import { AppModule } from "@renderer/modules/app/AppModule";
import { AssetsModule } from "@renderer/modules/assets/AssetsModule";
import { ModuleChatPane } from "@renderer/modules/chat/ModuleChatPane";
import { CreationModule } from "@renderer/modules/creation/CreationModule";
import { DocsModule } from "@renderer/modules/docs/DocsModule";
import { api } from "@renderer/lib/api";
import type { ChatScope, ModuleType } from "@shared/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";

export const NEW_PROJECT_SESSION_EVENT = "project:new-session";

const resolveProjectModule = (value: string | null): ModuleType => {
  if (
    value === "creation" ||
    value === "assets" ||
    value === "docs" ||
    value === "app"
  ) {
    return value;
  }
  return "docs";
};

export const ProjectWorkspacePage = () => {
  const { projectId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const activeModuleParam = searchParams.get("module");
  const activeDocumentParam = searchParams.get("doc") ?? undefined;
  const [contexts, setContexts] = useState<Record<ModuleType, unknown>>({
    docs: {},
    creation: {},
    assets: {},
    app: {},
  });
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>(
    undefined,
  );
  const queryClient = useQueryClient();

  const activeModule = useMemo(
    () => resolveProjectModule(activeModuleParam),
    [activeModuleParam],
  );

  const chatScope = useMemo<ChatScope>(
    () => ({ type: "project", projectId }),
    [projectId],
  );
  const scopeKey = projectId;

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
    setCurrentSessionId(created.id);
    void queryClient.invalidateQueries({
      queryKey: ["chat-sessions", scopeKey],
    });
  }, [activeModule, chatScope, queryClient, scopeKey]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setCurrentSessionId(sessionId);
  }, []);

  const handleSessionCreated = useCallback(
    (sessionId: string) => {
      setCurrentSessionId(sessionId);
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
    let cancelled = false;

    const syncProjectSession = async (): Promise<void> => {
      setCurrentSessionId(undefined);
      try {
        const sessions = await api.chat.getSessions(chatScope);
        if (cancelled) {
          return;
        }
        setCurrentSessionId(sessions[0]?.id);
      } catch {
        if (!cancelled) {
          setCurrentSessionId(undefined);
        }
      }
    };

    void syncProjectSession();

    return () => {
      cancelled = true;
    };
  }, [chatScope]);

  const left = useMemo(
    () => (
      <div className="h-full min-h-0">
        <div className={activeModule === "docs" ? "h-full min-h-0" : "hidden"}>
          <DocsModule
            projectId={projectId}
            requestedDocumentId={activeDocumentParam}
            onContextChange={(ctx) => updateContext("docs", ctx)}
            chatScope={chatScope}
            chatModule={activeModule}
            currentSessionId={currentSessionId}
            onSelectSession={handleSelectSession}
            onNewSession={handleNewSession}
          />
        </div>
        <div
          className={activeModule === "creation" ? "h-full min-h-0" : "hidden"}
        >
          <CreationModule
            projectId={projectId}
            onContextChange={(ctx) => updateContext("creation", ctx)}
          />
        </div>
        <div
          className={activeModule === "assets" ? "h-full min-h-0" : "hidden"}
        >
          <AssetsModule
            projectId={projectId}
            onContextChange={(ctx) => updateContext("assets", ctx)}
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
      activeDocumentParam,
      activeModule,
      chatScope,
      currentSessionId,
      handleNewSession,
      handleSelectSession,
      projectId,
      updateContext,
    ],
  );

  return (
    <div className="h-full min-h-0 px-5 pb-5">
      <SplitPane
        left={left}
        right={
          <ModuleChatPane
            projectId={projectId}
            scope={chatScope}
            module={activeModule}
            chatVariant="project"
            contextSnapshot={contexts}
            sessionId={currentSessionId}
            onSessionCreated={handleSessionCreated}
          />
        }
      />
    </div>
  );
};
