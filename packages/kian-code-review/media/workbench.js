/* global acquireVsCodeApi */
(() => {
  const api = acquireVsCodeApi();
  const saved = api.getState() || {};
  let state, busy = false, treeKey = saved.treeKey, openFolders = new Set(saved.openFolders || []);
  let detailsHidden = saved.detailsHidden || false;
  let historyHidden = saved.historyHidden || false, rightTab = saved.rightTab || 'notes', showResolved = saved.showResolved || false;
  let reviewedOpen = saved.reviewedOpen || false;
  let regexMode = saved.regexMode || false;
  let lastValidMatcher = () => true;
  const app = document.getElementById('app');
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const tr = text => state?.labels[text] || text;
  const persist = () => api.setState({ detailsHidden, historyHidden, rightTab, showResolved, reviewedOpen,
    includeFilter: fileSearch.value, excludeFilter: excludeSearch.value, regexMode, openFolders: [...openFolders], treeKey, scrolls: {
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
  const historyToggle = button('☷', () => { historyHidden = !historyHidden; updateDetailsVisibility(); persist(); }, 'icon-button');
  const connect = actionButton('PR', 'Connect PR', 'connectPR');
  navigation.append(previous, next, swap, refresh, connect, historyToggle, detailToggle); header.append(controls, navigation);
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
  const excludeSearch = el('input', 'search'); excludeSearch.type = 'search';
  fileSearch.value = saved.includeFilter || ''; excludeSearch.value = saved.excludeFilter || '';
  for (const input of [fileSearch, excludeSearch]) input.addEventListener('input', () => { renderFiles(); persist(); });
  const regexToggle = button('.*', () => { regexMode = !regexMode; renderFiles(); persist(); }, 'icon-button regex-toggle');
  const includeLabel = el('label', 'filter-field'), excludeLabel = el('label', 'filter-field');
  const includeCaption = el('span', 'eyebrow'), excludeCaption = el('span', 'eyebrow');
  includeLabel.append(includeCaption, fileSearch); excludeLabel.append(excludeCaption, excludeSearch);
  const expand = button('⊞', () => { for (const node of filesBody.querySelectorAll('details.folder')) { node.open = true; openFolders.add(node.dataset.path); } persist(); }, 'icon-button');
  const collapse = button('⊟', () => { for (const node of filesBody.querySelectorAll('details.folder')) node.open = false; openFolders.clear(); persist(); }, 'icon-button');
  fileTools.append(includeLabel, excludeLabel, regexToggle, expand, collapse); filesPane.heading.after(fileTools);
  const filterError = el('div', 'filter-error'); filterError.hidden = true; filterError.setAttribute('role', 'status'); fileTools.after(filterError);
  const footer = el('footer'); app.append(header, status, layout, footer);
  const updateBanner = el('div', 'update-banner'), updateText = el('span');
  const updateRefresh = actionButton('↻', 'Refresh Comparison', 'refresh'); updateBanner.append(updateText, updateRefresh); status.after(updateBanner);
  const tabs = el('div', 'detail-tabs');
  const infoTab = button('', () => { rightTab = 'details'; renderDetails(); persist(); });
  const notesTab = button('', () => { rightTab = 'notes'; renderDetails(); persist(); });
  tabs.append(notesTab, infoTab); detailsPane.heading.after(tabs);

  function updateDetailsVisibility() {
    layout.classList.toggle('details-hidden', detailsHidden);
    layout.classList.toggle('history-hidden', historyHidden);
    historyToggle.title = tr('History visibility'); historyToggle.setAttribute('aria-label', historyToggle.title);
    historyToggle.setAttribute('aria-pressed', String(!historyHidden));
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
    regexToggle.setAttribute('aria-pressed', String(regexMode)); regexToggle.title = tr('Use regular expressions');
    regexToggle.setAttribute('aria-label', regexToggle.title);
    const hint = tr(regexMode ? 'Regular expressions, case insensitive. Commas outside groups separate OR conditions. Escape a literal comma with \\,.' : 'Comma separates OR conditions. Glob: *.py, src/**, *.{cu,cpp}. Plain text matches substrings.');
    fileSearch.title = hint; excludeSearch.title = hint;
    let matches;
    try {
      matches = window.KianFileFilter.compile(fileSearch.value, excludeSearch.value, regexMode); lastValidMatcher = matches;
      filterError.hidden = true; fileSearch.removeAttribute('aria-invalid'); excludeSearch.removeAttribute('aria-invalid');
    }
    catch (error) {
      filterError.hidden = false; filterError.textContent = `${tr(error.field === 'exclude' ? 'Invalid exclude pattern' : 'Invalid include pattern')}: ${tr(error.message)}`;
      fileSearch.setAttribute('aria-invalid', String(error.field === 'include')); excludeSearch.setAttribute('aria-invalid', String(error.field === 'exclude'));
      matches = lastValidMatcher;
    }
    filesBody.replaceChildren();
    const matching = state.files.filter(matches);
    const files = matching.filter(f => !state.review?.files[f.path]?.reviewed);
    const reviewed = matching.filter(f => state.review?.files[f.path]?.reviewed);
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
        details.open = Boolean(fileSearch.value || excludeSearch.value) || openFolders.has(folder.path);
        details.addEventListener('toggle', () => { if (!details.isConnected) return; if (details.open) openFolders.add(folder.path); else openFolders.delete(folder.path); persist(); });
        const summary = el('summary'); summary.append(el('span', 'folder-name', folder.name), el('span', 'count', String(folder.count)), counts(folder.added, folder.removed));
        const children = el('div', 'folder-children'); append(children, folder); details.append(summary, children); parent.append(details);
      }
      for (const file of tree.files.sort((a, b) => a.path.localeCompare(b.path))) {
        const row = el('div', 'file-row');
        const review = state.review?.files[file.path];
        const check = button(review?.reviewed ? '✓' : '○', () => send({ type: 'file', action: review?.reviewed ? 'unread' : 'reviewed', path: file.path }), 'review-check');
        check.title = tr(review?.reviewed ? 'Mark unread' : 'Mark reviewed');
        check.setAttribute('aria-label', `${check.title}: ${file.path}`); check.setAttribute('aria-pressed', String(Boolean(review?.reviewed))); row.append(check);
        const name = button(review?.reviewed ? file.path : file.path.split('/').at(-1), () => send({ type: 'file', action: 'open', path: file.path }), 'file-name');
        name.title = (file.oldPath !== file.path ? `${file.oldPath} → ${file.path}` : file.path) + ' · ' + tr('Full comparison');
        row.append(el('span', 'file-status', file.status), name, file.added === null ? el('span', 'count', tr('Binary')) : counts(file.added, file.removed));
        if (review?.updated) {
          row.classList.add('updated');
          const delta = button('Δ', () => send({ type: 'file', action: 'incremental', path: file.path }), 'delta-button');
          delta.title = tr(review.targetChanged ? 'Since last review' : 'Base changed; the target file is unchanged. Check the full comparison.');
          delta.setAttribute('aria-label', `${tr('Updated since review')}: ${file.path}`);
          delta.disabled = !review.targetChanged; row.append(delta);
        }
        for (const [action, symbol, label] of [['copyAbsolute', '⧉', 'Copy Compare-side Absolute Path'], ['copyRelative', './', 'Copy Relative Path'], ['openWorkingFile', '↗', 'Open Working File']]) {
          const control = button(symbol, () => send({ type: 'file', action, path: file.path }), 'file-action');
          control.title = tr(label); control.setAttribute('aria-label', `${tr(label)}: ${file.path}`); row.append(control);
        }
        parent.append(row);
      }
    };
    append(filesBody, root);
    if (!files.length) filesBody.append(el('p', 'empty', tr(reviewed.length ? 'All matching files are reviewed.' : 'No matching files.')));
    if (reviewed.length) {
      const lane = el('details', 'reviewed-lane'); lane.append(el('summary', '', `${tr('Reviewed files')} · ${reviewed.length}`));
      lane.open = reviewedOpen; lane.addEventListener('toggle', () => { if (lane.isConnected) { reviewedOpen = lane.open; persist(); } });
      const content = el('div'); append(content, { children: new Map(), files: reviewed }); lane.append(content); filesBody.prepend(lane);
    }
    filesBody.scrollTop = scroll; filesPane.count.textContent = `${files.length} / ${matching.length}`;
  }

  function renderDetails() {
    const scroll = detailBody.scrollTop; detailBody.replaceChildren();
    detailsPane.title.textContent = tr(rightTab === 'notes' ? 'Private questions' : 'Details');
    notesTab.textContent = `${tr('Private questions')} · ${state.review?.notes.filter(n => !n.resolved).length || 0}`;
    infoTab.textContent = tr('Details'); notesTab.classList.toggle('active', rightTab === 'notes'); infoTab.classList.toggle('active', rightTab === 'details');
    if (rightTab === 'notes') { renderNotes(); detailBody.scrollTop = scroll; return; }
    if (!state.details) return;
    detailBody.append(el('code', 'hash', state.right));
    detailBody.append(el('pre', 'commit-message', state.details.message));
    for (const [label, value] of [['Author', state.details.author], ['Date', state.details.date], ['Base', state.left || tr('Empty tree')], ['Parents', state.details.parents.join('\n') || '∅'], ['Working tree path', state.details.worktree || state.root]]) {
      const item = el('div', 'detail-field'); item.append(el('span', 'eyebrow', tr(label)), el('span', 'detail-value', value)); detailBody.append(item);
    }
    if (!state.details.worktree) detailBody.append(el('p', 'muted', tr('No matching historical worktree; paths refer to the current workspace.')));
    detailBody.scrollTop = scroll;
  }

  function renderNotes() {
    const tools = el('div', 'notes-tools');
    tools.append(button(tr('Copy prompts'), () => send({ type: 'action', action: 'copyPrompts' })),
      button('+', () => send({ type: 'action', action: 'addNote' })));
    tools.lastChild.title = tr('Add private question');
    const resolvedLabel = el('label', 'muted'), checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = showResolved;
    checkbox.addEventListener('change', () => { showResolved = checkbox.checked; renderDetails(); persist(); });
    resolvedLabel.append(checkbox, document.createTextNode(tr('Show resolved'))); tools.append(resolvedLabel); detailBody.append(tools);
    const notes = (state.review?.notes || []).filter(note => showResolved || !note.resolved);
    for (const note of notes) {
      const card = el('article', 'note-card');
      const anchor = button(`${note.anchor.path}:${note.anchor.start + 1}${note.anchor.end > note.anchor.start ? '–' + (note.anchor.end + 1) : ''}`, () => send({ type: 'note', action: 'open', id: note.id }), 'note-anchor');
      card.append(anchor, el('span', 'note-meta', `${note.anchor.side} · ${note.anchor.ref?.slice(0, 8) || '∅'} · ${tr(note.resolved ? 'Resolved' : note.published ? 'Published' : 'Local only')}`));
      if (note.anchor.head !== state.right) card.append(el('span', 'note-meta', tr('Anchor version changed')));
      card.append(el('pre', 'note-text', note.text));
      const actions = el('div', 'note-actions');
      for (const [action, label] of [[note.resolved ? 'reopen' : 'resolve', note.resolved ? 'Reopen' : 'Resolve'], ['edit', 'Edit'], ...(!note.published ? [['publish', 'Submit to GitHub…']] : [])]) {
        actions.append(button(tr(label), () => send({ type: 'note', action, id: note.id })));
      }
      card.append(actions); detailBody.append(card);
    }
    if (!notes.length) detailBody.append(el('p', 'empty', tr('No private questions.')));
  }

  window.addEventListener('message', event => {
    if (!event.data || !['state', 'error', 'fold', 'focusFilter'].includes(event.data.type)) return;
    if (event.data.type === 'focusFilter') { fileSearch.focus(); return; }
    busy = false; app.classList.remove('busy');
    if (event.data.type === 'error') {
      if (state?.mode) mode.value = state.mode;
      status.textContent = event.data.message; status.classList.add('error'); return;
    }
    if (event.data.type === 'fold') { (event.data.expand ? expand : collapse).click(); return; }
    state = event.data.state;
    updateBanner.hidden = !state.update?.available && !state.update?.error;
    updateText.textContent = state.update?.available ? `${tr('Updates available')} · ${tr('Refresh to review the new version. Your current view is unchanged.')}`
      : state.update?.error ? `${tr('Update check failed')}: ${state.update.error}` : '';
    updateRefresh.title = tr('Refresh Comparison');
    connect.textContent = state.pr ? `#${state.pr.number}` : 'PR'; connect.title = state.pr?.url || tr('Connect PR');
    updateRefresh.setAttribute('aria-label', updateRefresh.title); connect.setAttribute('aria-label', connect.title);
    status.classList.remove('error'); status.textContent = state.summary || tr('Choose branches or a commit from the toolbar.');
    for (const c of state.controls) {
      const control = controlButtons[c.control];
      if (control) { control.label.textContent = c.name; control.value.textContent = c.value; control.node.title = c.control === 'repository' ? state.root || c.value : c.value; }
    }
    modeCaption.textContent = tr('Mode');
    for (const [i, label] of ['PR', 'Branch Diff', 'Commit Diff'].entries()) {
      mode.options[i].textContent = tr(label);
      mode.options[i].title = tr(['PR / merge base', 'Branch tips', 'Commit · first parent'][i]);
    }
    mode.value = state.mode || 'merge-base';
    mode.setAttribute('aria-label', tr('Mode'));
    mode.title = mode.selectedOptions[0]?.title || tr('Mode');
    previous.disabled = !state.canPrevious; next.disabled = !state.canNext;
    previous.title = tr('Previous Commit (Older)'); next.title = tr('Next Commit (Newer)');
    previous.setAttribute('aria-label', previous.title); next.setAttribute('aria-label', next.title);
    for (const [node, key] of [[historyPane.title, 'History'], [filesPane.title, 'Changed files'], [detailsPane.title, 'Details']]) node.textContent = tr(key);
    for (const [input, key] of [[historySearch, 'Search commits'], [fileSearch, 'Include files'], [excludeSearch, 'Exclude files']]) { input.placeholder = tr(key); input.setAttribute('aria-label', tr(key)); }
    includeCaption.textContent = tr('Include files'); excludeCaption.textContent = tr('Exclude files');
    for (const [node, key] of [[expand, 'Expand All Folders'], [collapse, 'Collapse All Folders'], [swap, 'Swap Base and Compare'], [refresh, 'Refresh Comparison']]) { node.title = tr(key); node.setAttribute('aria-label', tr(key)); }
    if (treeKey !== state.key) { if (treeKey && state.key !== saved.treeKey) openFolders.clear(); treeKey = state.key; }
    updateDetailsVisibility(); renderHistory(); renderFiles(); renderDetails();
    footer.textContent = (state.root || '') + (state.pr ? '' : ' · ' + tr('Local refs only; connect a PR to detect updates on GitHub.'));
    if (!app.dataset.ready) {
      for (const [node, key] of [[historyBody, 'history'], [filesBody, 'files'], [detailBody, 'details']]) node.scrollTop = saved.scrolls?.[key] || 0;
      app.dataset.ready = 'true';
    }
  });
  api.postMessage({ type: 'ready' });
})();
