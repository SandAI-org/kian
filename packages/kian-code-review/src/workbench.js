const vscode = require('vscode');
const crypto = require('node:crypto');
const t = (...args) => vscode.l10n.t(...args);

function errorMessage(error) {
  return error.git?.timedOut ? t('Git timed out after {0} seconds per attempt (retried once). The previous comparison is unchanged. Try again.', error.git.timeoutMs / 1000)
    : error.message;
}

function logError(output, error) {
  output?.appendLine(error.stack || error.message);
  if (error.git) output?.appendLine(JSON.stringify(error.git));
}

class ReviewWorkbench {
  constructor(context, provider) {
    this.context = context; this.provider = provider; this.message = ''; this.description = '';
    this.revision = 0; this.visible = false;
    this.visibility = new vscode.EventEmitter(); this.onDidChangeVisibility = this.visibility.event;
    this.subscription = provider.onDidChangeTreeData(() => this.update());
  }

  resolveWebviewView(view) {
    this.webviewView = view; this.visible = view.visible;
    this.visibility.fire({ visible: this.visible });
    const webview = view.webview;
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] };
    webview.html = this.html(webview);
    this.listeners = [webview.onDidReceiveMessage(message => this.receive(message)),
      view.onDidChangeVisibility(() => {
        this.visible = view.visible; this.visibility.fire({ visible: this.visible });
        if (this.visible) this.update();
      }), view.onDidDispose(() => { this.visible = false; this.webviewView = null; this.revision++; this.listeners.forEach(l => l.dispose()); })];
  }

  html(webview) {
    const nonce = crypto.randomBytes(24).toString('hex');
    const asset = name => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', name));
    return `<!doctype html><html lang="${vscode.env.language}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${asset('workbench.css')}"><title>Kian Review</title></head><body><main id="app"></main><script nonce="${nonce}" src="${asset('file-filter.js')}"></script><script nonce="${nonce}" src="${asset('workbench.js')}"></script></body></html>`;
  }

  async snapshot() {
    const p = this.provider, result = p.result;
    const labels = Object.fromEntries(['Repository', 'Mode', 'Base', 'Compare', 'Commit', 'Branch tips', 'PR / merge base',
      'Commit · first parent', 'PR', 'Branch Diff', 'Commit Diff', 'First parent (automatic)', 'History', 'Changed files', 'Details', 'Hide details', 'Show details',
      'Search commits', 'Filter files', 'Load older commits…', 'Previous Commit (Older)', 'Next Commit (Newer)',
      'Expand All Folders', 'Collapse All Folders', 'Refresh Comparison', 'Swap Base and Compare', 'Copy Relative Path',
      'Copy Compare-side Absolute Path', 'Open Working File', 'Empty tree', 'No commits in this range.', 'No matching files.',
      'Choose branches or a commit from the toolbar.', 'Parents', 'Author', 'Date', 'Binary', 'Working tree path',
      'No matching historical worktree; paths refer to the current workspace.', 'Select repository',
      'Reviewed files', 'Mark reviewed', 'Mark unread', 'Updated since review', 'Since last review', 'Full comparison',
      'Base changed; the target file is unchanged. Check the full comparison.', 'Private questions', 'Copy prompts', 'Add private question',
      'Resolve', 'Reopen', 'Edit', 'Resolved', 'Open', 'Submit to GitHub…', 'Published', 'Local only', 'No private questions.',
      'History visibility', 'Connect PR', 'Updates available', 'Refresh to review the new version. Your current view is unchanged.',
      'Local refs only; connect a PR to detect updates on GitHub.', 'Update check failed', 'Anchor version changed', 'Show resolved', 'All matching files are reviewed.',
      'Include files', 'Exclude files', 'Use regular expressions', 'Invalid include pattern', 'Invalid exclude pattern', 'Unclosed glob group',
      'Comma separates OR conditions. Glob: *.py, src/**, *.{cu,cpp}. Plain text matches substrings.',
      'Regular expressions, case insensitive. Commas outside groups separate OR conditions. Escape a literal comma with \\,.'].map(text => [text, t(text)]));
    if (!result) return { labels, controls: p.getControls(), files: [], commits: [], key: '', summary: this.message };
    const git = p.git, input = { ...p.input };
    const source = input.mode === 'commit' ? p.commitHistory.tip : result.rightHash;
    const exclude = input.mode === 'commit' ? undefined : result.leftHash;
    const historyKey = `${git.root}:${source}:${exclude || ''}`;
    if (this.history?.key !== historyKey) {
      const commits = await git.commits(0, source, exclude);
      if (p.git !== git || p.result !== result) return;
      this.history = { key: historyKey, source, exclude, git, commits, more: commits.length === 200 };
    }
    const body = await git.exec(['show', '-s', '--format=%B%x00%an%x00%aI%x00%P', result.rightHash, '--']);
    if (p.git !== git || p.result !== result) return;
    const [message, author, date, parents] = body.trimEnd().split('\0');
    const review = await p.review.state(p.reviewSession);
    if (p.git !== git || p.result !== result) return;
    const position = input.mode === 'commit' ? p.commitHistory.hashes.indexOf(result.rightHash) : -1;
    return { labels, controls: p.getControls(), filter: p.filter, files: result.files.filter(f => `${f.path}\n${f.oldPath}`.toLowerCase().includes(p.filter.toLowerCase())).map(({ path, oldPath, status, added, removed }) => ({ path, oldPath, status, added, removed })),
      commits: this.history.commits, more: this.history.more, historyKey, mode: input.mode,
      selected: input.mode === 'commit' ? result.rightHash : null, left: result.leftHash, right: result.rightHash,
      key: `${git.root}:${result.leftHash}:${result.rightHash}:${input.mode}:${p.reviewSession.scope}`, root: git.root,
      canPrevious: position >= 0 && position + 1 < p.commitHistory.hashes.length, canNext: position > 0,
      review, update: p.review.updateInfo, pr: input.pr,
      details: { message, author, date, parents: parents?.split(' ').filter(Boolean) || [], worktree: result.rightWorktree },
      summary: t('{0} files · +{1} / −{2}', result.files.length, result.files.reduce((n, f) => n + (f.added || 0), 0), result.files.reduce((n, f) => n + (f.removed || 0), 0)) };
  }

  async update() {
    const revision = ++this.revision;
    if (!this.webviewView || !this.visible) return;
    try {
      const state = await this.snapshot();
      if (!state || revision !== this.revision || !this.webviewView) return;
      this.state = state;
      await this.webviewView.webview.postMessage({ type: 'state', state });
    } catch (error) {
      if (revision === this.revision) this.error(error);
    }
  }

  error(error) {
    logError(this.provider.output, error);
    this.webviewView?.webview.postMessage({ type: 'error', message: t('Kian Review: {0}', errorMessage(error)) });
  }

  async receive(message) {
    try {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'ready') return this.update();
      if (!['action', 'mode', 'commit', 'older', 'file', 'note'].includes(message.type)) return;
      if (!vscode.workspace.isTrusted) throw new Error(t('Open a trusted Git repository first.'));
      const p = this.provider;
      const currentKey = p.result ? `${p.git.root}:${p.result.leftHash}:${p.result.rightHash}:${p.input.mode}:${p.reviewSession.scope}` : '';
      if (message.key !== this.state?.key || message.key !== currentKey) return this.update();
      if (message.type === 'action') {
        const actions = { repository: 'repository', base: 'base', target: 'target', refresh: 'refresh', swap: 'swap', previous: 'previousCommit', next: 'nextCommit', connectPR: 'connectPR', copyPrompts: 'copyPrompts', addNote: 'addPrivateNote' };
        if (Object.hasOwn(actions, message.action)) await vscode.commands.executeCommand(`kianReview.${actions[message.action]}`);
      } else if (message.type === 'mode' && ['direct', 'merge-base', 'commit'].includes(message.mode)) {
        await p.refresh(message.mode === 'commit' ? p.commitInput || { right: p.input?.right || 'HEAD', mode: 'commit' }
          : { ...await p.defaultBranches(), mode: message.mode });
      } else if (message.type === 'commit' && this.history?.commits.some(c => c.hash === message.hash)) {
        await p.refresh({ right: message.hash, mode: 'commit' });
      } else if (message.type === 'older' && this.history?.more) {
        const history = this.history;
        const commits = await history.git.commits(history.commits.length, history.source, history.exclude);
        if (this.history !== history) return;
        history.commits.push(...commits); history.more = commits.length === 200;
      } else if (message.type === 'file' && ['open', 'copyRelative', 'copyAbsolute', 'openWorkingFile', 'reviewed', 'unread', 'incremental'].includes(message.action)) {
        const file = p.result?.files.find(file => file.path === message.path);
        if (file && ['reviewed', 'unread'].includes(message.action)) await p.review.mark(file, message.action === 'reviewed');
        else if (file) await vscode.commands.executeCommand(`kianReview.${message.action === 'incremental' ? 'open' : message.action}`, { file, incremental: message.action === 'incremental' });
      } else if (message.type === 'note' && ['edit', 'resolve', 'reopen', 'open', 'publish'].includes(message.action)) {
        if (message.action === 'publish') await p.review.publish(message.id);
        else await p.review.noteAction(message.id, message.action);
      }
      await this.update();
    } catch (error) { this.error(error); }
  }

  dispose() {
    this.revision++; this.subscription.dispose(); this.visibility.dispose(); this.listeners?.forEach(l => l.dispose());
  }
}

module.exports = { ReviewWorkbench, errorMessage, logError };
