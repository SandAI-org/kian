import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { CompactDropdown } from "@renderer/components/CompactDropdown";
import {
  IllustrationEmptyEditor,
  IllustrationEmptyFiles,
} from "@renderer/components/EmptyIllustrations";
import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { translateUiText } from "@renderer/i18n/uiTranslations";
import { ScrollArea } from "@renderer/components/ScrollArea";
import { api } from "@renderer/lib/api";
import type { DocExplorerEntryDTO, DocumentDTO } from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Typography, message, type MenuProps } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChatSessionList } from "@renderer/modules/chat/ChatSessionList";
import { MarkdownEditor } from "./MarkdownEditor";

interface DocsModuleProps {
  projectId: string;
  requestedDocumentId?: string;
  onContextChange?: (context: unknown) => void;
  chatScope?: import("@shared/types").ChatScope;
  chatModule?: import("@shared/types").ChatModuleType;
  currentSessionId?: string;
  onSelectSession?: (sessionId: string) => void;
  onNewSession?: () => void;
}

type SaveState = "saved" | "saving" | "error";
type RenameKind = "file" | "directory";
interface RenameState {
  kind: RenameKind;
  path: string;
  value: string;
}

const normalizeWhitespace = (text: string): string =>
  text.replace(/\s+/g, " ").trim();
const docSortOptions: Intl.CollatorOptions = {
  numeric: true,
  sensitivity: "base",
};

interface DirectoryTreeNode {
  kind: "directory";
  key: string;
  name: string;
  path: string;
  children: ExplorerTreeNode[];
}

interface FileTreeNode {
  kind: "file";
  key: string;
  name: string;
  path: string;
  isEditableText: boolean;
  isMarkdown: boolean;
  doc?: DocumentDTO;
}

type ExplorerTreeNode = DirectoryTreeNode | FileTreeNode;

const stripDocsPrefix = (rawPath: string): string => {
  const normalized = rawPath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^\.\//, "");
  if (normalized.startsWith("docs/files/")) {
    return normalized.slice("docs/files/".length);
  }
  if (normalized.startsWith("docs/")) {
    return normalized.slice("docs/".length);
  }
  if (normalized.startsWith("files/")) {
    return normalized.slice("files/".length);
  }
  return normalized;
};

const toDocPath = (rawPath: string): string => {
  const stripped = stripDocsPrefix(rawPath);
  return stripped;
};

const isMarkdownDocumentPath = (rawPath: string): boolean => {
  const normalized = stripDocsPrefix(rawPath).toLowerCase();
  return normalized.endsWith(".md") || normalized.endsWith(".markdown");
};

const findDocumentByQuery = (
  docs: DocumentDTO[],
  query?: string,
): DocumentDTO | undefined => {
  if (!query) return undefined;

  const raw = query.trim();
  if (!raw) return undefined;

  const normalizedQuery = toDocPath(raw).toLowerCase();
  const normalizedBaseName =
    normalizedQuery.split("/").at(-1) ?? normalizedQuery;

  const exact = docs.find(
    (doc) => toDocPath(doc.id).toLowerCase() === normalizedQuery,
  );
  if (exact) return exact;

  const baseNameMatches = docs.filter((doc) => {
    const normalizedId = toDocPath(doc.id).toLowerCase();
    return (
      (normalizedId.split("/").at(-1) ?? normalizedId) === normalizedBaseName
    );
  });
  if (baseNameMatches.length === 1) {
    return baseNameMatches[0];
  }

  const fuzzyMatches = docs.filter((doc) => {
    const normalizedId = toDocPath(doc.id).toLowerCase();
    return (
      normalizedId.includes(normalizedQuery) ||
      normalizedId.includes(normalizedBaseName)
    );
  });
  if (fuzzyMatches.length === 1) {
    return fuzzyMatches[0];
  }

  return undefined;
};

const buildFallbackExplorerEntries = (
  docs: DocumentDTO[],
): DocExplorerEntryDTO[] => {
  const seen = new Set<string>();
  const entries: DocExplorerEntryDTO[] = [];

  for (const doc of docs) {
    const normalizedPath = stripDocsPrefix(doc.id);
    if (!normalizedPath || seen.has(normalizedPath)) {
      continue;
    }
    seen.add(normalizedPath);
    entries.push({
      path: normalizedPath,
      name: normalizedPath.split("/").at(-1) ?? normalizedPath,
      kind: "file",
      isEditableText: true,
      isMarkdown: isMarkdownDocumentPath(normalizedPath),
    });
  }

  entries.sort((a, b) =>
    a.path.localeCompare(b.path, "zh-Hans-CN", docSortOptions),
  );
  return entries;
};

const buildDocTree = (
  entries: DocExplorerEntryDTO[],
  docsByPath: Map<string, DocumentDTO>,
): ExplorerTreeNode[] => {
  const root: DirectoryTreeNode = {
    kind: "directory",
    key: "dir:__root__",
    name: "",
    path: "",
    children: [],
  };
  const directories = new Map<string, DirectoryTreeNode>([["", root]]);
  const fileKeys = new Set<string>();

  const ensureDirectoryNode = (
    directoryPath: string,
    name: string,
    parent: DirectoryTreeNode,
  ): DirectoryTreeNode => {
    const existing = directories.get(directoryPath);
    if (existing) {
      return existing;
    }

    const node: DirectoryTreeNode = {
      kind: "directory",
      key: `dir:${directoryPath}`,
      name,
      path: directoryPath,
      children: [],
    };
    parent.children.push(node);
    directories.set(directoryPath, node);
    return node;
  };

  const sortedEntries = [...entries].sort((a, b) =>
    a.path.localeCompare(b.path, "zh-Hans-CN", {
      numeric: true,
      sensitivity: "base",
    }),
  );

  for (const rawEntry of sortedEntries) {
    const relativePath = stripDocsPrefix(rawEntry.path);
    if (!relativePath) {
      continue;
    }

    const segments = relativePath.split("/").filter(Boolean);
    if (segments.length === 0) {
      continue;
    }

    let parent = root;
    let currentPath = "";

    for (const segment of segments.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      parent = ensureDirectoryNode(currentPath, segment, parent);
    }

    const leafName = segments.at(-1);
    if (!leafName) {
      continue;
    }

    const leafPath = currentPath ? `${currentPath}/${leafName}` : leafName;

    if (rawEntry.kind === "directory") {
      ensureDirectoryNode(leafPath, leafName, parent);
      continue;
    }

    const fileKey = `file:${leafPath}`;
    if (fileKeys.has(fileKey)) {
      continue;
    }
    fileKeys.add(fileKey);

    parent.children.push({
      kind: "file",
      key: fileKey,
      name: leafName,
      path: leafPath,
      isEditableText: rawEntry.isEditableText,
      isMarkdown: rawEntry.isMarkdown,
      doc: rawEntry.isEditableText ? docsByPath.get(leafPath) : undefined,
    });
  }

  const sortTree = (nodes: ExplorerTreeNode[]): void => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name, "zh-Hans-CN", docSortOptions);
    });

    for (const node of nodes) {
      if (node.kind === "directory") {
        sortTree(node.children);
      }
    }
  };

  sortTree(root.children);
  return root.children;
};

const collectDirectoryPaths = (nodes: ExplorerTreeNode[]): string[] => {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "directory") continue;
    paths.push(node.path);
    paths.push(...collectDirectoryPaths(node.children));
  }
  return paths;
};

const getAncestorDirectoryPaths = (rawPath: string): string[] => {
  const segments = stripDocsPrefix(rawPath).split("/").filter(Boolean);
  if (segments.length <= 1) {
    return [];
  }

  const paths: string[] = [];
  let currentPath = "";
  for (const segment of segments.slice(0, -1)) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    paths.push(currentPath);
  }
  return paths;
};

const arePathSetsEqual = (left: Set<string>, right: Set<string>): boolean => {
  if (left.size !== right.size) {
    return false;
  }

  for (const path of left) {
    if (!right.has(path)) {
      return false;
    }
  }
  return true;
};

const getNewFileName = (language: import("@shared/i18n").AppLanguage): string =>
  translateUiText(language, "新文件.md");
const getNewFolderName = (
  language: import("@shared/i18n").AppLanguage,
): string => translateUiText(language, "新文件夹");
const getPathSegments = (rawPath: string): string[] =>
  stripDocsPrefix(rawPath).split("/").filter(Boolean);
const getPathBaseName = (rawPath: string): string =>
  getPathSegments(rawPath).at(-1) ?? "";

const buildDuplicateTargetPath = (
  rawPath: string,
  language: import("@shared/i18n").AppLanguage,
): string => {
  const segments = getPathSegments(rawPath);
  const sourceFileName = segments.pop() ?? getNewFileName(language);
  const dotIndex = sourceFileName.lastIndexOf(".");
  const hasExtension = dotIndex > 0;
  const baseName = hasExtension
    ? sourceFileName.slice(0, dotIndex)
    : sourceFileName;
  const extension = hasExtension ? sourceFileName.slice(dotIndex) : ".md";
  const duplicateFileName = translateUiText(
    language,
    `${baseName}-副本${extension}`,
  );

  return [...segments, duplicateFileName].join("/");
};

export const DocsModule = ({
  projectId,
  requestedDocumentId,
  onContextChange,
  chatScope,
  chatModule,
  currentSessionId,
  onSelectSession,
  onNewSession,
}: DocsModuleProps) => {
  const { language } = useAppI18n();
  const t = (value: string): string => translateUiText(language, value);
  const queryClient = useQueryClient();
  const [activeDocId, setActiveDocId] = useState<string>();
  const [editorValue, setEditorValue] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
    () => new Set(),
  );
  const [renaming, setRenaming] = useState<RenameState | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const hasChatProps = Boolean(chatScope);
  type SidebarTab = "files" | "conversations";
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("files");
  const hasInitializedExpansionRef = useRef(false);

  const docsQuery = useQuery({
    queryKey: ["docs", projectId],
    queryFn: () => api.docs.list(projectId),
    enabled: Boolean(projectId),
    refetchOnWindowFocus: true,
  });

  const explorerQuery = useQuery({
    queryKey: ["docs-explorer", projectId],
    queryFn: () => api.docs.explorer(projectId),
    enabled: Boolean(projectId),
    refetchOnWindowFocus: true,
  });

  const docs = docsQuery.data ?? [];
  const explorerEntries = explorerQuery.data ?? [];
  const effectiveExplorerEntries = useMemo(
    () =>
      explorerEntries.length > 0
        ? explorerEntries
        : buildFallbackExplorerEntries(docs),
    [explorerEntries, docs],
  );

  const docsByPath = useMemo(() => {
    const map = new Map<string, DocumentDTO>();
    for (const doc of docs) {
      const normalizedPath = stripDocsPrefix(doc.id);
      if (!normalizedPath) {
        continue;
      }
      map.set(normalizedPath, doc);
    }
    return map;
  }, [docs]);

  const docsTree = useMemo(
    () => buildDocTree(effectiveExplorerEntries, docsByPath),
    [effectiveExplorerEntries, docsByPath],
  );
  const allDirectoryPaths = useMemo(
    () => collectDirectoryPaths(docsTree),
    [docsTree],
  );
  const rootDirectoryPaths = useMemo(
    () =>
      docsTree
        .filter((node): node is DirectoryTreeNode => node.kind === "directory")
        .map((node) => node.path),
    [docsTree],
  );
  const saveStatusText =
    saveState === "saving"
      ? t("自动保存中...")
      : saveState === "error"
        ? t("保存失败")
        : t("已自动保存");

  const activeDoc = useMemo(
    () => docs.find((item) => item.id === activeDocId) ?? docs[0],
    [activeDocId, docs],
  );
  const activeDirectoryPaths = useMemo(
    () => (activeDoc ? getAncestorDirectoryPaths(activeDoc.id) : []),
    [activeDoc?.id],
  );

  useEffect(() => {
    const target = findDocumentByQuery(docs, requestedDocumentId);
    if (!target) {
      return;
    }
    setActiveDocId((previous) =>
      previous === target.id ? previous : target.id,
    );
  }, [docs, requestedDocumentId]);

  useEffect(() => {
    hasInitializedExpansionRef.current = false;
    setExpandedDirectories(new Set());
  }, [projectId]);

  useEffect(() => {
    const availablePaths = new Set(allDirectoryPaths);
    setExpandedDirectories((previous) => {
      if (availablePaths.size === 0) {
        hasInitializedExpansionRef.current = false;
        return previous.size === 0 ? previous : new Set<string>();
      }

      const next = new Set<string>();
      for (const path of previous) {
        if (availablePaths.has(path)) {
          next.add(path);
        }
      }

      if (!hasInitializedExpansionRef.current) {
        for (const path of rootDirectoryPaths) {
          if (availablePaths.has(path)) {
            next.add(path);
          }
        }
        hasInitializedExpansionRef.current = true;
      }

      for (const path of activeDirectoryPaths) {
        if (availablePaths.has(path)) {
          next.add(path);
        }
      }

      return arePathSetsEqual(previous, next) ? previous : next;
    });
  }, [allDirectoryPaths, rootDirectoryPaths, activeDirectoryPaths]);

  useEffect(() => {
    if (!activeDoc) {
      setEditorValue("");
      return;
    }
    setEditorValue(activeDoc.content);
    setActiveDocId(activeDoc.id);
  }, [activeDoc?.id, activeDoc?.content]);

  useEffect(() => {
    onContextChange?.({
      activeDocId: activeDoc?.id,
      activeDocTitle: activeDoc
        ? toDocPath(activeDoc.id) || toDocPath(activeDoc.title)
        : undefined,
      docCount: docs.length,
    });
  }, [activeDoc?.id, activeDoc?.title, docs.length, onContextChange]);

  const invalidateDocQueries = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["docs", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["docs-explorer", projectId] }),
    ]);
  };

  const createFileMutation = useMutation({
    mutationFn: async (targetPath: string) => {
      const created = await api.docs.create({
        projectId,
        title: targetPath,
        content: translateUiText(
          language,
          "# 新文档\n\n在这里记录你的音视频创作笔记。\n",
        ),
      });
      const createdPath = stripDocsPrefix(created.id);
      const createdEntry: DocExplorerEntryDTO = {
        path: createdPath,
        name: getPathBaseName(createdPath),
        kind: "file",
        isEditableText: true,
        isMarkdown: true,
      };
      queryClient.setQueryData<DocumentDTO[]>(
        ["docs", projectId],
        (previous) => [
          created,
          ...(previous ?? []).filter((item) => item.id !== created.id),
        ],
      );
      queryClient.setQueryData<DocExplorerEntryDTO[]>(
        ["docs-explorer", projectId],
        (previous) => {
          const merged = [
            ...(previous ?? []).filter(
              (item) => item.path !== createdEntry.path,
            ),
            createdEntry,
          ];
          merged.sort((a, b) =>
            a.path.localeCompare(b.path, "zh-Hans-CN", docSortOptions),
          );
          return merged;
        },
      );
      await invalidateDocQueries();
      return created;
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : t("创建文件失败"));
    },
  });

  const createFolderMutation = useMutation({
    mutationFn: async () => {
      const created = await api.docs.createFolder({
        projectId,
        path: getNewFolderName(language),
      });
      const createdPath = stripDocsPrefix(created.path);
      const createdEntry: DocExplorerEntryDTO = {
        path: createdPath,
        name: getPathBaseName(createdPath),
        kind: "directory",
        isEditableText: false,
        isMarkdown: false,
      };
      queryClient.setQueryData<DocExplorerEntryDTO[]>(
        ["docs-explorer", projectId],
        (previous) => {
          const merged = [
            ...(previous ?? []).filter(
              (item) => item.path !== createdEntry.path,
            ),
            createdEntry,
          ];
          merged.sort((a, b) =>
            a.path.localeCompare(b.path, "zh-Hans-CN", docSortOptions),
          );
          return merged;
        },
      );
      await invalidateDocQueries();
      return created;
    },
    onError: (error) => {
      message.error(
        error instanceof Error ? error.message : t("创建文件夹失败"),
      );
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: (payload: { title: string; content: string }) =>
      api.docs.create({
        projectId,
        title: payload.title,
        content: payload.content,
      }),
    onSuccess: async (created) => {
      await invalidateDocQueries();
      setActiveDocId(created.id);
      message.success(t("已生成副本"));
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : t("复制文件失败"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (documentPath: string) => {
      await api.docs.delete(projectId, documentPath);
      return documentPath;
    },
    onSuccess: async (deletedDocumentPath) => {
      queryClient.setQueryData<DocumentDTO[]>(["docs", projectId], (previous) =>
        (previous ?? []).filter(
          (item) => stripDocsPrefix(item.id) !== deletedDocumentPath,
        ),
      );
      queryClient.setQueryData<DocExplorerEntryDTO[]>(
        ["docs-explorer", projectId],
        (previous) =>
          (previous ?? []).filter(
            (item) => stripDocsPrefix(item.path) !== deletedDocumentPath,
          ),
      );
      await invalidateDocQueries();
      if (activeDocId && stripDocsPrefix(activeDocId) === deletedDocumentPath) {
        setActiveDocId(undefined);
      }
      message.success(t("文件已删除"));
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : t("删除文件失败"));
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (directoryPath: string) =>
      api.docs.deleteFolder({ projectId, path: directoryPath }),
    onSuccess: async (_, deletedDirectoryPath) => {
      await invalidateDocQueries();
      if (activeDocId?.startsWith(`${deletedDirectoryPath}/`)) {
        setActiveDocId(undefined);
      }
      setExpandedDirectories((previous) => {
        const next = new Set<string>();
        for (const item of previous) {
          if (
            item !== deletedDirectoryPath &&
            !item.startsWith(`${deletedDirectoryPath}/`)
          ) {
            next.add(item);
          }
        }
        return next;
      });
      message.success(t("文件夹已删除"));
    },
    onError: (error) => {
      message.error(
        error instanceof Error ? error.message : t("删除文件夹失败"),
      );
    },
  });

  const renameFileMutation = useMutation({
    mutationFn: async (payload: { id: string; title: string }) => {
      const updated = await api.docs.update({
        projectId,
        id: payload.id,
        title: payload.title,
      });
      await invalidateDocQueries();
      return updated;
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : t("重命名文件失败"));
    },
  });

  const renameFolderMutation = useMutation({
    mutationFn: async (payload: { path: string; name: string }) => {
      const updated = await api.docs.renameFolder({
        projectId,
        path: payload.path,
        name: payload.name,
      });
      await invalidateDocQueries();
      return updated;
    },
    onError: (error) => {
      message.error(
        error instanceof Error ? error.message : t("重命名文件夹失败"),
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { id: string; content: string }) =>
      api.docs.update({ projectId, id: payload.id, content: payload.content }),
    onSuccess: (updated) => {
      setSaveState("saved");
      queryClient.setQueryData<DocumentDTO[]>(["docs", projectId], (previous) =>
        [updated, ...((previous ?? []).filter((item) => item.id !== updated.id))],
      );
    },
    onError: (error) => {
      setSaveState("error");
      message.error(error instanceof Error ? error.message : t("自动保存失败"));
    },
  });

  useEffect(() => {
    if (!activeDoc) return;
    if (editorValue === activeDoc.content) {
      setSaveState("saved");
      return;
    }

    setSaveState("saving");
    const timer = setTimeout(() => {
      updateMutation.mutate({ id: activeDoc.id, content: editorValue });
    }, 700);

    return () => clearTimeout(timer);
  }, [activeDoc, editorValue]);

  const toggleDirectory = (directoryPath: string): void => {
    setExpandedDirectories((previous) => {
      const next = new Set(previous);
      if (next.has(directoryPath)) {
        next.delete(directoryPath);
      } else {
        next.add(directoryPath);
      }
      return next;
    });
  };

  const beginRename = (input: {
    kind: RenameKind;
    path: string;
    currentName?: string;
  }): void => {
    setRenaming({
      kind: input.kind,
      path: input.path,
      value: input.currentName ?? getPathBaseName(input.path),
    });
  };

  const cancelRename = (): void => {
    setRenaming(null);
  };

  const remapExpandedDirectories = (fromPath: string, toPath: string): void => {
    setExpandedDirectories((previous) => {
      const next = new Set<string>();
      for (const item of previous) {
        if (item === fromPath) {
          next.add(toPath);
          continue;
        }
        if (item.startsWith(`${fromPath}/`)) {
          next.add(`${toPath}${item.slice(fromPath.length)}`);
          continue;
        }
        next.add(item);
      }
      return next;
    });
  };

  const handleCreateFile = async (): Promise<void> => {
    const targetPath = getNewFileName(language);
    try {
      const created = await createFileMutation.mutateAsync(targetPath);
      setActiveDocId(created.id);
      beginRename({
        kind: "file",
        path: stripDocsPrefix(created.id),
      });
    } catch {
      // Errors are surfaced by mutation callbacks.
    }
  };

  const handleCreateFileInDirectory = async (
    directoryPath: string,
  ): Promise<void> => {
    const normalizedDirectoryPath = stripDocsPrefix(directoryPath);
    const targetPath = `${normalizedDirectoryPath}/${getNewFileName(language)}`;
    try {
      const created = await createFileMutation.mutateAsync(targetPath);
      setExpandedDirectories((previous) =>
        previous.has(normalizedDirectoryPath)
          ? previous
          : new Set(previous).add(normalizedDirectoryPath),
      );
      setActiveDocId(created.id);
      beginRename({
        kind: "file",
        path: stripDocsPrefix(created.id),
      });
    } catch {
      // Errors are surfaced by mutation callbacks.
    }
  };

  const handleCreateFolder = async (): Promise<void> => {
    try {
      const created = await createFolderMutation.mutateAsync();
      const createdPath = stripDocsPrefix(created.path);
      setExpandedDirectories((previous) =>
        previous.has(createdPath) ? previous : new Set(previous).add(createdPath),
      );
      beginRename({
        kind: "directory",
        path: createdPath,
      });
    } catch {
      // Errors are surfaced by mutation callbacks.
    }
  };

  const handleCommitRename = async (): Promise<void> => {
    if (!renaming) return;
    if (renameFileMutation.isPending || renameFolderMutation.isPending) return;

    const nextName = renaming.value.trim();
    const currentName = getPathBaseName(renaming.path);
    if (!nextName || nextName === currentName) {
      setRenaming(null);
      return;
    }

    try {
      if (renaming.kind === "file") {
        const doc = docsByPath.get(renaming.path);
        if (!doc) {
          setRenaming(null);
          return;
        }

        const updated = await renameFileMutation.mutateAsync({
          id: doc.id,
          title: nextName,
        });
        if (activeDocId === doc.id) {
          setActiveDocId(updated.id);
        }
        setRenaming(null);
        return;
      }

      const updated = await renameFolderMutation.mutateAsync({
        path: renaming.path,
        name: nextName,
      });
      const nextPath = stripDocsPrefix(updated.path);
      if (activeDocId?.startsWith(`${renaming.path}/`)) {
        setActiveDocId(`${nextPath}${activeDocId.slice(renaming.path.length)}`);
      }
      remapExpandedDirectories(renaming.path, nextPath);
      setRenaming(null);
    } catch {
      // Errors are surfaced by mutation callbacks.
    }
  };

  const handleDuplicateFile = async (node: FileTreeNode): Promise<void> => {
    if (!node.doc) return;

    try {
      await duplicateMutation.mutateAsync({
        title: buildDuplicateTargetPath(node.path, language),
        content: node.doc.content,
      });
    } catch {
      // Errors are surfaced by mutation callbacks.
    }
  };

  const handleDeleteFile = (node: FileTreeNode): void => {
    if (!node.doc) return;
    const targetPath = stripDocsPrefix(node.path);
    deleteMutation.mutate(targetPath);
  };

  const handleDeleteDirectory = (node: DirectoryTreeNode): void => {
    const targetPath = node.path;
    deleteFolderMutation.mutate(targetPath);
  };

  const createActionMenu: MenuProps = {
    items: [
      { key: "new-folder", label: t("新文件夹"), icon: <FolderOutlined /> },
      { key: "new-file", label: t("新文件"), icon: <FileTextOutlined /> },
    ],
    onClick: ({ key }) => {
      if (key === "new-folder") {
        void handleCreateFolder();
        return;
      }
      if (key === "new-file") {
        void handleCreateFile();
      }
    },
  };

  const renderRenameInput = (
    kind: RenameKind,
    path: string,
    placeholder: string,
  ) => (
    <input
      value={
        renaming?.kind === kind && renaming.path === path ? renaming.value : ""
      }
      placeholder={placeholder}
      autoFocus
      onFocus={(event) => {
        event.currentTarget.select();
      }}
      onChange={(event) => {
        const nextValue = event.currentTarget.value;
        setRenaming((previous) => {
          if (!previous || previous.kind !== kind || previous.path !== path)
            return previous;
          return { ...previous, value: nextValue };
        });
      }}
      onBlur={() => {
        void handleCommitRename();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void handleCommitRename();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          cancelRename();
        }
      }}
      onClick={(event) => {
        event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
      className="h-[20px] w-full border-0 bg-transparent p-0 text-sm leading-[20px] text-inherit outline-none"
    />
  );

  const renderTree = (nodes: ExplorerTreeNode[], depth = 0) =>
    nodes.map((node) => {
      const paddingLeft = depth * 16 + 8;

      if (node.kind === "directory") {
        const expanded = expandedDirectories.has(node.path);
        const renamingDirectory =
          renaming?.kind === "directory" && renaming.path === node.path;
        const directoryMenu: MenuProps = {
          items: [
            {
              key: "new-file",
              label: t("新文件"),
              icon: <FileTextOutlined />,
              disabled:
                createFileMutation.isPending ||
                renameFolderMutation.isPending ||
                renameFileMutation.isPending ||
                deleteFolderMutation.isPending,
            },
            {
              key: "rename",
              label: t("重命名"),
              icon: <EditOutlined />,
              disabled:
                renameFolderMutation.isPending ||
                renameFileMutation.isPending ||
                deleteFolderMutation.isPending,
            },
            {
              key: "delete",
              label: t("删除"),
              icon: <DeleteOutlined />,
              danger: true,
              disabled:
                renameFolderMutation.isPending ||
                renameFileMutation.isPending ||
                deleteFolderMutation.isPending,
            },
          ],
          onClick: ({ key, domEvent }) => {
            domEvent.stopPropagation();
            if (key === "new-file") {
              void handleCreateFileInDirectory(node.path);
              return;
            }
            if (key === "rename") {
              beginRename({
                kind: "directory",
                path: node.path,
                currentName: node.name,
              });
              return;
            }
            if (key === "delete") {
              handleDeleteDirectory(node);
            }
          },
        };

        return (
          <div key={node.key}>
            <div className="group relative">
              <button
                type="button"
                onClick={() => {
                  if (renamingDirectory) return;
                  toggleDirectory(node.path);
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  beginRename({
                    kind: "directory",
                    path: node.path,
                    currentName: node.name,
                  });
                }}
                className="flex w-full items-center gap-2 rounded-md py-1.5 pr-8 text-left text-sm text-slate-700 transition-colors hover:bg-[#f4f7fd]"
                style={{ paddingLeft }}
              >
                {expanded ? (
                  <FolderOpenOutlined className="text-slate-500" />
                ) : (
                  <FolderOutlined className="text-slate-500 group-hover:text-slate-600" />
                )}
                {renamingDirectory ? (
                  <div className="min-w-0 flex-1">
                    {renderRenameInput(
                      "directory",
                      node.path,
                      t("输入文件夹名称"),
                    )}
                  </div>
                ) : (
                  <Typography.Text
                    className="!mb-0 !text-sm !text-slate-800"
                    ellipsis
                  >
                    {node.name}
                  </Typography.Text>
                )}
              </button>

              {!renamingDirectory ? (
                <CompactDropdown
                  menu={directoryMenu}
                  trigger={["click"]}
                  placement="bottomRight"
                >
                  <Button
                    type="text"
                    shape="circle"
                    size="small"
                    icon={<EllipsisOutlined />}
                    aria-label={t(`操作 ${node.name}`)}
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                    className="!absolute !right-1 !top-1/2 !-translate-y-1/2 !text-slate-500 !opacity-0 !pointer-events-none hover:!text-slate-700 group-hover:!opacity-100 group-hover:!pointer-events-auto"
                  />
                </CompactDropdown>
              ) : null}
            </div>
            {expanded ? renderTree(node.children, depth + 1) : null}
          </div>
        );
      }

      const active = Boolean(node.doc) && activeDoc?.id === node.doc?.id;
      const selectable = node.isEditableText && Boolean(node.doc);
      const renamingFile =
        renaming?.kind === "file" && renaming.path === node.path;
      const fileMenu: MenuProps = {
        items: [
          {
            key: "rename",
            label: t("重命名"),
            icon: <EditOutlined />,
            disabled:
              !selectable ||
              renameFileMutation.isPending ||
              renameFolderMutation.isPending ||
              deleteFolderMutation.isPending,
          },
          {
            key: "duplicate",
            label: t("复制"),
            icon: <CopyOutlined />,
            disabled:
              !selectable ||
              duplicateMutation.isPending ||
              deleteFolderMutation.isPending,
          },
          {
            key: "delete",
            label: t("删除"),
            icon: <DeleteOutlined />,
            danger: true,
            disabled:
              !selectable ||
              deleteMutation.isPending ||
              deleteFolderMutation.isPending,
          },
        ],
        onClick: ({ key, domEvent }) => {
          domEvent.stopPropagation();
          if (!selectable) return;

          if (key === "rename") {
            beginRename({
              kind: "file",
              path: node.path,
              currentName: node.name,
            });
            return;
          }
          if (key === "duplicate") {
            void handleDuplicateFile(node);
            return;
          }
          if (key === "delete") {
            handleDeleteFile(node);
          }
        },
      };

      return (
        <div key={node.key} className="group relative">
          <button
            type="button"
            disabled={!selectable}
            onClick={() => {
              if (renamingFile) return;
              if (node.doc) {
                setActiveDocId(node.doc.id);
              }
            }}
            onDoubleClick={(event) => {
              if (!selectable) return;
              event.preventDefault();
              event.stopPropagation();
              beginRename({
                kind: "file",
                path: node.path,
                currentName: node.name,
              });
            }}
            aria-current={active ? "page" : undefined}
            className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-8 text-left text-sm transition-colors ${
              selectable
                ? active
                  ? "bg-[#edf3ff] text-[#1f4fcc]"
                  : "text-slate-700 hover:bg-[#f4f7fd]"
                : "cursor-default text-slate-400"
            }`}
            style={{ paddingLeft }}
          >
            <FileTextOutlined
              className={
                selectable
                  ? active
                    ? "text-[#2f6ff7]"
                    : "text-slate-400 group-hover:text-slate-500"
                  : "text-slate-300"
              }
            />
            {renamingFile ? (
              <div className="min-w-0 flex-1">
                {renderRenameInput("file", node.path, t("输入文件名称"))}
              </div>
            ) : (
              <Typography.Text
                className={`!mb-0 !text-sm ${
                  selectable
                    ? active
                      ? "!text-[#1f4fcc]"
                      : "!text-slate-900"
                    : "!text-slate-400"
                }`}
                ellipsis
              >
                {node.name}
              </Typography.Text>
            )}
          </button>

          {selectable && !renamingFile ? (
            <CompactDropdown
              menu={fileMenu}
              trigger={["click"]}
              placement="bottomRight"
            >
              <Button
                type="text"
                shape="circle"
                size="small"
                icon={<EllipsisOutlined />}
                aria-label={t(`操作 ${node.name}`)}
                onClick={(event) => {
                  event.stopPropagation();
                }}
                className="!absolute !right-1 !top-1/2 !-translate-y-1/2 !text-slate-500 !opacity-0 !pointer-events-none hover:!text-slate-700 group-hover:!opacity-100 group-hover:!pointer-events-auto"
              />
            </CompactDropdown>
          ) : null}
        </div>
      );
    });

  return (
    <div className="flex h-full min-h-0 gap-0.5">
      <div
        className={`flex h-full min-h-0 shrink-0 flex-col transition-[width] duration-200 ${sidebarCollapsed ? "w-10" : "w-72"}`}
      >
        <div className="mb-3 flex items-center justify-between">
          {!sidebarCollapsed ? (
            hasChatProps ? (
              <div className="flex items-center gap-0.5 rounded-full border border-[#dce5f4] bg-white/90 p-0.5">
                <button
                  type="button"
                  onClick={() => setSidebarTab("files")}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-all duration-200 ${
                    sidebarTab === "files"
                      ? "bg-[#2f6ff7] text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {t("文件列表")}
                </button>
                <button
                  type="button"
                  onClick={() => setSidebarTab("conversations")}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-all duration-200 ${
                    sidebarTab === "conversations"
                      ? "bg-[#2f6ff7] text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {t("对话列表")}
                </button>
              </div>
            ) : (
              <Typography.Text className="!font-semibold !text-slate-900">
                {t("文件")}
              </Typography.Text>
            )
          ) : null}
          <div className="flex items-center gap-0.5">
            {!sidebarCollapsed && sidebarTab === "files" ? (
              <CompactDropdown
                menu={createActionMenu}
                trigger={["hover"]}
                placement="bottomRight"
              >
                <Button
                  type="text"
                  shape="circle"
                  icon={<PlusOutlined />}
                  title={t("新建")}
                  aria-label={t("新建")}
                  size="small"
                />
              </CompactDropdown>
            ) : !sidebarCollapsed && sidebarTab === "conversations" && onNewSession ? (
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
            <Button
              type="text"
              shape="circle"
              icon={
                sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />
              }
              title={
                sidebarCollapsed ? t("展开文件列表") : t("折叠文件列表")
              }
              aria-label={
                sidebarCollapsed ? t("展开文件列表") : t("折叠文件列表")
              }
              size="small"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
            />
          </div>
        </div>

        {!sidebarCollapsed ? (
          sidebarTab === "conversations" && chatScope && chatModule && onSelectSession && onNewSession ? (
            <ChatSessionList
              scope={chatScope}
              module={chatModule}
              currentSessionId={currentSessionId}
              onSelectSession={onSelectSession}
              onNewSession={onNewSession}
              hideHeader
            />
          ) : docsTree.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1 py-8">
              <IllustrationEmptyFiles size={64} />
              <Typography.Text className="!text-xs !text-slate-400">
                {t("暂无文件")}
              </Typography.Text>
            </div>
          ) : (
            <ScrollArea className="min-h-0 flex-1 pr-[10px]">
              <div className="space-y-0.5">{renderTree(docsTree)}</div>
            </ScrollArea>
          )
        ) : null}
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {activeDoc ? (
          <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <MarkdownEditor
                key={activeDoc.id}
                projectId={projectId}
                title={toDocPath(activeDoc.id) || toDocPath(activeDoc.title)}
                statusText={saveStatusText}
                value={editorValue}
                onChange={setEditorValue}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[#dbe5f5] bg-white shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2">
              <IllustrationEmptyEditor size={80} />
              <Typography.Text className="!text-sm !text-slate-400">
                可以试试让 Kian 来帮你修改或者创建文档
              </Typography.Text>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
