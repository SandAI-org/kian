import {
  CloseOutlined,
  DeleteOutlined,
  LeftOutlined,
  PlusOutlined,
  RightOutlined,
} from "@ant-design/icons";
import {
  IllustrationEmptyGroupMembers,
  IllustrationEmptyGroupMessages,
} from "@renderer/components/EmptyIllustrations";
import { ScrollArea } from "@renderer/components/ScrollArea";
import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { api } from "@renderer/lib/api";
import {
  CHAT_THINKING_LEVEL_VALUES,
  ChatComposer,
  type ChatMentionOption,
  type LocalChatFile,
} from "@renderer/modules/chat/ChatComposer";
import {
  AssistantMessageContextMenu,
  MarkdownMessage,
} from "@renderer/modules/chat/ModuleChatPane";
import type {
  AgentGroupDTO,
  AgentGroupMessageDTO,
  AgentGroupTypingAgentDTO,
  ChatThinkingLevel,
  ProjectDTO,
} from "@shared/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  Modal,
  Select,
  Typography,
  message as antdMessage,
} from "antd";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

interface AgentGroupChatWorkspaceProps {
  group: AgentGroupDTO;
  projects: ProjectDTO[];
}

const PAGE_SIZE = 30;
const SUPPORTED_FILE_ACCEPT = [
  ".pdf",
  ".docx",
  ".csv",
  ".xlsx",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".md",
  ".markdown",
  "image/*",
  "audio/*",
  "video/*",
].join(",");
const IMAGE_FILE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".heic",
  ".heif",
]);
const VIDEO_FILE_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".avi",
  ".mkv",
  ".flv",
  ".wmv",
  ".m3u8",
]);
const AUDIO_FILE_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".flac",
  ".ogg",
  ".opus",
]);
const FULL_HEIGHT_SCROLL_CONTENT_CLASS =
  "[&_.simplebar-wrapper]:h-full [&_.simplebar-mask]:h-full [&_.simplebar-offset]:!h-full [&_.simplebar-content-wrapper]:h-full [&_.simplebar-content]:min-h-full";
const AGENT_COLOR_SPACE_SIZE = 360 * 20 * 14;
const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 56;

type AgentBubbleStyle = Pick<CSSProperties, "backgroundColor" | "borderColor">;

const formatMessageTime = (isoString: string): string =>
  new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoString));

const getStableHash = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const getAgentIdentityKey = (
  message: Pick<AgentGroupMessageDTO, "senderAgentId" | "senderAgentName" | "id">,
): string => message.senderAgentName || message.senderAgentId || message.id;

const formatTypingAgentNames = (
  agents: AgentGroupTypingAgentDTO[],
  language: string,
): string =>
  agents
    .map((agent) => agent.agentName || agent.agentProjectId)
    .join(language === "zh-CN" ? "，" : ", ");

const getAgentBubbleStyle = (colorIndex: number): AgentBubbleStyle => {
  const hue = colorIndex % 360;
  const saturation = 58 + (Math.floor(colorIndex / 360) % 20);
  const lightness = 44 + (Math.floor(colorIndex / (360 * 20)) % 14);
  const color = `hsl(${hue} ${saturation}% ${lightness}%)`;

  return {
    borderColor: `color-mix(in srgb, ${color} 68%, var(--stroke))`,
    backgroundColor: `color-mix(in srgb, ${color} 16%, rgba(var(--surface-rgb), 0.9))`,
  };
};

const getFileExtension = (fileName: string): string => {
  const normalized = fileName.trim().toLowerCase();
  const dotIndex = normalized.lastIndexOf(".");
  return dotIndex >= 0 ? normalized.slice(dotIndex) : "";
};

const isImageFile = (name: string, mimeType?: string): boolean =>
  Boolean(mimeType?.startsWith("image/")) ||
  IMAGE_FILE_EXTENSIONS.has(getFileExtension(name));

const getMarkdownKind = (
  file: Pick<LocalChatFile, "name" | "mimeType" | "extension">,
): "image" | "video" | "audio" | "file" => {
  if (file.mimeType?.startsWith("image/")) return "image";
  if (file.mimeType?.startsWith("video/")) return "video";
  if (file.mimeType?.startsWith("audio/")) return "audio";
  if (IMAGE_FILE_EXTENSIONS.has(file.extension)) return "image";
  if (VIDEO_FILE_EXTENSIONS.has(file.extension)) return "video";
  if (AUDIO_FILE_EXTENSIONS.has(file.extension)) return "audio";
  return "file";
};

const formatGroupDraftMessage = (
  text: string,
  files: LocalChatFile[],
): string => {
  const base = text.trim();
  if (files.length === 0) return base;
  const fileLines = files.map(
    (file) => `@[${getMarkdownKind(file)}](${file.sourcePath})`,
  );
  return `${base}\n\n${fileLines.join("\n")}`.trim();
};

const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.readAsDataURL(file);
  });

export const AgentGroupChatWorkspace = ({
  group,
  projects,
}: AgentGroupChatWorkspaceProps) => {
  const { language, resolvedTheme, t } = useAppI18n();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<AgentGroupMessageDTO[]>([]);
  const [typingAgents, setTypingAgents] = useState<AgentGroupTypingAgentDTO[]>(
    [],
  );
  const [beforeCursor, setBeforeCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<LocalChatFile[]>([]);
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [memberSidebarOpen, setMemberSidebarOpen] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [checkedAvailableMemberIds, setCheckedAvailableMemberIds] = useState<
    string[]
  >([]);
  const [checkedSelectedMemberIds, setCheckedSelectedMemberIds] = useState<
    string[]
  >([]);
  const [isComposing, setIsComposing] = useState(false);
  const [selectedThinkingLevel, setSelectedThinkingLevel] =
    useState<ChatThinkingLevel>("low");
  const inputContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingFilesRef = useRef<LocalChatFile[]>([]);
  const messageBottomRef = useRef<HTMLDivElement | null>(null);
  const isBottomAnchorVisibleRef = useRef(true);
  const hasInitialBottomPositionedRef = useRef(false);
  const forceScrollToBottomRef = useRef(false);

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const thinkingLevelOptions = useMemo(
    () =>
      CHAT_THINKING_LEVEL_VALUES.map((value) => ({
        value,
        label:
          value === "low" ? t("低") : value === "medium" ? t("中") : t("高"),
      })),
    [t],
  );
  const members = useMemo(
    () =>
      group.memberProjectIds
        .map((projectId) => projectById.get(projectId))
        .filter((project): project is ProjectDTO => Boolean(project)),
    [group.memberProjectIds, projectById],
  );
  const selectableMemberIds = useMemo(
    () =>
      new Set(
        projects
          .filter((project) => !group.memberProjectIds.includes(project.id))
          .map((project) => project.id),
      ),
    [group.memberProjectIds, projects],
  );
  const selectedMemberIdSet = useMemo(
    () => new Set(selectedMemberIds),
    [selectedMemberIds],
  );
  const availableMemberProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          selectableMemberIds.has(project.id) &&
          !selectedMemberIdSet.has(project.id),
      ),
    [projects, selectableMemberIds, selectedMemberIdSet],
  );
  const selectedMemberProjects = useMemo(
    () =>
      selectedMemberIds
        .map((projectId) => projectById.get(projectId))
        .filter((project): project is ProjectDTO => Boolean(project)),
    [projectById, selectedMemberIds],
  );
  const availableMemberIdSet = useMemo(
    () => new Set(availableMemberProjects.map((project) => project.id)),
    [availableMemberProjects],
  );
  const agentBubbleStyles = useMemo(() => {
    const agentKeys = new Set(group.memberProjectIds);
    for (const message of messages) {
      if (message.senderType === "agent") {
        agentKeys.add(getAgentIdentityKey(message));
      }
    }

    const usedColorIndexes = new Set<number>();
    const styles = new Map<string, AgentBubbleStyle>();
    for (const agentKey of [...agentKeys].sort()) {
      let colorIndex = getStableHash(agentKey) % AGENT_COLOR_SPACE_SIZE;
      while (usedColorIndexes.has(colorIndex)) {
        colorIndex = (colorIndex + 1) % AGENT_COLOR_SPACE_SIZE;
      }
      usedColorIndexes.add(colorIndex);
      styles.set(agentKey, getAgentBubbleStyle(colorIndex));
    }
    return styles;
  }, [group.memberProjectIds, messages]);
  const typingLabel = useMemo(() => {
    if (typingAgents.length === 0) return "";
    return t(`${formatTypingAgentNames(typingAgents, language)} 正在思考...`);
  }, [language, t, typingAgents]);
  const mentionNames = useMemo(
    () => members.map((member) => member.name),
    [members],
  );
  const mentionOptions = useMemo<ChatMentionOption[]>(
    () =>
      members.map((member) => ({
        key: member.id,
        label: `@${member.name}`,
        insertText: `@${member.name}`,
        searchText: member.name,
      })),
    [members],
  );

  const loadLatestMessages = useCallback(async () => {
    setLoadingMessages(true);
    try {
      const page = await api.agentGroupMessage.list({
        groupId: group.id,
        limit: PAGE_SIZE,
      });
      setMessages(page.messages);
      setBeforeCursor(page.nextBeforeCursor);
      setHasMore(page.hasMore);
    } catch (error) {
      antdMessage.error(
        error instanceof Error ? error.message : t("加载群消息失败"),
      );
    } finally {
      setLoadingMessages(false);
    }
  }, [group.id, t]);

  const loadOlderMessages = useCallback(async () => {
    if (!beforeCursor || !hasMore || loadingMessages) return;
    setLoadingMessages(true);
    try {
      const page = await api.agentGroupMessage.list({
        groupId: group.id,
        limit: PAGE_SIZE,
        beforeCursor,
      });
      setMessages((current) => {
        const existingIds = new Set(current.map((item) => item.id));
        return [
          ...page.messages.filter((item) => !existingIds.has(item.id)),
          ...current,
        ];
      });
      setBeforeCursor(page.nextBeforeCursor);
      setHasMore(page.hasMore);
    } catch (error) {
      antdMessage.error(
        error instanceof Error ? error.message : t("加载群消息失败"),
      );
    } finally {
      setLoadingMessages(false);
    }
  }, [beforeCursor, group.id, hasMore, loadingMessages, t]);

  useEffect(() => {
    void loadLatestMessages();
  }, [loadLatestMessages]);

  useEffect(() => {
    hasInitialBottomPositionedRef.current = false;
    forceScrollToBottomRef.current = false;
    isBottomAnchorVisibleRef.current = true;
  }, [group.id]);

  useEffect(() => {
    setSelectedMemberIds((current) =>
      current.filter((projectId) => selectableMemberIds.has(projectId)),
    );
  }, [selectableMemberIds]);

  useEffect(() => {
    setCheckedAvailableMemberIds((current) =>
      current.filter((projectId) => availableMemberIdSet.has(projectId)),
    );
  }, [availableMemberIdSet]);

  useEffect(() => {
    setCheckedSelectedMemberIds((current) =>
      current.filter((projectId) => selectedMemberIdSet.has(projectId)),
    );
  }, [selectedMemberIdSet]);

  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);

  useEffect(
    () => () => {
      for (const file of pendingFilesRef.current) {
        if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
      }
    },
    [],
  );

  useEffect(() => {
    return api.agentGroupMessage.subscribeUpdated((event) => {
      if (event.groupId !== group.id) return;
      setMessages((current) => {
        if (current.some((item) => item.id === event.message.id)) {
          return current;
        }
        return [...current, event.message];
      });
    });
  }, [group.id]);

  useEffect(() => {
    let active = true;
    setTypingAgents([]);
    void api.agentGroupMessage
      .getTypingState({ groupId: group.id })
      .then((state) => {
        if (active && state.groupId === group.id) {
          setTypingAgents(state.agents);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [group.id]);

  useEffect(() => {
    return api.agentGroupMessage.subscribeTypingUpdated((event) => {
      if (event.groupId !== group.id) return;
      setTypingAgents(event.agents);
    });
  }, [group.id]);

  const getMessageViewport = useCallback((): HTMLElement | null => {
    const anchor = messageBottomRef.current;
    if (!anchor) return null;
    const viewport = anchor.closest(".simplebar-content-wrapper");
    return viewport instanceof HTMLElement ? viewport : null;
  }, []);

  const isViewportNearBottom = useCallback((viewport: HTMLElement): boolean => {
    const distanceToBottom =
      viewport.scrollHeight - (viewport.scrollTop + viewport.clientHeight);
    return distanceToBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior): void => {
      const viewport = getMessageViewport();
      if (viewport) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior });
        return;
      }
      const anchor = messageBottomRef.current;
      if (!anchor) return;
      anchor.scrollIntoView({ block: "end", behavior });
    },
    [getMessageViewport],
  );

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const viewport = getMessageViewport();
    if (!viewport) return;
    const content = viewport.querySelector(".simplebar-content");
    if (!(content instanceof HTMLElement)) return;

    let rafId: number | undefined;
    const keepBottomWhenContentChanges = (): void => {
      if (!isBottomAnchorVisibleRef.current && !forceScrollToBottomRef.current)
        return;
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        scrollToBottom("auto");
      });
    };

    const observer = new ResizeObserver(() => {
      keepBottomWhenContentChanges();
    });
    observer.observe(content);

    return () => {
      observer.disconnect();
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [
    getMessageViewport,
    group.id,
    messages.length,
    scrollToBottom,
    typingAgents.length,
  ]);

  useLayoutEffect(() => {
    if (!messageBottomRef.current) return;
    const isInitialBottomPositioning = !hasInitialBottomPositionedRef.current;
    const shouldForceScroll = forceScrollToBottomRef.current;
    if (
      !shouldForceScroll &&
      !isInitialBottomPositioning &&
      !isBottomAnchorVisibleRef.current
    )
      return;
    const viewport = getMessageViewport();
    const distanceToBottom = viewport
      ? viewport.scrollHeight - (viewport.scrollTop + viewport.clientHeight)
      : 0;
    const shouldUseSmoothScroll =
      !shouldForceScroll &&
      !isInitialBottomPositioning &&
      distanceToBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
    scrollToBottom(shouldUseSmoothScroll ? "smooth" : "auto");
    hasInitialBottomPositionedRef.current = true;
    forceScrollToBottomRef.current = false;
    isBottomAnchorVisibleRef.current = true;
  }, [getMessageViewport, messages, scrollToBottom, typingAgents.length]);

  const sendMutation = useMutation({
    mutationFn: (content: string) =>
      api.agentGroupMessage.sendUserMessage({
        groupId: group.id,
        content,
      }),
    onSuccess: () => {
      setDraft("");
    },
    onError: (error) => {
      antdMessage.error(error instanceof Error ? error.message : t("发送失败"));
    },
  });

  const addMembersMutation = useMutation({
    mutationFn: (projectIds: string[]) =>
      api.agentGroup.addMembers({
        groupId: group.id,
        projectIds,
      }),
    onSuccess: async () => {
      setSelectedMemberIds([]);
      setCheckedAvailableMemberIds([]);
      setCheckedSelectedMemberIds([]);
      setAddMembersOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["agent-groups"] });
    },
    onError: (error) => {
      antdMessage.error(
        error instanceof Error ? error.message : t("添加成员失败"),
      );
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (projectId: string) =>
      api.agentGroup.removeMember({
        groupId: group.id,
        projectIds: [projectId],
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["agent-groups"] });
    },
    onError: (error) => {
      antdMessage.error(
        error instanceof Error ? error.message : t("移除成员失败"),
      );
    },
  });

  const handleScroll = useCallback(
    (event: Event) => {
      const target = event.currentTarget as HTMLElement;
      isBottomAnchorVisibleRef.current = isViewportNearBottom(target);
      if (target.scrollTop < 32) {
        void loadOlderMessages();
      }
    },
    [isViewportNearBottom, loadOlderMessages],
  );

  const appendPendingFiles = useCallback((files: LocalChatFile[]) => {
    if (files.length === 0) return;
    setPendingFiles((current) => {
      const byKey = new Map(current.map((file) => [file.key, file]));
      for (const file of files) {
        const replaced = byKey.get(file.key);
        if (replaced?.previewUrl && replaced.previewUrl !== file.previewUrl) {
          URL.revokeObjectURL(replaced.previewUrl);
        }
        byKey.set(file.key, file);
      }
      const merged = [...byKey.values()];
      if (merged.length <= 20) return merged;
      const overflow = merged.slice(20);
      for (const file of overflow) {
        if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
      }
      return merged.slice(0, 20);
    });
  }, []);

  const handleSelectFiles = (event: ChangeEvent<HTMLInputElement>): void => {
    const selected = Array.from(event.target.files ?? []);
    if (selected.length === 0) return;

    const nextFiles: LocalChatFile[] = [];
    for (const rawFile of selected) {
      const legacyPath = (rawFile as File & { path?: string }).path;
      const sourcePath = api.file.getPathForFile(rawFile) || legacyPath;
      if (!sourcePath) {
        antdMessage.error(t("当前环境无法读取文件路径"));
        continue;
      }
      nextFiles.push({
        key: `${sourcePath}:${rawFile.lastModified}:${rawFile.size}`,
        name: rawFile.name,
        sourcePath,
        size: rawFile.size,
        mimeType: rawFile.type || undefined,
        extension: getFileExtension(rawFile.name),
        previewUrl: isImageFile(rawFile.name, rawFile.type || undefined)
          ? URL.createObjectURL(rawFile)
          : undefined,
      });
    }
    appendPendingFiles(nextFiles);
    event.target.value = "";
  };

  const handlePasteFiles = (event: ClipboardEvent<HTMLDivElement>): void => {
    const clipboardFiles = Array.from(event.clipboardData.files);
    const itemFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    const selected = clipboardFiles.length > 0 ? clipboardFiles : itemFiles;
    if (selected.length === 0) return;

    event.preventDefault();
    void (async () => {
      const nextFiles: LocalChatFile[] = [];
      for (const rawFile of selected) {
        const legacyPath = (rawFile as File & { path?: string }).path;
        let sourcePath = api.file.getPathForFile(rawFile) || legacyPath;
        let name = rawFile.name || "pasted-file";
        let size = rawFile.size;

        if (!sourcePath) {
          try {
            const saved = await api.file.savePastedUpload({
              name,
              mimeType: rawFile.type || undefined,
              dataBase64: await readFileAsBase64(rawFile),
            });
            sourcePath = saved.sourcePath;
            name = saved.name;
            size = saved.size ?? rawFile.size;
          } catch {
            antdMessage.error(t("粘贴文件失败"));
            continue;
          }
        }

        nextFiles.push({
          key: `${sourcePath}:${rawFile.lastModified}:${size}`,
          name,
          sourcePath,
          size,
          mimeType: rawFile.type || undefined,
          extension: getFileExtension(name),
          previewUrl: isImageFile(name, rawFile.type || undefined)
            ? URL.createObjectURL(rawFile)
            : undefined,
        });
      }
      appendPendingFiles(nextFiles);
    })();
  };

  const handleRemovePendingFile = (key: string): void => {
    setPendingFiles((current) => {
      const target = current.find((file) => file.key === key);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((file) => file.key !== key);
    });
  };

  const handleCloseAddMembersModal = (): void => {
    setAddMembersOpen(false);
    setSelectedMemberIds([]);
    setCheckedAvailableMemberIds([]);
    setCheckedSelectedMemberIds([]);
  };

  const moveCheckedMembersToSelected = (): void => {
    setSelectedMemberIds((current) => [
      ...current,
      ...checkedAvailableMemberIds.filter(
        (projectId) =>
          availableMemberIdSet.has(projectId) && !current.includes(projectId),
      ),
    ]);
    setCheckedAvailableMemberIds([]);
  };

  const moveCheckedMembersToAvailable = (): void => {
    const removedIds = new Set(checkedSelectedMemberIds);
    setSelectedMemberIds((current) =>
      current.filter((projectId) => !removedIds.has(projectId)),
    );
    setCheckedSelectedMemberIds([]);
  };

  const handleSend = useCallback(() => {
    const files = [...pendingFiles];
    const content = formatGroupDraftMessage(draft, files);
    if (!content || sendMutation.isPending) return;
    setDraft("");
    setPendingFiles((current) => {
      for (const file of current) {
        if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
      }
      return [];
    });
    sendMutation.mutate(content);
    forceScrollToBottomRef.current = true;
    isBottomAnchorVisibleRef.current = true;
  }, [draft, pendingFiles, sendMutation]);

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (event.nativeEvent.isComposing || isComposing) return;

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        handleSend();
      }
    },
    [
      handleSend,
      isComposing,
    ],
  );

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-[var(--stroke)] bg-[rgba(var(--surface-rgb),0.72)] shadow-[var(--shadow-panel)]">
      <div className="flex items-start justify-between gap-4 border-b border-[var(--stroke)] px-5 py-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Typography.Title
              level={4}
              className="!mb-0 !truncate !text-[var(--text)]"
            >
              {group.name}
            </Typography.Title>
            <Button
              type="text"
              size="small"
              className="!h-6 !rounded-full !border !border-[var(--stroke)] !px-2 !text-xs !text-[var(--muted)] hover:!border-[var(--primary)] hover:!text-[var(--primary)]"
              onClick={() => setMemberSidebarOpen((open) => !open)}
            >
              {members.length} {t("成员")}
            </Button>
          </div>
          <Typography.Paragraph
            className="!mb-0 !mt-1 !text-sm !text-[var(--muted)]"
            ellipsis={{ rows: 2 }}
          >
            {group.description || t("暂无描述")}
          </Typography.Paragraph>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <ScrollArea
            className={`min-h-0 flex-1 px-5 py-4 ${FULL_HEIGHT_SCROLL_CONTENT_CLASS}`}
            onScroll={handleScroll}
          >
            {loadingMessages && messages.length === 0 ? (
              <div className="flex min-h-full items-center justify-center text-sm text-[var(--muted)]">
                {t("加载中...")}
              </div>
            ) : messages.length === 0 ? (
              <div className="flex min-h-full items-center justify-center px-4">
                <div className="flex max-w-[300px] flex-col items-center text-center">
                  <div className="mb-3 flex h-[176px] w-[176px] items-center justify-center rounded-full bg-[rgba(var(--surface-rgb),0.52)]">
                    <IllustrationEmptyGroupMessages size={168} />
                  </div>
                  <div className="text-sm font-semibold text-[var(--text)]">
                    {t("暂无群消息")}
                  </div>
                  <div className="mt-1 max-w-[240px] text-xs leading-5 text-[var(--muted)]">
                    {t("新消息会显示在这里")}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {hasMore ? (
                  <div className="flex justify-center">
                    <Button
                      type="text"
                      size="small"
                      loading={loadingMessages}
                      onClick={() => void loadOlderMessages()}
                    >
                      {t("加载更早消息")}
                    </Button>
                  </div>
                ) : null}
                {messages.map((item) => {
                  const isUser = item.senderType === "user";
                  const senderName = isUser
                    ? t("我")
                    : item.senderAgentName || item.senderAgentId || t("系统");
                  const agentBubbleStyle =
                    item.senderType === "agent"
                      ? agentBubbleStyles.get(getAgentIdentityKey(item))
                      : undefined;
                  return (
                    <div
                      key={item.id}
                      className={`flex ${isUser ? "justify-end" : "w-full"}`}
                    >
                      <div
                        className={
                          isUser
                            ? "max-w-[88%] rounded-2xl rounded-br-md bg-[#2f6ff7] px-3 py-2 text-white"
                            : "flex w-full flex-col items-start text-[var(--text)]"
                        }
                      >
                        {!isUser ? (
                          <div className="mb-1 flex max-w-[88%] items-center gap-2 text-xs text-[var(--muted)]">
                            <span>
                              {senderName}
                            </span>
                            <span>{formatMessageTime(item.createdAt)}</span>
                          </div>
                        ) : null}
                        <div
                          className={`break-words ${
                            isUser
                              ? ""
                              : `max-w-[88%] rounded-2xl rounded-tl-md border px-3 py-2 text-[var(--text)] ${
                                  item.senderType === "agent"
                                    ? ""
                                    : "border-[var(--stroke)] bg-[var(--surface)]"
                                }`
                          }`}
                          style={isUser ? undefined : agentBubbleStyle}
                        >
                          {item.senderType === "agent" ? (
                            <AssistantMessageContextMenu
                              content={item.content}
                              projectId={item.senderAgentId ?? undefined}
                              mentionNames={mentionNames}
                              resolvedTheme={resolvedTheme}
                              saveAsImageLabel={t("保存为图片")}
                              saveSuccessLabel={t("图片已保存")}
                              saveFailedLabel={t("保存图片失败")}
                              saveImageToClipboardLabel={t("保存图片到剪贴板")}
                              saveImageToClipboardSuccessLabel={t(
                                "图片已保存到剪贴板",
                              )}
                              saveImageToClipboardFailedLabel={t(
                                "保存图片到剪贴板失败",
                              )}
                              copyMarkdownLabel={t("复制 Markdown")}
                              copyMarkdownSuccessLabel={t("Markdown 已复制")}
                              copyMarkdownFailedLabel={t("复制 Markdown 失败")}
                            />
                          ) : (
                            <MarkdownMessage
                              content={item.content}
                              mentionNames={mentionNames}
                              user={isUser}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {typingLabel ? (
                  <div className="agent-group-thinking-hint max-w-[88%] text-xs text-[var(--muted)]">
                    {typingLabel}
                  </div>
                ) : null}
                <div
                  ref={messageBottomRef}
                  aria-hidden="true"
                  className="h-px w-full"
                />
              </div>
            )}
          </ScrollArea>

          <div className="border-t border-[var(--stroke)] p-4">
            <ChatComposer
              variant="embedded"
              inputContainerRef={inputContainerRef}
              input={draft}
              onInputChange={setDraft}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => {
                setIsComposing(false);
              }}
              onEditorKeyDown={handleInputKeyDown}
              onInputPaste={handlePasteFiles}
              mentionOptions={mentionOptions}
              mentionAriaLabel={t("提及 Agent")}
              placeholder={t("发送群消息，使用 @Agent 名称点名")}
              fileInputRef={fileInputRef}
              onSelectFiles={handleSelectFiles}
              fileAccept={SUPPORTED_FILE_ACCEPT}
              addFileLabel={t("添加文件")}
              removeFileLabel={(fileName) => t(`移除文件 ${fileName}`)}
              pendingFiles={pendingFiles}
              onRemovePendingFile={handleRemovePendingFile}
              chatInputShortcutHint={t("发送消息")}
              selectedThinkingLevel={selectedThinkingLevel}
              onThinkingLevelChange={setSelectedThinkingLevel}
              showThinkingLevel={false}
              thinkingLevelOptions={thinkingLevelOptions}
              thinkingLevelMenuHeader={t("思考等级")}
              canInterrupt={false}
              interruptLoading={false}
              onInterrupt={() => {}}
              sendLoading={sendMutation.isPending}
              onSend={handleSend}
              canSend={Boolean(draft.trim()) || pendingFiles.length > 0}
            />
          </div>
        </div>

        {memberSidebarOpen ? (
          <aside className="flex w-72 shrink-0 flex-col border-l border-[var(--stroke)] bg-[var(--surface-2)]">
            <div className="flex items-center justify-between border-b border-[var(--stroke)] px-4 py-3">
              <Typography.Text className="!font-semibold !text-[var(--text)]">
                {t("群成员")}
              </Typography.Text>
              <Button
                type="text"
                shape="circle"
                size="small"
                icon={<CloseOutlined />}
                title={t("关闭")}
                aria-label={t("关闭")}
                onClick={() => setMemberSidebarOpen(false)}
              />
            </div>
            <ScrollArea
              className={`min-h-0 flex-1 px-3 py-3 ${FULL_HEIGHT_SCROLL_CONTENT_CLASS}`}
            >
              {members.length > 0 ? (
                <div className="space-y-1">
                  {members.map((member) => (
                    <div
                      key={member.id}
                      className="group flex items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-[var(--surface)]"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--text)]">
                          {member.name}
                        </div>
                      </div>
                      <Button
                        type="text"
                        danger
                        size="small"
                        shape="circle"
                        className="!opacity-0 group-hover:!opacity-100"
                        icon={<DeleteOutlined />}
                        loading={removeMemberMutation.isPending}
                        title={t("移除成员")}
                        aria-label={t("移除成员")}
                        onClick={() => removeMemberMutation.mutate(member.id)}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-full items-center justify-center px-4">
                  <div className="flex max-w-[210px] flex-col items-center text-center">
                    <IllustrationEmptyGroupMembers size={132} />
                    <div className="mt-2 text-sm font-semibold text-[var(--text)]">
                      {t("还没有群成员")}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-[var(--muted)]">
                      {t("选择要加入的 Agent")}
                    </div>
                  </div>
                </div>
              )}
            </ScrollArea>
            <div className="border-t border-[var(--stroke)] p-3">
              <Button
                block
                icon={<PlusOutlined />}
                onClick={() => setAddMembersOpen(true)}
              >
                {t("添加成员")}
              </Button>
            </div>
          </aside>
        ) : null}
      </div>

      <Modal
        title={t("添加群成员")}
        open={addMembersOpen}
        width={760}
        okText={t("添加")}
        cancelText={t("取消")}
        okButtonProps={{
          disabled: selectedMemberIds.length === 0,
          loading: addMembersMutation.isPending,
        }}
        onCancel={handleCloseAddMembersModal}
        onOk={() => addMembersMutation.mutate(selectedMemberIds)}
      >
        <div className="grid min-h-[320px] grid-cols-[minmax(0,1fr)_48px_minmax(0,1fr)] gap-3">
          <div className="flex min-w-0 flex-col rounded-lg border border-[var(--stroke)] bg-[var(--surface)]">
            <div className="flex items-center justify-between border-b border-[var(--stroke)] px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <Checkbox
                  checked={
                    availableMemberProjects.length > 0 &&
                    checkedAvailableMemberIds.length ===
                      availableMemberProjects.length
                  }
                  indeterminate={
                    checkedAvailableMemberIds.length > 0 &&
                    checkedAvailableMemberIds.length <
                      availableMemberProjects.length
                  }
                  disabled={availableMemberProjects.length === 0}
                  aria-label={t("选择全部可添加 Agent")}
                  onChange={(event) =>
                    setCheckedAvailableMemberIds(
                      event.target.checked
                        ? availableMemberProjects.map((project) => project.id)
                        : [],
                    )
                  }
                />
                <Typography.Text className="!truncate !font-medium !text-[var(--text)]">
                  {t("可添加 Agent")}
                </Typography.Text>
              </div>
              <Typography.Text className="!text-xs !text-[var(--muted)]">
                {checkedAvailableMemberIds.length}/
                {availableMemberProjects.length}
              </Typography.Text>
            </div>
            <ScrollArea className="min-h-0 flex-1 px-2 py-2">
              {availableMemberProjects.length > 0 ? (
                <div className="space-y-1">
                  {availableMemberProjects.map((project) => (
                    <Checkbox
                      key={project.id}
                      checked={checkedAvailableMemberIds.includes(project.id)}
                      className="!flex !min-w-0 rounded-md !px-2 !py-2 hover:!bg-[var(--surface-2)]"
                      onChange={(event) =>
                        setCheckedAvailableMemberIds((current) =>
                          event.target.checked
                            ? [...current, project.id]
                            : current.filter(
                                (projectId) => projectId !== project.id,
                              ),
                        )
                      }
                    >
                      <span className="ml-1 flex min-w-0">
                        <span className="truncate text-sm font-medium text-[var(--text)]">
                          {project.name}
                        </span>
                      </span>
                    </Checkbox>
                  ))}
                </div>
              ) : (
                <div className="flex h-full min-h-[220px] items-center justify-center px-4 text-center text-sm text-[var(--muted)]">
                  {t("暂无可添加 Agent")}
                </div>
              )}
            </ScrollArea>
          </div>

          <div className="flex flex-col items-center justify-center gap-2">
            <Button
              type="primary"
              shape="circle"
              className="!h-8 !w-8 !min-w-8 !shrink-0"
              icon={<RightOutlined />}
              disabled={checkedAvailableMemberIds.length === 0}
              title={t("添加选中的 Agent")}
              aria-label={t("添加选中的 Agent")}
              onClick={moveCheckedMembersToSelected}
            />
            <Button
              shape="circle"
              className="!h-8 !w-8 !min-w-8 !shrink-0"
              icon={<LeftOutlined />}
              disabled={checkedSelectedMemberIds.length === 0}
              title={t("取消选择选中的 Agent")}
              aria-label={t("取消选择选中的 Agent")}
              onClick={moveCheckedMembersToAvailable}
            />
          </div>

          <div className="flex min-w-0 flex-col rounded-lg border border-[var(--stroke)] bg-[var(--surface)]">
            <div className="flex items-center justify-between border-b border-[var(--stroke)] px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <Checkbox
                  checked={
                    selectedMemberProjects.length > 0 &&
                    checkedSelectedMemberIds.length ===
                      selectedMemberProjects.length
                  }
                  indeterminate={
                    checkedSelectedMemberIds.length > 0 &&
                    checkedSelectedMemberIds.length <
                      selectedMemberProjects.length
                  }
                  disabled={selectedMemberProjects.length === 0}
                  aria-label={t("选择全部已选择 Agent")}
                  onChange={(event) =>
                    setCheckedSelectedMemberIds(
                      event.target.checked
                        ? selectedMemberProjects.map((project) => project.id)
                        : [],
                    )
                  }
                />
                <Typography.Text className="!truncate !font-medium !text-[var(--text)]">
                  {t("已选择 Agent")}
                </Typography.Text>
              </div>
              <Typography.Text className="!text-xs !text-[var(--muted)]">
                {checkedSelectedMemberIds.length}/{selectedMemberProjects.length}
              </Typography.Text>
            </div>
            <ScrollArea className="min-h-0 flex-1 px-2 py-2">
              {selectedMemberProjects.length > 0 ? (
                <div className="space-y-1">
                  {selectedMemberProjects.map((project) => (
                    <Checkbox
                      key={project.id}
                      checked={checkedSelectedMemberIds.includes(project.id)}
                      className="!flex !min-w-0 rounded-md !px-2 !py-2 hover:!bg-[var(--surface-2)]"
                      onChange={(event) =>
                        setCheckedSelectedMemberIds((current) =>
                          event.target.checked
                            ? [...current, project.id]
                            : current.filter(
                                (projectId) => projectId !== project.id,
                              ),
                        )
                      }
                    >
                      <span className="ml-1 flex min-w-0">
                        <span className="truncate text-sm font-medium text-[var(--text)]">
                          {project.name}
                        </span>
                      </span>
                    </Checkbox>
                  ))}
                </div>
              ) : (
                <div className="flex h-full min-h-[220px] items-center justify-center px-4 text-center text-sm text-[var(--muted)]">
                  {t("尚未选择 Agent")}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </Modal>
    </div>
  );
};
