const test = require('node:test');
const assert = require('node:assert/strict');
const { dayOf, group, unreadWindow } = require('../scripts/repo_inbox_web/timeline.js');

const event = (id, captured_at, extra = {}) => ({ id, captured_at, ...extra });

test('collection days use Beijing midnight, not UTC midnight or read dates', () => {
  assert.equal(dayOf(event('before', '2026-12-31T15:59:59Z')), '2026-12-31');
  assert.equal(dayOf(event('after', '2026-12-31T16:00:00Z', { read_at: '2028-01-01T00:00:00Z' })), '2027-01-01');
});

test('newer days precede higher-priority older items; intra-day order is retained', () => {
  const input = [event('old-required', '2026-10-29T02:00:00Z', { required: true }),
    event('today', '2026-11-01T02:00:00Z'), event('old-score', '2026-10-29T03:00:00Z')];
  const days = group(input);
  assert.deepEqual(days.map(d => d.key), ['2026-11-01', '2026-10-29']);
  assert.deepEqual(days[1].events.map(e => e.id), ['old-required', 'old-score']);
});

test('read archives form separate year, month and day branches across years', () => {
  const input = [event('old', '2024-02-01T01:00:00Z'), event('new', '2026-11-01T01:00:00Z'),
    event('previous-month', '2026-10-31T01:00:00Z'), event('previous-day', '2026-11-02T01:00:00Z')];
  const years = group(input, true);
  assert.deepEqual(years.map(y => y.key), ['2026', '2024']);
  assert.deepEqual(years[0].children.map(m => m.key), ['2026-11', '2026-10']);
  assert.deepEqual(years[0].children[0].children.map(d => d.key), ['2026-11-02', '2026-11-01']);
  assert.equal(years[0].events.length, 3);
});

test('undated imports are never assigned their import/read date', () => {
  const input = [event('unknown', null, { imported_at: '2026-11-01', read_at: '2026-11-02' }),
    event('invalid', 'not-a-date'), event('dated', '2026-10-01T00:00:00Z')];
  for (const archive of [false, true]) {
    const tree = group(input, archive);
    assert.equal(tree.at(-1).key, 'history');
    assert.deepEqual(tree.at(-1).events.map(e => e.id), ['unknown', 'invalid']);
  }
});

test('day actions retain all entries beyond the visible page', () => {
  const input = Array.from({ length: 40 }, (_, i) => event(String(i), '2026-11-01T01:00:00Z'));
  const [day] = group(input);
  assert.equal(day.events.length, 40);
  assert.equal(new Set(day.events.map(e => e.id)).size, 40);
  assert.deepEqual(day.events, input);
});

test('backfilled source event dates precede collection dates without changing read dates', () => {
  assert.equal(dayOf(event('merged', '2026-11-01T10:00:00Z', {
    event_at:'2026-10-29T15:59:59Z', read_at:'2026-11-03T00:00:00Z',
  })), '2026-10-29');
});

test('seven-day unread window includes today plus six Beijing dates and retains older undated entries', () => {
  const input = [event('today', '2026-11-09T16:00:00Z'),
    event('boundary', '2026-11-03T16:00:00Z'),
    event('old', '2026-11-03T15:59:59Z'), event('unknown', null),
    event('source-old', '2026-11-10T02:00:00Z', { event_at: '2026-10-01T00:00:00Z' })];
  const result = unreadWindow(input, Date.parse('2026-11-10T03:00:00Z'));
  assert.equal(result.cutoff, '2026-11-04');
  assert.deepEqual(result.recent.map(e => e.id), ['today', 'boundary']);
  assert.deepEqual(result.history.map(e => e.id), ['old', 'unknown', 'source-old']);
  assert.equal(result.recent.length + result.history.length, input.length);
  assert.equal(unreadWindow(input, Date.parse('2026-11-10T16:00:00Z')).cutoff, '2026-11-05');
});
