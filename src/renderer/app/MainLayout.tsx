import {
  AppstoreFilled,
  AppstoreOutlined,
  ApiFilled,
  ApiOutlined,
  ArrowUpOutlined,
  CalendarFilled,
  CalendarOutlined,
  CheckOutlined,
  CheckSquareFilled,
  CheckSquareOutlined,
  CompassFilled,
  CompassOutlined,
  DownOutlined,
  InfoCircleOutlined,
  RobotOutlined,
  RobotFilled,
  SettingFilled,
  SettingOutlined,
  StarFilled,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppUpdateStatusDTO, ModuleType } from '@shared/types';
import { api } from '@renderer/lib/api';
import { toggleWindowMaximizeFromChrome } from '@renderer/lib/windowChrome';
import {
  MAIN_AGENT_INPUT_FOCUS_EVENT,
  matchesKeyboardShortcut,
} from '@renderer/lib/shortcuts';
import { NEW_CURRENT_AGENT_SESSION_EVENT } from '@renderer/modules/chat/MainAgentPage';
import { NEW_PROJECT_SESSION_EVENT } from '@renderer/modules/project/ProjectWorkspacePage';
import kianLogo from '@renderer/assets/kian-logo.png';
import { Input, Layout, Menu, Tooltip, Typography, message } from 'antd';
import { CompactDropdown } from '@renderer/components/CompactDropdown';
import { Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
import { DEFAULT_SHORTCUT_CONFIG } from '@shared/utils/shortcuts';

const { Sider, Header, Content } = Layout;
const GUIDE_SEEN_STORAGE_KEY = 'kian.guide.seen.v1';
const PROJECT_MODULE_ITEMS: Array<{ key: ModuleType; label: string }> = [
  { key: 'docs', label: '文档' },
  { key: 'creation', label: '音视频创作' },
  { key: 'assets', label: '素材' },
  { key: 'app', label: '应用' }
];

const resolveProjectModule = (value: string | null): ModuleType => {
  if (value === 'creation' || value === 'assets' || value === 'docs' || value === 'app') {
    return value;
  }
  return 'docs';
};

export const MainLayout = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const hasHandledStartupDefaultRoute = useRef(false);
  const pendingMainAgentInputFocusRef = useRef(false);
  const pendingMainAgentSessionCreationRef = useRef(false);
  const agentProjectMatch = useMatch('/agent/:projectId');
  const legacyProjectMatch = useMatch('/project/:projectId');
  const projectMatch = agentProjectMatch ?? legacyProjectMatch;
  const projectId = projectMatch?.params.projectId ?? '';
  const [isTitleEditing, setIsTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [headerActions, setHeaderActions] = useState<ReactNode | null>(null);
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatusDTO | null>(null);
  const isHomePage = location.pathname === '/';
  const isProjectPage = Boolean(projectMatch);
  const isTasksPage = location.pathname.startsWith('/tasks');
  const isCronjobsPage = location.pathname.startsWith('/cronjobs');
  const isGuidePage = location.pathname.startsWith('/guide');
  const isMcpPage = location.pathname.startsWith('/mcp');
  const isMainAgentPage = location.pathname.startsWith('/main-agent');
  const headerTitle = isHomePage
    ? '智能体'
    : location.pathname.startsWith('/settings')
      ? '设置'
      : isMcpPage
      ? 'MCP 服务'
      : isMainAgentPage
        ? 'Kian'
      : isTasksPage
        ? '后台任务'
      : isCronjobsPage
        ? '定时任务'
      : location.pathname.startsWith('/skills')
        ? '技能'
        : 'Kian';
  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.project.getById(projectId),
    enabled: isProjectPage && Boolean(projectId)
  });
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: api.project.list,
    enabled: isProjectPage
  });
  const shortcutConfigQuery = useQuery({
    queryKey: ['settings', 'shortcuts'],
    queryFn: api.settings.getShortcutConfig
  });
  const generalConfigQuery = useQuery({
    queryKey: ['settings', 'general'],
    queryFn: api.settings.getGeneralConfig
  });
  const shortcutConfig = shortcutConfigQuery.data ?? DEFAULT_SHORTCUT_CONFIG;

  const selectedKey = location.pathname.startsWith('/settings')
    ? '/settings'
    : isMainAgentPage
      ? '/main-agent'
    : isTasksPage
      ? '/tasks'
    : isCronjobsPage
      ? '/cronjobs'
    : isGuidePage
      ? '/guide'
    : isMcpPage
      ? '/mcp'
    : location.pathname.startsWith('/skills')
      ? '/skills'
      : '/';
  const isProjectsEntrySelected = selectedKey === '/';
  const isTasksEntrySelected = selectedKey === '/tasks';
  const isCronjobsEntrySelected = selectedKey === '/cronjobs';
  const isGuideEntrySelected = selectedKey === '/guide';
  const isMcpEntrySelected = selectedKey === '/mcp';
  const isSkillsEntrySelected = selectedKey === '/skills';
  const isSettingsEntrySelected = selectedKey === '/settings';
  const isMainAgentEntrySelected = selectedKey === '/main-agent';
  const project = useMemo(
    () =>
      projectQuery.data ??
      (projectsQuery.data ?? []).find((item) => item.id === projectId),
    [projectId, projectQuery.data, projectsQuery.data]
  );
  const activeProjectModule = useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    return resolveProjectModule(searchParams.get('module'));
  }, [location.search]);
  const updateProjectMutation = useMutation({
    mutationFn: (payload: { id: string; name: string }) => api.project.update(payload)
  });
  const persistGeneralConfig = useCallback(
    async (overrides: Partial<Awaited<ReturnType<typeof api.settings.getGeneralConfig>>>) => {
      const currentConfig =
        generalConfigQuery.data ?? (await api.settings.getGeneralConfig());
      const nextConfig = {
        ...currentConfig,
        ...overrides,
        mainSubModeEnabled: true
      };
      await api.settings.saveGeneralConfig(nextConfig);
      queryClient.setQueryData(['settings', 'general'], nextConfig);
      return nextConfig;
    },
    [generalConfigQuery.data, queryClient]
  );

  useEffect(() => {
    if (!isTitleEditing) {
      setTitleDraft(project?.name ?? '');
    }
  }, [isTitleEditing, project?.name]);

  useEffect(
    () =>
      api.appOperation.subscribe((event) => {
        if (event.type !== 'navigate') return;

        const searchParams = new URLSearchParams();
        if (event.module) {
          searchParams.set('module', event.module);
        }
        if (event.documentId) {
          searchParams.set('doc', event.documentId);
        }

        const search = searchParams.toString();
        navigate(
          {
            pathname: `/agent/${event.projectId}`,
            search: search ? `?${search}` : ''
          },
          { replace: true }
        );
      }),
    [navigate]
  );

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if (!matchesKeyboardShortcut(event, shortcutConfig.focusMainAgentInput)) {
        return;
      }

      event.preventDefault();
      if (isMainAgentPage) {
        window.dispatchEvent(new Event(MAIN_AGENT_INPUT_FOCUS_EVENT));
        return;
      }

      pendingMainAgentInputFocusRef.current = true;
      navigate('/main-agent');
    };

    window.addEventListener('keydown', handleShortcut);
    return () => {
      window.removeEventListener('keydown', handleShortcut);
    };
  }, [isMainAgentPage, navigate, shortcutConfig.focusMainAgentInput]);

  useEffect(() => {
    const unsubscribe = api.window.subscribeFocusMainAgentShortcut(() => {
      if (isMainAgentPage) {
        window.dispatchEvent(new Event(MAIN_AGENT_INPUT_FOCUS_EVENT));
        return;
      }

      pendingMainAgentInputFocusRef.current = true;
      navigate('/main-agent');
    });

    return unsubscribe;
  }, [isMainAgentPage, navigate]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if (!matchesKeyboardShortcut(event, shortcutConfig.openSettingsPage)) {
        return;
      }

      event.preventDefault();
      navigate('/settings');
    };

    window.addEventListener('keydown', handleShortcut);
    return () => {
      window.removeEventListener('keydown', handleShortcut);
    };
  }, [navigate, shortcutConfig.openSettingsPage]);

  // Configurable shortcut: create new chat session
  useEffect(() => {
    const handleNewSession = (event: KeyboardEvent): void => {
      if (!matchesKeyboardShortcut(event, shortcutConfig.newChatSession)) {
        return;
      }
      event.preventDefault();
      if (isProjectPage) {
        window.dispatchEvent(new Event(NEW_PROJECT_SESSION_EVENT));
      } else if (isMainAgentPage) {
        window.dispatchEvent(new Event(NEW_CURRENT_AGENT_SESSION_EVENT));
        window.requestAnimationFrame(() => {
          window.dispatchEvent(new Event(MAIN_AGENT_INPUT_FOCUS_EVENT));
        });
      } else {
        pendingMainAgentSessionCreationRef.current = true;
        pendingMainAgentInputFocusRef.current = true;
        navigate('/main-agent');
      }
    };

    window.addEventListener('keydown', handleNewSession);
    return () => {
      window.removeEventListener('keydown', handleNewSession);
    };
  }, [isMainAgentPage, isProjectPage, navigate, shortcutConfig.newChatSession]);

  useEffect(() => {
    if (
      !isMainAgentPage ||
      (!pendingMainAgentInputFocusRef.current &&
        !pendingMainAgentSessionCreationRef.current)
    ) {
      return;
    }

    const shouldFocusInput = pendingMainAgentInputFocusRef.current;
    const shouldCreateSession = pendingMainAgentSessionCreationRef.current;
    pendingMainAgentInputFocusRef.current = false;
    pendingMainAgentSessionCreationRef.current = false;
    const frameId = window.requestAnimationFrame(() => {
      if (shouldCreateSession) {
        window.dispatchEvent(new Event(NEW_CURRENT_AGENT_SESSION_EVENT));
      }
      if (shouldFocusInput) {
        window.dispatchEvent(new Event(MAIN_AGENT_INPUT_FOCUS_EVENT));
      }
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isMainAgentPage]);

  useEffect(() => {
    if (hasHandledStartupDefaultRoute.current) return;
    if (location.pathname !== '/') return;
    if (!generalConfigQuery.data) return;

    hasHandledStartupDefaultRoute.current = true;
    let cancelled = false;

    const handleStartupDefaultRoute = async (): Promise<void> => {
      let legacyGuideDismissed = false;
      try {
        legacyGuideDismissed = window.localStorage.getItem(GUIDE_SEEN_STORAGE_KEY) === '1';
      } catch {
        legacyGuideDismissed = false;
      }

      if (generalConfigQuery.data.quickGuideDismissed || legacyGuideDismissed) {
        if (legacyGuideDismissed && !generalConfigQuery.data.quickGuideDismissed) {
          try {
            await persistGeneralConfig({ quickGuideDismissed: true });
          } catch {
            // Ignore migration failures and continue routing.
          }
        }
        if (!cancelled) {
          navigate('/main-agent', { replace: true });
        }
        return;
      }

      try {
        await persistGeneralConfig({ quickGuideDismissed: true });
      } catch {
        // Ignore persistence failures and continue routing.
      }
      if (!cancelled) {
        navigate('/guide', { replace: true });
      }
    };

    void handleStartupDefaultRoute();

    return () => {
      cancelled = true;
    };
  }, [generalConfigQuery.data, location.pathname, navigate, persistGeneralConfig]);

  useEffect(() => {
    if (!location.pathname.startsWith('/settings') && !location.pathname.startsWith('/mcp')) {
      setHeaderActions(null);
    }
  }, [location.pathname]);

  useEffect(() => {
    let disposed = false;
    api.update
      .getStatus()
      .then((status) => {
        if (disposed) return;
        setUpdateStatus(status);
      })
      .catch(() => undefined);

    const unsubscribe = api.update.subscribeStatus((status) => {
      if (disposed) return;
      setUpdateStatus(status);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const handleInstallDownloadedUpdate = useCallback(() => {
    void api.update.quitAndInstall().catch((error) => {
      message.error(error instanceof Error ? error.message : '安装更新失败');
    });
  }, []);

  const isUpdateReady = updateStatus?.stage === 'downloaded';

  const startTitleEditing = useCallback(() => {
    if (!project?.id || updateProjectMutation.isPending) return;
    setTitleDraft(project.name);
    setIsTitleEditing(true);
  }, [project?.id, project?.name, updateProjectMutation.isPending]);

  const cancelTitleEditing = useCallback(() => {
    setTitleDraft(project?.name ?? '');
    setIsTitleEditing(false);
  }, [project?.name]);

  const saveTitleOnBlur = useCallback(async () => {
    if (!project?.id) {
      setIsTitleEditing(false);
      return;
    }

    const nextName = titleDraft.trim();
    if (!nextName || nextName === project.name) {
      setTitleDraft(project.name);
      setIsTitleEditing(false);
      return;
    }

    try {
      const updatedProject = await updateProjectMutation.mutateAsync({
        id: project.id,
        name: nextName
      });

      setTitleDraft(updatedProject.name);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['project'] }),
        queryClient.invalidateQueries({ queryKey: ['settings', 'chat-channel'] })
      ]);

      if (updatedProject.id !== projectId) {
        navigate(`/agent/${updatedProject.id}`, { replace: true });
      }
    } catch (error) {
      setTitleDraft(project.name);
      message.error(error instanceof Error ? error.message : 'Agent 名称保存失败');
    } finally {
      setIsTitleEditing(false);
    }
  }, [
    navigate,
    project?.id,
    project?.name,
    projectId,
    queryClient,
    titleDraft,
    updateProjectMutation
  ]);

  const switchProjectModule = useCallback(
    (module: ModuleType) => {
      if (!isProjectPage) return;
      const searchParams = new URLSearchParams(location.search);
      searchParams.set('module', module);
      navigate(
        {
          pathname: location.pathname,
          search: `?${searchParams.toString()}`
        },
        { replace: true }
      );
    },
    [isProjectPage, location.pathname, location.search, navigate]
  );

  const switchProjectByDropdown = useCallback(
    (nextProjectId: string) => {
      if (!isProjectPage || !nextProjectId || nextProjectId === projectId) return;
      const searchParams = new URLSearchParams(location.search);
      searchParams.delete('doc');
      const search = searchParams.toString();
      navigate({
        pathname: `/agent/${nextProjectId}`,
        search: search ? `?${search}` : ''
      });
    },
    [isProjectPage, location.search, navigate, projectId]
  );

  return (
    <Layout className="h-full min-h-0 !bg-[#f4f7fc]">
      <Sider
        width={76}
        className="drag-region relative z-20 !bg-[#f8fafd] border-r border-[#e3e8f2] !min-w-[76px] !max-w-[76px]"
        onDoubleClick={toggleWindowMaximizeFromChrome}
      >
        <div className="flex h-full w-full flex-col items-center py-4 pt-12">
          <button
            type="button"
            onClick={() => navigate('/main-agent')}
            className="no-drag mb-6 rounded-xl transition-transform hover:scale-[1.02]"
            aria-label="打开主智能体"
          >
            <img src={kianLogo} alt="Kian logo" className="h-11 w-11 rounded-xl object-cover" />
          </button>
          <Menu
            mode="inline"
            selectedKeys={selectedKey === '/settings' ? [] : [selectedKey]}
            className="sidebar-menu no-drag w-[58px] border-none bg-transparent"
            items={[
              {
                key: '/main-agent',
                icon: <StarFilled style={{ color: isMainAgentEntrySelected ? '#d4a017' : '#b8c4da' }} />,
                label: ''
              },
              {
                key: '/',
                icon: isProjectsEntrySelected ? <RobotFilled /> : <RobotOutlined />,
                label: ''
              },
              {
                key: '/skills',
                icon: isSkillsEntrySelected ? <AppstoreFilled /> : <AppstoreOutlined />,
                label: ''
              },
              {
                key: '/mcp',
                icon: isMcpEntrySelected ? <ApiFilled /> : <ApiOutlined />,
                label: ''
              },
              {
                key: '/tasks',
                icon: isTasksEntrySelected ? <CheckSquareFilled /> : <CheckSquareOutlined />,
                label: ''
              },
              {
                key: '/cronjobs',
                icon: isCronjobsEntrySelected ? <CalendarFilled /> : <CalendarOutlined />,
                label: ''
              }
            ]}
            onClick={(info) => {
              navigate(String(info.key));
            }}
          />
          <div className="mt-auto flex w-full flex-col items-center">
            {isUpdateReady ? (
              <Tooltip title="重启升级到新版本" placement="right">
                <div className="upgrade-ready-badge no-drag">
                  <button
                    type="button"
                    onClick={handleInstallDownloadedUpdate}
                    className="upgrade-ready-badge__button"
                    aria-label="重启升级到新版本"
                  >
                    <ArrowUpOutlined />
                  </button>
                  <span className="upgrade-ready-badge__tag">新版本</span>
                </div>
              </Tooltip>
            ) : null}
            <Menu
              mode="inline"
              selectedKeys={selectedKey === '/settings' || selectedKey === '/guide' ? [selectedKey] : []}
              className="sidebar-menu no-drag w-[58px] border-none bg-transparent"
              items={[
                {
                  key: '/guide',
                  icon: isGuideEntrySelected ? <CompassFilled /> : <CompassOutlined />,
                  label: ''
                },
                {
                  key: '/settings',
                  icon: isSettingsEntrySelected ? <SettingFilled /> : <SettingOutlined />,
                  label: ''
                }
              ]}
              onClick={(info) => {
                navigate(String(info.key));
              }}
            />
          </div>
        </div>
      </Sider>
      <Layout className="h-full min-h-0 !bg-[#f4f7fc]">
        {isMainAgentPage ? null : (
          <Header
            className="drag-region !h-[88px] !bg-transparent px-5"
            onDoubleClick={toggleWindowMaximizeFromChrome}
          >
            <div className="flex h-full items-center justify-between">
              {isProjectPage ? (
                <div className="no-drag flex min-w-0 items-center gap-3">
                  <div className="min-w-0">
                    {isTitleEditing ? (
                      <Input
                        autoFocus
                        value={titleDraft}
                        maxLength={100}
                        className="w-[min(640px,60vw)] !rounded-none !border-0 !border-b !border-dashed !border-[#bed0ee] !bg-transparent !px-0 !shadow-none hover:!border-[#96b0de] focus:!border-[#2f6ff7]"
                        onChange={(event) => setTitleDraft(event.target.value)}
                        onBlur={() => {
                          void saveTitleOnBlur();
                        }}
                        onPressEnter={(event) => event.currentTarget.blur()}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            cancelTitleEditing();
                          }
                        }}
                        disabled={updateProjectMutation.isPending}
                      />
                    ) : (
                      <CompactDropdown
                        trigger={['click']}
                        disabled={projectsQuery.isLoading}
                        overlayStyle={{ minWidth: 210 }}
                        menu={{
                          selectable: true,
                          selectedKeys: project?.id ? [project.id] : [],
                          items: (projectsQuery.data ?? []).map((item) => ({
                            key: item.id,
                            label: (
                              <div className="flex items-center justify-between gap-3">
                                <span className="max-w-[340px] truncate">{item.name}</span>
                                {item.id === project?.id ? (
                                  <CheckOutlined className="shrink-0 text-[#2f6ff7]" />
                                ) : null}
                              </div>
                            )
                          })),
                          onClick: (info: { key: string }) => {
                            switchProjectByDropdown(info.key);
                          }
                        }}
                      >
                        <button
                          type="button"
                          className="no-drag flex max-w-[min(640px,60vw)] items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-[#eef3fc]"
                          onDoubleClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            startTitleEditing();
                          }}
                        >
                          <Typography.Title level={3} className="!mb-0 !truncate !text-slate-900">
                            {project?.name ?? 'Agent'}
                          </Typography.Title>
                          <DownOutlined className="text-xs text-slate-500" />
                        </button>
                      </CompactDropdown>
                    )}
                  </div>
                </div>
              ) : (
                !isGuidePage ? (
                  <Typography.Title level={3} className="!mb-0 !text-slate-900">
                    {headerTitle}
                  </Typography.Title>
                ) : null
              )}
              {isProjectPage ? (
                <div className="no-drag flex items-center gap-2 rounded-full border border-[#dce5f4] bg-white/90 p-1 shadow-[0_4px_16px_rgba(15,23,42,0.05)]">
                  {PROJECT_MODULE_ITEMS.map((item) => {
                    const active = activeProjectModule === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        aria-current={active ? 'page' : undefined}
                        onClick={() => switchProjectModule(item.key)}
                        className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                          active
                            ? 'bg-[#2f6ff7] text-white shadow-[0_6px_12px_rgba(47,111,247,0.32)]'
                            : 'text-slate-600 hover:bg-[#eef3fc] hover:text-slate-900'
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              ) : isCronjobsPage ? (
                <Typography.Text className="!inline-flex !items-center !gap-1 !text-[12px] !text-slate-500">
                  <InfoCircleOutlined className="!text-[12px]" />
                  点击卡片可切换状态
                </Typography.Text>
              ) : isTasksPage ? (
                <Typography.Text className="!inline-flex !items-center !gap-1 !text-[12px] !text-slate-500">
                  <InfoCircleOutlined className="!text-[12px]" />
                  点击任务可查看 stdout.log
                </Typography.Text>
              ) : headerActions ? (
                <div className="no-drag flex items-center">{headerActions}</div>
              ) : null}
            </div>
          </Header>
        )}
        <Content className="flex-1 min-h-0 overflow-hidden">
          <div className="h-full min-h-0">
            <Outlet context={{ setHeaderActions }} />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
};

export interface MainLayoutOutletContext {
  setHeaderActions: (actions: ReactNode | null) => void;
}
