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
  ChatSessionKind,
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
  sessionKinds?: ChatSessionKind[];
  allowCreate?: boolean;
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

const SOURCE_LABEL_MAP: Record<string, Record<string, string>> = {
  discord: { group: "Discord Server", direct: "Discord 用户" },
  feishu: { group: "飞书群", direct: "飞书用户" },
  telegram: { group: "Telegram 频道", direct: "Telegram 用户" },
  weixin: { group: "微信群", direct: "微信用户" },
};

const getSessionSourceLabel = (session: ChatSessionDTO): string | null => {
  if (!session.metadataJson) return null;
  try {
    const meta = JSON.parse(session.metadataJson);
    if (meta.kind !== "digital_avatar_session") return null;
    const providerMap = SOURCE_LABEL_MAP[meta.provider];
    if (!providerMap) return null;
    const label = providerMap[meta.chatType];
    return label ?? null;
  } catch {
    return null;
  }
};

export const ChatSessionList = ({
  scope,
  module,
  currentSessionId,
  onSelectSession,
  onNewSession,
  sessionKinds,
  allowCreate = true,
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
    queryKey: getChatSessionsQueryKey(scopeKey, sessionKinds),
    queryFn: () => api.chat.getSessions(scope, { kinds: sessionKinds }),
    enabled: Boolean(scopeKey),
  });

  const sessions = sessionsQuery.data ?? [];
  const isDigitalAvatarList =
    sessionKinds?.length === 1 && sessionKinds[0] === "digital_avatar";

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
          } else if (allowCreate) {
            // No sessions left, create a new one
            onNewSession();
          }
        }
      } catch {
        message.error(t("删除对话失败"));
      }
    },
    [
      allowCreate,
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
    const sessionsQueryKey = getChatSessionsQueryKey(scopeKey, sessionKinds);
    const previousSessions =
      queryClient.getQueryData<ChatSessionDTO[]>(sessionsQueryKey);
    const optimisticUpdatedAt = new Date().toISOString();
    patchChatSessionList(
      queryClient,
      scope,
      editingSessionId,
      (currentItem) => {
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
      },
      sessionKinds,
    );
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
    sessionKinds,
    sessions,
    t,
    titleDraft,
  ]);

  const listContent = sessions.length === 0 ? (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center select-none">
      {isDigitalAvatarList ? (
        <>
          <svg
            width="56"
            height="56"
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="mb-3 opacity-30"
          >
            <rect
              x="6"
              y="12"
              width="30"
              height="20"
              rx="6"
              stroke="#94a3b8"
              strokeWidth="1.2"
            />
            <path
              d="M12 32 L12 38 L19 32"
              stroke="#94a3b8"
              strokeWidth="1.2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="15" cy="22" r="1.5" fill="#94a3b8" />
            <circle cx="21" cy="22" r="1.5" fill="#94a3b8" />
            <circle cx="27" cy="22" r="1.5" fill="#94a3b8" />
            <rect
              x="28"
              y="28"
              width="30"
              height="20"
              rx="6"
              stroke="#94a3b8"
              strokeWidth="1.2"
            />
            <path
              d="M52 48 L52 54 L45 48"
              stroke="#94a3b8"
              strokeWidth="1.2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect
              x="35"
              y="36"
              width="16"
              height="2"
              rx="1"
              fill="#94a3b8"
              opacity="0.5"
            />
            <rect
              x="35"
              y="41"
              width="10"
              height="2"
              rx="1"
              fill="#94a3b8"
              opacity="0.35"
            />
          </svg>
          <Typography.Text className="!mb-1 !text-sm !font-medium !text-slate-500">
            {t("暂无对话")}
          </Typography.Text>
          <Typography.Text className="!text-xs !text-slate-400">
            {t("新消息会显示在这里")}
          </Typography.Text>
        </>
      ) : (
        <Typography.Text className="!text-xs !text-slate-400">
          {t("暂无对话")}
        </Typography.Text>
      )}
    </div>
  ) : (
    <ScrollArea className="min-h-0 flex-1 pr-[10px]">
      <div className="space-y-0.5">
        {sessions.map((session) => {
          const isActive = session.id === currentSessionId;
          const isEditing = session.id === editingSessionId;
          const sourceLabel = getSessionSourceLabel(session);
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
                    className={`flex h-5 items-center gap-1.5 ${
                      isActive ? "text-[#1f4fcc]" : "text-slate-800 group-hover:text-[#1f4fcc]"
                    }`}
                    onDoubleClick={(event) => beginTitleEditing(event, session)}
                    title={t("双击修改对话名称")}
                  >
                    {sourceLabel ? (
                      <span className="shrink-0 rounded border border-blue-200 bg-blue-50 px-1 text-[10px] leading-4 text-blue-500">
                        {sourceLabel}
                      </span>
                    ) : null}
                    <span className="i18n-no-translate truncate text-sm font-medium leading-5">
                      {session.title || t("新对话")}
                    </span>
                  </div>
                )}
                <div className="truncate text-xs text-slate-400">
                  {formatRelativeTime(language, session.updatedAt)}
                </div>
              </div>
              <button
                type="button"
                className={`chat-session-list__delete ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded transition-opacity hover:bg-red-50 hover:text-red-500 ${
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
          {allowCreate ? (
            <Button
              type="text"
              shape="circle"
              icon={<PlusOutlined />}
              title={t("新建对话")}
              aria-label={t("新建对话")}
              size="small"
              onClick={onNewSession}
            />
          ) : null}
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
