/* global acquireVsCodeApi */
(() => {
  const api = acquireVsCodeApi();
  const saved = api.getState() || {};
  let state, busy = false, treeKey = saved.treeKey, openFolders = new Set(saved.openFolders || []);
  let detailsHidden = saved.detailsHidden || false;
  const app = document.getElementById('app');
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const tr = text => state?.labels[text] || text;
  const persist = () => api.setState({ detailsHidden, openFolders: [...openFolders], treeKey, scrolls: {
    history: historyBody.scrollTop, files: filesBody.scrollTop, details: detailBody.scrollTop,
  } });
  const send = message => {
    if (busy || !state) return;
    busy = true; app.classList.add('busy'); status.textContent = '…';
    api.postMessage({ ...message, key: state.key });
  };
  const button = (label, action, className = '') => {
    const node = el('button', className, label); node.type = 'button'; node.addEventListener('click', action); return node;
  };
  const actionButton = (symbol, label, action) => {
    const node = button(symbol, () => send({ type: 'action', action }), 'icon-button');
    node.title = tr(label); node.setAttribute('aria-label', tr(label)); return node;
  };
  const header = el('header', 'toolbar');
  const controls = el('div', 'controls');
  const controlButtons = {};
  for (const id of ['repository', 'base', 'target']) {
    const node = button('', () => send({ type: 'action', action: id }), 'control');
    const label = el('span', 'eyebrow'), value = el('span', 'control-value'); node.append(label, value);
    controlButtons[id] = { node, label, value };
  }
  const modeLabel = el('label', 'control mode');
  const modeCaption = el('span', 'eyebrow'), mode = el('select');
  for (const value of ['merge-base', 'direct', 'commit']) { const option = el('option'); option.value = value; mode.append(option); }
  mode.addEventListener('change', () => send({ type: 'mode', mode: mode.value }));
  modeLabel.append(modeCaption, mode);
  controls.append(controlButtons.repository.node, modeLabel, controlButtons.base.node, el('span', 'direction', '→'), controlButtons.target.node);
  const navigation = el('div', 'navigation');
  const previous = actionButton('←', 'Previous Commit (Older)', 'previous');
  const next = actionButton('→', 'Next Commit (Newer)', 'next');
  const swap = actionButton('⇄', 'Swap Base and Compare', 'swap');
  const refresh = actionButton('↻', 'Refresh Comparison', 'refresh');
  const detailToggle = button('◫', () => { detailsHidden = !detailsHidden; updateDetailsVisibility(); persist(); }, 'icon-button');
  navigation.append(previous, next, swap, refresh, detailToggle); header.append(controls, navigation);
  const status = el('div', 'status'); status.setAttribute('role', 'status');
  const layout = el('div', 'layout');
  const pane = className => {
    const section = el('section', 'pane ' + className), heading = el('div', 'pane-heading');
    const title = el('h2'), count = el('span', 'count'); heading.append(title, count);
    const body = el('div', 'scroll-area'); section.append(heading, body); layout.append(section);
    body.addEventListener('scroll', persist, { passive: true });
    return { section, heading, title, count, body };
  };
  const historyPane = pane('history'), filesPane = pane('files'), detailsPane = pane('details');
  const historyBody = historyPane.body, filesBody = filesPane.body, detailBody = detailsPane.body;
  const historySearch = el('input', 'search'); historySearch.type = 'search';
  historySearch.addEventListener('input', renderHistory); historyPane.heading.after(historySearch);
  const fileTools = el('div', 'file-tools'), fileSearch = el('input', 'search'); fileSearch.type = 'search';
  fileSearch.addEventListener('input', renderFiles);
  const expand = button('⊞', () => { for (const node of filesBody.querySelectorAll('details')) { node.open = true; openFolders.add(node.dataset.path); } persist(); }, 'icon-button');
  const collapse = button('⊟', () => { for (const node of filesBody.querySelectorAll('details')) node.open = false; openFolders.clear(); persist(); }, 'icon-button');
  fileTools.append(fileSearch, expand, collapse); filesPane.heading.after(fileTools);
  const footer = el('footer'); app.append(header, status, layout, footer);

  function updateDetailsVisibility() {
    layout.classList.toggle('details-hidden', detailsHidden);
    detailToggle.title = tr(detailsHidden ? 'Show details' : 'Hide details');
    detailToggle.setAttribute('aria-label', detailToggle.title);
    detailToggle.setAttribute('aria-pressed', String(!detailsHidden));
  }

  function renderHistory() {
    const scroll = historyBody.scrollTop;
    historyBody.replaceChildren();
    const query = historySearch.value.toLowerCase();
    const commits = state.commits.filter(c => `${c.hash} ${c.subject} ${c.author} ${c.date}`.toLowerCase().includes(query));
    for (const commit of commits) {
      const row = button('', () => send({ type: 'commit', hash: commit.hash }), 'commit-row');
      row.classList.toggle('selected', commit.hash === state.selected);
      row.setAttribute('aria-current', commit.hash === state.selected ? 'true' : 'false');
      row.title = `${commit.hash}\n${commit.subject}\n${commit.author} · ${commit.date}`;
      row.append(el('span', 'trace-dot', commit.parents?.length > 1 ? '◇' : '●'));
      const content = el('span', 'commit-content'); content.append(el('span', 'commit-subject', commit.subject));
      const meta = el('span', 'commit-meta'); meta.append(el('code', '', commit.hash.slice(0, 8)), el('span', '', `${commit.author} · ${commit.date}`));
      content.append(meta); row.append(content); historyBody.append(row);
    }
    if (!commits.length) historyBody.append(el('p', 'empty', tr('No commits in this range.')));
    if (state.more) historyBody.append(button(tr('Load older commits…'), () => send({ type: 'older' }), 'load-more'));
    historyBody.scrollTop = scroll;
    historyPane.count.textContent = state.commits.length + (state.more ? '+' : '');
  }

  function renderFiles() {
    const scroll = filesBody.scrollTop;
    filesBody.replaceChildren();
    const files = state.files.filter(f => `${f.path}\n${f.oldPath}`.toLowerCase().includes(fileSearch.value.toLowerCase()));
    const root = { children: new Map(), files: [], added: 0, removed: 0, count: 0 };
    for (const file of files) {
      const parts = file.path.split('/'); let node = root;
      const add = node => { node.added += file.added || 0; node.removed += file.removed || 0; node.count++; };
      add(node);
      for (let i = 0; i < parts.length - 1; i++) {
        const name = parts[i];
        if (!node.children.has(name)) node.children.set(name, { name, path: parts.slice(0, i + 1).join('/'), children: new Map(), files: [], added: 0, removed: 0, count: 0 });
        node = node.children.get(name); add(node);
      }
      node.files.push(file);
    }
    const counts = (added, removed) => { const node = el('span', 'line-counts'); node.append(el('span', 'added', '+' + added), el('span', 'removed', '−' + removed)); return node; };
    const append = (parent, tree) => {
      for (const folder of [...tree.children.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        const details = el('details', 'folder'); details.dataset.path = folder.path;
        details.open = Boolean(fileSearch.value) || openFolders.has(folder.path);
        details.addEventListener('toggle', () => { if (!details.isConnected) return; if (details.open) openFolders.add(folder.path); else openFolders.delete(folder.path); persist(); });
        const summary = el('summary'); summary.append(el('span', 'folder-name', folder.name), el('span', 'count', String(folder.count)), counts(folder.added, folder.removed));
        const children = el('div', 'folder-children'); append(children, folder); details.append(summary, children); parent.append(details);
      }
      for (const file of tree.files.sort((a, b) => a.path.localeCompare(b.path))) {
        const row = el('div', 'file-row');
        const name = button(file.path.split('/').at(-1), () => send({ type: 'file', action: 'open', path: file.path }), 'file-name');
        name.title = file.oldPath !== file.path ? `${file.oldPath} → ${file.path}` : file.path;
        row.append(el('span', 'file-status', file.status), name, file.added === null ? el('span', 'count', tr('Binary')) : counts(file.added, file.removed));
        for (const [action, symbol, label] of [['copyAbsolute', '⧉', 'Copy Compare-side Absolute Path'], ['copyRelative', './', 'Copy Relative Path'], ['openWorkingFile', '↗', 'Open Working File']]) {
          const control = button(symbol, () => send({ type: 'file', action, path: file.path }), 'file-action');
          control.title = tr(label); control.setAttribute('aria-label', `${tr(label)}: ${file.path}`); row.append(control);
        }
        parent.append(row);
      }
    };
    append(filesBody, root);
    if (!files.length) filesBody.append(el('p', 'empty', tr('No matching files.')));
    filesBody.scrollTop = scroll; filesPane.count.textContent = String(files.length);
  }

  function renderDetails() {
    const scroll = detailBody.scrollTop; detailBody.replaceChildren();
    if (!state.details) return;
    detailBody.append(el('code', 'hash', state.right));
    detailBody.append(el('pre', 'commit-message', state.details.message));
    for (const [label, value] of [['Author', state.details.author], ['Date', state.details.date], ['Base', state.left || tr('Empty tree')], ['Parents', state.details.parents.join('\n') || '∅'], ['Working tree path', state.details.worktree || state.root]]) {
      const item = el('div', 'detail-field'); item.append(el('span', 'eyebrow', tr(label)), el('span', 'detail-value', value)); detailBody.append(item);
    }
    if (!state.details.worktree) detailBody.append(el('p', 'muted', tr('No matching historical worktree; paths refer to the current workspace.')));
    detailBody.scrollTop = scroll;
  }

  window.addEventListener('message', event => {
    if (!event.data || !['state', 'error', 'fold'].includes(event.data.type)) return;
    busy = false; app.classList.remove('busy');
    if (event.data.type === 'error') { status.textContent = event.data.message; status.classList.add('error'); return; }
    if (event.data.type === 'fold') { (event.data.expand ? expand : collapse).click(); return; }
    state = event.data.state;
    status.classList.remove('error'); status.textContent = state.summary || tr('Choose branches or a commit from the toolbar.');
    for (const c of state.controls) {
      const control = controlButtons[c.control];
      if (control) { control.label.textContent = c.name; control.value.textContent = c.value; control.node.title = c.control === 'repository' ? state.root || c.value : c.value; }
    }
    modeCaption.textContent = tr('Mode');
    for (const [i, label] of ['PR / merge base', 'Branch tips', 'Commit · first parent'].entries()) mode.options[i].textContent = tr(label);
    mode.value = state.mode || 'merge-base';
    mode.setAttribute('aria-label', tr('Mode'));
    previous.disabled = !state.canPrevious; next.disabled = !state.canNext;
    previous.title = tr('Previous Commit (Older)'); next.title = tr('Next Commit (Newer)');
    previous.setAttribute('aria-label', previous.title); next.setAttribute('aria-label', next.title);
    for (const [node, key] of [[historyPane.title, 'History'], [filesPane.title, 'Changed files'], [detailsPane.title, 'Details']]) node.textContent = tr(key);
    for (const [input, key] of [[historySearch, 'Search commits'], [fileSearch, 'Filter files']]) { input.placeholder = tr(key); input.setAttribute('aria-label', tr(key)); }
    for (const [node, key] of [[expand, 'Expand All Folders'], [collapse, 'Collapse All Folders'], [swap, 'Swap Base and Compare'], [refresh, 'Refresh Comparison']]) { node.title = tr(key); node.setAttribute('aria-label', tr(key)); }
    if (treeKey !== state.key) { if (treeKey && state.key !== saved.treeKey) openFolders.clear(); treeKey = state.key; }
    updateDetailsVisibility(); renderHistory(); renderFiles(); renderDetails();
    footer.textContent = state.root || '';
    if (!app.dataset.ready) {
      for (const [node, key] of [[historyBody, 'history'], [filesBody, 'files'], [detailBody, 'details']]) node.scrollTop = saved.scrolls?.[key] || 0;
      app.dataset.ready = 'true';
    }
  });
  api.postMessage({ type: 'ready' });
})();
