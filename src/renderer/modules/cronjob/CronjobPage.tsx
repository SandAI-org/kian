import { ScrollArea } from '@renderer/components/ScrollArea';
import { useAppI18n } from '@renderer/i18n/AppI18nProvider';
import { api } from '@renderer/lib/api';
import type { CronJobDTO, CronJobExecutionStatus } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Spin, Tag, Typography, message } from 'antd';
import { IllustrationEmptyCronjob } from '@renderer/components/EmptyIllustrations';
import type { MouseEvent } from 'react';

const ACTIVE_STATUS = new Set(['active', 'enabled', 'running', 'on', '开启', '启用', '运行中']);
const PAUSED_STATUS = new Set(['paused', 'disabled', 'off', '暂停', '已暂停']);

const isActiveStatus = (status: string): boolean => ACTIVE_STATUS.has(status.trim().toLowerCase());

const resolveNextStatus = (status: string): 'active' | 'paused' => (isActiveStatus(status) ? 'paused' : 'active');

const shouldSkipCardToggle = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(target.closest('a,button,input,textarea,select,label,.ant-typography-expand'));
};

const resolveStatusTag = (status: string, t: (value: string) => string) => {
  const normalized = status.trim().toLowerCase();
  if (ACTIVE_STATUS.has(normalized)) {
    return (
      <Tag color="green" className="!m-0">
        {t('运行中')}
      </Tag>
    );
  }
  if (PAUSED_STATUS.has(normalized)) {
    return (
      <Tag color="default" className="!m-0">
        {t('已暂停')}
      </Tag>
    );
  }
  return (
    <Tag color="blue" className="!m-0">
      {status ? t(status) : t('未知状态')}
    </Tag>
  );
};

const resolveTargetAgentLabel = (job: CronJobDTO, t: (value: string) => string): string =>
  job.targetAgentName?.trim() || job.targetAgentId?.trim() || t('主 Agent');

const formatExecutionTime = (value: string, language: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(language, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

const resolveExecutionStatusTag = (
  status: CronJobExecutionStatus,
  t: (value: string) => string
) => {
  if (status === 'failed') {
    return (
      <Tag color="red" className="!m-0">
        {t('执行失败')}
      </Tag>
    );
  }
  if (status === 'skipped') {
    return (
      <Tag color="default" className="!m-0">
        {t('已跳过')}
      </Tag>
    );
  }
  return (
    <Tag color="green" className="!m-0">
      {t('已执行')}
    </Tag>
  );
};

export const CronjobPage = () => {
  const { language, t } = useAppI18n();
  const queryClient = useQueryClient();
  const cronjobQuery = useQuery({
    queryKey: ['cronjobs'],
    queryFn: api.cronjob.listWithLastExecution,
    refetchInterval: 5000
  });
  const toggleStatusMutation = useMutation({
    mutationFn: async (job: CronJobDTO) =>
      api.cronjob.setStatus({
        id: job.id,
        status: resolveNextStatus(job.status)
      }),
    onMutate: async (job) => {
      await queryClient.cancelQueries({ queryKey: ['cronjobs'] });
      const previousJobs = queryClient.getQueryData<CronJobDTO[]>(['cronjobs']);
      if (previousJobs) {
        queryClient.setQueryData<CronJobDTO[]>(
          ['cronjobs'],
          previousJobs.map((item) =>
            item.id === job.id
              ? {
                  ...item,
                  status: resolveNextStatus(item.status)
                }
              : item
          )
        );
      }
      return { previousJobs };
    },
    onError: (_error, _job, context) => {
      if (context?.previousJobs) {
        queryClient.setQueryData(['cronjobs'], context.previousJobs);
      }
      void message.error(t('切换状态失败'));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['cronjobs'] });
    }
  });

  const jobs = cronjobQuery.data ?? [];
  const pendingJobId = toggleStatusMutation.isPending ? toggleStatusMutation.variables?.id : '';

  const handleCardClick = (job: CronJobDTO, event: MouseEvent<HTMLDivElement>) => {
    if (shouldSkipCardToggle(event.target) || toggleStatusMutation.isPending) {
      return;
    }
    toggleStatusMutation.mutate(job);
  };

  if (cronjobQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spin />
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      {jobs.length === 0 ? (
        <div className="flex h-[60vh] flex-col items-center justify-center gap-2">
          <IllustrationEmptyCronjob size={88} />
          <Typography.Text className="!text-sm !text-slate-400">
            {t('暂无定时任务')}
          </Typography.Text>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 px-5 pb-5 md:grid-cols-3">
          {jobs.map((job) => {
            const isToggling = pendingJobId === job.id;
            return (
              <Card
                key={job.id}
                hoverable
                className={`panel !rounded-[16px] !border-[#dde6f5] !bg-[#ffffff] transition ${
                  isToggling ? 'cursor-wait opacity-70' : 'cursor-pointer'
                }`}
                onClick={(event) => handleCardClick(job, event)}
              >
                <div className="flex h-full flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Typography.Text className="!text-sm !font-medium !text-slate-800">
                        {t(`执行时间：${job.timeSummary || '--'}`)}
                      </Typography.Text>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Tag color="cyan" className="!m-0">
                        {resolveTargetAgentLabel(job, t)}
                      </Tag>
                      <Tag color="geekblue" className="!m-0">
                        {job.cron || '--'}
                      </Tag>
                      {resolveStatusTag(job.status, t)}
                    </div>
                  </div>
                  <Typography.Paragraph
                    className="!mb-0 !text-[13px] !text-slate-600"
                    ellipsis={{ rows: 4, expandable: true, symbol: t('展开') }}
                  >
                    {job.content || '--'}
                  </Typography.Paragraph>
                  {job.lastExecution ? (
                    <div className="flex flex-col gap-1 rounded-md bg-slate-50 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Typography.Text className="!text-xs !text-slate-500">
                          {t('最近执行：')}
                          {formatExecutionTime(job.lastExecution.executedAt, language)}
                        </Typography.Text>
                        {resolveExecutionStatusTag(job.lastExecution.status, t)}
                      </div>
                      {job.lastExecution.error ? (
                        <Typography.Text className="!text-xs" type="danger">
                          {t('错误：')}
                          {job.lastExecution.error}
                        </Typography.Text>
                      ) : job.lastExecution.assistantMessage ? (
                        <Typography.Paragraph
                          className="!mb-0 !text-xs !text-slate-500"
                          ellipsis={{ rows: 2, expandable: true, symbol: t('展开') }}
                        >
                          {t('最近反馈：')}
                          {job.lastExecution.assistantMessage}
                        </Typography.Paragraph>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </ScrollArea>
  );
};
