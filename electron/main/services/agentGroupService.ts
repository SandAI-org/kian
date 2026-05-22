import { Type } from "@mariozechner/pi-ai";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AgentGroupDTO,
  AgentGroupMessageDTO,
  AgentGroupMessagePageDTO,
  AgentGroupTypingAgentDTO,
  AgentGroupTypingStateDTO,
  ChatAttachmentDTO,
  ProjectDTO,
} from "@shared/types";
import type { CustomToolDef } from "./customTools";
import { logger } from "./logger";
import {
  extractExtendedMarkdownTokens,
  resolveAttachmentAbsolutePath,
} from "./mediaMarkdown";
import { repositoryService } from "./repositoryService";
import { INTERNAL_ROOT } from "./workspacePaths";

type GroupMessageCursor = {
  offset: number;
};

type PendingDispatchBatch = {
  messages: AgentGroupMessageDTO[];
  allowRandom: boolean;
  timer: NodeJS.Timeout;
};

type ReadLineResult = {
  line: string;
  offset: number;
};

type TypingAgentState = AgentGroupTypingAgentDTO & {
  count: number;
};

const GROUPS_ROOT = path.join(INTERNAL_ROOT, "agent-groups");
const GROUPS_INDEX_PATH = path.join(GROUPS_ROOT, "groups.json");
const MESSAGE_READ_CHUNK_BYTES = 16 * 1024;
const DEFAULT_MESSAGE_LIMIT = 20;
const MAX_MESSAGE_LIMIT = 100;
const DISPATCH_DEBOUNCE_MS = 1000;
const AGENT_SEND_COOLDOWN_MS = 3000;

const groupAppendQueue = new Map<string, Promise<void>>();
const pendingDispatchByGroupId = new Map<string, PendingDispatchBatch>();
const lastAgentSendAtByGroupAndAgent = new Map<string, number>();
const typingAgentsByGroupId = new Map<string, Map<string, TypingAgentState>>();
const eventEmitter = new EventEmitter();

const GROUP_MESSAGES_UPDATED_EVENT = "group-messages-updated";
const GROUP_TYPING_UPDATED_EVENT = "group-typing-updated";

const nowISO = (): string => new Date().toISOString();

const ensureDir = async (dirPath: string): Promise<void> => {
  await fs.mkdir(dirPath, { recursive: true });
};

const readJson = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      error instanceof SyntaxError
    ) {
      return fallback;
    }
    throw error;
  }
};

const writeJson = async <T>(filePath: string, payload: T): Promise<void> => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const normalizeGroupName = (name: string): string =>
  name
    .replace(/[\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getGroupDir = (groupId: string): string => path.join(GROUPS_ROOT, groupId);
const getGroupMessagesPath = (groupId: string): string =>
  path.join(getGroupDir(groupId), "messages.ndjson");

const ensureGroupStorage = async (): Promise<void> => {
  await ensureDir(GROUPS_ROOT);
  try {
    await fs.access(GROUPS_INDEX_PATH);
  } catch {
    await writeJson<AgentGroupDTO[]>(GROUPS_INDEX_PATH, []);
  }
};

const readGroups = async (): Promise<AgentGroupDTO[]> => {
  await ensureGroupStorage();
  const groups = await readJson<AgentGroupDTO[]>(GROUPS_INDEX_PATH, []);
  return groups.map((group) => ({
    ...group,
    memberProjectIds: Array.isArray(group.memberProjectIds)
      ? group.memberProjectIds
      : [],
    description: group.description ?? null,
  }));
};

const writeGroups = async (groups: AgentGroupDTO[]): Promise<void> => {
  await writeJson(GROUPS_INDEX_PATH, groups);
};

const getGroupByIdOrThrow = async (groupId: string): Promise<AgentGroupDTO> => {
  const group = (await readGroups()).find((item) => item.id === groupId);
  if (!group) {
    throw new Error("群组不存在");
  }
  return group;
};

const encodeCursor = (cursor: GroupMessageCursor): string =>
  Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");

const decodeCursor = (value?: string | null): GroupMessageCursor | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<GroupMessageCursor>;
    if (typeof parsed.offset === "number" && parsed.offset >= 0) {
      return { offset: Math.trunc(parsed.offset) };
    }
  } catch {
    return null;
  }
  return null;
};

const lastIndexOfByte = (
  buffer: Buffer,
  byte: number,
  fromIndex: number,
): number => {
  for (let index = fromIndex; index >= 0; index -= 1) {
    if (buffer[index] === byte) return index;
  }
  return -1;
};

const readLinesBeforeOffset = async (
  filePath: string,
  endOffset: number,
  limit: number,
): Promise<ReadLineResult[]> => {
  const file = await fs.open(filePath, "r");
  try {
    const results: ReadLineResult[] = [];
    let position = endOffset;
    let carry = Buffer.alloc(0);

    while (position > 0 && results.length < limit) {
      const chunkSize = Math.min(MESSAGE_READ_CHUNK_BYTES, position);
      const chunkStart = position - chunkSize;
      const chunk = Buffer.alloc(chunkSize);
      await file.read(chunk, 0, chunkSize, chunkStart);
      const combined = Buffer.concat([chunk, carry]);
      const combinedStart = chunkStart;
      let searchEnd = combined.length;

      while (results.length < limit) {
        const newlineIndex = lastIndexOfByte(combined, 10, searchEnd - 1);
        if (newlineIndex < 0) break;
        const lineBuffer = combined.subarray(newlineIndex + 1, searchEnd);
        const line = lineBuffer.toString("utf8").trim();
        if (line) {
          results.push({
            line,
            offset: combinedStart + newlineIndex + 1,
          });
        }
        searchEnd = newlineIndex;
      }

      carry = combined.subarray(0, searchEnd);
      position = chunkStart;
    }

    if (position === 0 && results.length < limit) {
      const line = carry.toString("utf8").trim();
      if (line) {
        results.push({ line, offset: 0 });
      }
    }

    return results;
  } finally {
    await file.close();
  }
};

const parseMessageLine = (line: string): AgentGroupMessageDTO | null => {
  try {
    const parsed = JSON.parse(line) as AgentGroupMessageDTO;
    if (
      typeof parsed.id === "string" &&
      typeof parsed.groupId === "string" &&
      typeof parsed.content === "string" &&
      typeof parsed.createdAt === "string"
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
};

const appendGroupMessage = async (
  message: AgentGroupMessageDTO,
): Promise<AgentGroupMessageDTO> => {
  await ensureDir(getGroupDir(message.groupId));
  const filePath = getGroupMessagesPath(message.groupId);
  const previous = groupAppendQueue.get(message.groupId) ?? Promise.resolve();
  let releaseCurrent = (): void => {};
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const currentChain = previous.catch(() => undefined).then(() => current);
  groupAppendQueue.set(message.groupId, currentChain);

  await previous.catch(() => undefined);
  try {
    await fs.appendFile(filePath, `${JSON.stringify(message)}\n`, "utf8");
  } finally {
    releaseCurrent();
    if (groupAppendQueue.get(message.groupId) === currentChain) {
      groupAppendQueue.delete(message.groupId);
    }
  }

  eventEmitter.emit(GROUP_MESSAGES_UPDATED_EVENT, {
    groupId: message.groupId,
    message,
  });
  return message;
};

const getTypingState = (groupId: string): AgentGroupTypingStateDTO => {
  const agents = typingAgentsByGroupId.get(groupId);
  return {
    groupId,
    agents: agents
      ? [...agents.values()].map(({ count: _count, ...agent }) => agent)
      : [],
  };
};

const emitTypingState = (groupId: string): void => {
  eventEmitter.emit(GROUP_TYPING_UPDATED_EVENT, getTypingState(groupId));
};

const markAgentTyping = (input: {
  groupId: string;
  agentProjectId: string;
  agentName: string;
}): void => {
  const agents =
    typingAgentsByGroupId.get(input.groupId) ??
    new Map<string, TypingAgentState>();
  const current = agents.get(input.agentProjectId);
  agents.set(input.agentProjectId, {
    agentProjectId: input.agentProjectId,
    agentName: input.agentName,
    count: (current?.count ?? 0) + 1,
  });
  typingAgentsByGroupId.set(input.groupId, agents);
  emitTypingState(input.groupId);
};

const unmarkAgentTyping = (input: {
  groupId: string;
  agentProjectId: string;
}): void => {
  const agents = typingAgentsByGroupId.get(input.groupId);
  if (!agents) return;
  const current = agents.get(input.agentProjectId);
  if (!current) return;
  if (current.count > 1) {
    agents.set(input.agentProjectId, { ...current, count: current.count - 1 });
  } else {
    agents.delete(input.agentProjectId);
  }
  if (agents.size === 0) {
    typingAgentsByGroupId.delete(input.groupId);
  }
  emitTypingState(input.groupId);
};

const normalizeLimit = (limit?: number): number =>
  Math.min(MAX_MESSAGE_LIMIT, Math.max(1, Math.trunc(limit ?? DEFAULT_MESSAGE_LIMIT)));

const resolveMentionedMemberIds = (
  content: string,
  members: ProjectDTO[],
): string[] => {
  const mentioned = new Set<string>();
  for (const member of members) {
    if (
      content.includes(`@${member.id}`) ||
      (member.name.trim() && content.includes(`@${member.name.trim()}`))
    ) {
      mentioned.add(member.id);
    }
  }
  return [...mentioned];
};

const shuffle = <T>(items: T[]): T[] => {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
};

const loadGroupMembers = async (group: AgentGroupDTO): Promise<ProjectDTO[]> => {
  const projects = await repositoryService.listProjects();
  const byId = new Map(projects.map((project) => [project.id, project]));
  return group.memberProjectIds
    .map((projectId) => byId.get(projectId))
    .filter((item): item is ProjectDTO => Boolean(item));
};

const getLastSpokenAtByAgent = async (
  groupId: string,
  memberIds: string[],
): Promise<Map<string, string>> => {
  const remaining = new Set(memberIds);
  const spokenAt = new Map<string, string>();
  let beforeCursor: string | null = null;

  while (remaining.size > 0) {
    const page = await agentGroupService.listMessages({
      groupId,
      limit: 100,
      beforeCursor,
    });
    for (let index = page.messages.length - 1; index >= 0; index -= 1) {
      const message = page.messages[index];
      const senderAgentId = message.senderAgentId ?? "";
      if (message.senderType === "agent" && remaining.has(senderAgentId)) {
        spokenAt.set(senderAgentId, message.createdAt);
        remaining.delete(senderAgentId);
      }
    }
    if (!page.hasMore || !page.nextBeforeCursor) break;
    beforeCursor = page.nextBeforeCursor;
  }

  return spokenAt;
};

const resolveRandomTargets = async (
  group: AgentGroupDTO,
  members: ProjectDTO[],
  excludedIds: Set<string>,
): Promise<ProjectDTO[]> => {
  const candidates = members.filter((member) => !excludedIds.has(member.id));
  if (candidates.length === 0) return [];
  const lastSpokenAt = await getLastSpokenAtByAgent(
    group.id,
    candidates.map((member) => member.id),
  );
  const stalePool = [...candidates]
    .sort((left, right) => {
      const leftAt = lastSpokenAt.get(left.id);
      const rightAt = lastSpokenAt.get(right.id);
      if (!leftAt && rightAt) return -1;
      if (leftAt && !rightAt) return 1;
      if (!leftAt && !rightAt) return left.name.localeCompare(right.name);
      if (!leftAt || !rightAt) return 0;
      return leftAt.localeCompare(rightAt);
    })
    .slice(0, 5);
  const count = Math.floor(Math.random() * stalePool.length) + 1;
  return shuffle(stalePool).slice(0, count);
};

const formatGroupMessagesForPrompt = (
  messages: AgentGroupMessageDTO[],
): string =>
  messages
    .map((message) => {
      const sender =
        message.senderType === "agent"
          ? message.senderAgentName ?? message.senderAgentId ?? "Agent"
          : message.senderType === "user"
            ? "用户"
            : "系统";
      return `- ${sender}：${message.content}`;
    })
    .join("\n");

const resolveGroupMessageAttachmentPath = (
  message: AgentGroupMessageDTO,
  filePath: string,
): string => {
  if (path.isAbsolute(filePath)) {
    return path.normalize(filePath);
  }
  if (message.senderType === "agent" && message.senderAgentId) {
    return resolveAttachmentAbsolutePath(
      { type: "project", projectId: message.senderAgentId },
      filePath,
    );
  }
  return resolveAttachmentAbsolutePath({ type: "main" }, filePath);
};

const extractImageAttachmentsFromMessages = async (
  messages: AgentGroupMessageDTO[],
): Promise<ChatAttachmentDTO[]> => {
  const attachments: ChatAttachmentDTO[] = [];
  const seenPaths = new Set<string>();

  for (const message of messages) {
    for (const token of extractExtendedMarkdownTokens(message.content)) {
      if (token.kind !== "image") continue;
      const absolutePath = resolveGroupMessageAttachmentPath(message, token.path);
      if (seenPaths.has(absolutePath)) continue;
      seenPaths.add(absolutePath);

      try {
        const stat = await fs.stat(absolutePath);
        if (!stat.isFile()) continue;
        attachments.push({
          name: path.basename(absolutePath) || "image",
          path: absolutePath,
          size: stat.size,
        });
      } catch (error) {
        logger.warn("Agent group image attachment not found", {
          groupId: message.groupId,
          messageId: message.id,
          filePath: absolutePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return attachments;
};

const notifyAgent = async (input: {
  group: AgentGroupDTO;
  agent: ProjectDTO;
  notificationId: string;
  messages: AgentGroupMessageDTO[];
  mentioned: boolean;
}): Promise<void> => {
  const latestMessages = await agentGroupService.listMessages({
    groupId: input.group.id,
    limit: 5,
  });
  const attachments = await extractImageAttachmentsFromMessages(input.messages);
  const { chatService } = await import("./chatService");
  const scope = { type: "project" as const, projectId: input.agent.id };
  const session = await repositoryService.createChatSession({
    scope,
    module: "main",
    title: input.group.name,
    kind: "group_runtime",
    hidden: true,
    metadataJson: JSON.stringify({
      kind: "agent_group_notification",
      groupId: input.group.id,
      notificationId: input.notificationId,
      triggeredMessageIds: input.messages.map((message) => message.id),
    }),
  });
  const message = [
    `你收到了群聊通知。`,
    ``,
    `群名称：${input.group.name}`,
    `群描述：${input.group.description?.trim() || "暂无描述"}`,
    `你是否被 @：${input.mentioned ? "是" : "否"}`,
    ``,
    `本次合并通知包含的消息：`,
    formatGroupMessagesForPrompt(input.messages),
    ``,
    `群里最新 5 条消息：`,
    formatGroupMessagesForPrompt(latestMessages.messages),
    ``,
    input.mentioned
      ? `你被明确 @ 了。请调用 SendMessageToGroup 在群里简洁回应，不要只在隐藏 session 中回复。`
      : `你没有被 @。用户发到群里的消息通常期待至少一位相关 Agent 回应；如果你能提供有用补充、纠正错误、承担行动或推进讨论，请调用 SendMessageToGroup 简洁发言。确实无必要时才保持沉默。`,
  ].join("\n");

  markAgentTyping({
    groupId: input.group.id,
    agentProjectId: input.agent.id,
    agentName: input.agent.name,
  });
  try {
    const result = await chatService.send({
      scope,
      module: "main",
      sessionId: session.id,
      message,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    logger.info("Agent group notification completed", {
      groupId: input.group.id,
      agentId: input.agent.id,
      notificationId: input.notificationId,
      mentioned: input.mentioned,
      toolActionCount: result.toolActions.length,
      assistantMessageLength: result.assistantMessage.length,
    });
  } finally {
    unmarkAgentTyping({
      groupId: input.group.id,
      agentProjectId: input.agent.id,
    });
  }
};

const flushDispatch = async (groupId: string): Promise<void> => {
  const batch = pendingDispatchByGroupId.get(groupId);
  if (!batch) return;
  pendingDispatchByGroupId.delete(groupId);

  try {
    const group = await getGroupByIdOrThrow(groupId);
    const members = await loadGroupMembers(group);
    const mentionedIds = new Set<string>();
    for (const message of batch.messages) {
      for (const memberId of resolveMentionedMemberIds(message.content, members)) {
        mentionedIds.add(memberId);
      }
    }

    const senderAgentIds = new Set(
      batch.messages
        .map((message) => message.senderAgentId)
        .filter((value): value is string => Boolean(value)),
    );
    const notificationId = randomUUID();
    const targets =
      mentionedIds.size > 0
        ? members.filter((member) => mentionedIds.has(member.id))
        : batch.allowRandom
          ? await resolveRandomTargets(group, members, senderAgentIds)
          : [];

    await Promise.all(
      targets.map((agent) =>
        notifyAgent({
          group,
          agent,
          notificationId,
          messages: batch.messages,
          mentioned: mentionedIds.has(agent.id),
        }).catch((error) => {
          logger.warn("Agent group notification failed", {
            groupId,
            agentId: agent.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }),
      ),
    );
  } catch (error) {
    logger.warn("Agent group dispatch failed", {
      groupId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const scheduleDispatch = (
  message: AgentGroupMessageDTO,
  options: { allowRandom: boolean },
): void => {
  const existing = pendingDispatchByGroupId.get(message.groupId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.messages.push(message);
    existing.allowRandom = existing.allowRandom || options.allowRandom;
    existing.timer = setTimeout(() => {
      void flushDispatch(message.groupId);
    }, DISPATCH_DEBOUNCE_MS);
    return;
  }

  const timer = setTimeout(() => {
    void flushDispatch(message.groupId);
  }, DISPATCH_DEBOUNCE_MS);
  pendingDispatchByGroupId.set(message.groupId, {
    messages: [message],
    allowRandom: options.allowRandom,
    timer,
  });
};

export const agentGroupService = {
  onMessagesUpdated(
    listener: (event: {
      groupId: string;
      message: AgentGroupMessageDTO;
    }) => void,
  ): () => void {
    eventEmitter.on(GROUP_MESSAGES_UPDATED_EVENT, listener);
    return () => eventEmitter.off(GROUP_MESSAGES_UPDATED_EVENT, listener);
  },

  onTypingUpdated(listener: (event: AgentGroupTypingStateDTO) => void): () => void {
    eventEmitter.on(GROUP_TYPING_UPDATED_EVENT, listener);
    return () => eventEmitter.off(GROUP_TYPING_UPDATED_EVENT, listener);
  },

  getTypingState(groupId: string): AgentGroupTypingStateDTO {
    return getTypingState(groupId);
  },

  async listGroups(): Promise<AgentGroupDTO[]> {
    return [...(await readGroups())].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  },

  async createGroup(input: {
    name: string;
    description?: string | null;
    memberProjectIds?: string[];
  }): Promise<AgentGroupDTO> {
    const timestamp = nowISO();
    const projectIds = new Set(
      (await repositoryService.listProjects()).map((project) => project.id),
    );
    const group: AgentGroupDTO = {
      id: `g-${randomUUID()}`,
      name: normalizeGroupName(input.name),
      description: input.description?.trim() || null,
      memberProjectIds: [
        ...new Set(
          (input.memberProjectIds ?? []).filter((projectId) =>
            projectIds.has(projectId),
          ),
        ),
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const groups = await readGroups();
    await writeGroups([...groups, group]);
    await ensureDir(getGroupDir(group.id));
    return group;
  },

  async updateGroup(input: {
    id: string;
    name?: string;
    description?: string | null;
  }): Promise<AgentGroupDTO> {
    const groups = await readGroups();
    const group = groups.find((item) => item.id === input.id);
    if (!group) throw new Error("群组不存在");
    if (input.name !== undefined) {
      group.name = normalizeGroupName(input.name);
    }
    if (input.description !== undefined) {
      group.description = input.description?.trim() || null;
    }
    group.updatedAt = nowISO();
    await writeGroups(groups);
    return group;
  },

  async deleteGroup(groupId: string): Promise<void> {
    const groups = await readGroups();
    await writeGroups(groups.filter((group) => group.id !== groupId));
    await fs.rm(getGroupDir(groupId), { recursive: true, force: true });
  },

  async addMembers(input: {
    groupId: string;
    projectIds: string[];
  }): Promise<AgentGroupDTO> {
    const groups = await readGroups();
    const group = groups.find((item) => item.id === input.groupId);
    if (!group) throw new Error("群组不存在");
    const projectIds = new Set((await repositoryService.listProjects()).map((project) => project.id));
    const nextMembers = new Set(group.memberProjectIds);
    for (const projectId of input.projectIds) {
      if (projectIds.has(projectId)) {
        nextMembers.add(projectId);
      }
    }
    group.memberProjectIds = [...nextMembers];
    group.updatedAt = nowISO();
    await writeGroups(groups);
    return group;
  },

  async removeMember(input: {
    groupId: string;
    projectIds: string[];
  }): Promise<AgentGroupDTO> {
    const groups = await readGroups();
    const group = groups.find((item) => item.id === input.groupId);
    if (!group) throw new Error("群组不存在");
    const removing = new Set(input.projectIds);
    group.memberProjectIds = group.memberProjectIds.filter(
      (projectId) => !removing.has(projectId),
    );
    group.updatedAt = nowISO();
    await writeGroups(groups);
    return group;
  },

  async listMessages(input: {
    groupId: string;
    limit?: number;
    beforeCursor?: string | null;
  }): Promise<AgentGroupMessagePageDTO> {
    await getGroupByIdOrThrow(input.groupId);
    const filePath = getGroupMessagesPath(input.groupId);
    const limit = normalizeLimit(input.limit);
    const cursor = decodeCursor(input.beforeCursor);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile() || stat.size === 0) {
      return { messages: [], nextBeforeCursor: null, hasMore: false };
    }
    const endOffset = Math.min(cursor?.offset ?? stat.size, stat.size);
    const rows = await readLinesBeforeOffset(filePath, endOffset, limit + 1);
    const pageRows = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const messages = pageRows
      .map((row) => parseMessageLine(row.line))
      .filter((message): message is AgentGroupMessageDTO => Boolean(message))
      .reverse();
    const oldestRow = pageRows[pageRows.length - 1];
    return {
      messages,
      nextBeforeCursor:
        hasMore && oldestRow ? encodeCursor({ offset: oldestRow.offset }) : null,
      hasMore,
    };
  },

  async sendUserMessage(input: {
    groupId: string;
    content: string;
  }): Promise<AgentGroupMessageDTO> {
    await getGroupByIdOrThrow(input.groupId);
    const message = await appendGroupMessage({
      id: randomUUID(),
      groupId: input.groupId,
      senderType: "user",
      senderAgentId: null,
      senderAgentName: null,
      content: input.content.trim(),
      notificationId: null,
      createdAt: nowISO(),
    });
    scheduleDispatch(message, { allowRandom: true });
    return message;
  },

  async sendAgentMessage(input: {
    groupId: string;
    agentProjectId: string;
    content: string;
  }): Promise<AgentGroupMessageDTO> {
    const content = input.content.trim();
    if (!content) {
      throw new Error("消息内容不能为空");
    }
    const cooldownKey = `${input.groupId}:${input.agentProjectId}`;
    const now = Date.now();
    const lastSentAt = lastAgentSendAtByGroupAndAgent.get(cooldownKey) ?? 0;
    if (now - lastSentAt < AGENT_SEND_COOLDOWN_MS) {
      throw new Error("发送过于频繁，请稍后再试");
    }
    const group = await getGroupByIdOrThrow(input.groupId);
    if (!group.memberProjectIds.includes(input.agentProjectId)) {
      throw new Error("当前 Agent 不在群组中");
    }
    const project = await repositoryService.getProjectById(input.agentProjectId);
    const message = await appendGroupMessage({
      id: randomUUID(),
      groupId: input.groupId,
      senderType: "agent",
      senderAgentId: input.agentProjectId,
      senderAgentName: project?.name ?? input.agentProjectId,
      content,
      notificationId: null,
      createdAt: nowISO(),
    });
    lastAgentSendAtByGroupAndAgent.set(cooldownKey, now);
    scheduleDispatch(message, { allowRandom: false });
    return message;
  },

  async listMembers(groupId: string): Promise<ProjectDTO[]> {
    const group = await getGroupByIdOrThrow(groupId);
    return loadGroupMembers(group);
  },
};

export const createAgentGroupTools = (input: {
  groupId: string;
  agentProjectId: string;
}): CustomToolDef[] => [
  {
    name: "CreateGroup",
    label: "CreateGroup",
    description: "创建一个新的智能体群聊，可同时设置群名称、描述和成员。",
    parameters: Type.Object({
      name: Type.String({ description: "群组名称。" }),
      description: Type.Optional(Type.String({ description: "群组描述。" })),
      memberProjectIds: Type.Optional(
        Type.Array(Type.String(), {
          description: "要加入群组的 Agent 项目 ID 列表。",
        }),
      ),
    }),
    handler: async (params) => {
      const group = await agentGroupService.createGroup({
        name: typeof params.name === "string" ? params.name : "",
        description:
          typeof params.description === "string" ? params.description : undefined,
        memberProjectIds: Array.isArray(params.memberProjectIds)
          ? params.memberProjectIds.filter((projectId): projectId is string =>
              typeof projectId === "string",
            )
          : undefined,
      });
      return { text: JSON.stringify(group, null, 2) };
    },
  },
  {
    name: "ListGroupMembers",
    label: "ListGroupMembers",
    description: "查看当前智能体群聊中的所有成员。",
    parameters: Type.Object({
      groupId: Type.Optional(Type.String({ description: "群组 ID。默认使用当前群。" })),
    }),
    handler: async (params) => {
      const groupId =
        typeof params.groupId === "string" && params.groupId.trim()
          ? params.groupId.trim()
          : input.groupId;
      const members = await agentGroupService.listMembers(groupId);
      return {
        text: JSON.stringify(
          members.map((member) => ({
            id: member.id,
            name: member.name,
            description: member.description ?? "",
          })),
          null,
          2,
        ),
      };
    },
  },
  {
    name: "ListGroupMessages",
    label: "ListGroupMessages",
    description: "按页查看群聊消息历史。无 beforeCursor 时返回最新消息。",
    parameters: Type.Object({
      groupId: Type.Optional(Type.String({ description: "群组 ID。默认使用当前群。" })),
      limit: Type.Optional(Type.Number({ description: "返回条数，默认 20，最大 100。" })),
      beforeCursor: Type.Optional(
        Type.String({ description: "上一页返回的 nextBeforeCursor，用于继续查看更早消息。" }),
      ),
    }),
    handler: async (params) => {
      const groupId =
        typeof params.groupId === "string" && params.groupId.trim()
          ? params.groupId.trim()
          : input.groupId;
      const limit = typeof params.limit === "number" ? params.limit : undefined;
      const beforeCursor =
        typeof params.beforeCursor === "string" ? params.beforeCursor : undefined;
      const page = await agentGroupService.listMessages({
        groupId,
        limit,
        beforeCursor,
      });
      return { text: JSON.stringify(page, null, 2) };
    },
  },
  {
    name: "SendMessageToGroup",
    label: "SendMessageToGroup",
    description: "当你确实需要在群聊中公开发言时，向群里发送一条简洁消息。",
    parameters: Type.Object({
      groupId: Type.Optional(Type.String({ description: "群组 ID。默认使用当前群。" })),
      content: Type.String({ description: "要发送到群聊中的消息内容。" }),
    }),
    handler: async (params) => {
      const content = typeof params.content === "string" ? params.content : "";
      const groupId =
        typeof params.groupId === "string" && params.groupId.trim()
          ? params.groupId.trim()
          : input.groupId;
      try {
        const message = await agentGroupService.sendAgentMessage({
          groupId,
          agentProjectId: input.agentProjectId,
          content,
        });
        return {
          text: `已发送到群聊：${message.content}`,
        };
      } catch (error) {
        return {
          text: `SendMessageToGroup failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          isError: true,
        };
      }
    },
  },
];
