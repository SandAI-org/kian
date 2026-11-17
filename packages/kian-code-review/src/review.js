const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ReviewStore, scopeKey, reviewStatus, promptsMarkdown } = require('./review-store');
const { GitHubAPI, parseRepository, parsePullRequest, patchContainsRange } = require('./github');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const t = (...args) => vscode.l10n.t(...args);

class ReviewService {
  constructor(context, provider) {
    this.provider = provider;
    this.store = new ReviewStore(path.join(context.globalStorageUri.fsPath, 'reviews'));
    this.documents = new Map(); this.threads = new Map(); this.threadNotes = new WeakMap(); this.commentNotes = new WeakMap();
    this.controller = vscode.comments.createCommentController('kianReview.notes', t('Kian Review · Private notes'));
    this.controller.options = { prompt: t('Add a private question'), placeHolder: t('Private prompt for your agent; nothing is posted to GitHub.') };
    this.controller.commentingRangeProvider = { provideCommentingRanges: doc => this.documents.has(doc.uri.toString())
      ? [new vscode.Range(0, 0, Math.max(0, doc.lineCount - 1), 0)] : [] };
    this.editorListener = vscode.window.onDidChangeActiveTextEditor(editor => vscode.commands.executeCommand('setContext', 'kianReview.noteDocument', Boolean(editor && this.documents.has(editor.document.uri.toString()))));
    this.updateInfo = { available: false };
    this.timer = setInterval(() => this.checkUpdates(), 30000); this.timer.unref();
    const denied = () => { throw vscode.FileSystemError.NoPermissions(); };
    this.fsRegistration = vscode.workspace.registerFileSystemProvider('kian-review-cache', {
      onDidChangeFile: new vscode.EventEmitter().event, watch: () => new vscode.Disposable(() => {}),
      stat: async uri => { const s = await fs.stat(this.cachedPath(uri)); return { type: vscode.FileType.File, ctime: s.ctimeMs, mtime: s.mtimeMs, size: s.size }; },
      readFile: uri => fs.readFile(this.cachedPath(uri)), readDirectory: () => [], writeFile: denied, rename: denied, delete: denied, createDirectory: denied,
    }, { isReadonly: true, isCaseSensitive: true });
  }
  cachedPath(uri) { return this.store.objectPath(uri.path.split('/')[1]); }
  cachedUri(object, name) { return vscode.Uri.from({ scheme: 'kian-review-cache', path: `/${object.oid}/${path.basename(name)}` }); }
  async prepare(git, input, result) {
    const common = (await git.exec(['rev-parse', '--git-common-dir'])).trim();
    const identity = await fs.realpath(path.resolve(git.root, common));
    const notesInput = input.mode === 'commit' && this.provider.branchInput ? this.provider.branchInput : input;
    return { scope: scopeKey(identity, input, result), notesScope: scopeKey(identity, { ...notesInput, mode: 'notes' }, result),
      git, input: { ...input }, result, root: git.root };
  }
  async state(session) {
    if (!session) return { files: {}, notes: [] };
    const records = new Map((await this.store.entries(session.scope, 'files')).map(record => [record.path, record]));
    return { files: Object.fromEntries(session.result.files.map(file => [file.path, reviewStatus(file, records.get(file.path) || records.get(file.oldPath))])),
      notes: (await this.store.entries(session.notesScope, 'notes')).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) };
  }
  async mark(file, reviewed) {
    const session = this.provider.reviewSession;
    if (!session) return;
    await this.store.mark(session.scope, file, session.result, session.git, reviewed);
    await this.provider.view.update();
  }
  async registerDocument(uri, anchor, session) {
    this.documents.set(uri.toString(), { anchor: { ...anchor, uri: uri.toString() }, session });
    for (const note of await this.store.entries(session.notesScope, 'notes')) {
      if (note.anchor.uri === uri.toString()) this.showThread(note, session);
    }
  }
  showThread(note, session, thread) {
    const key = session.notesScope + ':' + note.id;
    thread = thread || this.threads.get(key) || this.controller.createCommentThread(vscode.Uri.parse(note.anchor.uri),
      new vscode.Range(note.anchor.start, 0, note.anchor.end, 0), []);
    this.threads.set(key, thread); this.threadNotes.set(thread, { id: note.id, session });
    const body = new vscode.MarkdownString(); body.appendText(note.text);
    const comment = { body, timestamp: new Date(note.createdAt), mode: vscode.CommentMode.Preview, contextValue: 'kianPrivateNote', author: { name: t('Private prompt') }, label: note.published ? t('Published') : t('Local only') };
    this.commentNotes.set(comment, { id: note.id, session, thread });
    thread.comments = [comment];
    thread.contextValue = note.resolved ? 'kianNoteResolved' : 'kianNoteOpen';
    thread.label = note.resolved ? t('Resolved') : t('Private question');
    thread.state = note.resolved ? vscode.CommentThreadState.Resolved : vscode.CommentThreadState.Unresolved;
    thread.canReply = false;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
    return thread;
  }
  async addReply(reply) {
    const registered = this.documents.get(reply.thread?.uri.toString());
    if (!registered || !reply.thread.range || !reply.text?.trim()) return;
    if (reply.text.length > 65536) throw new Error(t('A private prompt must be at most 65536 characters.'));
    const note = await this.store.addNote(registered.session.notesScope, { ...registered.anchor,
      start: reply.thread.range.start.line, end: reply.thread.range.end.line }, reply.text.trim());
    this.showThread(note, registered.session, reply.thread); await this.provider.view.update();
  }
  async addAtSelection() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.documents.has(editor.document.uri.toString())) throw new Error(t('Open a Kian Review diff and select a code line first.'));
    const text = await vscode.window.showInputBox({ prompt: t('Private prompt for your agent; nothing is posted to GitHub.'), ignoreFocusOut: true });
    if (!text?.trim()) return;
    const thread = this.controller.createCommentThread(editor.document.uri, editor.selection, []);
    await this.addReply({ thread, text });
  }
  async noteAction(id, action, session = this.provider.reviewSession) {
    const note = await this.store.read(session.notesScope, 'notes', id);
    if (!note) return;
    if (action === 'edit') {
      await vscode.window.showTextDocument(vscode.Uri.parse(note.anchor.uri), { preview: true,
        selection: new vscode.Range(note.anchor.start, 0, note.anchor.end, 0) });
      const thread = this.threads.get(session.notesScope + ':' + id) || this.showThread(note, session);
      const comment = thread.comments[0];
      if (comment.mode !== vscode.CommentMode.Editing) {
        comment.body = note.text;
        comment.mode = vscode.CommentMode.Editing;
        thread.comments = [comment];
      }
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
      return;
    } else if (action === 'resolve' || action === 'reopen') note.resolved = action === 'resolve';
    else if (action === 'open') {
      const uri = vscode.Uri.parse(note.anchor.uri);
      await vscode.window.showTextDocument(uri, { preview: true, selection: new vscode.Range(note.anchor.start, 0, note.anchor.end, 0) });
      return;
    } else return;
    await this.store.write(session.notesScope, 'notes', note.id, note);
    if (this.threads.has(session.notesScope + ':' + id)) this.showThread(note, session);
    await this.provider.view.update();
  }
  async finishEdit(comment, save) {
    const entry = this.commentNotes.get(comment);
    if (!entry) return;
    const note = await this.store.read(entry.session.notesScope, 'notes', entry.id);
    if (!note) return;
    if (save) {
      const text = typeof comment.body === 'string' ? comment.body : comment.body.value;
      if (!text.trim() || text.length > 65536) {
        const draft = { ...comment, mode: vscode.CommentMode.Editing };
        this.commentNotes.set(draft, entry); entry.thread.comments = [draft];
        throw new Error(t('A private prompt must contain text and be at most 65536 characters.'));
      }
      if (note.text !== text.trim()) note.updatedAt = new Date().toISOString();
      note.text = text.trim();
      await this.store.write(entry.session.notesScope, 'notes', note.id, note);
    }
    this.showThread(note, entry.session, entry.thread).collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    await this.provider.view.update();
  }
  async threadAction(thread, action) {
    const note = this.threadNotes.get(thread);
    if (note) await this.noteAction(note.id, action, note.session);
  }
  async copyPrompts() {
    const session = this.provider.reviewSession;
    if (!session) return;
    const text = promptsMarkdown(await this.store.entries(session.notesScope, 'notes'), session.root);
    await vscode.env.clipboard.writeText(text);
  }
  async github(interactive) {
    const session = await vscode.authentication.getSession('github', ['repo'], interactive ? { createIfNone: true } : { silent: true });
    if (!session) return;
    const noProxy = (process.env.no_proxy || process.env.NO_PROXY || '').split(',').map(s => s.trim());
    const bypass = noProxy.some(s => s === '*' || s === 'api.github.com' || s === 'github.com' || s === '.github.com');
    const proxy = bypass ? undefined : vscode.workspace.getConfiguration('http').get('proxy') || process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY;
    return new GitHubAPI(session.accessToken, proxy, t);
  }
  async fetchPR(api, link) {
    const p = this.provider, repo = p.repo, git = p.git;
    const pr = await api.request(`/repos/${link.repository}/pulls/${link.number}`);
    if (p.repo !== repo || p.git !== git) throw new Error(t('Repository changed; select the PR again.'));
    const repositories = repo.state.remotes.map(r => parseRepository(r.fetchUrl)).filter(Boolean);
    if (!repositories.some(r => [pr.base.repo.full_name, pr.head.repo?.full_name].some(name => name?.toLowerCase() === r.toLowerCase()))) {
      throw new Error(t('This PR does not belong to the current repository.'));
    }
    for (const [hash, ref] of [[pr.head.sha, `refs/pull/${link.number}/head`], [pr.base.sha, `refs/heads/${pr.base.ref}`]]) {
      try { await git.resolve(hash); }
      catch (error) {
        if (error.code !== 128) throw error;
        const remote = repo.state.remotes.find(r => parseRepository(r.fetchUrl)?.toLowerCase() === link.repository.toLowerCase());
        await run(git.git, ['fetch', '--no-tags', '--', remote?.fetchUrl || `https://github.com/${link.repository}.git`, ref],
          { cwd: git.root, timeout: 120000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
        await git.resolve(hash);
      }
    }
    return pr;
  }
  async connectPR() {
    const p = this.provider;
    if (!await p.selectRepository()) return false;
    const repo = p.repo;
    const api = await this.github(true); if (!api) return false;
    const remotes = [...repo.state.remotes].sort((a, b) => (a.name === 'upstream' ? -1 : a.name === 'origin' ? 0 : 1) - (b.name === 'upstream' ? -1 : b.name === 'origin' ? 0 : 1));
    const repositories = [...new Set(remotes.map(r => parseRepository(r.fetchUrl)).filter(Boolean))];
    let repository = p.input?.pr?.repository || p.branchInput?.pr?.repository || repositories[0];
    let state = 'open', page = 1, rows = [], link;
    while (!link) {
      const batch = repository ? await api.request(`/repos/${repository}/pulls?state=${state}&sort=updated&direction=desc&per_page=30&page=${page}`) : [];
      if (p.repo !== repo) return false;
      rows.push(...batch);
      const item = await vscode.window.showQuickPick([
        { label: t('Enter a PR URL or number…'), action: 'url', alwaysShow: true },
        ...rows.map(pr => ({ label: `#${pr.number}  ${pr.title}`, description: `${pr.user?.login || ''} · ${pr.draft ? t('Draft') : pr.state === 'open' ? t('Open') : t('Closed')}`,
          detail: `${pr.base.ref} ← ${pr.head.label || pr.head.ref}`, link: { repository, number: pr.number } })),
        ...(batch.length === 30 ? [{ label: t('Load more PRs…'), action: 'more', alwaysShow: true }] : []),
        ...(repository ? [{ label: t(state === 'open' ? 'Include closed PRs' : 'Open PRs only'), action: 'state', alwaysShow: true }] : []),
        ...(repositories.length > 1 ? [{ label: t('Choose GitHub repository…'), action: 'repository', alwaysShow: true }] : []),
      ], { placeHolder: t('Select PR · {0}', repository || repo.rootUri.fsPath), matchOnDescription: true, matchOnDetail: true });
      if (!item || p.repo !== repo) return false;
      if (item.action === 'more') { page++; continue; }
      if (item.action === 'state') { state = state === 'open' ? 'all' : 'open'; page = 1; rows = []; continue; }
      if (item.action === 'repository') {
        const selected = await vscode.window.showQuickPick(repositories, { placeHolder: t('Choose GitHub repository…') });
        if (!selected) return false;
        repository = selected; page = 1; rows = []; continue;
      }
      if (item.action === 'url') {
        const parse = value => /^#?[1-9]\d*$/.test(value.trim()) && repository
          ? { repository, number: Number(value.trim().replace('#', '')) } : parsePullRequest(value);
        const value = await vscode.window.showInputBox({ prompt: t('Enter a PR URL or number…'),
          validateInput: value => parse(value) ? null : t('Enter a github.com PR URL or a PR number for this repository.') });
        if (!value) return false;
        link = parse(value); if (!link) return false;
      } else link = item.link;
    }
    if (p.repo !== repo) return false;
    const pr = await this.fetchPR(api, link);
    if (p.repo !== repo) return false;
    const original = await p.defaultBranches();
    const scopes = { ...p.context.workspaceState.get('pullRequestScopes', {}) };
    const scopeKey = link => `${repo.rootUri.toString()}:${link.repository.toLowerCase()}#${link.number}`;
    if (original.pr) scopes[scopeKey(original.pr)] = original.reviewKey || [original.left, original.right];
    let reviewKey = scopes[scopeKey(link)];
    if (!reviewKey && !original.pr) {
      try {
        const [left, right] = await Promise.all([p.git.resolve(original.left), p.git.resolve(original.right)]);
        const manualKey = original.reviewKey || [original.left, original.right];
        const claimed = Object.entries(scopes).some(([key, value]) => key !== scopeKey(link) && key.startsWith(repo.rootUri.toString() + ':') && JSON.stringify(value) === JSON.stringify(manualKey));
        if (!claimed && left === pr.base.sha && right === pr.head.sha) reviewKey = manualKey;
      } catch (error) { if (error.code !== 128) throw error; }
    }
    reviewKey ||= ['github-pr', link.repository.toLowerCase(), link.number];
    await p.refresh({ left: pr.base.sha, right: pr.head.sha, mode: 'merge-base', reviewKey,
      pr: { ...link, url: pr.html_url, title: pr.title, baseRef: pr.base.ref, headRef: pr.head.ref } });
    scopes[scopeKey(link)] = reviewKey;
    await p.context.workspaceState.update('pullRequestScopes', scopes);
    this.updateInfo = { available: false }; return true;
  }
  async refresh() {
    const p = this.provider, input = p.input;
    if (!input?.pr) { await p.refresh(); this.updateInfo = { available: false }; return; }
    const api = await this.github(true); if (!api) return;
    const pr = await this.fetchPR(api, input.pr);
    await p.refresh({ ...input, left: pr.base.sha, right: pr.head.sha,
      pr: { ...input.pr, title: pr.title, baseRef: pr.base.ref, headRef: pr.head.ref, url: pr.html_url } });
    this.updateInfo = { available: false }; await p.view.update();
  }
  async checkUpdates() {
    const p = this.provider;
    if (this.checking || !p.view.visible || !p.result || p.input.mode === 'commit') return;
    this.checking = true;
    const current = p.result, input = p.input, previous = this.updateInfo;
    try {
      let available;
      if (input.pr) {
        const api = await this.github(false);
        if (!api) throw new Error(t('Sign in to GitHub to check PR updates.'));
        const pr = await api.request(`/repos/${input.pr.repository}/pulls/${input.pr.number}`);
        available = pr.head.sha !== current.rightHash || pr.base.sha !== current.baseTipHash
          || pr.base.ref !== input.pr.baseRef || pr.head.ref !== input.pr.headRef;
      } else {
        const [left, right] = await Promise.all([p.git.resolve(input.left), p.git.resolve(input.right)]);
        available = left !== current.baseTipHash || right !== current.rightHash;
      }
      if (p.result === current) this.updateInfo = { available };
    } catch (error) { if (p.result === current) this.updateInfo = { ...this.updateInfo, error: error.message }; }
    finally { this.checking = false; }
    if (p.result === current && (previous.available !== this.updateInfo.available || previous.error !== this.updateInfo.error)) await p.view.update();
  }
  async publish(id) {
    const p = this.provider, session = p.reviewSession;
    const note = await this.store.read(session.notesScope, 'notes', id);
    if (!note || note.published) return;
    if (!p.input.pr && !await this.connectPR()) return;
    const link = p.input.pr, api = await this.github(true); if (!api) return;
    const route = `/repos/${link.repository}`;
    const marker = `<!-- kian-review-note:${note.id} -->`;
    // A previous POST can have succeeded despite a lost response. Never repeat it blindly.
    const existing = [...await api.list(`${route}/issues/${link.number}/comments`), ...await api.list(`${route}/pulls/${link.number}/comments`)]
      .find(comment => comment.body?.includes(marker));
    if (existing) {
      note.published = { url: existing.html_url, at: new Date().toISOString() };
      await this.store.write(session.notesScope, 'notes', note.id, note); await p.view.update(); return;
    }
    const pr = await api.request(`${route}/pulls/${link.number}`);
    const files = await api.list(`${route}/pulls/${link.number}/files`);
    const file = files.find(f => f.filename === note.anchor.filePath);
    const current = p.result;
    let anchorMatches = note.anchor.side === 'RIGHT' && note.anchor.ref === pr.head.sha;
    if (note.anchor.side === 'LEFT') {
      try { anchorMatches = note.anchor.ref === (await session.git.exec(['merge-base', pr.base.sha, pr.head.sha])).trim(); }
      catch (error) { if (error.code !== 128) throw error; }
    }
    const inline = note.anchor.head === pr.head.sha && !note.anchor.incremental && current.rightHash === pr.head.sha
      && anchorMatches && file && patchContainsRange(file.patch, note.anchor.side, note.anchor.start + 1, note.anchor.end + 1);
    const location = `${note.anchor.path}:${note.anchor.start + 1}${note.anchor.end > note.anchor.start ? `-${note.anchor.end + 1}` : ''}`;
    const visibleBody = inline ? note.text : `**${location}** (${note.anchor.side}, ${note.anchor.ref || 'empty'})\n\n${note.text}`;
    const preview = await vscode.workspace.openTextDocument({ content: visibleBody, language: 'markdown' });
    await vscode.window.showTextDocument(preview, { preview: true });
    const submit = t('Publish to GitHub');
    const choice = await vscode.window.showInformationMessage(t('Publish this note to {0}#{1}?', link.repository, link.number),
      { modal: true, detail: (inline ? t('This becomes a public-to-the-repository inline PR comment.') : t('This anchor is outside the current PR diff. Publish as a general PR comment instead.')) + '\n\n' + visibleBody }, submit);
    if (choice !== submit) return;
    const latest = await api.request(`${route}/pulls/${link.number}`);
    if (latest.head.sha !== pr.head.sha || latest.base.sha !== pr.base.sha) throw new Error(t('The PR changed during confirmation. Refresh and review the note before publishing.'));
    const payload = inline ? { body: visibleBody + '\n\n' + marker, commit_id: pr.head.sha, path: file.filename,
      line: note.anchor.end + 1, side: note.anchor.side,
      ...(note.anchor.end > note.anchor.start ? { start_line: note.anchor.start + 1, start_side: note.anchor.side } : {}) } : { body: visibleBody + '\n\n' + marker };
    const published = await api.request(inline ? `${route}/pulls/${link.number}/comments` : `${route}/issues/${link.number}/comments`, 'POST', payload);
    note.published = { url: published.html_url, at: new Date().toISOString() };
    await this.store.write(session.notesScope, 'notes', note.id, note);
    if (this.threads.has(session.notesScope + ':' + id)) this.showThread(note, session);
    await p.view.update();
  }
  async open(file, incremental = false) {
    const p = this.provider, c = file.comparison, session = p.reviewSession;
    const resource = name => vscode.Uri.joinPath(c.repo.rootUri, name);
    const empty = name => resource(name).with({ scheme: 'kian-review-empty', query: '' });
    let baseline;
    if (incremental) {
      baseline = (await this.state(session)).files[file.path]?.baseline;
      if (!baseline) return;
      if (baseline.rightObject && baseline.rightObject.type !== 'blob') throw new Error(t('Incremental source diff is unavailable for this Git object.'));
    }
    const leftRef = baseline ? baseline.rightHash : c.leftHash;
    const leftPath = baseline ? baseline.path : file.oldPath;
    const leftObject = baseline ? baseline.rightObject : file.leftObject;
    const decorate = uri => uri.with({ query: JSON.stringify({ ...(uri.query ? JSON.parse(uri.query) : {}), kianReviewScope: session.scope }) });
    const left = decorate(!leftObject ? empty(file.path) : baseline ? this.cachedUri(leftObject, leftPath) : p.gitApi.toGitUri(resource(leftPath), leftRef));
    const right = decorate(!file.rightObject ? empty(file.path) : p.gitApi.toGitUri(resource(file.path), c.rightHash));
    await this.registerDocument(left, { path: leftPath, filePath: file.path, side: 'LEFT', ref: leftRef, object: leftObject,
      absolutePath: path.join(c.leftWorktree || session.root, leftPath), head: c.rightHash, base: c.leftHash, incremental }, session);
    await this.registerDocument(right, { path: file.path, filePath: file.path, side: 'RIGHT', ref: c.rightHash, object: file.rightObject,
      absolutePath: path.join(c.rightWorktree || session.root, file.path), head: c.rightHash, base: c.leftHash, incremental }, session);
    await vscode.commands.executeCommand('vscode.diff', left, right,
      `${file.path} · ${incremental ? t('Since last review') : t('Full comparison')} (${leftRef?.slice(0, 8) || '∅'} → ${c.rightHash.slice(0, 8)})`, { preview: true });
  }
  dispose() { clearInterval(this.timer); this.editorListener.dispose(); this.controller.dispose(); this.fsRegistration.dispose(); }
}

module.exports = { ReviewService };
