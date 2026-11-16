const vscode = require('vscode');
const path = require('node:path');
const { GitRepository, buildTree } = require('./git');
const t = (...args) => vscode.l10n.t(...args);

class ReviewProvider {
  constructor(context, gitApi) {
    this.context = context; this.gitApi = gitApi; this.generation = 0;
    this.events = new vscode.EventEmitter(); this.onDidChangeTreeData = this.events.event;
    this.root = buildTree([]); this.filter = ''; this.input = null; this.repo = null;
  }

  async selectRepository() {
    const repos = this.gitApi.repositories;
    if (!repos.length) throw new Error(t('Open a trusted Git repository first.'));
    const item = repos.length === 1 ? { repo: repos[0] } : await vscode.window.showQuickPick(
      repos.map(repo => ({ label: path.basename(repo.rootUri.fsPath), description: repo.rootUri.fsPath, repo })),
      { placeHolder: t('Select repository') });
    if (!item) return false;
    if (this.repo?.rootUri.toString() !== item.repo.rootUri.toString()) {
      this.generation++; this.repo = item.repo;
      this.git = new GitRepository(this.repo.rootUri.fsPath, this.gitApi.git.path);
      this.input = null; this.result = null; this.root = buildTree([]); this.filter = '';
      this.events.fire();
    }
    return true;
  }

  async pickRef(prompt, current) {
    const refs = await this.git.refs();
    const item = await vscode.window.showQuickPick([
      { label: t('Enter a branch, tag or commit…'), custom: true },
      ...refs.map(ref => ({ label: ref.name, description: ref.hash, ref: ref.name })),
    ], { placeHolder: prompt, matchOnDescription: true });
    if (!item) return;
    if (!item.custom) return item.ref;
    return vscode.window.showInputBox({ prompt, value: current || 'HEAD', validateInput: v => v.trim() ? null : t('A revision is required.') });
  }

  async compareBranches() {
    if (!await this.selectRepository()) return;
    const left = await this.pickRef(t('Base / left branch'), this.input?.left);
    if (!left) return;
    const right = await this.pickRef(t('Compare / right branch'), this.input?.right);
    if (!right) return;
    const mode = await vscode.window.showQuickPick([
      { label: t('Branch tips'), description: t('Compare the two complete committed versions'), mode: 'direct' },
      { label: t('PR / merge base'), description: t('Changes from the common ancestor to the right branch'), mode: 'merge-base' },
    ], { placeHolder: t('Comparison mode') });
    if (mode) await this.refresh({ left, right, mode: mode.mode });
  }

  async compareCommit() {
    if (!await this.selectRepository()) return;
    let skip = 0;
    while (true) {
      const commits = await this.git.commits(skip);
      const item = await vscode.window.showQuickPick([
        { label: t('Enter a commit or revision…'), custom: true },
        ...commits.map(c => ({ label: c.subject, description: `${c.hash.slice(0, 8)} · ${c.author} · ${c.date}`, hash: c.hash })),
        ...(commits.length === 200 ? [{ label: t('Load older commits…'), more: true }] : []),
      ], { placeHolder: t('Commit vs first parent (initial commits compare with empty)'), matchOnDescription: true });
      if (!item) return;
      if (item.more) { skip += commits.length; continue; }
      const right = item.custom ? await vscode.window.showInputBox({ prompt: t('Commit or revision'), value: 'HEAD' }) : item.hash;
      if (right) await this.refresh({ right, mode: 'commit' });
      return;
    }
  }

  async refresh(input = this.input) {
    if (!input || !this.git) return this.compareBranches();
    const generation = ++this.generation; const repo = this.repo;
    this.view.message = t('Comparing…');
    try {
      const result = await this.git.compare(input);
      if (generation !== this.generation) return;
      this.input = input; this.result = result;
      for (const file of result.files) file.comparison = { ...result, files: undefined, repo };
      this.rebuild();
      await this.context.workspaceState.update('comparison', { root: repo.rootUri.toString(), input });
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
    if (node?.meta || node?.file) return [];
    const children = [...(node || this.root).children.values()].sort((a, b) =>
      Number(Boolean(b.children)) - Number(Boolean(a.children)) || a.name.localeCompare(b.name));
    if (node) return children;
    if (!this.result) return [];
    const left = this.result.leftHash?.slice(0, 8) || t('Empty tree');
    const right = this.result.rightHash.slice(0, 8);
    return [{ meta: true, name: `${this.input.left || left} → ${this.input.right.length > 16 ? right : this.input.right}` }, ...children];
  }

  getTreeItem(node) {
    const item = new vscode.TreeItem(node.name, node.children ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    if (node.meta) {
      item.description = this.result.mode === 'commit' ? t('Commit · first parent') : this.result.mode === 'merge-base' ? t('PR / merge base') : t('Branch tips');
      item.tooltip = `${this.repo.rootUri.fsPath}\n${this.result.leftHash || t('Empty tree')} → ${this.result.rightHash}`;
      if (this.result.parentCount > 1) item.tooltip += '\n' + t('Merge commit: compared with first parent.');
      item.iconPath = new vscode.ThemeIcon('git-compare'); return item;
    }
    if (node.children) { item.iconPath = new vscode.ThemeIcon('folder'); return item; }
    const f = node.file;
    item.id = `${f.comparison.rightHash}:${f.path}`;
    item.resourceUri = vscode.Uri.joinPath(f.comparison.repo.rootUri, f.path);
    item.contextValue = 'reviewFile';
    item.description = `${f.status} · ${f.added === null ? t('Binary') : `+${f.added ?? 0} / −${f.removed ?? 0}`}`;
    item.tooltip = f.path + (f.oldPath !== f.path ? `\n${f.oldPath} → ${f.path}` : '');
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
  const view = vscode.window.createTreeView('kianReview.files', { treeDataProvider: provider, showCollapseAll: true });
  provider.view = view; provider.updateMessage();
  context.subscriptions.push(view, provider.events,
    vscode.workspace.registerTextDocumentContentProvider('kian-review-empty', { provideTextDocumentContent: () => '' }));
  const register = (name, fn) => context.subscriptions.push(vscode.commands.registerCommand(`kianReview.${name}`, async (...args) => {
    try {
      if (!vscode.workspace.isTrusted) throw new Error(t('Open a trusted Git repository first.'));
      return await fn(...args);
    } catch (error) { vscode.window.showErrorMessage(t('Kian Review: {0}', error.message)); }
  }));
  register('branches', () => provider.compareBranches());
  register('commit', () => provider.compareCommit());
  register('refresh', () => provider.refresh());
  register('repository', () => provider.selectRepository());
  register('open', node => provider.open(node));
  register('copyRelative', node => node?.file && vscode.env.clipboard.writeText(node.file.path));
  register('copyAbsolute', node => node?.file && vscode.env.clipboard.writeText(vscode.Uri.joinPath(node.file.comparison.repo.rootUri, node.file.path).fsPath));
  register('openWorkingFile', async node => {
    if (node?.file) await vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(node.file.comparison.repo.rootUri, node.file.path));
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
  const saved = context.workspaceState.get('comparison');
  if (saved) {
    const restore = async () => {
      if (provider.input) return;
      const repo = api.repositories.find(r => r.rootUri.toString() === saved.root);
      if (repo) {
        provider.repo = repo; provider.git = new GitRepository(repo.rootUri.fsPath, api.git.path);
        try { await provider.refresh(saved.input); } catch { provider.updateMessage(); }
      }
    };
    context.subscriptions.push(api.onDidOpenRepository(restore)); await restore();
  }
  return { provider };
}

module.exports = { activate };
