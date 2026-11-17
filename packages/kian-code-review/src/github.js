const https = require('node:https');
const http = require('node:http');
const tls = require('node:tls');

function parseRepository(url) {
  const match = url?.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}
function parsePullRequest(url) {
  const match = url?.trim().match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/);
  return match ? { repository: `${match[1]}/${match[2]}`, number: Number(match[3]) } : null;
}
function patchContains(patch, side, line) {
  let left, right;
  for (const text of (patch || '').split('\n')) {
    const header = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) { left = Number(header[1]); right = Number(header[2]); continue; }
    if (left === undefined || ![' ', '+', '-'].includes(text[0])) continue;
    if (text[0] !== '+' && side === 'LEFT' && left === line) return true;
    if (text[0] !== '-' && side === 'RIGHT' && right === line) return true;
    if (text[0] !== '+') left++;
    if (text[0] !== '-') right++;
  }
  return false;
}

function patchContainsRange(patch, side, start, end) {
  return (patch || '').split('\n').some(line => {
    const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!match) return false;
    const first = Number(match[side === 'LEFT' ? 1 : 3]), count = Number(match[side === 'LEFT' ? 2 : 4] ?? 1);
    return start >= first && end < first + count && patchContains(patch, side, start) && patchContains(patch, side, end);
  });
}

class GitHubAPI {
  constructor(token, proxy, translate = (text, ...args) => text.replace(/\{(\d+)\}/g, (_, i) => args[i])) {
    this.token = token; this.proxy = proxy; this.t = translate;
  }
  async request(route, method = 'GET', body) {
    let agent;
    if (this.proxy) {
      const proxy = new URL(this.proxy);
      if (!['http:', 'https:'].includes(proxy.protocol)) throw new Error(this.t('GitHub requires an HTTP or HTTPS proxy URL.'));
      agent = new https.Agent();
      agent.createConnection = (options, callback) => {
        const headers = { Host: `${options.host}:443` };
        if (proxy.username) headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64');
        const connect = (proxy.protocol === 'https:' ? https : http).request(proxy, { method: 'CONNECT', path: `${options.host}:443`, headers });
        let finished = false;
        const done = (error, socket) => { if (!finished) { finished = true; callback(error, socket); } };
        connect.on('connect', (response, socket) => {
          if (response.statusCode !== 200) { socket.destroy(); done(new Error(this.t('GitHub proxy connection failed ({0}).', response.statusCode))); return; }
          const secure = tls.connect({ socket, servername: options.host });
          secure.once('secureConnect', () => done(null, secure)); secure.once('error', done);
        });
        connect.setTimeout(20000, () => connect.destroy(new Error(this.t('GitHub connection timed out.'))));
        connect.once('error', done); connect.end();
      };
    }
    try {
      return await new Promise((resolve, reject) => {
        const payload = body === undefined ? null : JSON.stringify(body);
        const request = https.request(`https://api.github.com${route}`, { method, agent,
          headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Kian-Review',
            'X-GitHub-Api-Version': '2022-11-28', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) } }, response => {
          const chunks = []; let size = 0;
          response.on('data', chunk => { size += chunk.length; if (size > 8 * 1024 * 1024) response.destroy(new Error(this.t('GitHub response is too large.'))); else chunks.push(chunk); });
          response.on('error', reject);
          response.on('end', () => {
            try {
              const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
              if (response.statusCode < 200 || response.statusCode >= 300) reject(new Error(this.t('GitHub request failed ({0}): {1}', response.statusCode, value?.message || '')));
              else resolve(value);
            } catch (error) { reject(error); }
          });
        });
        request.setTimeout(30000, () => request.destroy(new Error(this.t('GitHub connection timed out.'))));
        request.once('error', reject); request.end(payload);
      });
    } finally { agent?.destroy(); }
  }
  async list(route) {
    const rows = [];
    for (let page = 1; ; page++) {
      const data = await this.request(`${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      rows.push(...data); if (data.length < 100) return rows;
    }
  }
}

module.exports = { GitHubAPI, parseRepository, parsePullRequest, patchContains, patchContainsRange };
