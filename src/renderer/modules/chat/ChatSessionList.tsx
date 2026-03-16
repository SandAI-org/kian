import { DeleteOutlined, MenuFoldOutlined, MenuUnfoldOutlined, PlusOutlined } from "@ant-design/icons";
import { ScrollArea } from "@renderer/components/ScrollArea";
import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { translateUiText } from "@renderer/i18n/uiTranslations";
import { api } from "@renderer/lib/api";
import {
  getChatSessionsQueryKey,
  patchChatSessionList,
} from "@renderer/modules/chat/chatQueryCache";
import type {
  ChatModuleType,
  ChatScope,
  ChatSessionDTO,
} from "@shared/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Typography, message } from "antd";
import { useCallback, useEffect, useState } from "react";

interface ChatSessionListProps {
  scope: ChatScope;
  module: ChatModuleType;
  currentSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  /** When true, renders only the list without a header (header managed externally). */
  hideHeader?: boolean;
  /** When true and header is shown, display a collapse button. */
  collapsible?: boolean;
  /** Called when the collapse button is clicked. */
  onCollapse?: () => void;
}

const getScopeKey = (scope: ChatScope): string =>
  scope.type === "main" ? "main" : scope.projectId;

const formatRelativeTime = (
  language: import("@shared/i18n").AppLanguage,
  isoString: string,
): string => {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return translateUiText(language, "刚刚");
  if (diffMin < 60) return translateUiText(language, `${diffMin}分钟前`);
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return translateUiText(language, `${diffHour}小时前`);
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return translateUiText(language, `${diffDay}天前`);
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) {
    return translateUiText(language, `${diffMonth}个月前`);
  }
  return translateUiText(language, `${Math.floor(diffMonth / 12)}年前`);
};

export const ChatSessionList = ({
  scope,
  module,
  currentSessionId,
  onSelectSession,
  onNewSession,
  hideHeader = false,
  collapsible = false,
  onCollapse,
}: ChatSessionListProps) => {
  const { language } = useAppI18n();
  const t = (value: string): string => translateUiText(language, value);
  const scopeKey = getScopeKey(scope);
  const queryClient = useQueryClient();
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);

  const sessionsQuery = useQuery({
    queryKey: ["chat-sessions", scopeKey],
    queryFn: () => api.chat.getSessions(scope),
    enabled: Boolean(scopeKey),
  });

  const sessions = sessionsQuery.data ?? [];

  useEffect(() => {
    if (!editingSessionId) return;
    if (!sessions.some((session) => session.id === editingSessionId)) {
      setEditingSessionId(null);
      setTitleDraft("");
    }
  }, [editingSessionId, sessions]);

  const handleDelete = useCallback(
    async (e: React.MouseEvent, sessionId: string) => {
      e.stopPropagation();
      try {
        await api.chat.deleteSession(scope, sessionId);
        void queryClient.invalidateQueries({
          queryKey: ["chat-sessions", scopeKey],
        });
        // If we deleted the current session, select the first remaining one
        if (sessionId === currentSessionId) {
          const remaining = sessions.filter((s) => s.id !== sessionId);
          if (remaining.length > 0) {
            onSelectSession(remaining[0].id);
          } else {
            // No sessions left, create a new one
            onNewSession();
          }
        }
      } catch {
        message.error(t("删除对话失败"));
      }
    },
    [
      currentSessionId,
      onNewSession,
      onSelectSession,
      queryClient,
      scope,
      scopeKey,
      sessions,
      t,
    ],
  );

  const beginTitleEditing = useCallback(
    (e: React.MouseEvent, session: ChatSessionDTO) => {
      e.stopPropagation();
      if (isSavingTitle) return;
      setEditingSessionId(session.id);
      setTitleDraft(session.title || "");
    },
    [isSavingTitle],
  );

  const cancelTitleEditing = useCallback(() => {
    if (isSavingTitle) return;
    setEditingSessionId(null);
    setTitleDraft("");
  }, [isSavingTitle]);

  const saveTitleEditing = useCallback(async () => {
    if (!editingSessionId || isSavingTitle) return;

    const session = sessions.find((item) => item.id === editingSessionId);
    if (!session) {
      setEditingSessionId(null);
      setTitleDraft("");
      return;
    }

    const nextTitle = titleDraft.trim();
    const currentTitle = session.title.trim();

    if (!nextTitle || nextTitle === currentTitle) {
      setEditingSessionId(null);
      setTitleDraft("");
      return;
    }

    setIsSavingTitle(true);
    const sessionsQueryKey = getChatSessionsQueryKey(scopeKey);
    const previousSessions =
      queryClient.getQueryData<ChatSessionDTO[]>(sessionsQueryKey);
    const optimisticUpdatedAt = new Date().toISOString();
    patchChatSessionList(queryClient, scope, editingSessionId, (currentItem) => {
      if (
        currentItem.title === nextTitle &&
        currentItem.updatedAt === optimisticUpdatedAt
      ) {
        return currentItem;
      }

      return {
        ...currentItem,
        title: nextTitle,
        updatedAt: optimisticUpdatedAt,
      };
    });
    setEditingSessionId(null);
    setTitleDraft("");

    try {
      await api.chat.updateSessionTitle(scope, editingSessionId, nextTitle);
    } catch {
      if (previousSessions) {
        queryClient.setQueryData(sessionsQueryKey, previousSessions);
      }
      message.error(t("修改对话名称失败"));
    } finally {
      setIsSavingTitle(false);
    }
  }, [
    editingSessionId,
    isSavingTitle,
    queryClient,
    scope,
    scopeKey,
    sessions,
    t,
    titleDraft,
  ]);

  const listContent = sessions.length === 0 ? (
    <div className="flex flex-col items-center justify-center gap-1 py-8">
      <Typography.Text className="!text-xs !text-slate-400">
        {t("暂无对话")}
      </Typography.Text>
    </div>
  ) : (
    <ScrollArea className="min-h-0 flex-1 pr-[10px]">
      <div className="space-y-0.5">
        {sessions.map((session) => {
          const isActive = session.id === currentSessionId;
          const isEditing = session.id === editingSessionId;
          return (
            <div
              key={session.id}
              className={`group flex cursor-pointer items-center justify-between rounded-lg py-2 transition-colors ${
                isActive ? "text-[#1f4fcc]" : "text-slate-700 hover:text-[#1f4fcc]"
              }`}
              onClick={() => {
                if (isEditing) return;
                onSelectSession(session.id);
              }}
            >
              <div className="min-w-0 flex-1">
                {isEditing ? (
                  <div className="h-5">
                    <Input
                      autoFocus
                      value={titleDraft}
                      maxLength={100}
                      className="!h-5 !rounded-none !border-0 !bg-transparent !px-0 !py-0 !text-sm !font-medium !leading-5 !shadow-none"
                      onChange={(event) => setTitleDraft(event.target.value)}
                      onFocus={(event) => event.target.select()}
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onBlur={() => {
                        void saveTitleEditing();
                      }}
                      onPressEnter={(event) => event.currentTarget.blur()}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelTitleEditing();
                        }
                      }}
                      disabled={isSavingTitle}
                    />
                  </div>
                ) : (
                  <div
                    className={`i18n-no-translate h-5 truncate text-sm font-medium leading-5 ${
                      isActive ? "text-[#1f4fcc]" : "text-slate-800 group-hover:text-[#1f4fcc]"
                    }`}
                    onDoubleClick={(event) => beginTitleEditing(event, session)}
                    title={t("双击修改对话名称")}
                  >
                    {session.title || t("新对话")}
                  </div>
                )}
                <div className="truncate text-xs text-slate-400">
                  {formatRelativeTime(language, session.updatedAt)}
                </div>
              </div>
              <button
                type="button"
                className={`ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded transition-opacity hover:bg-red-50 hover:text-red-500 ${
                  isEditing
                    ? "pointer-events-none invisible opacity-0"
                    : "opacity-0 group-hover:opacity-100"
                }`}
                onClick={(e) => handleDelete(e, session.id)}
                title={t("删除对话")}
                aria-label={t("删除对话")}
                tabIndex={isEditing ? -1 : 0}
              >
                <DeleteOutlined className="text-xs" />
              </button>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );

  if (hideHeader) {
    return <div className="flex min-h-0 flex-1 flex-col">{listContent}</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-center justify-between">
        <Typography.Text className="!font-semibold !text-slate-900">
          {scope.type === "main" ? t("对话历史") : t("对话")}
        </Typography.Text>
        <div className="flex items-center gap-0.5">
          <Button
            type="text"
            shape="circle"
            icon={<PlusOutlined />}
            title={t("新建对话")}
            aria-label={t("新建对话")}
            size="small"
            onClick={onNewSession}
          />
          {collapsible ? (
            <Button
              type="text"
              shape="circle"
              icon={<MenuFoldOutlined />}
              title={t("折叠对话列表")}
              aria-label={t("折叠对话列表")}
              size="small"
              onClick={onCollapse}
            />
          ) : null}
        </div>
      </div>
      {listContent}
    </div>
  );
};
