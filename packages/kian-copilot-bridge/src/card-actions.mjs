const parseActionIdentity = (value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    try {
      return parseActionIdentity(JSON.parse(trimmed));
    } catch {
      return { command: trimmed.toLowerCase(), repo: '', mode: 'default' };
    }
  }
  if (!value || typeof value !== 'object') return null;
  const repo = typeof value.repo === 'string' ? value.repo.trim().toLowerCase() : '';
  const mode = ['simple', 'full'].includes(value.mode) ? value.mode : 'default';
  if (typeof value.text === 'string' && value.text.trim()) {
    return { command: value.text.trim().toLowerCase(), repo, mode };
  }
  if (typeof value.action !== 'string') return null;
  const pr = value.pr === undefined || value.pr === null ? '' : String(value.pr);
  return { command: `${value.action}${pr}`.trim().toLowerCase(), repo, mode };
};

const parseButtonTextIdentity = (button) => {
  const content = typeof button?.text === 'string' ? button.text : button?.text?.content;
  if (typeof content !== 'string') return null;
  const match = content.match(/(?:PR\s*)?#(\d+)/i);
  if (!match) return null;
  const action = content.includes('更新') ? 'up' : content.includes('生成') ? 'desc' : '';
  if (!action) return null;
  const mode = content.includes('简略版')
    ? 'simple'
    : content.includes('完整版') ? 'full' : 'default';
  return { command: `${action}${match[1]}`, repo: '', mode };
};

const getButtonIdentities = (button) => {
  const valueIdentity = parseActionIdentity(button.value);
  const textIdentity = parseButtonTextIdentity(button);
  if (!valueIdentity) return textIdentity ? [textIdentity] : [];
  if (!textIdentity) return [valueIdentity];
  const normalizedValueIdentity = valueIdentity.mode === 'default'
    ? { ...valueIdentity, mode: textIdentity.mode }
    : valueIdentity;
  return [normalizedValueIdentity, textIdentity];
};

const matchScore = (identity, target) => {
  if (!identity
    || identity.command !== target.command.toLowerCase()
    || identity.mode !== target.mode) return 0;
  const targetRepo = target.repo.trim().toLowerCase();
  if (identity.repo === targetRepo) return 3;
  return identity.repo ? 1 : 2;
};

const normalizeCardNode = (value, key = '') => {
  if (!Array.isArray(value) && (!value || typeof value !== 'object')) return value;
  if (Array.isArray(value)) {
    if (key === 'elements') {
      return value.map((element) => Array.isArray(element)
        ? { tag: 'action', actions: element.flat(Infinity).map((item) => normalizeCardNode(item)) }
        : normalizeCardNode(element));
    }
    if (key === 'actions') return value.flat(Infinity).map((item) => normalizeCardNode(item));
    return value.map((item) => normalizeCardNode(item));
  }
  const normalized = Object.fromEntries(
    Object.entries(value).map(([childKey, child]) => [childKey, normalizeCardNode(child, childKey)]),
  );
  if (normalized.tag === 'button' && typeof normalized.text === 'string') {
    normalized.text = { tag: 'plain_text', content: normalized.text };
  }
  return normalized;
};

export const disableCardAction = (card, target) => {
  const clonedCard = normalizeCardNode(card);
  const candidates = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (value.tag === 'button' && value.disabled !== true) {
      const identities = getButtonIdentities(value);
      const score = Math.max(0, ...identities.map((identity) => matchScore(identity, target)));
      candidates.push({ button: value, identities, score });
    }
    Object.values(value).forEach(visit);
  };
  visit(clonedCard);
  const bestScore = Math.max(0, ...candidates.map(({ score }) => score));
  const matches = candidates.filter(({ score }) => score === bestScore && score > 0);
  if (matches.length !== 1) {
    return {
      card,
      changed: false,
      candidates: candidates.flatMap(({ identities }) => identities),
    };
  }
  matches[0].button.disabled = true;
  matches[0].button.type = 'default';
  return { card: clonedCard, changed: true, candidates: [] };
};
