import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as Lark from '@larksuiteoapi/node-sdk';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(process.env.KIAN_REPO_ROOT || path.join(packageDir, '../..'));
const automationHome = path.resolve(
  (process.env.KIAN_AUTOMATION_HOME || path.join(os.homedir(), '.config/kian-automation'))
    .replace(/^~(?=$|\/)/, os.homedir()),
);
const configPath = path.join(automationHome, 'config/config.json');
const stateDir = path.join(automationHome, 'state');
const prManagerPath = path.join(repoRoot, 'automation/scripts/pr_desc_manager.py');
const connectionAlertStatePath = path.join(stateDir, 'connection-state.json');
const pythonBin = process.env.KIAN_PYTHON || 'python3';
const logPrefix = '[kian-copilot-bridge]';
const seen = new Map();
const seenTtlMs = 10 * 60 * 1000;
const pendingTextCommands = new Map();
const recentCommands = new Map();
const commandDedupeTtlMs = 60 * 1000;
const textCommandDelayMs = 1500;
const connectionRecycleMs = 60 * 60 * 1000;
const wsHealthCheckIntervalMs = 30 * 1000;
const wsPongTimeoutMs = 3 * 60 * 1000;
const wsHeartbeatSilenceTimeoutMs = 6 * 60 * 1000;
let activeCommands = 0;
let wsStartedAt = Date.now();
let wsLastSignalAt = wsStartedAt;
let wsLastPingAt = 0;
let wsLastPongAt = 0;
let wsLastUnackedPingAt = 0;
let handleWsHealthySignal = () => {};
let handleWsFailureSignal = () => {};

const log = (...args) => console.log(logPrefix, ...args);
const error = (...args) => console.error(logPrefix, ...args);

const flattenLogArgs = (args) => args.flat(Infinity);

const recordWsSdkSignal = (args) => {
  const text = flattenLogArgs(args).filter((item) => typeof item === 'string').join(' ').toLowerCase();
  if (!text.includes('[ws]')) return;
  const now = Date.now();
  if (text.includes('ping success')) {
    wsLastSignalAt = now;
    wsLastPingAt = now;
    if (!wsLastUnackedPingAt) wsLastUnackedPingAt = now;
  } else if (text.includes('receive pong')) {
    wsLastSignalAt = now;
    wsLastPongAt = now;
    wsLastUnackedPingAt = 0;
    void Promise.resolve(handleWsHealthySignal('pong')).catch(error);
  }
};

const recordWsSdkFailure = (args) => {
  const text = flattenLogArgs(args).filter((item) => typeof item === 'string').join(' ').toLowerCase();
  if (!text.includes('[ws]') && !text.includes('connect failed')) return;
  if (text.includes('connect failed') || text.includes('getaddrinfo') || text.includes('timeout')) {
    void Promise.resolve(handleWsFailureSignal('connect_failed', text.slice(0, 500))).catch(error);
  }
};

const wsSdkLogger = {
  fatal: (...args) => {
    recordWsSdkFailure(args);
    error('Feishu SDK fatal', ...args);
  },
  error: (...args) => {
    recordWsSdkFailure(args);
    error('Feishu SDK error', ...args);
  },
  warn: (...args) => {
    recordWsSdkSignal(args);
    recordWsSdkFailure(args);
    console.warn(...args);
  },
  info: (...args) => {
    recordWsSdkSignal(args);
    recordWsSdkFailure(args);
    const text = flattenLogArgs(args).filter((item) => typeof item === 'string').join(' ').toLowerCase();
    if (text.includes('ws connect success') || text.includes('reconnect success')) {
      void Promise.resolve(handleWsHealthySignal('connected')).catch(error);
    }
    if (text.includes('ws client ready') || text.includes('reconnect success')) log(...args);
  },
  debug: (...args) => {
    recordWsSdkSignal(args);
    recordWsSdkFailure(args);
    const text = flattenLogArgs(args).filter((item) => typeof item === 'string').join(' ').toLowerCase();
    if (text.includes('ws connect success') || text.includes('reconnect success')) {
      void Promise.resolve(handleWsHealthySignal('connected')).catch(error);
    }
    if (text.includes('ws connect success') || text.includes('reconnect success')) log(...args);
  },
  trace: (...args) => recordWsSdkSignal(args),
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));

const readConnectionAlertState = async () => {
  try {
    const state = await readJson(connectionAlertStatePath);
    return {
      status: state.status === 'unhealthy' ? 'unhealthy' : 'healthy',
      incident: state.incident || null,
      pending: Array.isArray(state.pending) ? state.pending.slice(-10) : [],
    };
  } catch (cause) {
    if (cause?.code !== 'ENOENT') error('failed to read connection alert state', cause);
    return { status: 'healthy', incident: null, pending: [] };
  }
};

const writeConnectionAlertState = async (state) => {
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  const temporaryPath = `${connectionAlertStatePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, connectionAlertStatePath);
};

const run = (program, args) => new Promise((resolve, reject) => {
  const child = spawn(program, args, {
    env: {
      ...process.env,
      http_proxy: '',
      https_proxy: '',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
      all_proxy: '',
      NO_PROXY: '*',
      no_proxy: '*',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) resolve(stdout.trim());
    else reject(new Error(stderr.trim() || stdout.trim() || `exit ${code}`));
  });
});

const parseText = (content) => {
  try {
    const parsed = JSON.parse(content || '{}');
    return typeof parsed.text === 'string' ? parsed.text.trim() : '';
  } catch {
    return '';
  }
};

const markSeen = (id) => {
  const now = Date.now();
  for (const [key, at] of seen) {
    if (now - at > seenTtlMs) seen.delete(key);
  }
  if (!id || seen.has(id)) return false;
  seen.set(id, now);
  return true;
};

const parseCardCommand = (data) => {
  const value = data?.action?.value;
  if (typeof value === 'string') return { command: value.trim(), repo: '', mode: 'default' };
  if (!value || typeof value !== 'object') return { command: '', repo: '', mode: 'default' };
  const repo = typeof value.repo === 'string' ? value.repo.trim() : '';
  const mode = ['simple', 'full'].includes(value.mode) ? value.mode : 'default';
  if (typeof value.text === 'string' && value.text.trim()) {
    return { command: value.text.trim(), repo, mode };
  }
  if (typeof value.action === 'string') {
    const pr = value.pr === undefined || value.pr === null ? '' : String(value.pr);
    return { command: `${value.action}${pr}`.trim(), repo, mode };
  }
  return { command: '', repo: '', mode: 'default' };
};

const pruneRecentCommands = () => {
  const now = Date.now();
  for (const [key, at] of recentCommands) {
    if (now - at > commandDedupeTtlMs) recentCommands.delete(key);
  }
};

const getTenantToken = async (appId, appSecret) => {
  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json();
  if (!response.ok || !payload.tenant_access_token) {
    throw new Error(`Feishu token request failed: ${payload.msg || response.status}`);
  }
  return payload.tenant_access_token;
};

const reply = async ({ appId, appSecret, messageId, chatId, text }) => {
  const token = await getTenantToken(appId, appSecret);
  const content = JSON.stringify({ text });
  const target = messageId
    ? `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reply`
    : 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id';
  const body = messageId
    ? { msg_type: 'text', content }
    : { receive_id: chatId, msg_type: 'text', content };
  const response = await fetch(target, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || payload.code) {
    throw new Error(`Feishu reply failed: ${payload.msg || response.status}`);
  }
};

const main = async () => {
  const config = await readJson(configPath);
  const feishuSettings = config.feishu ?? {};
  const appId = feishuSettings.app_id;
  const appSecret = feishuSettings.app_secret;
  const allowedUsers = new Set(feishuSettings.allowed_users || [feishuSettings.open_id].filter(Boolean));
  if (!appId || !appSecret) throw new Error('Feishu credentials are not configured');

  const connectionAlertState = await readConnectionAlertState();
  let alertOperation = Promise.resolve();
  const serializeAlertOperation = (operation) => {
    alertOperation = alertOperation.then(operation, operation);
    return alertOperation;
  };
  const flushConnectionAlerts = async () => {
    if (!connectionAlertState.pending.length) return;
    connectionAlertState.pending = [];
    await writeConnectionAlertState(connectionAlertState);
  };
  const markConnectionUnhealthy = (reason, detail = '') => serializeAlertOperation(async () => {
    if (connectionAlertState.status === 'unhealthy') {
      await flushConnectionAlerts();
      return;
    }
    const incident = {
      reason,
      detail,
      detectedAt: Date.now(),
      lastPingAt: wsLastPingAt || null,
      lastPongAt: wsLastPongAt || null,
    };
    connectionAlertState.status = 'unhealthy';
    connectionAlertState.incident = incident;
    connectionAlertState.pending.push({ id: `failure-${incident.detectedAt}`, kind: 'failure', incident });
    await writeConnectionAlertState(connectionAlertState);
    await flushConnectionAlerts();
  });
  const markConnectionHealthy = (source) => serializeAlertOperation(async () => {
    if (connectionAlertState.status !== 'unhealthy') {
      await flushConnectionAlerts();
      return;
    }
    const recoveredAt = Date.now();
    const incident = connectionAlertState.incident;
    connectionAlertState.status = 'healthy';
    connectionAlertState.incident = null;
    connectionAlertState.pending.push({
      id: `recovery-${recoveredAt}`,
      kind: 'recovery',
      source,
      recoveredAt,
      incident,
    });
    await writeConnectionAlertState(connectionAlertState);
    await flushConnectionAlerts();
  });
  handleWsHealthySignal = markConnectionHealthy;
  handleWsFailureSignal = markConnectionUnhealthy;
  void serializeAlertOperation(flushConnectionAlerts);

  const executeCommand = async ({ command, repo = '', mode = 'default', userId, chatId, messageId, source }) => {
    const normalized = command.toLowerCase();
    if (!/^(?:desc|up)\d+$/.test(normalized)) return;
    if (allowedUsers.size && !allowedUsers.has(userId)) return;
    pruneRecentCommands();
    const commandKey = `${userId}:${repo}:${mode}:${normalized}`;
    if (source === 'card') {
      const pendingKey = `${userId}::${normalized}`;
      const pending = pendingTextCommands.get(pendingKey);
      if (pending) {
        clearTimeout(pending);
        pendingTextCommands.delete(pendingKey);
      }
    }
    if (recentCommands.has(commandKey)) {
      log('skipped duplicate command', normalized, source);
      return;
    }
    recentCommands.set(commandKey, Date.now());
    log('received command', normalized, source, mode);
    activeCommands += 1;
    try {
      const args = [prManagerPath, normalized];
      if (repo) args.push(repo);
      if (mode !== 'default') args.push(mode);
      const output = await run(pythonBin, args);
      const result = JSON.parse(output);
      const text = result.status === 'UPDATED'
        ? `✅ ${result.repo}#${result.number} desc 已更新并贴上。\n${result.details}`
        : `ℹ️ ${result.repo}#${result.number} desc 无需更新。\n${result.details}`;
      await reply({ appId, appSecret, messageId, chatId, text });
      log('completed command', normalized, result.status, source, mode);
    } catch (cause) {
      error('command failed', normalized, cause);
      await reply({ appId, appSecret, messageId, chatId, text: `❌ ${normalized} 执行失败：${cause.message}` }).catch(error);
    } finally {
      activeCommands -= 1;
    }
  };

  const scheduleTextCommand = (input) => {
    const commandKey = `${input.userId}::${input.command.toLowerCase()}`;
    const existing = pendingTextCommands.get(commandKey);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      pendingTextCommands.delete(commandKey);
      void executeCommand({ ...input, source: 'text' });
    }, textCommandDelayMs);
    pendingTextCommands.set(commandKey, timer);
  };

  const dispatcher = new Lark.EventDispatcher({ loggerLevel: Lark.LoggerLevel.warn }).register({
    'im.message.receive_v1': async (data) => {
      wsLastSignalAt = Date.now();
      wsLastUnackedPingAt = 0;
      void markConnectionHealthy('event').catch(error);
      const messageId = data.message?.message_id || '';
      if (!markSeen(data.event_id || data.uuid || messageId)) return;
      if (data.sender?.sender_type === 'app') return;
      const userId = data.sender?.sender_id?.open_id || '';
      if (allowedUsers.size && !allowedUsers.has(userId)) return;
      if (data.message?.message_type !== 'text') return;
      const command = parseText(data.message?.content);
      if (!/^(?:desc|up)\d+$/i.test(command)) return;
      const chatId = data.message?.chat_id || '';
      scheduleTextCommand({ command, userId, chatId, messageId });
    },
    'card.action.trigger': async (data) => {
      wsLastSignalAt = Date.now();
      wsLastUnackedPingAt = 0;
      void markConnectionHealthy('event').catch(error);
      const { command, repo, mode } = parseCardCommand(data);
      if (!/^(?:desc|up)\d+$/i.test(command)) return {};
      const userId = data.open_id || data.operator?.open_id || '';
      const chatId = data.open_chat_id || data.context?.open_chat_id || '';
      const messageId = data.open_message_id || data.context?.open_message_id || '';
      const eventKey = `card:${messageId}:${userId}:${repo}:${mode}:${command.toLowerCase()}`;
      if (!markSeen(eventKey)) return {};
      void executeCommand({ command, repo, mode, userId, chatId, messageId, source: 'card' });
      return { toast: { type: 'info', content: `已收到 ${command}，正在处理` } };
    },
  });

  const client = new Lark.WSClient({
    appId,
    appSecret,
    autoReconnect: true,
    loggerLevel: Lark.LoggerLevel.trace,
    logger: wsSdkLogger,
  });
  wsStartedAt = Date.now();
  wsLastSignalAt = wsStartedAt;
  wsLastPingAt = 0;
  wsLastPongAt = 0;
  wsLastUnackedPingAt = 0;
  let restartingStaleConnection = false;
  const restartIfWsStale = async () => {
    const now = Date.now();
    const silenceMs = now - Math.max(wsStartedAt, wsLastSignalAt);
    const pendingPongMs = wsLastUnackedPingAt ? now - wsLastUnackedPingAt : 0;
    if (pendingPongMs <= wsPongTimeoutMs && silenceMs <= wsHeartbeatSilenceTimeoutMs) return;
    const reason = pendingPongMs > wsPongTimeoutMs ? 'pong_timeout' : 'heartbeat_silence';
    await markConnectionUnhealthy(reason, JSON.stringify({ silenceMs, pendingPongMs }));
    if (activeCommands > 0 || pendingTextCommands.size > 0) return;
    if (restartingStaleConnection) return;
    restartingStaleConnection = true;
    log('restarting stale Feishu listener', {
      reason,
      silenceMs,
      pendingPongMs,
      lastPingAt: wsLastPingAt,
      lastPongAt: wsLastPongAt,
      reconnectInfo: client.getReconnectInfo(),
    });
    process.exit(0);
  };
  setInterval(() => void restartIfWsStale().catch(error), wsHealthCheckIntervalMs);
  // The SDK can occasionally leave a dead WebSocket in a live process after
  // repeated DNS/network timeouts. launchd only restarts exited processes, so
  // recycle this listener while idle and let KeepAlive establish a fresh
  // connection. Never interrupt an in-flight PR description update.
  const recycleWhenIdle = () => {
    if (activeCommands > 0 || pendingTextCommands.size > 0) {
      setTimeout(recycleWhenIdle, 60 * 1000);
      return;
    }
    log('recycling Feishu listener to refresh WebSocket');
    process.exit(0);
  };
  setTimeout(recycleWhenIdle, connectionRecycleMs);
  log('starting Feishu listener');
  await client.start({ eventDispatcher: dispatcher });
};

main().catch((cause) => {
  error(cause);
  process.exitCode = 1;
});
