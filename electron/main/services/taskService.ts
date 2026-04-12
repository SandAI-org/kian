import { randomUUID } from 'node:crypto';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, promises as fs, type WriteStream } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { TaskDTO, TaskDetailDTO, TaskStatus } from '@shared/types';
import { logger } from './logger';
import { WORKSPACE_ROOT } from './workspacePaths';

const TASKS_DIR_NAME = '.tasks';
const TASK_META_FILE_NAME = 'meta.json';
const TASK_STDOUT_LOG_FILE_NAME = 'stdout.log';
const TASK_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const LOG_TAIL_MAX_BYTES = 200_000;
const STOP_GRACE_PERIOD_MS = 1_500;
const STOP_POLL_INTERVAL_MS = 100;

const execFileAsync = promisify(execFile);

interface TaskMetaFile {
  createdAt: string;
  name: string;
  status: TaskStatus;
  command: string;
  pid: number | null;
}

interface TaskRuntime {
  child: ChildProcess;
  logStream: WriteStream;
}

export interface TaskUpdateInput {
  id?: string;
  name?: string;
  command?: string;
  status?: TaskStatus;
}

const tasksRootDir = path.join(WORKSPACE_ROOT, TASKS_DIR_NAME);
const runtimeByTaskId = new Map<string, TaskRuntime>();
const stopIntentByTaskId = new Map<string, TaskStatus>();

const ensureDir = async (dirPath: string): Promise<void> => {
  await fs.mkdir(dirPath, { recursive: true });
};

const nowISO = (): string => new Date().toISOString();

const isTaskStatus = (value: unknown): value is TaskStatus =>
  value === 'running' || value === 'stopped' || value === 'success';

const normalizeTaskId = (taskId: string): string => {
  const normalized = taskId.trim();
  if (!TASK_ID_PATTERN.test(normalized)) {
    throw new Error('任务 ID 不合法');
  }
  return normalized;
};

const sanitizeTaskSlug = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'task';
};

const buildTaskId = (name?: string, command?: string): string => {
  const seed = (name?.trim() || command?.trim() || 'task').slice(0, 32);
  const suffix = randomUUID().slice(0, 8);
  return `${sanitizeTaskSlug(seed)}-${suffix}`;
};

const getTaskDir = (taskId: string): string =>
  path.join(tasksRootDir, normalizeTaskId(taskId));

const getTaskMetaPath = (taskId: string): string =>
  path.join(getTaskDir(taskId), TASK_META_FILE_NAME);

const getTaskStdoutPath = (taskId: string): string =>
  path.join(getTaskDir(taskId), TASK_STDOUT_LOG_FILE_NAME);

const isPidRunning = (pid: number | null): boolean => {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === 'ESRCH') return false;
    return true;
  }
};

const waitForPidExit = async (
  pid: number,
  timeoutMs: number = STOP_GRACE_PERIOD_MS
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) {
      return true;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, STOP_POLL_INTERVAL_MS);
    });
  }
  return !isPidRunning(pid);
};

const readUnixProcessGroupId = async (pid: number): Promise<number | null> => {
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'pgid=', '-p', String(pid)]);
    const pgid = Number.parseInt(stdout.trim(), 10);
    return Number.isInteger(pgid) && pgid > 0 ? pgid : null;
  } catch (error) {
    logger.warn('Failed to inspect task process group', {
      pid,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
};

const signalUnixProcessTree = async (pid: number, signal: NodeJS.Signals): Promise<void> => {
  const processGroupId = await readUnixProcessGroupId(pid);
  if (processGroupId === pid) {
    try {
      process.kill(-pid, signal);
      return;
    } catch (error) {
      const errno = error as NodeJS.ErrnoException;
      if (errno.code === 'ESRCH') {
        return;
      }
      logger.warn('Failed to signal task process group', {
        pid,
        signal,
        error: errno.message
      });
    }
  }

  try {
    process.kill(pid, signal);
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code !== 'ESRCH') {
      logger.warn('Failed to signal task process', {
        pid,
        signal,
        error: errno.message
      });
    }
  }
};

const signalWindowsProcessTree = async (pid: number, force: boolean): Promise<void> => {
  const args = ['/pid', String(pid), '/t'];
  if (force) {
    args.push('/f');
  }

  try {
    await execFileAsync('taskkill', args);
  } catch (error) {
    const details =
      error && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr?: unknown }).stderr ?? '')
        : error instanceof Error
          ? error.message
          : String(error);
    const normalized = details.toLowerCase();
    if (
      normalized.includes('not found') ||
      normalized.includes('no running instance') ||
      normalized.includes('not running')
    ) {
      return;
    }
    logger.warn('Failed to terminate Windows task process tree', {
      pid,
      force,
      error: details
    });
  }
};

const terminateProcessTree = async (pid: number | null): Promise<void> => {
  if (!pid || !Number.isInteger(pid) || pid <= 0 || !isPidRunning(pid)) {
    return;
  }

  if (process.platform === 'win32') {
    await signalWindowsProcessTree(pid, false);
    const exited = await waitForPidExit(pid);
    if (exited) {
      return;
    }
    await signalWindowsProcessTree(pid, true);
    const forceExited = await waitForPidExit(pid, 500);
    if (!forceExited && isPidRunning(pid)) {
      throw new Error(`未能停止任务进程树（PID=${pid}）`);
    }
    return;
  }

  await signalUnixProcessTree(pid, 'SIGTERM');
  const exited = await waitForPidExit(pid);
  if (exited) {
    return;
  }

  await signalUnixProcessTree(pid, 'SIGKILL');
  const forceExited = await waitForPidExit(pid, 500);
  if (!forceExited && isPidRunning(pid)) {
    throw new Error(`未能停止任务进程树（PID=${pid}）`);
  }
};

const parseTaskMetaFile = (raw: string, taskId: string): TaskMetaFile => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `任务 ${taskId} 的 meta.json 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`任务 ${taskId} 的 meta.json 结构不合法`);
  }

  const candidate = parsed as Record<string, unknown>;
  const createdAt = typeof candidate.createdAt === 'string' ? candidate.createdAt : '';
  const name = typeof candidate.name === 'string' ? candidate.name : '';
  const status = candidate.status;
  const command = typeof candidate.command === 'string' ? candidate.command : '';
  const pidValue = candidate.pid;
  const pid =
    pidValue === null
      ? null
      : typeof pidValue === 'number' && Number.isInteger(pidValue) && pidValue > 0
        ? pidValue
        : null;

  if (!createdAt.trim()) {
    throw new Error(`任务 ${taskId} 缺少 createdAt`);
  }
  if (!name.trim()) {
    throw new Error(`任务 ${taskId} 缺少 name`);
  }
  if (!isTaskStatus(status)) {
    throw new Error(`任务 ${taskId} 状态非法`);
  }

  return {
    createdAt,
    name,
    status,
    command,
    pid
  };
};

const readTaskMeta = async (taskId: string): Promise<TaskMetaFile> => {
  const normalizedTaskId = normalizeTaskId(taskId);
  const raw = await fs.readFile(getTaskMetaPath(normalizedTaskId), 'utf8');
  return parseTaskMetaFile(raw, normalizedTaskId);
};

const readTaskMetaIfExists = async (taskId: string): Promise<TaskMetaFile | null> => {
  try {
    return await readTaskMeta(taskId);
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
};

const writeTaskMeta = async (taskId: string, meta: TaskMetaFile): Promise<void> => {
  const normalizedTaskId = normalizeTaskId(taskId);
  await ensureDir(getTaskDir(normalizedTaskId));
  await fs.writeFile(
    getTaskMetaPath(normalizedTaskId),
    `${JSON.stringify(meta, null, 2)}\n`,
    'utf8'
  );
};

const toTaskDTO = (taskId: string, meta: TaskMetaFile): TaskDTO => ({
  id: normalizeTaskId(taskId),
  createdAt: meta.createdAt,
  name: meta.name,
  status: meta.status,
  command: meta.command,
  pid: meta.pid,
  taskDir: getTaskDir(taskId),
  stdoutLogPath: getTaskStdoutPath(taskId)
});

const getTaskRuntime = (taskId: string): TaskRuntime | undefined =>
  runtimeByTaskId.get(normalizeTaskId(taskId));

const listTaskIds = async (): Promise<string[]> => {
  try {
    await ensureDir(tasksRootDir);
    const entries = await fs.readdir(tasksRootDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && TASK_ID_PATTERN.test(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === 'ENOENT' || errno.code === 'ENOTDIR') {
      logger.warn('Task directory is unavailable, skipping task scan', {
        tasksRootDir,
        error: errno.message
      });
      return [];
    }
    throw error;
  }
};

const readLogTail = async (
  logPath: string,
  maxBytes = LOG_TAIL_MAX_BYTES
): Promise<{ stdout: string; stdoutSizeBytes: number; stdoutTruncated: boolean }> => {
  try {
    const buffer = await fs.readFile(logPath);
    if (buffer.byteLength <= maxBytes) {
      return {
        stdout: buffer.toString('utf8'),
        stdoutSizeBytes: buffer.byteLength,
        stdoutTruncated: false
      };
    }

    const tail = buffer.subarray(buffer.byteLength - maxBytes);
    return {
      stdout: tail.toString('utf8'),
      stdoutSizeBytes: buffer.byteLength,
      stdoutTruncated: true
    };
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === 'ENOENT') {
      return {
        stdout: '',
        stdoutSizeBytes: 0,
        stdoutTruncated: false
      };
    }
    throw error;
  }
};

const stopRuntimeProcess = async (taskId: string, fallbackPid?: number | null): Promise<void> => {
  const normalizedTaskId = normalizeTaskId(taskId);
  const runtime = runtimeByTaskId.get(normalizedTaskId);
  const targetPid = runtime?.child.pid ?? fallbackPid ?? null;
  await terminateProcessTree(targetPid);
};

const launchTaskProcess = async (taskId: string): Promise<TaskDTO> => {
  const normalizedTaskId = normalizeTaskId(taskId);
  const meta = await readTaskMeta(normalizedTaskId);
  const command = meta.command.trim();
  if (!command) {
    throw new Error('任务 command 为空，无法启动');
  }

  const existingRuntime = runtimeByTaskId.get(normalizedTaskId);
  if (existingRuntime && existingRuntime.child.exitCode === null) {
    return toTaskDTO(normalizedTaskId, {
      ...meta,
      status: 'running',
      pid: existingRuntime.child.pid ?? meta.pid
    });
  }

  await ensureDir(getTaskDir(normalizedTaskId));
  await fs.appendFile(
    getTaskStdoutPath(normalizedTaskId),
    `\n[${nowISO()}] --- task starting ---\n`,
    'utf8'
  );
  const logStream = createWriteStream(getTaskStdoutPath(normalizedTaskId), { flags: 'a' });
  const child = spawn(command, {
    cwd: WORKSPACE_ROOT,
    env: process.env,
    shell: true,
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (child.stdout) {
    child.stdout.pipe(logStream, { end: false });
  }
  if (child.stderr) {
    child.stderr.pipe(logStream, { end: false });
  }

  runtimeByTaskId.set(normalizedTaskId, { child, logStream });

  const runningMeta: TaskMetaFile = {
    ...meta,
    status: 'running',
    pid: child.pid ?? null
  };
  await writeTaskMeta(normalizedTaskId, runningMeta);

  let finalized = false;
  const finalizeProcess = async (input: {
    code: number | null;
    signal: NodeJS.Signals | null;
    cause: 'exit' | 'error';
    errorMessage?: string;
  }): Promise<void> => {
    if (finalized) return;
    finalized = true;

    runtimeByTaskId.delete(normalizedTaskId);

    try {
      if (input.cause === 'error') {
        const message = input.errorMessage ?? 'unknown error';
        logStream.write(`[${nowISO()}] --- task failed to launch: ${message} ---\n`);
      } else {
        const signalText = input.signal ? ` signal=${input.signal}` : '';
        logStream.write(
          `[${nowISO()}] --- task exited code=${input.code ?? 'null'}${signalText} ---\n`
        );
      }
    } catch {
      // ignore stream write errors
    } finally {
      logStream.end();
    }

    const latestMeta = await readTaskMetaIfExists(normalizedTaskId);
    if (!latestMeta) return;

    const stopIntent = stopIntentByTaskId.get(normalizedTaskId);
    if (stopIntent) {
      stopIntentByTaskId.delete(normalizedTaskId);
      await writeTaskMeta(normalizedTaskId, {
        ...latestMeta,
        status: stopIntent,
        pid: null
      });
      return;
    }

    const nextStatus: TaskStatus =
      input.cause === 'exit' && input.code === 0 && input.signal === null ? 'success' : 'stopped';
    await writeTaskMeta(normalizedTaskId, {
      ...latestMeta,
      status: nextStatus,
      pid: null
    });
  };

  child.once('error', (error) => {
    logger.error('Task process failed', {
      taskId: normalizedTaskId,
      error: error.message
    });
    void finalizeProcess({
      code: null,
      signal: null,
      cause: 'error',
      errorMessage: error.message
    });
  });

  child.once('exit', (code, signal) => {
    void finalizeProcess({
      code,
      signal,
      cause: 'exit'
    });
  });

  return toTaskDTO(normalizedTaskId, runningMeta);
};

const ensureTaskProcess = async (taskId: string): Promise<TaskDTO> => {
  const normalizedTaskId = normalizeTaskId(taskId);
  const meta = await readTaskMeta(normalizedTaskId);
  if (meta.status !== 'running') {
    return toTaskDTO(normalizedTaskId, meta);
  }

  const runtime = getTaskRuntime(normalizedTaskId);
  if (runtime && runtime.child.exitCode === null) {
    return toTaskDTO(normalizedTaskId, {
      ...meta,
      pid: runtime.child.pid ?? meta.pid
    });
  }

  if (isPidRunning(meta.pid)) {
    return toTaskDTO(normalizedTaskId, meta);
  }

  if (!meta.command.trim()) {
    const stoppedMeta: TaskMetaFile = {
      ...meta,
      status: 'stopped',
      pid: null
    };
    await writeTaskMeta(normalizedTaskId, stoppedMeta);
    return toTaskDTO(normalizedTaskId, stoppedMeta);
  }

  return launchTaskProcess(normalizedTaskId);
};

const listTasks = async (): Promise<TaskDTO[]> => {
  const taskIds = await listTaskIds();
  const tasks: TaskDTO[] = [];
  for (const taskId of taskIds) {
    try {
      const meta = await readTaskMeta(taskId);
      tasks.push(toTaskDTO(taskId, meta));
    } catch (error) {
      logger.warn('Skip invalid task meta', {
        taskId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

const viewTask = async (taskId: string): Promise<TaskDetailDTO> => {
  const normalizedTaskId = normalizeTaskId(taskId);
  const meta = await readTaskMeta(normalizedTaskId);
  const log = await readLogTail(getTaskStdoutPath(normalizedTaskId));
  return {
    ...toTaskDTO(normalizedTaskId, meta),
    ...log
  };
};

const startTask = async (taskId: string): Promise<TaskDTO> => {
  const normalizedTaskId = normalizeTaskId(taskId);
  const meta = await readTaskMeta(normalizedTaskId);
  if (!meta.command.trim()) {
    throw new Error('任务 command 为空，无法启动');
  }

  const runtime = getTaskRuntime(normalizedTaskId);
  if (runtime && runtime.child.exitCode === null) {
    const runningMeta: TaskMetaFile = {
      ...meta,
      status: 'running',
      pid: runtime.child.pid ?? meta.pid
    };
    await writeTaskMeta(normalizedTaskId, runningMeta);
    return toTaskDTO(normalizedTaskId, runningMeta);
  }

  if (meta.status === 'running' && isPidRunning(meta.pid)) {
    return toTaskDTO(normalizedTaskId, meta);
  }

  const nextMeta: TaskMetaFile = {
    ...meta,
    status: 'running',
    pid: null
  };
  await writeTaskMeta(normalizedTaskId, nextMeta);
  return launchTaskProcess(normalizedTaskId);
};

const stopTask = async (
  taskId: string,
  options?: { nextStatus?: Exclude<TaskStatus, 'running'> }
): Promise<TaskDTO> => {
  const normalizedTaskId = normalizeTaskId(taskId);
  const nextStatus = options?.nextStatus ?? 'stopped';
  const meta = await readTaskMeta(normalizedTaskId);

  stopIntentByTaskId.set(normalizedTaskId, nextStatus);
  await stopRuntimeProcess(normalizedTaskId, meta.pid);

  const stoppedMeta: TaskMetaFile = {
    ...meta,
    status: nextStatus,
    pid: null
  };
  await writeTaskMeta(normalizedTaskId, stoppedMeta);

  if (!getTaskRuntime(normalizedTaskId)) {
    stopIntentByTaskId.delete(normalizedTaskId);
  }

  return toTaskDTO(normalizedTaskId, stoppedMeta);
};

const deleteTask = async (taskId: string): Promise<boolean> => {
  const normalizedTaskId = normalizeTaskId(taskId);
  const existing = await readTaskMetaIfExists(normalizedTaskId);
  if (!existing) {
    return false;
  }

  await stopTask(normalizedTaskId, { nextStatus: 'stopped' });
  runtimeByTaskId.delete(normalizedTaskId);
  stopIntentByTaskId.delete(normalizedTaskId);
  await fs.rm(getTaskDir(normalizedTaskId), { recursive: true, force: true });
  return true;
};

const updateTask = async (input: TaskUpdateInput): Promise<TaskDTO> => {
  const taskId = input.id?.trim() ? normalizeTaskId(input.id) : '';
  const existingMeta = taskId ? await readTaskMetaIfExists(taskId) : null;

  if (!existingMeta) {
    const nextTaskId = taskId || buildTaskId(input.name, input.command);
    const nextStatus = input.status ?? 'stopped';
    const nextName = input.name?.trim() || input.command?.trim().slice(0, 48) || `Task ${nextTaskId}`;
    const nextCommand = (input.command ?? '').trim();
    if (nextStatus === 'running' && !nextCommand) {
      throw new Error('创建并启动任务时必须提供 command');
    }

    const createdMeta: TaskMetaFile = {
      createdAt: nowISO(),
      name: nextName,
      status: nextStatus,
      command: nextCommand,
      pid: null
    };
    await writeTaskMeta(nextTaskId, createdMeta);
    if (nextStatus === 'running') {
      return startTask(nextTaskId);
    }
    return toTaskDTO(nextTaskId, createdMeta);
  }

  const normalizedTaskId = taskId;
  const nextName = input.name !== undefined ? input.name.trim() : existingMeta.name;
  const nextCommand =
    input.command !== undefined ? input.command.trim() : existingMeta.command;
  const nextStatus = input.status ?? existingMeta.status;
  const commandChanged =
    input.command !== undefined && nextCommand !== existingMeta.command;

  if (!nextName) {
    throw new Error('任务名称不能为空');
  }
  if (nextStatus === 'running' && !nextCommand) {
    throw new Error('running 状态必须提供可执行 command');
  }

  if (nextStatus === 'running') {
    if (commandChanged && existingMeta.status === 'running') {
      await stopTask(normalizedTaskId, { nextStatus: 'stopped' });
    }
    await writeTaskMeta(normalizedTaskId, {
      ...existingMeta,
      name: nextName,
      command: nextCommand,
      status: 'running',
      pid: commandChanged ? null : existingMeta.pid
    });
    return startTask(normalizedTaskId);
  }

  if (nextStatus === 'stopped' || nextStatus === 'success') {
    await stopTask(normalizedTaskId, { nextStatus });
    const afterStop = (await readTaskMetaIfExists(normalizedTaskId)) ?? {
      ...existingMeta,
      status: nextStatus,
      pid: null
    };
    const finalMeta: TaskMetaFile = {
      ...afterStop,
      name: nextName,
      command: nextCommand,
      status: nextStatus,
      pid: null
    };
    await writeTaskMeta(normalizedTaskId, finalMeta);
    return toTaskDTO(normalizedTaskId, finalMeta);
  }

  const finalMeta: TaskMetaFile = {
    ...existingMeta,
    name: nextName,
    command: nextCommand
  };
  if (finalMeta.status !== 'running') {
    finalMeta.pid = null;
  }
  await writeTaskMeta(normalizedTaskId, finalMeta);
  return toTaskDTO(normalizedTaskId, finalMeta);
};

export const taskService = {
  async listTasks(): Promise<TaskDTO[]> {
    return listTasks();
  },

  async viewTask(taskId: string): Promise<TaskDetailDTO> {
    return viewTask(taskId);
  },

  async deleteTask(taskId: string): Promise<boolean> {
    return deleteTask(taskId);
  },

  async startTask(taskId: string): Promise<TaskDTO> {
    return startTask(taskId);
  },

  async stopTask(taskId: string): Promise<TaskDTO> {
    return stopTask(taskId, { nextStatus: 'stopped' });
  },

  async updateTask(input: TaskUpdateInput): Promise<TaskDTO> {
    return updateTask(input);
  },

  async ensureTaskProcess(taskId: string): Promise<TaskDTO> {
    return ensureTaskProcess(taskId);
  },

  async listActiveTasks(): Promise<TaskDTO[]> {
    const tasks = await listTasks();
    return tasks.filter((task) => {
      if (task.status !== 'running') {
        return false;
      }

      const runtime = getTaskRuntime(task.id);
      if (runtime && runtime.child.exitCode === null) {
        return true;
      }

      return isPidRunning(task.pid);
    });
  },

  async shutdownRunningTasks(): Promise<void> {
    const tasks = await listTasks();
    const runningTasks = tasks.filter((task) => task.status === 'running');
    for (const task of runningTasks) {
      await stopTask(task.id, { nextStatus: 'stopped' });
    }
  }
};
