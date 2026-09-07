const parseActionIdentity = (value) => {
  if (typeof value === 'string') {
    return { command: value.trim().toLowerCase(), repo: '', mode: 'default' };
  }
  if (!value || typeof value !== 'object') return null;
  const repo = typeof value.repo === 'string' ? value.repo.trim() : '';
  const mode = ['simple', 'full'].includes(value.mode) ? value.mode : 'default';
  if (typeof value.text === 'string' && value.text.trim()) {
    return { command: value.text.trim().toLowerCase(), repo, mode };
  }
  if (typeof value.action !== 'string') return null;
  const pr = value.pr === undefined || value.pr === null ? '' : String(value.pr);
  return { command: `${value.action}${pr}`.trim().toLowerCase(), repo, mode };
};

const matchesAction = (value, target) => {
  const identity = parseActionIdentity(value);
  return identity
    && identity.command === target.command.toLowerCase()
    && identity.repo === target.repo
    && identity.mode === target.mode;
};

export const disableCardAction = (card, target) => {
  let changed = false;
  const visit = (value) => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    const copy = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
    if (copy.tag === 'button' && matchesAction(copy.value, target) && copy.disabled !== true) {
      copy.disabled = true;
      copy.type = 'default';
      changed = true;
    }
    return copy;
  };
  return { card: visit(card), changed };
};
