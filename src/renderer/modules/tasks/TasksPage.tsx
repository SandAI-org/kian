import { PlayCircleOutlined, StopOutlined, DeleteOutlined } from '@ant-design/icons';
import { ScrollArea } from '@renderer/components/ScrollArea';
import { useAppI18n } from '@renderer/i18n/AppI18nProvider';
import { translateUiText } from '@renderer/i18n/uiTranslations';
import { api } from '@renderer/lib/api';
import type { TaskDTO } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Spin, Tag, Typography, message } from 'antd';
import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

const resolveStatusTag = (status: TaskDTO['status']) => {
  if (status === 'running') {
    return <Tag color="green">运行中</Tag>;
  }
  if (status === 'success') {
    return <Tag color="blue">已完成</Tag>;
  }
  return <Tag>已停止</Tag>;
};

const summarizeCommand = (command: string): string => {
  const normalized = command.trim().replace(/\s+/g, ' ');
  if (!normalized) return '--';
  return normalized.length > 90 ? `${normalized.slice(0, 87)}...` : normalized;
};

const TaskEmptyIllustration = ({ variant }: { variant: 'list' | 'detail' }) => {
  if (variant === 'list') {
    return (
      <svg width="172" height="126" viewBox="0 0 172 126" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="12" y="18" width="148" height="96" rx="16" fill="#F4F8FF" stroke="#D7E3F8" />
        <rect x="27" y="34" width="118" height="20" rx="8" fill="#E8F0FF" />
        <rect x="36" y="40" width="11" height="11" rx="3" fill="#2F6FF7" fillOpacity="0.2" />
        <rect x="53" y="41" width="70" height="8" rx="4" fill="#9AB5E7" />
        <rect x="27" y="59" width="118" height="20" rx="8" fill="#E8F0FF" />
        <rect x="36" y="65" width="11" height="11" rx="3" fill="#2F6FF7" fillOpacity="0.2" />
        <rect x="53" y="66" width="84" height="8" rx="4" fill="#9AB5E7" />
        <rect x="27" y="84" width="118" height="20" rx="8" fill="#E8F0FF" />
        <rect x="36" y="90" width="11" height="11" rx="3" fill="#2F6FF7" fillOpacity="0.2" />
        <rect x="53" y="91" width="62" height="8" rx="4" fill="#9AB5E7" />
        <rect x="126" y="6" width="34" height="34" rx="11" fill="#2F6FF7" />
        <path d="M143 15v16M135 23h16" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg width="208" height="140" viewBox="0 0 208 140" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="16" y="18" width="176" height="108" rx="16" fill="#F6F9FF" stroke="#D7E3F8" />
      <rect x="16" y="18" width="176" height="20" rx="16" fill="#EAF1FF" />
      <circle cx="30" cy="28" r="3" fill="#A9BDE8" />
      <circle cx="41" cy="28" r="3" fill="#A9BDE8" />
      <circle cx="52" cy="28" r="3" fill="#A9BDE8" />
      <rect x="30" y="48" width="148" height="12" rx="6" fill="#E5EEFF" />
      <rect x="30" y="65" width="116" height="10" rx="5" fill="#C7D9FA" />
      <rect x="30" y="80" width="132" height="10" rx="5" fill="#D3E1FB" />
      <rect x="30" y="95" width="86" height="10" rx="5" fill="#DFE9FC" />
      <rect x="144" y="88" width="44" height="34" rx="10" fill="#2F6FF7" />
      <path
        d="M157.5 98.5l6 5.5 11-10.5"
        stroke="white"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

const TaskEmptyState = ({
  variant,
  title,
  hint
}: {
  variant: 'list' | 'detail';
  title: string;
  hint: string;
}) => {
  return (
    <div className={`task-empty task-empty--${variant}`}>
      <div className="task-empty__glow task-empty__glow--one" />
      <div className="task-empty__glow task-empty__glow--two" />
      <div className="task-empty__icon">
        <TaskEmptyIllustration variant={variant} />
      </div>
      <div className="task-empty__text">
        <p className="task-empty__title">{title}</p>
        <p className="task-empty__hint">{hint}</p>
      </div>
    </div>
  );
};

export const TasksPage = () => {
  const { language } = useAppI18n();
  const t = (value: string): string => translateUiText(language, value);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTaskId = searchParams.get('task') ?? '';
  const tasksQuery = useQuery({
    queryKey: ['tasks'],
    queryFn: api.task.list,
    refetchInterval: 3000
  });

  const tasks = tasksQuery.data ?? [];

  useEffect(() => {
    if (tasks.length === 0) return;
    if (selectedTaskId && tasks.some((task) => task.id === selectedTaskId)) return;
    setSearchParams({ task: tasks[0].id }, { replace: true });
  }, [selectedTaskId, setSearchParams, tasks]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks]
  );

  const taskDetailQuery = useQuery({
    queryKey: ['task', selectedTaskId],
    queryFn: () => api.task.view(selectedTaskId),
    enabled: Boolean(selectedTaskId),
    refetchInterval: 2000
  });

  const startMutation = useMutation({
    mutationFn: (taskId: string) => api.task.start(taskId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['task', selectedTaskId] })
      ]);
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : t('启动任务失败'));
    }
  });

  const stopMutation = useMutation({
    mutationFn: (taskId: string) => api.task.stop(taskId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['task', selectedTaskId] })
      ]);
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : t('停止任务失败'));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => api.task.delete(taskId),
    onSuccess: async (_deleted, taskId) => {
      if (taskId === selectedTaskId) {
        setSearchParams({}, { replace: true });
      }
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : t('删除任务失败'));
    }
  });

  if (tasksQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spin />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 gap-4 px-5 pb-5">
      <div className="h-full w-[320px] shrink-0 overflow-hidden rounded-[16px] border border-[#dde6f5] bg-white">
        {tasks.length === 0 ? (
          <TaskEmptyState
            variant="list"
            title="还没有任务"
            hint="在聊天里触发命令执行后，任务会自动出现在这里"
          />
        ) : (
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-2 p-3">
              {tasks.map((task) => {
                const active = selectedTaskId === task.id;
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => setSearchParams({ task: task.id }, { replace: true })}
                    className={`rounded-xl border px-3 py-2 text-left transition ${
                      active
                        ? 'border-[#2f6ff7] bg-[#eef4ff]'
                        : 'border-[#e5ebf7] bg-white hover:border-[#c9d9f5] hover:bg-[#f7faff]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Typography.Text className="!max-w-[180px] !truncate !font-medium !text-slate-800">
                        {task.name}
                      </Typography.Text>
                      {resolveStatusTag(task.status)}
                    </div>
                    <Typography.Paragraph className="!mb-0 !mt-1 !text-xs !text-slate-500" ellipsis={{ rows: 2 }}>
                      {summarizeCommand(task.command)}
                    </Typography.Paragraph>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>

      <div className="min-w-0 flex-1 min-h-0">
        {!selectedTask ? (
          <div className="flex h-full min-h-[320px] items-center justify-center rounded-[16px] border border-[#dde6f5] bg-white">
            <TaskEmptyState
              variant="detail"
              title={tasks.length === 0 ? '暂无任务详情' : '选择任务查看日志'}
              hint={
                tasks.length === 0
                  ? '创建并启动任务后，这里会展示运行状态与 stdout.log'
                  : '从左侧选择一个任务，这里会实时显示执行输出'
              }
            />
          </div>
        ) : taskDetailQuery.isLoading ? (
          <div className="flex h-full items-center justify-center rounded-[16px] border border-[#dde6f5] bg-white">
            <Spin />
          </div>
        ) : taskDetailQuery.data ? (
          <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="shrink-0 overflow-hidden rounded-[16px] border border-[#dde6f5] bg-white">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <Typography.Title level={5} className="!mb-0 !truncate !text-slate-900">
                    {taskDetailQuery.data.name}
                  </Typography.Title>
                  <Typography.Text className="!text-xs !text-slate-500">
                    {taskDetailQuery.data.id} · PID {taskDetailQuery.data.pid ?? '--'}
                  </Typography.Text>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    icon={<PlayCircleOutlined />}
                    size="small"
                    disabled={startMutation.isPending || taskDetailQuery.data.status === 'running'}
                    onClick={() => startMutation.mutate(taskDetailQuery.data.id)}
                  >
                    启动
                  </Button>
                  <Button
                    icon={<StopOutlined />}
                    size="small"
                    disabled={stopMutation.isPending || taskDetailQuery.data.status !== 'running'}
                    onClick={() => stopMutation.mutate(taskDetailQuery.data.id)}
                  >
                    停止
                  </Button>
                  <Button
                    icon={<DeleteOutlined />}
                    size="small"
                    danger
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(taskDetailQuery.data.id)}
                  >
                    删除
                  </Button>
                </div>
              </div>
              <div className="border-t border-[#eef2fb] px-4 py-2 text-xs text-slate-500">
                命令：{taskDetailQuery.data.command || '--'}
              </div>
            </div>

            <div className="min-h-0 flex flex-1 flex-col overflow-hidden rounded-[16px] border border-[#dde6f5] bg-[#0f172a]">
              <div className="border-b border-slate-700/80 px-4 py-2 text-xs text-slate-400">stdout.log</div>
              <div className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  <pre className="m-0 whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5 text-slate-200">
                    {taskDetailQuery.data.stdout || '暂无输出'}
                  </pre>
                </ScrollArea>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-[320px] items-center justify-center rounded-[16px] border border-[#dde6f5] bg-white">
            <TaskEmptyState variant="detail" title="任务详情加载失败" hint="请刷新后重试，或检查任务是否已被删除" />
          </div>
        )}
      </div>
    </div>
  );
};
