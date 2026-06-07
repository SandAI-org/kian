import type { MainLayoutOutletContext } from "@renderer/app/MainLayout";
import {
  CloseOutlined,
  CheckCircleFilled,
  DeleteOutlined,
  DownloadOutlined,
  CloudDownloadOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { ScrollArea } from "@renderer/components/ScrollArea";
import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { api } from "@renderer/lib/api";
import type { InstalledSkillDTO, SkillContentFileDTO } from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Alert,
  Modal,
  Space,
  Spin,
  Switch,
  Tabs,
  Tree,
  Typography,
  message,
} from "antd";
import type { DataNode } from "antd/es/tree";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";

const skillCardBaseClassName =
  "!rounded-xl !border-[#dde6f5] !shadow-[0_8px_20px_rgba(15,23,42,0.03)] !transition-all !duration-200 hover:!-translate-y-0.5 hover:!border-[#cbd9f0] hover:!shadow-[0_12px_24px_rgba(15,23,42,0.06)]";

const skillDescriptionClassName =
  "!mt-1.5 !mb-1.5 !text-xs !leading-[1.65] !text-slate-600";

const buildSkillFileTree = (files: SkillContentFileDTO[]): DataNode[] => {
  const root: DataNode[] = [];
  const directories = new Map<string, DataNode[]>();
  directories.set("", root);

  for (const file of files) {
    const parts = file.path.split("/");
    let parentPath = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      const segment = parts[index] ?? "";
      const directoryPath = parentPath ? `${parentPath}/${segment}` : segment;
      if (!directories.has(directoryPath)) {
        const parentChildren = directories.get(parentPath) ?? root;
        const children: DataNode[] = [];
        parentChildren.push({
          key: directoryPath,
          title: segment,
          children,
        });
        directories.set(directoryPath, children);
      }
      parentPath = directoryPath;
    }

    const parentChildren = directories.get(parentPath) ?? root;
    parentChildren.push({
      key: file.path,
      title: parts.at(-1) ?? file.path,
      isLeaf: true,
    });
  }

  const sortNodes = (nodes: DataNode[]): void => {
    nodes.sort((left, right) => {
      const leftIsDirectory = Boolean(left.children);
      const rightIsDirectory = Boolean(right.children);
      if (leftIsDirectory !== rightIsDirectory) {
        return leftIsDirectory ? -1 : 1;
      }
      return String(left.title).localeCompare(String(right.title), "zh-Hans-CN", {
        numeric: true,
        sensitivity: "base",
      });
    });
    for (const node of nodes) {
      if (node.children) {
        sortNodes(node.children);
      }
    }
  };

  sortNodes(root);
  return root;
};

const collectSkillDirectoryPaths = (files: SkillContentFileDTO[]): string[] => {
  const directories = new Set<string>();
  for (const file of files) {
    const parts = file.path.split("/");
    let currentPath = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      currentPath = currentPath
        ? `${currentPath}/${parts[index]}`
        : parts[index] ?? "";
      if (currentPath) {
        directories.add(currentPath);
      }
    }
  }
  return Array.from(directories);
};

export const SkillsPage = () => {
  const { t } = useAppI18n();
  const queryClient = useQueryClient();
  const { setHeaderActions } = useOutletContext<MainLayoutOutletContext>();
  const [activeTab, setActiveTab] = useState("installed");
  const [selectedRepository, setSelectedRepository] = useState("");
  const [repositoryInput, setRepositoryInput] = useState("");
  const [isAddRepositoryDrawerOpen, setIsAddRepositoryDrawerOpen] =
    useState(false);
  const [isAddSkillModalOpen, setIsAddSkillModalOpen] = useState(false);
  const [addSkillTab, setAddSkillTab] = useState("local");
  const [localSourcePaths, setLocalSourcePaths] = useState<string[]>([]);
  const [skillMarkdown, setSkillMarkdown] = useState("");
  const [clawHubInput, setClawHubInput] = useState("");
  const [addSkillError, setAddSkillError] = useState<string | null>(null);
  const [contentSkill, setContentSkill] = useState<InstalledSkillDTO | null>(
    null,
  );
  const [activeSkillFilePath, setActiveSkillFilePath] = useState("");
  const [expandedSkillFileTreeKeys, setExpandedSkillFileTreeKeys] = useState<
    string[]
  >([]);

  const configQuery = useQuery({
    queryKey: ["skills", "config"],
    queryFn: api.skills.getConfig,
  });

  const installedQuery = useQuery({
    queryKey: ["skills", "installed"],
    queryFn: api.skills.listInstalled,
  });

  const repositories = configQuery.data?.repositories ?? [];

  useEffect(() => {
    if (repositories.length === 0) {
      setSelectedRepository("");
      return;
    }

    if (
      !selectedRepository ||
      !repositories.some((repo) => repo.url === selectedRepository)
    ) {
      setSelectedRepository(repositories[0]?.url ?? "");
    }
  }, [repositories, selectedRepository]);

  const repositorySkillsQuery = useQuery({
    queryKey: ["skills", "repository", selectedRepository],
    queryFn: () => api.skills.listRepositorySkills(selectedRepository),
    enabled: Boolean(selectedRepository),
    retry: false,
  });

  const skillContentQuery = useQuery({
    queryKey: ["skills", "content", contentSkill?.id],
    queryFn: () => api.skills.getContent({ skillId: contentSkill?.id ?? "" }),
    enabled: Boolean(contentSkill),
    retry: false,
  });

  useEffect(() => {
    const files = skillContentQuery.data?.files;
    if (!files) {
      return;
    }
    setActiveSkillFilePath((current) =>
      files.some((file) => file.path === current)
        ? current
        : files[0]?.path ?? "",
    );
  }, [skillContentQuery.data]);

  const refreshSkillQueries = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["skills", "config"] }),
      queryClient.invalidateQueries({ queryKey: ["skills", "installed"] }),
      queryClient.invalidateQueries({ queryKey: ["skills", "repository"] }),
    ]);
  };

  const addRepositoryMutation = useMutation({
    mutationFn: (repositoryUrl: string) =>
      api.skills.addRepository(repositoryUrl),
    onSuccess: async (_, repositoryUrl) => {
      message.success(t("仓库添加成功"));
      setRepositoryInput("");
      setSelectedRepository(repositoryUrl);
      setActiveTab("repository");
      setIsAddRepositoryDrawerOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["skills", "config"] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : t("添加仓库失败"));
    },
  });

  const installMutation = useMutation({
    mutationFn: (payload: { repositoryUrl: string; skillPath: string }) =>
      api.skills.install(payload),
    onSuccess: async (skill) => {
      message.success(t(`技能 ${skill.name} 安装成功`));
      await refreshSkillQueries();
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : t("安装失败"));
    },
  });

  const resetAddSkillForm = () => {
    setLocalSourcePaths([]);
    setSkillMarkdown("");
    setClawHubInput("");
    setAddSkillTab("local");
    setAddSkillError(null);
  };

  const getAddSkillErrorMessage = (
    error: unknown,
    fallback: string,
  ): string => (error instanceof Error ? t(error.message) : t(fallback));

  const showInstallSuccess = (skills: Array<{ name: string }>) => {
    if (skills.length === 1) {
      message.success(t(`技能 ${skills[0]?.name ?? ""} 安装成功`));
      return;
    }
    message.success(t(`已添加 ${skills.length} 个技能`));
  };

  const pickLocalSourcesMutation = useMutation({
    mutationFn: api.skills.pickLocalSources,
    onMutate: () => {
      setAddSkillError(null);
    },
    onSuccess: (paths) => {
      if (paths.length === 0) return;
      setLocalSourcePaths((current) =>
        Array.from(new Set([...current, ...paths])),
      );
    },
    onError: (error) => {
      const errorMessage = getAddSkillErrorMessage(error, "选择本地路径失败");
      setAddSkillError(errorMessage);
      message.error(errorMessage);
    },
  });

  const installLocalSourcesMutation = useMutation({
    mutationFn: (payload: { sourcePaths: string[] }) =>
      api.skills.installLocalSources(payload),
    onSuccess: async (skills) => {
      showInstallSuccess(skills);
      resetAddSkillForm();
      setIsAddSkillModalOpen(false);
      await refreshSkillQueries();
    },
    onError: (error) => {
      const errorMessage = getAddSkillErrorMessage(error, "添加技能失败");
      setAddSkillError(errorMessage);
      message.error(errorMessage);
    },
  });

  const installFromMarkdownMutation = useMutation({
    mutationFn: (payload: { markdown: string }) =>
      api.skills.installFromMarkdown(payload),
    onSuccess: async (skill) => {
      showInstallSuccess([skill]);
      resetAddSkillForm();
      setIsAddSkillModalOpen(false);
      await refreshSkillQueries();
    },
    onError: (error) => {
      const errorMessage = getAddSkillErrorMessage(error, "添加技能失败");
      setAddSkillError(errorMessage);
      message.error(errorMessage);
    },
  });

  const installFromClawHubMutation = useMutation({
    mutationFn: (payload: { input: string }) =>
      api.skills.installFromClawHub(payload),
    onSuccess: async (skills) => {
      showInstallSuccess(skills);
      resetAddSkillForm();
      setIsAddSkillModalOpen(false);
      await refreshSkillQueries();
    },
    onError: (error) => {
      const errorMessage = getAddSkillErrorMessage(error, "添加技能失败");
      setAddSkillError(errorMessage);
      message.error(errorMessage);
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: (payload: { skillId: string }) => api.skills.uninstall(payload),
    onSuccess: async (_, variables) => {
      const removed = installedSkills.find(
        (skill) => skill.id === variables.skillId,
      );
      message.success(t(`技能 ${removed?.name ?? ""} 已卸载`.trim()));
      await refreshSkillQueries();
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : t("卸载技能失败"));
    },
  });

  const updateVisibilityMutation = useMutation({
    mutationFn: (payload: {
      skillId: string;
      mainAgentVisible: boolean;
      projectAgentVisible: boolean;
    }) => api.skills.updateVisibility(payload),
    onSuccess: async () => {
      await refreshSkillQueries();
    },
    onError: (error) => {
      message.error(
        error instanceof Error ? error.message : t("更新技能可见性失败"),
      );
    },
  });

  const refreshMetadataMutation = useMutation({
    mutationFn: (repositoryUrl: string) =>
      api.skills.refreshRepositoryMetadata(repositoryUrl),
    onSuccess: async (result, repositoryUrl) => {
      message.success(
        result.updatedCount > 0
          ? t(
              `仓库元信息已同步：共 ${result.totalCount} 个技能，更新 ${result.updatedCount} 项`,
            )
          : t(`仓库元信息已是最新（共 ${result.totalCount} 个技能）`),
      );
      await queryClient.invalidateQueries({
        queryKey: ["skills", "repository", repositoryUrl],
      });
    },
    onError: (error) => {
      message.error(
        error instanceof Error ? error.message : t("同步仓库元信息失败"),
      );
    },
  });

  const onAddRepository = () => {
    const value = repositoryInput.trim();
    if (!value) {
      message.warning(t("请输入仓库地址"));
      return;
    }
    addRepositoryMutation.mutate(value);
  };

  const isAddingSkill =
    installLocalSourcesMutation.isPending ||
    installFromMarkdownMutation.isPending ||
    installFromClawHubMutation.isPending;

  const onAddSkill = () => {
    setAddSkillError(null);
    if (addSkillTab === "local") {
      if (localSourcePaths.length === 0) {
        const errorMessage = t("请先选择本地文件或目录");
        setAddSkillError(errorMessage);
        message.warning(errorMessage);
        return;
      }
      installLocalSourcesMutation.mutate({ sourcePaths: localSourcePaths });
      return;
    }

    if (addSkillTab === "markdown") {
      const markdown = skillMarkdown.trim();
      if (!markdown) {
        const errorMessage = t("请输入 SKILL.md 内容");
        setAddSkillError(errorMessage);
        message.warning(errorMessage);
        return;
      }
      installFromMarkdownMutation.mutate({ markdown });
      return;
    }

    const input = clawHubInput.trim();
    if (!input) {
      const errorMessage = t("请输入 ClawHub 名称或链接");
      setAddSkillError(errorMessage);
      message.warning(errorMessage);
      return;
    }
    installFromClawHubMutation.mutate({ input });
  };

  const installedSkills = installedQuery.data ?? [];
  const repositorySkills = repositorySkillsQuery.data ?? [];
  const isBuiltinInstalledSkill = (repositoryUrl: string): boolean =>
    repositoryUrl.trim().toLowerCase().startsWith("builtin://");

  const selectedRepositoryLabel = useMemo(
    () =>
      repositories.find((repo) => repo.url === selectedRepository)?.url ?? "",
    [repositories, selectedRepository],
  );

  const openAddRepositoryDrawer = useCallback(() => {
    setActiveTab("repository");
    setIsAddRepositoryDrawerOpen(true);
  }, []);

  const openAddSkillModal = useCallback(() => {
    setAddSkillError(null);
    setIsAddSkillModalOpen(true);
  }, []);

  const openSkillContentModal = useCallback((skill: InstalledSkillDTO) => {
    setContentSkill(skill);
    setActiveSkillFilePath("");
  }, []);

  const headerActions = useMemo(
    () => (
      <Space size={8}>
        <Button
          icon={<PlusOutlined />}
          className="!h-10 !rounded-full !px-5"
          onClick={openAddRepositoryDrawer}
        >
          {t("添加技能仓库")}
        </Button>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          className="!h-10 !rounded-full !px-5"
          onClick={openAddSkillModal}
        >
          {t("添加技能")}
        </Button>
      </Space>
    ),
    [openAddRepositoryDrawer, openAddSkillModal, t],
  );

  useEffect(() => {
    setHeaderActions(headerActions);
    return () => {
      setHeaderActions(null);
    };
  }, [headerActions, setHeaderActions]);

  const skillContentFiles = skillContentQuery.data?.files ?? [];
  const activeSkillFile =
    skillContentFiles.find((file) => file.path === activeSkillFilePath) ??
    skillContentFiles[0] ??
    null;
  const skillFileTreeData = useMemo(
    () => buildSkillFileTree(skillContentFiles),
    [skillContentFiles],
  );
  const skillFilePathSet = useMemo(
    () => new Set(skillContentFiles.map((file) => file.path)),
    [skillContentFiles],
  );
  const skillDirectoryPaths = useMemo(
    () => collectSkillDirectoryPaths(skillContentFiles),
    [skillContentFiles],
  );

  useEffect(() => {
    setExpandedSkillFileTreeKeys(skillDirectoryPaths);
  }, [skillDirectoryPaths]);

  const skillsTabs = [
    {
      key: "installed",
      label: t("已安装技能"),
      children: (
        <div className="space-y-4">
          {installedQuery.isLoading ? (
            <div className="flex h-[96px] items-center justify-center">
              <Spin />
            </div>
          ) : installedSkills.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("暂无已安装技能，请先从仓库安装")}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {installedSkills.map((skill) => {
                const uninstallLoading =
                  uninstallMutation.isPending &&
                  uninstallMutation.variables?.skillId === skill.id;
                const visibilityUpdating =
                  updateVisibilityMutation.isPending &&
                  updateVisibilityMutation.variables?.skillId === skill.id;
                const isBuiltinSkill = isBuiltinInstalledSkill(
                  skill.repositoryUrl,
                );

                return (
                  <Card
                    key={skill.id}
                    size="small"
                    role="button"
                    tabIndex={0}
                    className={`${skillCardBaseClassName} cursor-pointer !bg-white`}
                    onClick={() => openSkillContentModal(skill)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      openSkillContentModal(skill);
                    }}
                  >
                    <Space direction="vertical" className="w-full" size={4}>
                      <div className="flex items-start justify-between gap-3">
                        <Typography.Text className="min-w-0 !text-sm !font-semibold !text-slate-900">
                          {skill.name}
                        </Typography.Text>
                        <div className="flex shrink-0 items-center justify-end gap-1">
                          {!isBuiltinSkill ? (
                            <Button
                              size="small"
                              type="text"
                              className="!h-7 !rounded-md !px-2 !text-xs !font-medium !text-red-500"
                              icon={<DeleteOutlined />}
                              loading={uninstallLoading}
                              onClick={(event) => {
                                event.stopPropagation();
                                uninstallMutation.mutate({
                                  skillId: skill.id,
                                });
                              }}
                            >
                              {t("卸载")}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      {skill.description ? (
                        <Typography.Paragraph
                          className="!my-0 !text-xs !leading-[1.65] !text-slate-600"
                          ellipsis={{ rows: 2 }}
                        >
                          {skill.description}
                        </Typography.Paragraph>
                      ) : (
                        <Typography.Text className="block !text-[11px] !leading-[1.5] !text-slate-400">
                          {t("暂无描述")}
                        </Typography.Text>
                      )}
                      <Typography.Text
                        className="!text-xs !text-slate-500"
                        ellipsis
                      >
                        {skill.repositoryUrl}
                      </Typography.Text>
                      <div
                        className="flex flex-wrap gap-2"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <div className="flex min-w-[140px] flex-1 items-center justify-between gap-3 rounded-md border border-[#e8eef8] bg-[#f8fbff] px-2.5 py-1.5">
                          <Typography.Text className="!text-xs !font-medium !text-slate-600">
                            {t("主智能体")}
                          </Typography.Text>
                          <Switch
                            size="small"
                            checked={skill.mainAgentVisible}
                            loading={visibilityUpdating}
                            onChange={(checked) =>
                              updateVisibilityMutation.mutate({
                                skillId: skill.id,
                                mainAgentVisible: checked,
                                projectAgentVisible: skill.projectAgentVisible,
                              })
                            }
                          />
                        </div>
                        <div className="flex min-w-[140px] flex-1 items-center justify-between gap-3 rounded-md border border-[#e8eef8] bg-[#f8fbff] px-2.5 py-1.5">
                          <Typography.Text className="!text-xs !font-medium !text-slate-600">
                            {t("子智能体")}
                          </Typography.Text>
                          <Switch
                            size="small"
                            checked={skill.projectAgentVisible}
                            loading={visibilityUpdating}
                            onChange={(checked) =>
                              updateVisibilityMutation.mutate({
                                skillId: skill.id,
                                mainAgentVisible: skill.mainAgentVisible,
                                projectAgentVisible: checked,
                              })
                            }
                          />
                        </div>
                      </div>
                    </Space>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "repository",
      label: t("技能仓库"),
      children: (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {repositories.map((repository) => (
              <Button
                key={repository.url}
                type={
                  selectedRepository === repository.url ? "primary" : "default"
                }
                className="!h-9"
                onClick={() => setSelectedRepository(repository.url)}
              >
                <span className="max-w-[420px] truncate">{repository.url}</span>
              </Button>
            ))}
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Typography.Title level={4} className="!mb-0 !text-slate-900">
                {t("仓库技能")}
              </Typography.Title>
              <Space size={4} wrap>
                {selectedRepositoryLabel ? (
                  <Typography.Text className="!text-xs !text-slate-500">
                    {selectedRepositoryLabel}
                  </Typography.Text>
                ) : null}
                <Button
                  size="small"
                  type="text"
                  icon={<ReloadOutlined />}
                  className="!h-7 !rounded-md !px-2 !text-xs !text-slate-600"
                  loading={refreshMetadataMutation.isPending}
                  disabled={!selectedRepository}
                  onClick={() => {
                    if (!selectedRepository) return;
                    refreshMetadataMutation.mutate(selectedRepository);
                  }}
                >
                  {t("同步元信息")}
                </Button>
              </Space>
            </div>
            {!selectedRepository ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t("请先选择仓库")}
              />
            ) : repositorySkillsQuery.isLoading ? (
              <div className="flex h-[180px] items-center justify-center">
                <Spin />
              </div>
            ) : repositorySkillsQuery.isError ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  repositorySkillsQuery.error instanceof Error
                    ? repositorySkillsQuery.error.message
                    : t("加载仓库技能失败")
                }
              >
                <Button
                  size="small"
                  onClick={() => repositorySkillsQuery.refetch()}
                >
                  {t("重试")}
                </Button>
              </Empty>
            ) : repositorySkills.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t("当前仓库未解析到技能（未找到 SKILL.md）")}
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {repositorySkills.map((skill) => {
                  const installing =
                    installMutation.isPending &&
                    installMutation.variables?.repositoryUrl ===
                      selectedRepository &&
                    installMutation.variables?.skillPath === skill.skillPath;

                  return (
                    <Card
                      key={skill.id}
                      size="small"
                      className={`${skillCardBaseClassName} !bg-white`}
                    >
                      <Space direction="vertical" className="w-full" size={12}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Typography.Text className="!text-sm !font-semibold !text-slate-900">
                              {skill.name}
                            </Typography.Text>
                          </div>
                          <Button
                            size="small"
                            type="text"
                            className={`!h-7 !shrink-0 !rounded-md !px-2 !text-xs !font-medium ${
                              skill.installed
                                ? "!text-emerald-600"
                                : "!text-blue-600"
                            }`}
                            icon={
                              skill.installed ? (
                                <CheckCircleFilled />
                              ) : (
                                <DownloadOutlined />
                              )
                            }
                            loading={installing}
                            disabled={skill.installed}
                            onClick={() =>
                              installMutation.mutate({
                                repositoryUrl: selectedRepository,
                                skillPath: skill.skillPath,
                              })
                            }
                          >
                            {skill.installed ? t("已安装") : t("安装")}
                          </Button>
                        </div>
                        {skill.description ? (
                          <Typography.Paragraph
                            className={skillDescriptionClassName}
                            ellipsis={{ rows: 2 }}
                          >
                            {skill.description}
                          </Typography.Paragraph>
                        ) : (
                          <Typography.Text className="mt-1.5 mb-1.5 block !text-[11px] !text-slate-400">
                            {t("元信息更新中或暂不可用")}
                          </Typography.Text>
                        )}
                      </Space>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ),
    },
  ];

  const addSkillTabs = [
    {
      key: "local",
      label: t("本地文件/目录"),
      children: (
        <div className="space-y-4">
          <Typography.Paragraph className="!mb-0 !text-sm !leading-[1.7] !text-slate-600">
            {t("选择 SKILL.md 文件、技能目录，或包含多个技能目录的文件夹")}
          </Typography.Paragraph>
          <Button
            icon={<FolderOpenOutlined />}
            loading={pickLocalSourcesMutation.isPending}
            onClick={() => pickLocalSourcesMutation.mutate()}
          >
            {t("选择文件或目录")}
          </Button>
          {localSourcePaths.length > 0 ? (
            <div className="rounded-lg border border-[var(--stroke-strong)] bg-[var(--surface)]">
              <div className="border-b border-[var(--stroke)] px-3 py-2 text-xs font-medium text-[var(--muted)]">
                {t("已选择的路径")}
              </div>
              <ScrollArea className="max-h-[180px]">
                <div className="space-y-1 p-2">
                  {localSourcePaths.map((sourcePath) => (
                    <div
                      key={sourcePath}
                      className="flex items-center justify-between gap-2 rounded-md bg-[var(--surface-2)] px-2 py-1.5"
                    >
                      <Typography.Text
                        className="min-w-0 !text-xs !text-[var(--text-soft)]"
                        ellipsis
                      >
                        {sourcePath}
                      </Typography.Text>
                      <Button
                        size="small"
                        type="text"
                        icon={<DeleteOutlined />}
                        aria-label={t("移除")}
                        onClick={() =>
                          setLocalSourcePaths((current) =>
                            current.filter((item) => item !== sourcePath),
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("尚未选择本地文件或目录")}
            />
          )}
        </div>
      ),
    },
    {
      key: "markdown",
      label: t("SKILL.md 内容"),
      children: (
        <div className="space-y-3">
          <Typography.Paragraph className="!mb-0 !text-sm !leading-[1.7] !text-slate-600">
            {t("粘贴完整的 SKILL.md 内容")}
          </Typography.Paragraph>
          <Input.TextArea
            value={skillMarkdown}
            onChange={(event) => setSkillMarkdown(event.target.value)}
            placeholder={t("请输入 SKILL.md 内容")}
            rows={12}
            className="!font-mono !text-xs"
          />
        </div>
      ),
    },
    {
      key: "clawhub",
      label: t("ClawHub"),
      children: (
        <div className="space-y-3">
          <Typography.Paragraph className="!mb-0 !text-sm !leading-[1.7] !text-slate-600">
            {t("输入 ClawHub 技能名称或链接")}
          </Typography.Paragraph>
          <Input
            value={clawHubInput}
            onChange={(event) => setClawHubInput(event.target.value)}
            placeholder={t(
              "例如：https://clawhub.ai/spclaudehome/skill-vetter 或 skill-vetter",
            )}
            prefix={<CloudDownloadOutlined className="text-slate-400" />}
            onPressEnter={onAddSkill}
          />
        </div>
      ),
    },
  ];

  return (
    <>
      <ScrollArea className="h-full">
        <div className="px-5 pb-5 pt-4">
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={skillsTabs}
            className="[&_.ant-tabs-nav]:!mb-5"
            destroyInactiveTabPane={false}
          />
        </div>
      </ScrollArea>
      <Modal
        title={contentSkill?.name ?? ""}
        open={Boolean(contentSkill)}
        onCancel={() => {
          setContentSkill(null);
          setActiveSkillFilePath("");
        }}
        width={960}
        footer={null}
        destroyOnClose
      >
        <div className="h-[64vh] min-h-[360px] rounded-lg border border-[var(--stroke-strong)] bg-[var(--surface)]">
          {skillContentQuery.isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Spin />
            </div>
          ) : skillContentQuery.isError ? (
            <div className="flex h-full items-center justify-center px-6">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  skillContentQuery.error instanceof Error
                    ? t(skillContentQuery.error.message)
                    : t("加载技能内容失败")
                }
              >
                <Button size="small" onClick={() => skillContentQuery.refetch()}>
                  {t("重试")}
                </Button>
              </Empty>
            </div>
          ) : skillContentFiles.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t("暂无文件")}
              />
            </div>
          ) : (
            <div className="grid h-full grid-cols-[220px_minmax(0,1fr)]">
              <div className="min-w-0 border-r border-[var(--stroke)]">
                <div className="border-b border-[var(--stroke)] px-3 py-2 text-xs font-medium text-[var(--muted)]">
                  {t("文件列表")}
                </div>
                <ScrollArea className="h-[calc(64vh-38px)] min-h-[322px]">
                  <div className="p-2">
                    <Tree
                      blockNode
                      expandedKeys={expandedSkillFileTreeKeys}
                      selectedKeys={activeSkillFile ? [activeSkillFile.path] : []}
                      treeData={skillFileTreeData}
                      className={`skill-file-tree !bg-transparent !font-mono !text-xs ${
                        skillDirectoryPaths.length === 0
                          ? "skill-file-tree-flat"
                          : ""
                      }`}
                      onExpand={(expandedKeys) =>
                        setExpandedSkillFileTreeKeys(expandedKeys.map(String))
                      }
                      onSelect={(_, info) => {
                        const selectedPath = String(info.node.key);
                        if (skillFilePathSet.has(selectedPath)) {
                          setActiveSkillFilePath(selectedPath);
                          return;
                        }
                        setExpandedSkillFileTreeKeys((current) =>
                          current.includes(selectedPath)
                            ? current.filter((key) => key !== selectedPath)
                            : [...current, selectedPath],
                        );
                      }}
                    />
                  </div>
                </ScrollArea>
              </div>
              <div className="min-w-0">
                <div className="border-b border-[var(--stroke)] px-3 py-2 font-mono text-xs text-[var(--muted)]">
                  {activeSkillFile?.path}
                </div>
                <ScrollArea className="h-[calc(64vh-38px)] min-h-[322px]">
                  <pre className="m-0 inline-block min-w-full whitespace-pre p-4 font-mono text-xs leading-relaxed text-slate-700">{activeSkillFile?.content ?? ""}</pre>
                </ScrollArea>
              </div>
            </div>
          )}
        </div>
      </Modal>
      <Modal
        title={t("添加技能")}
        open={isAddSkillModalOpen}
        onCancel={() => {
          if (isAddingSkill) return;
          setIsAddSkillModalOpen(false);
          resetAddSkillForm();
        }}
        width={680}
        destroyOnClose
        maskClosable={!isAddingSkill}
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button
              disabled={isAddingSkill}
              onClick={() => {
                setIsAddSkillModalOpen(false);
                resetAddSkillForm();
              }}
            >
              {t("取消")}
            </Button>
            <Button
              type="primary"
              icon={
                addSkillTab === "local" ? (
                  <FolderOpenOutlined />
                ) : addSkillTab === "markdown" ? (
                  <FileTextOutlined />
                ) : (
                  <CloudDownloadOutlined />
                )
              }
              loading={isAddingSkill}
              onClick={onAddSkill}
            >
              {t("添加技能")}
            </Button>
          </div>
        }
      >
        <Tabs
          activeKey={addSkillTab}
          onChange={(key) => {
            setAddSkillTab(key);
            setAddSkillError(null);
          }}
          items={addSkillTabs}
          className="[&_.ant-tabs-nav]:!mb-4"
        />
        {addSkillError ? (
          <Alert
            type="error"
            showIcon
            message={addSkillError}
            className="!mt-4"
          />
        ) : null}
      </Modal>
      <Drawer
        title={t("添加技能仓库")}
        placement="right"
        open={isAddRepositoryDrawerOpen}
        onClose={() => {
          if (addRepositoryMutation.isPending) return;
          setIsAddRepositoryDrawerOpen(false);
          setRepositoryInput("");
        }}
        closable={false}
        extra={
          <Button
            type="text"
            icon={<CloseOutlined />}
            aria-label={t("关闭")}
            disabled={addRepositoryMutation.isPending}
            onClick={() => {
              setIsAddRepositoryDrawerOpen(false);
              setRepositoryInput("");
            }}
          />
        }
        width={520}
        maskClosable={!addRepositoryMutation.isPending}
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button
              disabled={addRepositoryMutation.isPending}
              onClick={() => {
                setIsAddRepositoryDrawerOpen(false);
                setRepositoryInput("");
              }}
            >
              {t("取消")}
            </Button>
            <Button
              type="primary"
              loading={addRepositoryMutation.isPending}
              onClick={onAddRepository}
            >
              {t("添加仓库")}
            </Button>
          </div>
        }
      >
        <Input
          className="!h-10 !text-[15px]"
          value={repositoryInput}
          onChange={(event) => setRepositoryInput(event.target.value)}
          placeholder={t(
            "输入 GitHub 仓库地址，例如 https://github.com/owner/repo",
          )}
          onPressEnter={onAddRepository}
        />
      </Drawer>
    </>
  );
};
