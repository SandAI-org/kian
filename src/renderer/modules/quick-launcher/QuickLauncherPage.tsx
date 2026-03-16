import { CloseOutlined, DesktopOutlined } from "@ant-design/icons";
import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { translateUiText } from "@renderer/i18n/uiTranslations";
import { api } from "@renderer/lib/api";
import {
  QUICK_LAUNCHER_NEW_SESSION_EVENT,
  matchesKeyboardShortcut,
} from "@renderer/lib/shortcuts";
import { ModuleChatPane } from "@renderer/modules/chat/ModuleChatPane";
import { useChatStreamStore } from "@renderer/store/chatStreamStore";
import type { ChatScope } from "@shared/types";
import { DEFAULT_SHORTCUT_CONFIG } from "@shared/utils/shortcuts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Tooltip, message } from "antd";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const MAIN_SCOPE: ChatScope = { type: "main" };
const QUICK_LAUNCHER_MAX_TIMELINE_HEIGHT = 420;
const QUICK_LAUNCHER_ACTIVE_HEIGHT = 520;

export const QuickLauncherPage = () => {
  const { language } = useAppI18n();
  const t = useCallback(
    (value: string) => translateUiText(language, value),
    [language],
  );
  const queryClient = useQueryClient();
  const [currentSessionId, setCurrentSessionId] = useState<string>();
  const [resetToken, setResetToken] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const focusFrameRef = useRef<number | undefined>(undefined);
  const resizeFrameRef = useRef<number | undefined>(undefined);
  const shortcutConfigQuery = useQuery({
    queryKey: ["settings", "shortcuts"],
    queryFn: api.settings.getShortcutConfig,
  });
  const shortcutConfig = shortcutConfigQuery.data ?? DEFAULT_SHORTCUT_CONFIG;

  const sessionsQuery = useQuery({
    queryKey: ["chat-sessions", "main"],
    queryFn: () => api.chat.getSessions(MAIN_SCOPE),
    staleTime: 1000 * 30,
    refetchInterval: (query) => {
      if (!currentSessionId) {
        return false;
      }
      const sessions = (query.state.data as Awaited<
        ReturnType<typeof api.chat.getSessions>
      > | undefined) ?? [];
      const currentSession = sessions.find((item) => item.id === currentSessionId);
      return currentSession && currentSession.title.trim() ? false : 1500;
    },
  });
  const messagesQuery = useQuery({
    queryKey: ["chat-messages", "main", currentSessionId],
    queryFn: () => api.chat.getMessages(MAIN_SCOPE, currentSessionId as string),
    enabled: Boolean(currentSessionId),
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });

  const streamSession = useChatStreamStore((state) =>
    currentSessionId ? state.sessions[currentSessionId] : undefined,
  );

  const currentSession = useMemo(
    () =>
      (sessionsQuery.data ?? []).find((item) => item.id === currentSessionId),
    [currentSessionId, sessionsQuery.data],
  );
  const sessionTitle = currentSession?.title.trim() || t("新对话");
  const hasConversationContent =
    Boolean(currentSessionId) &&
    ((messagesQuery.data?.length ?? 0) > 0 ||
      (streamSession?.streamingBlocks.length ?? 0) > 0 ||
      Boolean(streamSession?.streamError) ||
      Boolean(streamSession?.streamingInProgress));
  const previousHasConversationContentRef = useRef(hasConversationContent);

  useEffect(() => {
    if (
      !currentSessionId ||
      !sessionsQuery.data ||
      !sessionsQuery.isFetched ||
      hasConversationContent
    ) {
      return;
    }
    if (sessionsQuery.data.some((item) => item.id === currentSessionId)) {
      return;
    }
    setCurrentSessionId(undefined);
  }, [
    currentSessionId,
    hasConversationContent,
    sessionsQuery.data,
    sessionsQuery.isFetched,
  ]);

  const cancelScheduledFocus = useCallback(() => {
    if (focusFrameRef.current === undefined) {
      return;
    }
    window.cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = undefined;
  }, []);

  const focusInput = useCallback(() => {
    const textarea = panelRef.current?.querySelector("textarea");
    if (!(textarea instanceof HTMLTextAreaElement)) {
      return false;
    }
    textarea.focus();
    const cursor = textarea.value.length;
    textarea.setSelectionRange(cursor, cursor);
    return true;
  }, []);

  const scheduleFocusInput = useCallback(
    (attempts = 4) => {
      cancelScheduledFocus();

      const queueAttempt = (remainingAttempts: number) => {
        focusFrameRef.current = window.requestAnimationFrame(() => {
          if (focusInput() || remainingAttempts <= 1) {
            focusFrameRef.current = undefined;
            return;
          }
          queueAttempt(remainingAttempts - 1);
        });
      };

      queueAttempt(attempts);
    },
    [cancelScheduledFocus, focusInput],
  );

  useEffect(() => {
    if (currentSessionId) {
      return;
    }
    scheduleFocusInput();
  }, [currentSessionId, resetToken, scheduleFocusInput]);

  useEffect(() => {
    const handleFocus = () => {
      scheduleFocusInput();
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [scheduleFocusInput]);

  useEffect(() => cancelScheduledFocus, [cancelScheduledFocus]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      void api.window.hide();
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    const handleNewSession = (event: KeyboardEvent) => {
      if (!matchesKeyboardShortcut(event, shortcutConfig.newChatSession)) {
        return;
      }

      event.preventDefault();
      window.dispatchEvent(new Event(QUICK_LAUNCHER_NEW_SESSION_EVENT));
    };

    window.addEventListener("keydown", handleNewSession);
    return () => {
      window.removeEventListener("keydown", handleNewSession);
    };
  }, [shortcutConfig.newChatSession]);

  useEffect(() => {
    const hadConversationContent = previousHasConversationContentRef.current;
    previousHasConversationContentRef.current = hasConversationContent;

    if (!hasConversationContent) {
      void api.window.setQuickLauncherResizable(false).catch(() => undefined);
      return;
    }

    const enableResize = async () => {
      if (!hadConversationContent) {
        await api.window.resizeQuickLauncher(QUICK_LAUNCHER_ACTIVE_HEIGHT);
      }
      await api.window.setQuickLauncherResizable(true);
    };

    void enableResize().catch(() => undefined);
  }, [hasConversationContent]);

  const resizeWindow = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    void api.window.resizeQuickLauncher(
      Math.ceil(panel.getBoundingClientRect().height),
    ).catch(() => undefined);
  }, []);

  useLayoutEffect(() => {
    if (hasConversationContent) {
      return;
    }

    const panel = panelRef.current;
    if (!panel || typeof ResizeObserver === "undefined") {
      resizeWindow();
      return;
    }

    const scheduleResize = () => {
      if (resizeFrameRef.current !== undefined) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = undefined;
        resizeWindow();
      });
    };

    scheduleResize();
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(panel);

    return () => {
      observer.disconnect();
      if (resizeFrameRef.current !== undefined) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
    };
  }, [hasConversationContent, resizeWindow]);

  const openInMainChat = useCallback(async () => {
    if (!currentSessionId) {
      return;
    }
    try {
      await api.window.openMainAgentSession(currentSessionId);
      void api.window.dismissQuickLauncher().catch(() => undefined);
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("打开主聊天失败"),
      );
    }
  }, [currentSessionId, t]);

  const closeLauncher = useCallback(() => {
    void api.window.hide();
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

  const resetLauncherSession = useCallback(() => {
    setCurrentSessionId(undefined);
    setResetToken((value) => value + 1);
  }, []);

  useEffect(() => {
    window.addEventListener(
      QUICK_LAUNCHER_NEW_SESSION_EVENT,
      resetLauncherSession,
    );
    return () => {
      window.removeEventListener(
        QUICK_LAUNCHER_NEW_SESSION_EVENT,
        resetLauncherSession,
      );
    };
  }, [resetLauncherSession]);

  return (
    <div
      ref={panelRef}
      className={`drag-region w-full bg-[radial-gradient(circle_at_top_left,rgba(47,111,247,0.14),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(148,163,184,0.16),transparent_36%),#eef2f7] ${
        hasConversationContent ? "h-full" : ""
      }`}
    >
      <div
        className={`relative flex flex-col gap-2 overflow-hidden rounded-[24px] border border-white/70 bg-white/94 shadow-[0_18px_50px_rgba(15,23,42,0.14)] backdrop-blur ${
          hasConversationContent ? "h-full" : ""
        }`}
      >
        {currentSessionId && hasConversationContent ? (
          <div className="drag-region grid grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-2 border-b border-[#e4ebf5] px-3 py-2">
            <Button
              type="text"
              shape="circle"
              size="small"
              className="no-drag !flex !h-8 !w-8 !min-w-8 !items-center !justify-center !rounded-full !text-slate-500 hover:!bg-[#eef3fc] hover:!text-slate-900"
              icon={<CloseOutlined className="text-[13px]" />}
              aria-label={t("关闭")}
              onClick={closeLauncher}
            />
            <div className="i18n-no-translate min-w-0 truncate text-center text-[12px] font-semibold tracking-[0.01em] text-slate-700">
              {sessionTitle}
            </div>
            <Tooltip title={t("在主聊天中打开")} placement="left">
              <Button
                type="text"
                shape="circle"
                size="small"
                className="no-drag !flex !h-8 !w-8 !min-w-8 !items-center !justify-center !rounded-full !text-slate-500 hover:!bg-[#eef3fc] hover:!text-slate-900"
                icon={<DesktopOutlined className="text-[13px]" />}
                aria-label={t("在主聊天中打开")}
                onClick={() => {
                  void openInMainChat();
                }}
              />
            </Tooltip>
          </div>
        ) : null}

        <div
          className={`no-drag p-4 pt-3 ${
            hasConversationContent ? "flex min-h-0 flex-1 flex-col" : ""
          }`}
        >
          <ModuleChatPane
            key={`quick-launcher-${resetToken}`}
            scope={MAIN_SCOPE}
            module="main"
            chatVariant="main"
            acceptMainInputFocusEvents={false}
            hideBorder={false}
            sessionId={currentSessionId}
            onSessionCreated={handleSessionCreated}
            layoutMode={hasConversationContent ? "fill" : "auto"}
            emptyStateMode="hidden"
            timelineMaxHeight={
              hasConversationContent
                ? undefined
                : QUICK_LAUNCHER_MAX_TIMELINE_HEIGHT
            }
            sessionBootstrapMode="lazy-new"
          />
        </div>
      </div>
    </div>
  );
};
