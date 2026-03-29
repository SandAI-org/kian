import type { MainLayoutOutletContext } from "@renderer/app/MainLayout";
import {
  CloseOutlined,
  CheckCircleFilled,
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { ScrollArea } from "@renderer/components/ScrollArea";
import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { translateUiText } from "@renderer/i18n/uiTranslations";
import { api } from "@renderer/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Space,
  Spin,
  Switch,
  Tabs,
  Typography,
  message,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";

const skillCardBaseClassName =
  "!rounded-xl !border-[#dde6f5] !shadow-[0_8px_20px_rgba(15,23,42,0.03)] !transition-all !duration-200 hover:!-translate-y-0.5 hover:!border-[#cbd9f0] hover:!shadow-[0_12px_24px_rgba(15,23,42,0.06)]";

const skillDescriptionClassName =
  "!mt-1.5 !mb-1.5 !text-xs !leading-[1.65] !text-slate-600";

export const SkillsPage = () => {
  const { language } = useAppI18n();
  const t = (value: string): string => translateUiText(language, value);
  const queryClient = useQueryClient();
  const { setHeaderActions } = useOutletContext<MainLayoutOutletContext>();
  const [activeTab, setActiveTab] = useState("installed");
  const [selectedRepository, setSelectedRepository] = useState("");
  const [repositoryInput, setRepositoryInput] = useState("");
  const [isAddRepositoryDrawerOpen, setIsAddRepositoryDrawerOpen] =
    useState(false);

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

  const headerActions = useMemo(
    () => (
      <Button
        type="primary"
        icon={<PlusOutlined />}
        className="!h-10 !rounded-full !px-5"
        onClick={openAddRepositoryDrawer}
      >
        {translateUiText(language, "添加技能仓库")}
      </Button>
    ),
    [language, openAddRepositoryDrawer],
  );

  useEffect(() => {
    setHeaderActions(headerActions);
    return () => {
      setHeaderActions(null);
    };
  }, [headerActions, setHeaderActions]);

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
                    className={`${skillCardBaseClassName} !bg-white`}
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
                              onClick={() =>
                                uninstallMutation.mutate({
                                  skillId: skill.id,
                                })
                              }
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
                      <div className="flex flex-wrap gap-2">
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
