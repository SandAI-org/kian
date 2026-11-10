(function () {
  function timestamp(event) { return event.event_at || event.captured_at; }

  function dayOf(event) {
    if (!timestamp(event)) return null;
    const date = new Date(timestamp(event));
    if (!Number.isFinite(date.getTime())) return null;
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function group(events, archived = false) {
    const days = new Map();
    for (const event of events) {
      const day = dayOf(event) || 'history';
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(event);
    }
    const leaves = [...days].sort(([a], [b]) =>
      a === 'history' ? 1 : b === 'history' ? -1 : b.localeCompare(a),
    ).map(([key, values]) => ({ key, events: values }));
    if (!archived) return leaves;
    const years = new Map();
    for (const leaf of leaves) {
      if (leaf.key === 'history') continue;
      const year = leaf.key.slice(0, 4), month = leaf.key.slice(0, 7);
      if (!years.has(year)) years.set(year, new Map());
      if (!years.get(year).has(month)) years.get(year).set(month, []);
      years.get(year).get(month).push(leaf);
    }
    const result = [...years].map(([key, months]) => ({
      key, children: [...months].map(([key, children]) => ({
        key, children, events: children.flatMap(day => day.events),
      })), events: [...months.values()].flat().flatMap(day => day.events),
    }));
    const unknown = leaves.find(leaf => leaf.key === 'history');
    if (unknown) result.push(unknown);
    return result;
  }

  function unreadWindow(events, now = Date.now()) {
    const today = dayOf({ captured_at: new Date(now).toISOString() });
    const cutoff = new Date(Date.parse(today + 'T00:00:00Z') - 6 * 86400000).toISOString().slice(0, 10);
    const recent = [], history = [];
    for (const event of events) {
      const day = dayOf(event);
      (day && day >= cutoff ? recent : history).push(event);
    }
    return { recent, history, cutoff };
  }

  const api = { dayOf, group, timestamp, unreadWindow };
  if (typeof module !== 'undefined') module.exports = api;
  else window.InboxTimeline = api;
}());
