const vscode = require('vscode');
const path = require('node:path');
const { GitRepository, buildTree, isMagiRepository } = require('./git');
const t = (...args) => vscode.l10n.t(...args);

class ReviewProvider {
  constructor(context, gitApi) {
    this.context = context; this.gitApi = gitApi; this.generation = 0;
    this.events = new vscode.EventEmitter(); this.onDidChangeTreeData = this.events.event;
    this.root = buildTree([]); this.filter = ''; this.input = null; this.repo = null;
    this.folderState = vscode.TreeItemCollapsibleState.Collapsed;
    this.foldRevision = 0;
    this.saved = { ...context.workspaceState.get('comparisons', {}) };
    const legacy = context.workspaceState.get('comparison');
    if (legacy && !this.saved[legacy.root]) this.saved[legacy.root] = { input: legacy.input };
  }

  async selectRepository(force = false) {
    const repos = this.gitApi.repositories.filter(isMagiRepository);
    if (!repos.length) throw new Error(t('Open a Magi, Odin or Magicore repository first.'));
    if (!force && this.repo && repos.includes(this.repo)) return true;
    const primary = vscode.workspace.workspaceFolders?.map(folder =>
      repos.filter(repo => folder.uri.fsPath === repo.rootUri.fsPath || folder.uri.fsPath.startsWith(repo.rootUri.fsPath + path.sep))
        .sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0]).find(Boolean);
    const automatic = !force && (primary || (repos.length === 1 ? repos[0] : undefined));
    const item = automatic ? { repo: automatic } : await vscode.window.showQuickPick(
      repos.map(repo => ({ label: path.basename(repo.rootUri.fsPath), description: repo.rootUri.fsPath, repo })),
      { placeHolder: t('Select repository') });
    if (!item) return false;
    if (this.repo?.rootUri.toString() !== item.repo.rootUri.toString()) {
      this.generation++; this.repo = item.repo;
      this.git = new GitRepository(this.repo.rootUri.fsPath, this.gitApi.git.path);
      this.input = null; this.result = null; this.root = buildTree([]); this.filter = '';
      const saved = this.saved[this.repo.rootUri.toString()];
      this.branchInput = saved?.branchInput;
      this.commitInput = saved?.commitInput;
      this.input = saved?.input || null;
      this.events.fire();
    }
    return true;
  }

  async pickRef(prompt, current) {
    const history = this.git.commits(0, current || 'HEAD').catch(error => {
      // A saved branch can disappear after merge/cleanup; keep the selector usable.
      if (current && current !== 'HEAD' && error.code === 128) return this.git.commits();
      throw error;
    });
    const [refs, commits] = await Promise.all([this.git.refs(), history]);
    const item = await vscode.window.showQuickPick([
      { label: t('Enter a branch, tag or commit…'), custom: true },
      ...refs.map(ref => ({ label: ref.name, description: ref.hash, ref: ref.name })),
      ...commits.map(c => ({ label: c.subject, description: `${c.hash.slice(0, 8)} · ${c.author} · ${c.date}`, ref: c.hash })),
    ], { placeHolder: prompt, matchOnDescription: true });
    if (!item) return;
    if (!item.custom) return item.ref;
    return vscode.window.showInputBox({ prompt, value: current || 'HEAD', validateInput: v => v.trim() ? null : t('A revision is required.') });
  }

  async compareBranches() {
    await vscode.commands.executeCommand('kianReview.files.focus');
    if (!await this.selectRepository()) return;
    const input = await this.defaultBranches();
    // The branch button toggles tip/PR modes; returning from commit restores it.
    if (this.input?.mode === 'merge-base') input.mode = 'direct';
    else if (this.input?.mode === 'direct') input.mode = 'merge-base';
    await this.refresh(input);
  }

  async compareCommit() {
    await vscode.commands.executeCommand('kianReview.files.focus');
    if (!await this.selectRepository()) return;
    await this.refresh(this.commitInput || { right: this.input?.right || 'HEAD', mode: 'commit' });
  }

  async defaultBranches() {
    if (this.input && this.input.mode !== 'commit') return { ...this.input };
    if (this.branchInput) return { ...this.branchInput };
    const refs = await this.git.refs();
    const left = ['main', 'origin/main', 'master', 'origin/master'].find(name => refs.some(ref => ref.name === name)) || 'HEAD';
    return { left, right: this.repo.state.HEAD?.name || 'HEAD', mode: 'merge-base' };
  }

  async changeSide(side) {
    if (!await this.selectRepository()) return;
    const input = this.input || await this.defaultBranches();
    const value = await this.pickRef(side === 'left' ? t('Base / left branch') : t('Compare / right branch'), input[side] || this.result?.leftHash || 'HEAD');
    if (!value) return;
    await this.refresh({ ...input, [side]: value, mode: side === 'left' && input.mode === 'commit' ? 'direct' : input.mode });
  }

  async chooseMode() {
    if (!await this.selectRepository()) return;
    const item = await vscode.window.showQuickPick([
      { label: t('Branch tips'), mode: 'direct' },
      { label: t('PR / merge base'), mode: 'merge-base' },
      { label: t('Commit · first parent'), mode: 'commit' },
    ], { placeHolder: t('Comparison mode') });
    if (!item) return;
    await this.refresh(item.mode === 'commit' ? this.commitInput || { right: this.input?.right || 'HEAD', mode: 'commit' }
      : { ...await this.defaultBranches(), mode: item.mode });
  }

  getControls() {
    const mode = this.input?.mode;
    return [
      { control: 'repository', name: t('Repository'), value: this.repo ? path.basename(this.repo.rootUri.fsPath) : t('Select repository'), icon: 'repo' },
      { control: 'mode', name: t('Mode'), value: mode === 'commit' ? t('Commit · first parent') : mode === 'direct' ? t('Branch tips') : t('PR / merge base'), icon: 'git-compare' },
      { control: 'base', name: t('Base'), value: mode === 'commit' ? t('First parent (automatic)') : this.input?.left || 'main', icon: 'git-commit' },
      { control: 'target', name: t('Compare'), value: this.input?.right || this.repo?.state.HEAD?.name || 'HEAD', icon: 'git-branch' },
    ];
  }

  async refresh(input = this.input) {
    if (!this.git && !await this.selectRepository()) return;
    const generation = ++this.generation; const repo = this.repo;
    input = input || this.input || await this.defaultBranches();
    if (generation !== this.generation) return;
    this.view.message = t('Comparing…');
    try {
      const result = await this.git.compare(input);
      if (generation !== this.generation) return;
      this.input = input; this.result = result;
      if (input.mode === 'commit') this.commitInput = { ...input };
      else this.branchInput = { ...input };
      for (const file of result.files) file.comparison = { ...result, files: undefined, repo };
      this.rebuild();
      this.view.description = input.mode === 'commit' ? t('Commit · first parent') : input.mode === 'merge-base' ? t('PR / merge base') : t('Branch tips');
      this.saved[repo.rootUri.toString()] = { input, branchInput: this.branchInput, commitInput: this.commitInput };
      await Promise.all([
        this.context.workspaceState.update('comparison', { root: repo.rootUri.toString(), input }),
        this.context.workspaceState.update('comparisons', this.saved),
      ]);
      this.output?.appendLine(`${result.mode}: ${result.leftHash || 'empty'} -> ${result.rightHash}; ${result.files.length} files`);
    } finally {
      if (generation === this.generation) this.updateMessage();
    }
  }

  updateMessage() {
    if (!this.result) { this.view.message = t('Choose branches or a commit from the toolbar.'); return; }
    const added = this.result.files.reduce((n, f) => n + (f.added || 0), 0);
    const removed = this.result.files.reduce((n, f) => n + (f.removed || 0), 0);
    this.view.message = t('{0} files · +{1} / −{2}', this.result.files.length, added, removed);
    if (this.filter) this.view.message += ' · ' + t('Filter: {0}', this.filter);
  }

  rebuild() {
    this.root = buildTree((this.result?.files || []).filter(f =>
      `${f.path}\n${f.oldPath}`.toLowerCase().includes(this.filter.toLowerCase())));
    this.events.fire(); this.updateMessage();
  }

  getChildren(node) {
    if (node?.control || node?.file) return [];
    const children = [...(node || this.root).children.values()].sort((a, b) =>
      Number(Boolean(b.children)) - Number(Boolean(a.children)) || a.name.localeCompare(b.name));
    if (node) return children;
    return [...this.getControls(), ...children];
  }

  getParent(node) {
    if (node.control) return;
    const parts = (node.file?.path || node.path).split('/');
    parts.pop(); if (!parts.length) return;
    let parent = this.root;
    for (const name of parts) parent = parent.children.get(name);
    return parent;
  }

  async fold(expand) {
    this.folderState = expand ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
    this.foldRevision++;
    this.events.fire();
  }

  getTreeItem(node) {
    const item = new vscode.TreeItem(node.name, node.children ? this.folderState : vscode.TreeItemCollapsibleState.None);
    if (node.control) {
      item.id = `control:${node.control}`; item.contextValue = 'reviewControl';
      item.description = node.value;
      item.tooltip = node.control === 'repository' ? this.repo?.rootUri.fsPath || node.value : node.value;
      if (node.control === 'base' && this.result) item.tooltip += '\n' + (this.result.leftHash || t('Empty tree'));
      if (node.control === 'target' && this.result) item.tooltip += '\n' + this.result.rightHash + '\n' + (this.result.rightWorktree || t('No matching historical worktree; paths refer to the current workspace.'));
      item.iconPath = new vscode.ThemeIcon(node.icon);
      item.command = { command: `kianReview.${node.control}`, title: node.name };
      return item;
    }
    if (node.children) {
      item.id = `folder:${this.foldRevision}:${node.path}`;
      item.description = t('{0} files · +{1} / −{2}', node.stats.count, node.stats.added, node.stats.removed);
      if (node.stats.binary) item.description += ' · ' + t('{0} binary', node.stats.binary);
      item.iconPath = new vscode.ThemeIcon('folder'); return item;
    }
    const f = node.file;
    item.id = `${f.comparison.leftHash || 'empty'}:${f.comparison.rightHash}:${f.path}`;
    item.resourceUri = vscode.Uri.file(path.join(f.comparison.rightWorktree || f.comparison.repo.rootUri.fsPath, f.path));
    item.contextValue = 'reviewFile';
    item.description = `${f.status} · ${f.added === null ? t('Binary') : `+${f.added ?? 0} / −${f.removed ?? 0}`}`;
    item.tooltip = f.path + (f.oldPath !== f.path ? `\n${f.oldPath} → ${f.path}` : '');
    item.tooltip += '\n' + item.resourceUri.fsPath;
    if (!f.comparison.rightWorktree) item.tooltip += '\n' + t('No matching historical worktree; paths refer to the current workspace.');
    item.command = { command: 'kianReview.open', title: t('Open diff'), arguments: [node] };
    return item;
  }

  async open(node) {
    const f = node?.file; if (!f) return;
    const c = f.comparison;
    const resource = p => vscode.Uri.joinPath(c.repo.rootUri, p);
    const empty = p => resource(p).with({ scheme: 'kian-review-empty', query: '' });
    const left = f.status[0] === 'A' || !c.leftHash ? empty(f.path) : this.gitApi.toGitUri(resource(f.oldPath), c.leftHash);
    const right = f.status[0] === 'D' ? empty(f.path) : this.gitApi.toGitUri(resource(f.path), c.rightHash);
    await vscode.commands.executeCommand('vscode.diff', left, right,
      `${f.path} (${c.leftHash?.slice(0, 8) || '∅'} → ${c.rightHash.slice(0, 8)})`, { preview: true });
  }
}

async function activate(context) {
  const gitExtension = vscode.extensions.getExtension('vscode.git');
  const exports = await gitExtension.activate(); const api = exports.getAPI(1);
  const provider = new ReviewProvider(context, api);
  provider.output = vscode.window.createOutputChannel('Kian Review');
  const view = vscode.window.createTreeView('kianReview.files', { treeDataProvider: provider });
  provider.view = view; provider.updateMessage();
  context.subscriptions.push(view, provider.events, provider.output,
    vscode.workspace.registerTextDocumentContentProvider('kian-review-empty', { provideTextDocumentContent: () => '' }));
  const register = (name, fn) => context.subscriptions.push(vscode.commands.registerCommand(`kianReview.${name}`, async (...args) => {
    try {
      if (!vscode.workspace.isTrusted) throw new Error(t('Open a trusted Git repository first.'));
      const result = await fn(...args);
      if (['branches', 'commit', 'refresh', 'compare', 'repository', 'mode', 'base', 'target'].includes(name) && provider.result) {
        await vscode.commands.executeCommand('kianReview.files.focus');
      }
      return result;
    } catch (error) {
      provider.output.appendLine(error.stack || error.message);
      vscode.window.showErrorMessage(t('Kian Review: {0}', error.message));
    }
  }));
  register('branches', () => provider.compareBranches());
  register('commit', () => provider.compareCommit());
  register('refresh', () => provider.refresh());
  register('repository', async () => { if (await provider.selectRepository(true)) await provider.refresh(); });
  register('mode', () => provider.chooseMode());
  register('base', () => provider.changeSide('left'));
  register('target', () => provider.changeSide('right'));
  register('expand', () => provider.fold(true));
  register('collapse', () => provider.fold(false));
  register('editControl', node => node?.control && vscode.commands.executeCommand(`kianReview.${node.control}`));
  register('open', node => provider.open(node));
  register('copyRelative', node => node?.file && vscode.env.clipboard.writeText(node.file.path));
  register('copyAbsolute', async node => {
    if (!node?.file) return;
    const c = node.file.comparison;
    await vscode.env.clipboard.writeText(path.join(c.rightWorktree || c.repo.rootUri.fsPath, node.file.path));
    if (!c.rightWorktree) vscode.window.showInformationMessage(t('Copied the current workspace path; no worktree matches the reviewed revision.'));
  });
  register('openWorkingFile', async node => {
    if (node?.file) await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(node.file.comparison.rightWorktree || node.file.comparison.repo.rootUri.fsPath, node.file.path)));
  });
  register('filter', async () => {
    const value = await vscode.window.showInputBox({ prompt: t('Filter file paths (empty clears filter)'), value: provider.filter });
    if (value !== undefined) { provider.filter = value; provider.rebuild(); }
  });
  register('swap', async () => {
    if (provider.input?.mode === 'commit') return provider.compareBranches();
    if (provider.input) await provider.refresh({ ...provider.input, left: provider.input.right, right: provider.input.left });
  });
  // Public read-only command also permits repeatable Extension Host integration tests.
  register('compare', async ({ root, left, right, mode = 'direct' }) => {
    const repo = api.repositories.find(r => r.rootUri.fsPath === root);
    if (!repo) throw new Error(t('Repository is not open: {0}', root));
    provider.repo = repo; provider.git = new GitRepository(root, api.git.path);
    await provider.refresh({ left, right, mode }); return provider.result;
  });
  register('show', () => vscode.commands.executeCommand('kianReview.files.focus'));
  const initialize = async () => {
    if (provider.repo || !api.repositories.some(isMagiRepository)) return;
    try { if (await provider.selectRepository()) await provider.refresh(); }
    catch (error) { provider.output.appendLine(error.stack || error.message); provider.updateMessage(); }
  };
  context.subscriptions.push(api.onDidOpenRepository(initialize));
  await initialize();
  return { provider };
}

module.exports = { activate };
