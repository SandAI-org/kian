import { randomUUID } from 'node:crypto';
import type { ChatModuleType, ChatScope, CronJobDTO } from '@shared/types';
import { chatChannelService } from './chatChannelService';
import { chatService } from './chatService';
import { logger } from './logger';
import { repositoryService } from './repositoryService';

const POLL_INTERVAL_MS = 15_000;
const CRON_FIELD_COUNT = 5;
const MAIN_AGENT_ID = 'main-agent';
const MAIN_AGENT_NAME = '主 Agent';
const DEFAULT_PROJECT_MODULE: ChatModuleType = 'docs';
const DEFAULT_MAIN_MODULE: ChatModuleType = 'main';

const ACTIVE_STATUS = new Set(['active', 'enabled', 'running', 'on', '开启', '启用', '运行中']);

interface CronFieldRule {
  min: number;
  max: number;
  parseMax?: number;
  normalize?: (value: number) => number;
}

interface CronJobDispatchResult {
  status: 'dispatched' | 'skipped';
  reason?: 'empty_content';
  projectId: string | null;
  projectName: string | null;
  sessionId: string | null;
}

interface CronJobTargetContext {
  scope: ChatScope;
  defaultModule: ChatModuleType;
  projectId: string;
  projectName: string;
}

const CRON_MINUTE_RULE: CronFieldRule = {
  min: 0,
  max: 59
};

const CRON_HOUR_RULE: CronFieldRule = {
  min: 0,
  max: 23
};

const CRON_DAY_OF_MONTH_RULE: CronFieldRule = {
  min: 1,
  max: 31
};

const CRON_MONTH_RULE: CronFieldRule = {
  min: 1,
  max: 12
};

const CRON_DAY_OF_WEEK_RULE: CronFieldRule = {
  min: 0,
  max: 6,
  parseMax: 7,
  normalize: (value) => (value === 7 ? 0 : value)
};

let running = false;
let ticking = false;
let pollTimer: NodeJS.Timeout | null = null;
const lastTriggeredMinuteByJobId = new Map<string, string>();

const clearTimer = (): void => {
  if (!pollTimer) return;
  clearTimeout(pollTimer);
  pollTimer = null;
};

const scheduleNextTick = (): void => {
  if (!running) return;
  clearTimer();
  pollTimer = setTimeout(() => {
    void tick();
  }, POLL_INTERVAL_MS);
};

const normalizeStatus = (value: string): string => value.trim().toLowerCase();

const isCronJobActive = (job: CronJobDTO): boolean => {
  const normalizedStatus = normalizeStatus(job.status);
  return ACTIVE_STATUS.has(normalizedStatus);
};

const toMinuteKey = (date: Date): string => {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
};

const parseInteger = (value: string): number | null => {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  return Number.parseInt(value, 10);
};

const clampAndNormalize = (value: number, rule: CronFieldRule): number => {
  if (rule.normalize) {
    return rule.normalize(value);
  }
  return value;
};

const isInParseRange = (value: number, rule: CronFieldRule): boolean => {
  const upperBound = rule.parseMax ?? rule.max;
  return value >= rule.min && value <= upperBound;
};

const iterateRange = (
  start: number,
  end: number,
  step: number,
  onValue: (value: number) => boolean
): boolean => {
  if (step <= 0 || start > end) return false;

  for (let current = start; current <= end; current += step) {
    if (onValue(current)) {
      return true;
    }
  }

  return false;
};

const matchCronSegment = (segment: string, target: number, rule: CronFieldRule): boolean => {
  const trimmed = segment.trim();
  if (!trimmed) return false;

  const [basePartRaw, stepPartRaw, extraPart] = trimmed.split('/');
  if (extraPart !== undefined) return false;

  const basePart = basePartRaw.trim();
  const step = stepPartRaw === undefined ? 1 : parseInteger(stepPartRaw.trim());
  if (step === null || step <= 0) {
    return false;
  }

  const matchesValue = (value: number): boolean => {
    const normalized = clampAndNormalize(value, rule);
    if (normalized < rule.min || normalized > rule.max) {
      return false;
    }
    return normalized === target;
  };

  if (basePart === '*' || basePart === '') {
    return iterateRange(rule.min, rule.parseMax ?? rule.max, step, matchesValue);
  }

  if (basePart.includes('-')) {
    const [startRaw, endRaw, trailing] = basePart.split('-');
    if (trailing !== undefined) return false;

    const start = parseInteger(startRaw.trim());
    const end = parseInteger(endRaw.trim());
    if (start === null || end === null) return false;
    if (!isInParseRange(start, rule) || !isInParseRange(end, rule)) return false;

    return iterateRange(start, end, step, matchesValue);
  }

  const single = parseInteger(basePart);
  if (single === null) return false;
  if (!isInParseRange(single, rule)) return false;

  if (stepPartRaw !== undefined) {
    return iterateRange(single, rule.parseMax ?? rule.max, step, matchesValue);
  }

  return matchesValue(single);
};

const matchCronField = (field: string, target: number, rule: CronFieldRule): boolean => {
  const segments = field
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) return false;

  return segments.some((segment) => matchCronSegment(segment, target, rule));
};

const isWildcardField = (field: string): boolean => field.trim() === '*';

const matchesCronExpression = (cronExpression: string, now: Date): boolean => {
  const fields = cronExpression
    .trim()
    .split(/\s+/)
    .filter((field) => field.length > 0);

  if (fields.length !== CRON_FIELD_COUNT) {
    return false;
  }

  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = fields;

  const minuteMatch = matchCronField(minuteField, now.getMinutes(), CRON_MINUTE_RULE);
  const hourMatch = matchCronField(hourField, now.getHours(), CRON_HOUR_RULE);
  const monthMatch = matchCronField(monthField, now.getMonth() + 1, CRON_MONTH_RULE);
  const dayOfMonthMatch = matchCronField(dayOfMonthField, now.getDate(), CRON_DAY_OF_MONTH_RULE);
  const dayOfWeekMatch = matchCronField(dayOfWeekField, now.getDay(), CRON_DAY_OF_WEEK_RULE);

  const dayOfMonthWildcard = isWildcardField(dayOfMonthField);
  const dayOfWeekWildcard = isWildcardField(dayOfWeekField);

  const dayMatch =
    dayOfMonthWildcard && dayOfWeekWildcard
      ? true
      : dayOfMonthWildcard
        ? dayOfWeekMatch
        : dayOfWeekWildcard
          ? dayOfMonthMatch
          : dayOfMonthMatch || dayOfWeekMatch;

  return minuteMatch && hourMatch && monthMatch && dayMatch;
};

const logCronJobExecution = async (input: {
  job: CronJobDTO;
  executedAt: string;
  status: 'dispatched' | 'skipped' | 'failed';
  projectId?: string | null;
  projectName?: string | null;
  sessionId?: string | null;
  reason?: string | null;
  error?: string | null;
}): Promise<void> => {
  try {
    await repositoryService.logCronJobExecution({
      executedAt: input.executedAt,
      jobId: input.job.id,
      cron: input.job.cron,
      content: input.job.content.trim(),
      status: input.status,
      projectId: input.projectId ?? null,
      projectName: input.projectName ?? null,
      sessionId: input.sessionId ?? null,
      reason: input.reason ?? null,
      error: input.error ?? null
    });
  } catch (error) {
    logger.error('Failed to write cron job execution log', {
      jobId: input.job.id,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

const getDefaultCronTarget = (): CronJobTargetContext => ({
  scope: { type: 'main' },
  defaultModule: DEFAULT_MAIN_MODULE,
  projectId: MAIN_AGENT_ID,
  projectName: MAIN_AGENT_NAME
});

const resolveCronJobTarget = async (job: CronJobDTO): Promise<CronJobTargetContext> => {
  const targetAgentId = job.targetAgentId?.trim();
  if (!targetAgentId) {
    return getDefaultCronTarget();
  }

  const project = await repositoryService.getProjectById(targetAgentId);
  if (!project) {
    logger.warn('Cron job target agent not found, fallback to main agent', {
      jobId: job.id,
      targetAgentId
    });
    return getDefaultCronTarget();
  }

  return {
    scope: {
      type: 'project',
      projectId: project.id
    },
    defaultModule: DEFAULT_PROJECT_MODULE,
    projectId: project.id,
    projectName: project.name
  };
};

const dispatchCronJob = async (job: CronJobDTO): Promise<CronJobDispatchResult> => {
  const message = job.content.trim();
  if (!message) {
    logger.warn('Skipped cron job due to empty content', { jobId: job.id });
    return {
      status: 'skipped',
      reason: 'empty_content',
      projectId: null,
      projectName: null,
      sessionId: null
    };
  }

  const target = await resolveCronJobTarget(job);
  const sessions = await repositoryService.listChatSessions(target.scope);
  const session =
    sessions[0] ??
    (await repositoryService.createChatSession({
      scope: target.scope,
      module: target.defaultModule,
      title: target.scope.type === 'main' ? '主智能体会话' : 'Agent 会话'
    }));
  const module = session.module ?? target.defaultModule;

  void chatChannelService.mirrorAgentUserMessage({
    projectId: target.projectId,
    module,
    sessionId: session.id,
    message
  });

  const assistantMirrorStreamer = chatChannelService.createAgentAssistantMirrorStreamer({
    projectId: target.projectId,
    module,
    sessionId: session.id
  });
  const result = await chatService.send(
    {
      scope: target.scope,
      module,
      sessionId: session.id,
      requestId: randomUUID(),
      message
    },
    (streamEvent) => {
      assistantMirrorStreamer.pushEvent(streamEvent);
    }
  );

  void assistantMirrorStreamer.finalize({
    fallbackAssistantMessage: result.assistantMessage,
    toolActions: result.toolActions
  });

  logger.info('Cron job dispatched', {
    jobId: job.id,
    projectId: target.projectId,
    sessionId: session.id
  });

  return {
    status: 'dispatched',
    projectId: target.projectId,
    projectName: target.projectName,
    sessionId: session.id
  };
};

const tick = async (): Promise<void> => {
  if (!running || ticking) return;
  ticking = true;

  try {
    const jobs = await repositoryService.listCronJobs();
    const existingIds = new Set(jobs.map((job) => job.id));
    for (const jobId of lastTriggeredMinuteByJobId.keys()) {
      if (!existingIds.has(jobId)) {
        lastTriggeredMinuteByJobId.delete(jobId);
      }
    }

    const now = new Date();
    const minuteKey = toMinuteKey(now);

    for (const job of jobs) {
      if (!isCronJobActive(job)) continue;
      if (!job.cron.trim()) continue;
      if (!matchesCronExpression(job.cron, now)) continue;
      if (lastTriggeredMinuteByJobId.get(job.id) === minuteKey) continue;

      lastTriggeredMinuteByJobId.set(job.id, minuteKey);
      const executedAt = new Date().toISOString();
      try {
        const result = await dispatchCronJob(job);
        await logCronJobExecution({
          job,
          executedAt,
          status: result.status,
          projectId: result.projectId,
          projectName: result.projectName,
          sessionId: result.sessionId,
          reason: result.reason
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to dispatch cron job', {
          jobId: job.id,
          cron: job.cron,
          error: errorMessage
        });
        await logCronJobExecution({
          job,
          executedAt,
          status: 'failed',
          reason: 'dispatch_failed',
          error: errorMessage
        });
      }
    }
  } catch (error) {
    logger.error('Cron job scheduler tick failed', error);
  } finally {
    ticking = false;
    scheduleNextTick();
  }
};

const stopService = (): void => {
  running = false;
  ticking = false;
  clearTimer();
  lastTriggeredMinuteByJobId.clear();
};

export const cronjobService = {
  start(): void {
    if (running) return;
    running = true;
    logger.info('Cron job scheduler started');
    void tick();
  },

  stop(): void {
    if (!running) return;
    logger.info('Cron job scheduler stopped');
    stopService();
  }
};
