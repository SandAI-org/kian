const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function browser(fetchRead) {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', setAttribute() {} });
    return nodes.get(id);
  };
  const context = vm.createContext({
    URL, URLSearchParams, location: { search: '?channel=owned' },
    localStorage: { getItem: () => null }, setInterval() {},
    document: { documentElement: {}, getElementById: get, addEventListener() {} },
    fetch: (url, options) => url === '/api/inbox' ? new Promise(() => {}) : fetchRead(url, options),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/repo_inbox_web/app.js'), 'utf8'), context);
  vm.runInContext(`render=()=>{};loaded=true;token='fixture';query='does not match';mode='read';
    items=[{id:'owned-recent',channel:'owned',repo:'a/a',is_read:0,is_favorite:1},
    {id:'owned-history',channel:'owned',repo:'a/a',is_read:0},
    {id:'owned-read',channel:'owned',repo:'a/a',is_read:1},
    {id:'public',channel:'public',repo:'b/b',is_read:0},
    {id:'blog',channel:'public',repo:'source:blog',is_read:0}];`, context);
  return { context, get, state: () => JSON.parse(vm.runInContext('JSON.stringify(items)', context)) };
}

test('clear unread covers the whole current channel, including hidden history, ignoring search and read tab', async () => {
  const requests = [];
  const b = browser(async (url, options) => { requests.push({ url, ...JSON.parse(options.body) }); return { ok: true }; });
  await b.get('clearUnread').onclick();
  assert.deepEqual(requests, [{ url: '/api/read', ids: ['owned-recent', 'owned-history'], is_read: true }]);
  assert.deepEqual(b.state().map(e => e.is_read), [1, 1, 1, 0, 0]);
  assert.equal(b.state()[0].is_favorite, 1);
  await b.get('clearUnread').onclick();
  assert.equal(requests.length, 1);
});

test('open source bulk action excludes research blogs; favorites remain an independent scope', async () => {
  const requests = [];
  const b = browser(async (_, options) => { requests.push(JSON.parse(options.body)); return { ok: true }; });
  vm.runInContext("channel='public'", b.context);
  await b.get('clearUnread').onclick();
  assert.deepEqual(requests[0].ids, ['public']);
  vm.runInContext("channel='favorites'", b.context);
  await b.get('clearUnread').onclick();
  assert.deepEqual(requests[1].ids, ['owned-recent']);
});

test('failure preserves read state, permits retry, and concurrent clicks do not duplicate writes', async () => {
  let finish; let count = 0;
  const b = browser(() => { count++; return new Promise(resolve => { finish = resolve; }); });
  const click = b.get('clearUnread').onclick();
  await b.get('clearUnread').onclick(); assert.equal(count, 1);
  finish({ ok: false }); await click;
  assert.deepEqual(b.state().map(e => e.is_read), [0, 0, 1, 0, 0]);
  assert.ok(b.get('error').textContent);
  const retry = b.get('clearUnread').onclick(); assert.equal(count, 2);
  finish({ ok: true }); await retry;
  assert.deepEqual(b.state().map(e => e.is_read), [1, 1, 1, 0, 0]);
});
