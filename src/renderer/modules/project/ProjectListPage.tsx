import {
  DeleteOutlined,
  LeftOutlined,
  PlusOutlined,
  RightOutlined,
  RobotOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { IllustrationEmptyTeamChatTarget } from "@renderer/components/EmptyIllustrations";
import { ScrollArea } from "@renderer/components/ScrollArea";
import { useAppI18n } from "@renderer/i18n/AppI18nProvider";
import { api } from "@renderer/lib/api";
import { AgentGroupChatWorkspace } from "@renderer/modules/project/AgentGroupChatWorkspace";
import {
  ProjectWorkspaceContent,
  resolveProjectModule,
  type ProjectModuleKey,
} from "@renderer/modules/project/ProjectWorkspacePage";
import type { AgentGroupDTO, ProjectDTO } from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Typography,
  message,
} from "antd";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import type { MainLayoutOutletContext } from "@renderer/app/MainLayout";

type TeamSelection = { type: "agent"; id: string } | { type: "group"; id: string };

const PROJECT_MODULE_ITEMS: Array<{ key: ProjectModuleKey; label: string }> = [
  { key: "main", label: "聊天" },
  { key: "docs", label: "文档" },
  { key: "app", label: "应用" },
];

export const ProjectListPage = () => {
  const { t } = useAppI18n();
  const queryClient = useQueryClient();
  const { setHeaderActions } = useOutletContext<MainLayoutOutletContext>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selection, setSelection] = useState<TeamSelection | null>(null);
  const pendingRouteSelectionRef = useRef<TeamSelection | null>(null);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [createGroupForm] = Form.useForm<{
    name: string;
    description?: string;
  }>();
  const [selectedGroupMemberIds, setSelectedGroupMemberIds] = useState<string[]>(
    [],
  );
  const [checkedAvailableGroupMemberIds, setCheckedAvailableGroupMemberIds] =
    useState<string[]>([]);
  const [checkedSelectedGroupMemberIds, setCheckedSelectedGroupMemberIds] =
    useState<string[]>([]);

  const projectQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.project.list,
  });
  const groupQuery = useQuery({
    queryKey: ["agent-groups"],
    queryFn: api.agentGroup.list,
  });

  const projects = projectQuery.data ?? [];
  const groups = groupQuery.data ?? [];
  const routeAgentId = searchParams.get("agent")?.trim();
  const routeGroupId = searchParams.get("group")?.trim();
  const pendingRouteSelection = pendingRouteSelectionRef.current;
  const routeAgent = routeAgentId
    ? projects.find((project) => project.id === routeAgentId)
    : undefined;
  const routeGroup =
    !routeAgent && routeGroupId
      ? groups.find((group) => group.id === routeGroupId)
      : undefined;
  const activeSelection =
    pendingRouteSelection ??
    (routeAgent
      ? ({ type: "agent", id: routeAgent.id } satisfies TeamSelection)
      : routeGroup
        ? ({ type: "group", id: routeGroup.id } satisfies TeamSelection)
        : selection);
  const activeProjectModule = useMemo(
    () => resolveProjectModule(searchParams.get("module")),
    [searchParams],
  );
  const activeDocumentId = searchParams.get("doc") ?? undefined;
  const pendingRouteSessionId = searchParams.get("session")?.trim() ?? "";
  const selectedAgent =
    activeSelection?.type === "agent"
      ? projects.find((project) => project.id === activeSelection.id)
      : undefined;
  const selectedGroup =
    activeSelection?.type === "group"
      ? groups.find((group) => group.id === activeSelection.id)
      : undefined;
  const selectedGroupMemberIdSet = useMemo(
    () => new Set(selectedGroupMemberIds),
    [selectedGroupMemberIds],
  );
  const availableGroupMemberProjects = useMemo(
    () =>
      projects.filter((project) => !selectedGroupMemberIdSet.has(project.id)),
    [projects, selectedGroupMemberIdSet],
  );
  const selectedGroupMemberProjects = useMemo(
    () =>
      selectedGroupMemberIds
        .map((projectId) => projects.find((project) => project.id === projectId))
        .filter((project): project is ProjectDTO => Boolean(project)),
    [projects, selectedGroupMemberIds],
  );
  const availableGroupMemberIdSet = useMemo(
    () => new Set(availableGroupMemberProjects.map((project) => project.id)),
    [availableGroupMemberProjects],
  );

  useEffect(() => {
    if (!projectQuery.isFetched || !groupQuery.isFetched) return;

    const routeAgentId = searchParams.get("agent")?.trim();
    const routeGroupId = searchParams.get("group")?.trim();
    const pendingRouteSelection = pendingRouteSelectionRef.current;
    const routeMatchesPendingSelection =
      pendingRouteSelection?.type === "agent"
        ? routeAgentId === pendingRouteSelection.id
        : pendingRouteSelection?.type === "group"
          ? routeGroupId === pendingRouteSelection.id
          : false;

    if (pendingRouteSelection && !routeMatchesPendingSelection) {
      return;
    }
    if (routeMatchesPendingSelection) {
      pendingRouteSelectionRef.current = null;
    }

    const routeAgent = routeAgentId
      ? projects.find((project) => project.id === routeAgentId)
      : undefined;
    const routeGroup = routeGroupId
      ? groups.find((group) => group.id === routeGroupId)
      : undefined;

    if (routeAgent) {
      if (selection?.type !== "agent" || selection.id !== routeAgent.id) {
        setSelection({ type: "agent", id: routeAgent.id });
      }
      return;
    }

    if (routeGroup) {
      if (selection?.type !== "group" || selection.id !== routeGroup.id) {
        setSelection({ type: "group", id: routeGroup.id });
      }
      return;
    }

    const selectionStillExists =
      selection?.type === "agent"
        ? projects.some((project) => project.id === selection.id)
        : selection?.type === "group"
          ? groups.some((group) => group.id === selection.id)
          : false;
    if (selectionStillExists) return;

    if (projects[0]) {
      setSelection({ type: "agent", id: projects[0].id });
    } else if (groups[0]) {
      setSelection({ type: "group", id: groups[0].id });
    }
  }, [
    groupQuery.isFetched,
    groups,
    projectQuery.isFetched,
    projects,
    searchParams,
    selection,
  ]);

  const selectTeam = useCallback(
    (nextSelection: TeamSelection) => {
      pendingRouteSelectionRef.current = nextSelection;
      setSelection(nextSelection);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("doc");
      nextParams.delete("session");
      nextParams.delete("source");
      nextParams.delete("stamp");
      if (nextSelection.type === "agent") {
        nextParams.set("agent", nextSelection.id);
        nextParams.delete("group");
      } else {
        nextParams.set("group", nextSelection.id);
        nextParams.delete("agent");
        nextParams.delete("module");
      }
      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const switchSelectedAgentModule = useCallback(
    (module: ProjectModuleKey) => {
      if (!selectedAgent) return;
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("agent", selectedAgent.id);
      nextParams.delete("group");
      nextParams.delete("doc");
      nextParams.set("module", module);
      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, selectedAgent, setSearchParams],
  );

  const handlePendingRouteSessionConsumed = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("session");
    nextParams.delete("source");
    nextParams.delete("stamp");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const agentModuleHeaderActions = useMemo(() => {
    if (!selectedAgent) return null;

    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-full border border-[#dce5f4] bg-white/90 p-1 shadow-[0_4px_16px_rgba(15,23,42,0.05)]">
          {PROJECT_MODULE_ITEMS.map((item) => {
            const active = activeProjectModule === item.key;
            return (
              <button
                key={item.key}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => switchSelectedAgentModule(item.key)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-[#2f6ff7] text-white shadow-[0_6px_12px_rgba(47,111,247,0.32)]"
                    : "text-slate-600 hover:bg-[#eef3fc] hover:text-slate-900"
                }`}
              >
                {t(item.label)}
              </button>
            );
          })}
        </div>
      </div>
    );
  }, [
    activeProjectModule,
    selectedAgent,
    switchSelectedAgentModule,
    t,
  ]);

  useEffect(() => {
    setHeaderActions(agentModuleHeaderActions);
    return () => {
      setHeaderActions(null);
    };
  }, [agentModuleHeaderActions, setHeaderActions]);

  useEffect(() => {
    setSelectedGroupMemberIds((current) =>
      current.filter((projectId) =>
        projects.some((project) => project.id === projectId),
      ),
    );
  }, [projects]);

  useEffect(() => {
    setCheckedAvailableGroupMemberIds((current) =>
      current.filter((projectId) => availableGroupMemberIdSet.has(projectId)),
    );
  }, [availableGroupMemberIdSet]);

  useEffect(() => {
    setCheckedSelectedGroupMemberIds((current) =>
      current.filter((projectId) => selectedGroupMemberIdSet.has(projectId)),
    );
  }, [selectedGroupMemberIdSet]);

  const resetCreateGroupState = useCallback(() => {
    createGroupForm.resetFields();
    setSelectedGroupMemberIds([]);
    setCheckedAvailableGroupMemberIds([]);
    setCheckedSelectedGroupMemberIds([]);
  }, [createGroupForm]);

  const closeCreateGroupModal = useCallback(() => {
    setCreateGroupOpen(false);
    resetCreateGroupState();
  }, [resetCreateGroupState]);

  const moveCheckedGroupMembersToSelected = useCallback(() => {
    setSelectedGroupMemberIds((current) => [
      ...current,
      ...checkedAvailableGroupMemberIds.filter(
        (projectId) => !current.includes(projectId),
      ),
    ]);
    setCheckedAvailableGroupMemberIds([]);
  }, [checkedAvailableGroupMemberIds]);

  const moveCheckedGroupMembersToAvailable = useCallback(() => {
    const removing = new Set(checkedSelectedGroupMemberIds);
    setSelectedGroupMemberIds((current) =>
      current.filter((projectId) => !removing.has(projectId)),
    );
    setCheckedSelectedGroupMemberIds([]);
  }, [checkedSelectedGroupMemberIds]);

  const createAgentMutation = useMutation({
    mutationFn: () => api.project.create({ source: "manual" }),
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      selectTeam({ type: "agent", id: project.id });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : t("创建失败"));
    },
  });

  const createGroupMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      description?: string;
      memberProjectIds?: string[];
    }) =>
      api.agentGroup.create(payload),
    onSuccess: async (group) => {
      await queryClient.invalidateQueries({ queryKey: ["agent-groups"] });
      setCreateGroupOpen(false);
      resetCreateGroupState();
      selectTeam({ type: "group", id: group.id });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : t("创建群组失败"));
    },
  });

  const deleteAgentMutation = useMutation({
    mutationFn: (id: string) => api.project.delete(id),
    onSuccess: async (_result, deletedId) => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      if (selection?.type === "agent" && selection.id === deletedId) {
        setSelection(null);
      }
      message.success(t("Agent 已删除"));
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : t("删除失败"));
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (id: string) => api.agentGroup.delete(id),
    onSuccess: async (_result, deletedId) => {
      await queryClient.invalidateQueries({ queryKey: ["agent-groups"] });
      if (selection?.type === "group" && selection.id === deletedId) {
        setSelection(null);
      }
      message.success(t("群组已删除"));
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : t("删除群组失败"));
    },
  });

  const renderSidebarItem = (
    item: ProjectDTO | AgentGroupDTO,
    itemSelection: TeamSelection,
    icon: ReactNode,
    description?: string | null,
    onDelete?: () => void,
  ) => {
    const active =
      activeSelection?.type === itemSelection.type &&
      activeSelection.id === itemSelection.id;
    return (
      <button
        key={`${itemSelection.type}:${item.id}`}
        type="button"
        className={`group flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
          active
            ? "bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] text-[var(--primary)]"
            : "text-[var(--text-soft)] hover:bg-[var(--surface-2)] hover:text-[var(--primary)]"
        }`}
        onClick={() => selectTeam(itemSelection)}
      >
        <span className="mt-0.5 shrink-0">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {item.name}
          </span>
          <span className="block truncate text-xs text-[var(--muted)]">
            {description || t("暂无描述")}
          </span>
        </span>
        {onDelete ? (
          <span
            className="pointer-events-none flex h-6 w-0 shrink-0 items-center justify-center overflow-hidden rounded text-[var(--muted)] opacity-0 transition-[width,opacity] hover:bg-red-500/10 hover:text-red-500 group-hover:pointer-events-auto group-hover:w-6 group-hover:opacity-100"
            title={t("删除")}
            aria-label={t("删除")}
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            <DeleteOutlined className="text-xs" />
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <div className="flex h-full min-h-0 gap-4 px-5 pb-5">
      <aside className="flex h-full w-72 shrink-0 flex-col rounded-2xl border border-[var(--stroke)] bg-[rgba(var(--surface-rgb),0.72)] py-3 shadow-[var(--shadow-panel)]">
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 pl-3 pr-4">
            <section>
              <div className="sticky top-0 z-10 mb-2 flex items-center justify-between gap-2 bg-[rgba(var(--surface-rgb),0.92)] px-1 py-1 backdrop-blur">
                <Typography.Text className="!text-xs !font-bold !uppercase !tracking-wide !text-[var(--muted)]">
                  {t("群组")}
                </Typography.Text>
                <Button
                  type="text"
                  shape="circle"
                  size="small"
                  icon={<PlusOutlined />}
                  title={t("新建群组")}
                  aria-label={t("新建群组")}
                  onClick={() => setCreateGroupOpen(true)}
                />
              </div>
              <div className="space-y-1">
                {groups.length > 0 ? (
                  groups.map((group) =>
                    renderSidebarItem(
                      group,
                      { type: "group", id: group.id },
                      <TeamOutlined />,
                      group.description,
                      () => deleteGroupMutation.mutate(group.id),
                    ),
                  )
                ) : (
                  <div className="px-3 py-2 text-xs text-[var(--muted)]">
                    {t("暂无群组")}
                  </div>
                )}
              </div>
            </section>

            <section>
              <div className="sticky top-0 z-10 mb-2 flex items-center justify-between gap-2 bg-[rgba(var(--surface-rgb),0.92)] px-1 py-1 backdrop-blur">
                <Typography.Text className="!text-xs !font-bold !uppercase !tracking-wide !text-[var(--muted)]">
                  {t("全部 Agent")}
                </Typography.Text>
                <Button
                  type="text"
                  shape="circle"
                  size="small"
                  icon={<PlusOutlined />}
                  title={t("新建 Agent")}
                  aria-label={t("新建 Agent")}
                  loading={createAgentMutation.isPending}
                  onClick={() => createAgentMutation.mutate()}
                />
              </div>
              <div className="space-y-1">
                {projects.length > 0 ? (
                  projects.map((project) =>
                    renderSidebarItem(
                      project,
                      { type: "agent", id: project.id },
                      <RobotOutlined />,
                      project.description,
                      () => deleteAgentMutation.mutate(project.id),
                    ),
                  )
                ) : (
                  <div className="px-3 py-2 text-xs text-[var(--muted)]">
                    {t("暂无 Agent")}
                  </div>
                )}
              </div>
            </section>
          </div>
        </ScrollArea>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {selectedAgent ? (
          <ProjectWorkspaceContent
            key={selectedAgent.id}
            projectId={selectedAgent.id}
            activeModule={activeProjectModule}
            activeDocumentId={activeDocumentId}
            pendingRouteSessionId={pendingRouteSessionId}
            className="min-h-0 flex-1"
            onPendingRouteSessionConsumed={handlePendingRouteSessionConsumed}
          />
        ) : selectedGroup ? (
          <AgentGroupChatWorkspace
            key={selectedGroup.id}
            group={selectedGroup}
            projects={projects}
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-2xl border border-[var(--stroke)] bg-[rgba(var(--surface-rgb),0.72)]">
            <div className="empty-state select-none px-6 text-center">
              <div className="empty-state__icon">
                <IllustrationEmptyTeamChatTarget size={168} />
              </div>
              <p className="m-0 text-sm font-semibold text-[var(--text-soft)]">
                {t("创建群组或者智能体来聊天吧")}
              </p>
            </div>
          </div>
        )}
      </main>

      <Modal
        title={t("新建群组")}
        open={createGroupOpen}
        width={760}
        okText={t("创建")}
        cancelText={t("取消")}
        okButtonProps={{ loading: createGroupMutation.isPending }}
        onCancel={closeCreateGroupModal}
        onOk={() => {
          void createGroupForm.validateFields().then((values) => {
            createGroupMutation.mutate({
              ...values,
              memberProjectIds: selectedGroupMemberIds,
            });
          });
        }}
      >
        <Form form={createGroupForm} layout="vertical">
          <Form.Item
            name="name"
            label={t("群组名称")}
            rules={[{ required: true, message: t("请输入群组名称") }]}
          >
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="description" label={t("群组描述")}>
            <Input.TextArea maxLength={400} autoSize={{ minRows: 2, maxRows: 4 }} />
          </Form.Item>
          <Form.Item label={t("群成员")}>
            <div className="grid min-h-[260px] grid-cols-[minmax(0,1fr)_48px_minmax(0,1fr)] gap-3">
              <div className="flex min-w-0 flex-col rounded-lg border border-[var(--stroke)] bg-[var(--surface)]">
                <div className="flex items-center justify-between border-b border-[var(--stroke)] px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Checkbox
                      checked={
                        availableGroupMemberProjects.length > 0 &&
                        checkedAvailableGroupMemberIds.length ===
                          availableGroupMemberProjects.length
                      }
                      indeterminate={
                        checkedAvailableGroupMemberIds.length > 0 &&
                        checkedAvailableGroupMemberIds.length <
                          availableGroupMemberProjects.length
                      }
                      disabled={availableGroupMemberProjects.length === 0}
                      aria-label={t("选择全部可添加 Agent")}
                      onChange={(event) =>
                        setCheckedAvailableGroupMemberIds(
                          event.target.checked
                            ? availableGroupMemberProjects.map(
                                (project) => project.id,
                              )
                            : [],
                        )
                      }
                    />
                    <Typography.Text className="!truncate !font-medium !text-[var(--text)]">
                      {t("可添加 Agent")}
                    </Typography.Text>
                  </div>
                  <Typography.Text className="!text-xs !text-[var(--muted)]">
                    {checkedAvailableGroupMemberIds.length}/
                    {availableGroupMemberProjects.length}
                  </Typography.Text>
                </div>
                <ScrollArea className="min-h-0 flex-1 px-2 py-2">
                  {availableGroupMemberProjects.length > 0 ? (
                    <div className="space-y-1">
                      {availableGroupMemberProjects.map((project) => (
                        <Checkbox
                          key={project.id}
                          checked={checkedAvailableGroupMemberIds.includes(
                            project.id,
                          )}
                          className="!flex !min-w-0 rounded-md !px-2 !py-2 hover:!bg-[var(--surface-2)]"
                          onChange={(event) =>
                            setCheckedAvailableGroupMemberIds((current) =>
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
                    <div className="flex h-full min-h-[180px] items-center justify-center px-4 text-center text-sm text-[var(--muted)]">
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
                  disabled={checkedAvailableGroupMemberIds.length === 0}
                  title={t("添加选中的 Agent")}
                  aria-label={t("添加选中的 Agent")}
                  onClick={moveCheckedGroupMembersToSelected}
                />
                <Button
                  shape="circle"
                  className="!h-8 !w-8 !min-w-8 !shrink-0"
                  icon={<LeftOutlined />}
                  disabled={checkedSelectedGroupMemberIds.length === 0}
                  title={t("取消选择选中的 Agent")}
                  aria-label={t("取消选择选中的 Agent")}
                  onClick={moveCheckedGroupMembersToAvailable}
                />
              </div>

              <div className="flex min-w-0 flex-col rounded-lg border border-[var(--stroke)] bg-[var(--surface)]">
                <div className="flex items-center justify-between border-b border-[var(--stroke)] px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Checkbox
                      checked={
                        selectedGroupMemberProjects.length > 0 &&
                        checkedSelectedGroupMemberIds.length ===
                          selectedGroupMemberProjects.length
                      }
                      indeterminate={
                        checkedSelectedGroupMemberIds.length > 0 &&
                        checkedSelectedGroupMemberIds.length <
                          selectedGroupMemberProjects.length
                      }
                      disabled={selectedGroupMemberProjects.length === 0}
                      aria-label={t("选择全部已选择 Agent")}
                      onChange={(event) =>
                        setCheckedSelectedGroupMemberIds(
                          event.target.checked
                            ? selectedGroupMemberProjects.map(
                                (project) => project.id,
                              )
                            : [],
                        )
                      }
                    />
                    <Typography.Text className="!truncate !font-medium !text-[var(--text)]">
                      {t("已选择 Agent")}
                    </Typography.Text>
                  </div>
                  <Typography.Text className="!text-xs !text-[var(--muted)]">
                    {checkedSelectedGroupMemberIds.length}/
                    {selectedGroupMemberProjects.length}
                  </Typography.Text>
                </div>
                <ScrollArea className="min-h-0 flex-1 px-2 py-2">
                  {selectedGroupMemberProjects.length > 0 ? (
                    <div className="space-y-1">
                      {selectedGroupMemberProjects.map((project) => (
                        <Checkbox
                          key={project.id}
                          checked={checkedSelectedGroupMemberIds.includes(
                            project.id,
                          )}
                          className="!flex !min-w-0 rounded-md !px-2 !py-2 hover:!bg-[var(--surface-2)]"
                          onChange={(event) =>
                            setCheckedSelectedGroupMemberIds((current) =>
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
                    <div className="flex h-full min-h-[180px] items-center justify-center px-4 text-center text-sm text-[var(--muted)]">
                      {t("尚未选择 Agent")}
                    </div>
                  )}
                </ScrollArea>
              </div>
            </div>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
