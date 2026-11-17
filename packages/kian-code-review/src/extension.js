const vscode = require('vscode');
const path = require('node:path');
const { GitRepository, isMagiRepository } = require('./git');
const { ReviewWorkbench, errorMessage, logError } = require('./workbench');
const { ReviewService } = require('./review');
const t = (...args) => vscode.l10n.t(...args);

class ReviewProvider {
  constructor(context, gitApi) {
    this.context = context; this.gitApi = gitApi; this.generation = 0;
    this.events = new vscode.EventEmitter(); this.onDidChangeTreeData = this.events.event;
    this.filter = ''; this.input = null; this.repo = null;
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
      this.input = null; this.result = null; this.filter = '';
      this.commitHistory = null;
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
    if (this.input?.mode === 'commit') return this.changeSide('right');
    await this.refresh(this.commitInput || { right: this.input?.right || 'HEAD', mode: 'commit' });
  }

  async pickCommit(current) {
    let source = this.branchInput?.right || this.repo.state.HEAD?.name || 'HEAD';
    let hash;
    try { hash = await this.git.resolve(source); }
    catch (error) {
      if (source === 'HEAD' || error.code !== 128) throw error;
      source = 'HEAD'; hash = await this.git.resolve(source);
    }
    await this.loadCommitHistory(hash, this.branchInput?.pr?.headRef && source === this.branchInput.right ? this.branchInput.pr.headRef : source);
    let skip = 0;
    while (true) {
      const commits = await this.git.commits(skip, hash);
      const item = await vscode.window.showQuickPick([
        { label: t('Enter a commit SHA or revision…'), custom: true, alwaysShow: true },
        ...commits.map(c => ({ label: `${c.hash.slice(0, 8)}  ${c.subject}`,
          description: `${c.author} · ${c.date}`, detail: c.hash === this.result?.rightHash ? t('Current commit') : undefined, hash: c.hash })),
        ...(commits.length === 200 ? [{ label: t('Load older commits…'), more: true, alwaysShow: true }] : []),
      ], { placeHolder: t('Select a commit from {0}', source), matchOnDescription: true, matchOnDetail: true });
      if (!item) return;
      if (item.more) { skip += commits.length; continue; }
      if (!item.custom) return item.hash;
      const value = await vscode.window.showInputBox({ prompt: t('Commit or revision'), value: current || 'HEAD' });
      return value?.trim() ? this.git.resolve(value.trim()) : undefined;
    }
  }

  async loadCommitHistory(hash, source = hash) {
    if (source === 'HEAD') source = this.repo.state.HEAD?.name || 'HEAD';
    if (/^[0-9a-f]{40,64}$/i.test(source)) source = source.slice(0, 8);
    if (this.commitHistory?.tip === hash && this.commitHistory.root === this.git.root) { this.commitHistory.source = source; return; }
    const hashes = (await this.git.exec(['rev-list', '--topo-order', hash, '--'])).trim().split('\n').filter(Boolean);
    this.commitHistory = { tip: hash, source, root: this.git.root, hashes };
  }

  async navigateCommit(direction) {
    if (this.input?.mode !== 'commit' || !this.result) return;
    const hashes = this.commitHistory?.hashes || [];
    const index = hashes.indexOf(this.result.rightHash);
    const hash = index >= 0 ? hashes[index + direction] : undefined;
    if (hash) await this.refresh({ right: hash, mode: 'commit' });
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
    const value = side === 'right' && input.mode === 'commit' ? await this.pickCommit(input.right)
      : await this.pickRef(side === 'left' ? t('Base / left branch') : t('Compare / right branch'), input[side] || this.result?.leftHash || 'HEAD');
    if (!value) return;
    const next = { ...input, [side]: value, mode: side === 'left' && input.mode === 'commit' ? 'direct' : input.mode };
    delete next.pr; delete next.reviewKey;
    await this.refresh(next);
  }

  async chooseMode() {
    if (!await this.selectRepository()) return;
    const item = await vscode.window.showQuickPick([
      { label: t('Branch Diff'), description: t('Branch tips'), mode: 'direct' },
      { label: t('PR'), description: t('PR / merge base'), mode: 'merge-base' },
      { label: t('Commit Diff'), description: t('Commit vs first parent (initial commits compare with empty)'), mode: 'commit' },
    ], { placeHolder: t('Comparison mode') });
    if (!item) return;
    await this.refresh(item.mode === 'commit' ? this.commitInput || { right: this.input?.right || 'HEAD', mode: 'commit' }
      : { ...await this.defaultBranches(), mode: item.mode });
  }

  getControls() {
    const mode = this.input?.mode;
    return [
      { control: 'repository', name: t('Repository'), value: this.repo ? path.basename(this.repo.rootUri.fsPath) : t('Select repository'), icon: 'repo' },
      { control: 'mode', name: t('Mode'), value: mode === 'commit' ? t('Commit Diff') : mode === 'direct' ? t('Branch Diff') : t('PR'), icon: 'git-compare' },
      { control: 'base', name: t('Base'), title: mode === 'commit' ? t('First parent (automatic)') : undefined, value: mode === 'commit' ? this.result?.leftHash?.slice(0, 8) || t('Empty tree') : this.input?.pr?.baseRef || this.input?.left || 'main', icon: 'git-commit' },
      { control: 'target', name: mode === 'commit' ? `${t('Commit')} · ${this.commitHistory?.source || this.input?.right || 'HEAD'}` : t('Compare'),
        value: mode === 'commit' && this.result ? this.result.rightHash.slice(0, 8) : this.input?.pr?.headRef || this.input?.right || this.repo?.state.HEAD?.name || 'HEAD', icon: mode === 'commit' ? 'git-commit' : 'git-branch' },
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
      const reviewSession = await this.review.prepare(this.git, input, result);
      let commit;
      if (input.mode === 'commit') {
        if (!this.commitHistory || this.commitHistory.root !== this.git.root || !this.commitHistory.hashes.includes(result.rightHash)) {
          let source = this.branchInput?.right || this.repo.state.HEAD?.name || 'HEAD';
          let tip;
          try { tip = await this.git.resolve(source); }
          catch (error) { if (error.code !== 128) throw error; tip = result.rightHash; source = result.rightHash; }
          await this.loadCommitHistory(tip, this.branchInput?.pr?.headRef && source === this.branchInput.right ? this.branchInput.pr.headRef : source);
          if (!this.commitHistory.hashes.includes(result.rightHash)) await this.loadCommitHistory(result.rightHash);
        }
        const [subject, author, date] = (await this.git.exec(['show', '-s', '--format=%s%x00%an%x00%as', result.rightHash, '--'])).trimEnd().split('\0');
        commit = { subject, author, date };
      }
      if (generation !== this.generation) return;
      this.input = input; this.result = result; this.currentCommit = commit; this.reviewSession = reviewSession;
      this.review.updateInfo = { available: false };
      const position = input.mode === 'commit' ? this.commitHistory.hashes.indexOf(result.rightHash) : -1;
      await Promise.all([
        vscode.commands.executeCommand('setContext', 'kianReview.hasPreviousCommit', position >= 0 && position + 1 < this.commitHistory.hashes.length),
        vscode.commands.executeCommand('setContext', 'kianReview.hasNextCommit', position > 0),
      ]);
      if (input.mode === 'commit') this.commitInput = { ...input };
      else this.branchInput = { ...input };
      for (const file of result.files) file.comparison = { ...result, files: undefined, repo };
      this.rebuild();
      this.view.description = input.mode === 'commit' ? t('Commit Diff') : input.mode === 'merge-base' ? t('PR') : t('Branch Diff');
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
    this.events.fire(); this.updateMessage();
  }

  async fold(expand) {
    this.view.webviewView?.webview.postMessage({ type: 'fold', expand });
  }

  async open(node) {
    const f = node?.file; if (!f) return;
    await this.review.open(f, Boolean(node.incremental));
  }
}

async function activate(context) {
  const gitExtension = vscode.extensions.getExtension('vscode.git');
  const exports = await gitExtension.activate(); const api = exports.getAPI(1);
  const provider = new ReviewProvider(context, api);
  provider.review = new ReviewService(context, provider);
  provider.output = vscode.window.createOutputChannel('Kian Review');
  const workbench = new ReviewWorkbench(context, provider);
  provider.view = workbench; provider.updateMessage();
  context.subscriptions.push(provider.review, workbench, vscode.window.registerWebviewViewProvider('kianReview.files', workbench), provider.events, provider.output,
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
      logError(provider.output, error);
      vscode.window.showErrorMessage(t('Kian Review: {0}', errorMessage(error)));
    }
  }));
  register('branches', () => provider.compareBranches());
  register('commit', () => provider.compareCommit());
  register('refresh', () => provider.review.refresh());
  register('repository', async () => { if (await provider.selectRepository(true)) await provider.refresh(); });
  register('mode', () => provider.chooseMode());
  register('base', () => provider.changeSide('left'));
  register('target', () => provider.changeSide('right'));
  register('previousCommit', () => provider.navigateCommit(1));
  register('nextCommit', () => provider.navigateCommit(-1));
  register('expand', () => provider.fold(true));
  register('collapse', () => provider.fold(false));
  register('open', node => provider.open(node));
  register('addPrivateNote', () => provider.review.addAtSelection());
  register('savePrivateNote', reply => provider.review.addReply(reply));
  register('resolvePrivateNote', thread => provider.review.threadAction(thread, 'resolve'));
  register('reopenPrivateNote', thread => provider.review.threadAction(thread, 'reopen'));
  register('copyPrompts', () => provider.review.copyPrompts());
  register('connectPR', () => provider.review.connectPR());
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
    await vscode.commands.executeCommand('kianReview.files.focus');
    provider.view.webviewView?.webview.postMessage({ type: 'focusFilter' });
  });
  register('swap', async () => {
    if (provider.input?.mode === 'commit') return provider.compareBranches();
    if (provider.input) {
      const input = { ...provider.input, left: provider.input.right, right: provider.input.left };
      delete input.pr; delete input.reviewKey; await provider.refresh(input);
    }
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
    catch (error) { logError(provider.output, error); provider.updateMessage(); }
  };
  context.subscriptions.push(api.onDidOpenRepository(initialize));
  await initialize();
  return { provider, workbench };
}

module.exports = { activate };
