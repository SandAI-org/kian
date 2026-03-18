import { ScrollArea } from '@renderer/components/ScrollArea';
import { useAppI18n } from '@renderer/i18n/AppI18nProvider';
import { translateUiText } from '@renderer/i18n/uiTranslations';
import { api } from '@renderer/lib/api';
import type { CronJobDTO } from '@shared/types';
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

const resolveStatusTag = (status: string) => {
  const normalized = status.trim().toLowerCase();
  if (ACTIVE_STATUS.has(normalized)) {
    return (
      <Tag color="green" className="!m-0">
        运行中
      </Tag>
    );
  }
  if (PAUSED_STATUS.has(normalized)) {
    return (
      <Tag color="default" className="!m-0">
        已暂停
      </Tag>
    );
  }
  return (
    <Tag color="blue" className="!m-0">
      {status || '未知状态'}
    </Tag>
  );
};

const resolveTargetAgentLabel = (job: CronJobDTO): string =>
  job.targetAgentName?.trim() || job.targetAgentId?.trim() || '主 Agent';

export const CronjobPage = () => {
  const { language } = useAppI18n();
  const t = (value: string): string => translateUiText(language, value);
  const queryClient = useQueryClient();
  const cronjobQuery = useQuery({
    queryKey: ['cronjobs'],
    queryFn: api.cronjob.list,
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
            暂无定时任务
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
                        执行时间：{job.timeSummary || '--'}
                      </Typography.Text>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Tag color="cyan" className="!m-0">
                        {resolveTargetAgentLabel(job)}
                      </Tag>
                      <Tag color="geekblue" className="!m-0">
                        {job.cron || '--'}
                      </Tag>
                      {resolveStatusTag(job.status)}
                    </div>
                  </div>
                  <Typography.Paragraph
                    className="!mb-0 !text-[13px] !text-slate-600"
                    ellipsis={{ rows: 4, expandable: true, symbol: '展开' }}
                  >
                    {job.content || '--'}
                  </Typography.Paragraph>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </ScrollArea>
  );
};
