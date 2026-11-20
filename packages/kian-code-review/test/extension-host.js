const assert = require('node:assert/strict');
const vscode = require('vscode');
const { execFileSync } = require('node:child_process');

async function waitVisible(view) {
  if (view.visible) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { listener.dispose(); reject(new Error('Review tree did not become visible')); }, 5000);
    const listener = view.onDidChangeVisibility(event => {
      if (event.visible) { clearTimeout(timeout); listener.dispose(); resolve(); }
    });
  });
}

async function run() {
  const extension = vscode.extensions.getExtension('strivin0311.kian-code-review');
  const { provider, workbench } = await extension.activate();
  const api = vscode.extensions.getExtension('vscode.git').exports.getAPI(1);
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  await api.openRepository(vscode.Uri.file(root));
  const before = execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: root });
  await vscode.commands.executeCommand('kianReview.compare', { root, left: 'main', right: 'feature' });
  assert.equal(provider.result.files.length, 4);
  await waitVisible(provider.view);
  assert.equal(provider.view.visible, true);
  assert.equal(vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(tab => tab.input instanceof vscode.TabInputTextDiff).length, 0);
  const tree = provider.result.files.map(file => ({ file }));
  const leaf = tree.find(node => node.file?.path === 'demo.py');
  assert.ok(leaf);
  const oldClipboard = await vscode.env.clipboard.readText();
  try {
    await vscode.commands.executeCommand('kianReview.copyRelative', leaf);
    assert.equal(await vscode.env.clipboard.readText(), 'demo.py');
    await vscode.commands.executeCommand('kianReview.copyAbsolute', leaf);
    assert.equal(await vscode.env.clipboard.readText(), provider.result.rightWorktree + '/demo.py');
    assert.notEqual(provider.result.rightWorktree, root);
  } finally { await vscode.env.clipboard.writeText(oldClipboard); }
  await vscode.commands.executeCommand('kianReview.open', leaf);
  const diffs = vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(tab => tab.input instanceof vscode.TabInputTextDiff);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].input.modified.scheme, 'git');
  const doc = await vscode.workspace.openTextDocument(diffs[0].input.modified);
  assert.equal(doc.getText(), 'print("feature")\n');
  for (const name of ['added.py', 'removed.py']) {
    const node = tree.find(n => n.file?.path === name);
    await vscode.commands.executeCommand('kianReview.open', node);
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const emptyUri = name === 'added.py' ? tab.input.original : tab.input.modified;
    assert.equal((await vscode.workspace.openTextDocument(emptyUri)).getText(), '');
  }
  assert.deepEqual(execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: root }), before);
  // Exercise the webview host protocol with actual Git data and immutable file keys.
  await workbench.update();
  let state = await workbench.snapshot();
  assert.equal(state.files.length, 4);
  assert.equal(state.commits.length, 1);
  assert.equal(state.commits[0].hash, provider.result.rightHash);
  assert.ok(workbench.webviewView.webview.html.includes("default-src 'none'"));
  assert.ok(workbench.webviewView.webview.html.includes('workbench.css'));
  workbench.state = state;
  const previousInput = provider.input;
  await workbench.receive({ type: 'commit', hash: state.commits[0].hash, key: 'stale-key' });
  assert.equal(provider.input, previousInput);
  await workbench.receive({ type: 'commit', hash: 'not-in-the-loaded-history', key: state.key });
  assert.equal(provider.input, previousInput);
  await workbench.receive({ type: 'commit', hash: state.commits[0].hash, key: state.key });
  assert.equal(provider.input.mode, 'commit');
  state = await workbench.snapshot(); workbench.state = state;
  assert.equal(state.commits.length, 2);
  assert.equal(state.canPrevious, true);
  const beforeFailure = { input: provider.input, result: provider.result, branch: provider.branchInput };
  const originalCompare = provider.git.compare;
  try {
    provider.git.compare = async () => { throw new Error('fixture read timed out'); };
    await assert.rejects(provider.refresh({ left: 'main', right: 'feature', mode: 'merge-base' }), /timed out/);
    assert.equal(provider.input, beforeFailure.input);
    assert.equal(provider.result, beforeFailure.result);
    assert.equal(provider.branchInput, beforeFailure.branch);
  } finally { provider.git.compare = originalCompare; }
  await workbench.receive({ type: 'action', action: 'previous', key: state.key });
  assert.equal(provider.result.leftHash, null);
    assert.equal(provider.commitHistory.source, 'feature');
    assert.equal(provider.getControls().find(c => c.control === 'base').value, 'Empty tree');
  state = await workbench.snapshot(); workbench.state = state;
  assert.equal(state.canPrevious, false); assert.equal(state.canNext, true);
  await workbench.receive({ type: 'mode', mode: 'merge-base', key: state.key });
  assert.equal(provider.input.right, 'feature');
  state = await workbench.snapshot(); workbench.state = state;
  const clipboardBefore = await vscode.env.clipboard.readText();
  try {
    await workbench.receive({ type: 'file', action: 'copyRelative', path: 'demo.py', key: state.key });
    assert.equal(await vscode.env.clipboard.readText(), 'demo.py');
    await workbench.receive({ type: 'file', action: 'copyRelative', path: '../../outside', key: state.key });
    assert.equal(await vscode.env.clipboard.readText(), 'demo.py');
  } finally { await vscode.env.clipboard.writeText(clipboardBefore); }
  // Review state and private native comments use only the disposable profile's storage.
  const review = provider.review;
  const reviewFile = provider.result.files.find(f => f.path === 'demo.py');
  await review.mark(reviewFile, true);
  let reviewState = await review.state(provider.reviewSession);
  assert.equal(reviewState.files['demo.py'].reviewed, true);
  await provider.open({ file: reviewFile, incremental: true });
  const incrementalTab = vscode.window.tabGroups.activeTabGroup.activeTab.input;
  assert.equal(incrementalTab.original.scheme, 'kian-review-cache');
  assert.equal((await vscode.workspace.openTextDocument(incrementalTab.original)).getText(), 'print("feature")\n');
  await review.mark(reviewFile, false);
  await provider.open({ file: reviewFile });
  const noteUri = vscode.window.tabGroups.activeTabGroup.activeTab.input.modified;
  const noteThread = review.controller.createCommentThread(noteUri, new vscode.Range(0, 0, 0, 0), []);
  await review.addReply({ thread: noteThread, text: 'Explain this line.\nCheck the ordering.' });
  reviewState = await review.state(provider.reviewSession);
  const note = reviewState.notes.at(-1);
  assert.equal(note.anchor.path, 'demo.py'); assert.equal(note.anchor.start, 0);
  assert.equal(noteThread.comments.length, 1);
  const inputBoxOriginal = vscode.window.showInputBox;
  vscode.window.showInputBox = async () => { throw new Error('Editing must use the inline comment editor'); };
  try {
    await review.noteAction(note.id, 'edit');
    assert.equal(noteThread.comments[0].mode, vscode.CommentMode.Editing);
    assert.equal(noteThread.comments[0].body, note.text);
    assert.equal(noteThread.collapsibleState, vscode.CommentThreadCollapsibleState.Expanded);
    assert.equal(vscode.window.activeTextEditor.document.uri.toString(), note.anchor.uri);
    const activeDiff = vscode.window.tabGroups.activeTabGroup.activeTab.input;
    assert.ok(activeDiff instanceof vscode.TabInputTextDiff, 'Editing must keep the two-sided diff active');
    assert.equal(activeDiff.original.toString(), note.anchor.diff.left);
    assert.equal(activeDiff.modified.toString(), note.anchor.diff.right);
    let inlineEditor;
    for (let i = 0; i < 60; i++) {
      inlineEditor = vscode.workspace.textDocuments.find(doc => doc.uri.scheme === 'comment' && doc.getText() === note.text);
      if (inlineEditor) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(inlineEditor, 'The native multiline comment editor must be created');
    const edited = 'Explain this line.\nKeep `code`, **literal stars** and _underscores_.';
    noteThread.comments[0].body = new vscode.MarkdownString(edited);
    await vscode.commands.executeCommand('kianReview.saveEditedPrivateNote', noteThread.comments[0]);
    let notes = (await review.state(provider.reviewSession)).notes;
    assert.equal(notes.length, 1); assert.equal(notes[0].id, note.id); assert.equal(notes[0].text, edited);
    assert.deepEqual(notes[0].anchor, note.anchor);
    assert.equal(notes[0].createdAt, note.createdAt);
    assert.ok(notes[0].updatedAt);
    const editedAt = notes[0].updatedAt;
    assert.equal(noteThread.comments[0].timestamp.toISOString(), note.createdAt);
    assert.equal(noteThread.comments[0].mode, vscode.CommentMode.Preview);
    await review.noteAction(note.id, 'edit');
    assert.equal(noteThread.comments[0].body, edited);
    noteThread.comments[0].body = 'discard this draft';
    await vscode.commands.executeCommand('kianReview.cancelEditPrivateNote', noteThread.comments[0]);
    assert.equal((await review.state(provider.reviewSession)).notes[0].text, edited);
    assert.equal((await review.state(provider.reviewSession)).notes[0].updatedAt, editedAt);
    assert.equal(noteThread.comments[0].mode, vscode.CommentMode.Preview);
  } finally { vscode.window.showInputBox = inputBoxOriginal; }
  // Emulate a stored pre-0.6.2 note after restarting with no open diff documents.
  const stored = await review.store.read(provider.reviewSession.notesScope, 'notes', note.id);
  const legacy = { ...stored, anchor: { ...stored.anchor } };
  delete legacy.anchor.diff;
  await review.store.write(provider.reviewSession.notesScope, 'notes', note.id, legacy);
  review.documents.clear();
  await review.noteAction(note.id, 'open');
  assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab.input instanceof vscode.TabInputTextDiff);
  await review.store.write(provider.reviewSession.notesScope, 'notes', note.id, stored);
  const leftSession = { ...provider.reviewSession, notesScope: 'left-side-fixture' };
  const leftNote = await review.store.addNote(leftSession.notesScope, {
    ...note.anchor, uri: note.anchor.diff.left, side: 'LEFT', ref: note.anchor.base,
  }, 'Check the original line.');
  await vscode.window.tabGroups.close(vscode.window.tabGroups.activeTabGroup.activeTab);
  await review.noteAction(leftNote.id, 'open', leftSession);
  assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab.input instanceof vscode.TabInputTextDiff);
  assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab.input.original.toString(), leftNote.anchor.uri);
  await review.noteAction(leftNote.id, 'edit', leftSession);
  assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab.input instanceof vscode.TabInputTextDiff);
  assert.equal(review.threads.get(leftSession.notesScope + ':' + leftNote.id).comments[0].mode, vscode.CommentMode.Editing);
  const clipboardSaved = await vscode.env.clipboard.readText();
  try {
    await review.copyPrompts();
    assert.match(await vscode.env.clipboard.readText(), /demo\.py:1/);
    assert.match(await vscode.env.clipboard.readText(), /Explain this line/);
  } finally { await vscode.env.clipboard.writeText(clipboardSaved); }
  await review.threadAction(noteThread, 'resolve');
  assert.equal((await review.state(provider.reviewSession)).notes.at(-1).resolved, true);
  await review.threadAction(noteThread, 'reopen');
  assert.equal((await review.state(provider.reviewSession)).notes.at(-1).resolved, false);
  const branchNotesScope = provider.reviewSession.notesScope;
  await provider.refresh({ right: 'feature', mode: 'commit' });
  assert.equal(provider.reviewSession.notesScope, branchNotesScope);
  assert.equal((await review.state(provider.reviewSession)).notes.at(-1).id, note.id);
  await provider.refresh({ left: 'main', right: 'feature', mode: 'merge-base' });
  const githubOriginal = review.github, infoOriginal = vscode.window.showInformationMessage;
  const remoteComments = []; let postCount = 0;
  const originalInput = provider.input;
  provider.input = { ...provider.input, pr: { repository: 'fixture/repository', number: 1 } };
  review.github = async () => ({ list: async route => route.endsWith('/issues/1/comments') ? remoteComments : route.endsWith('/files') ? [{ filename: 'demo.py', patch: '@@ -1 +1 @@\n-print("main")\n+print("feature")' }] : [],
    request: async (route, method, payload) => {
      if (method === 'POST') {
        assert.ok(route.endsWith('/pulls/1/comments')); assert.equal(payload.line, 1); assert.equal(payload.side, 'RIGHT');
        assert.equal(payload.commit_id, provider.result.rightHash);
        postCount++; remoteComments.push({ body: payload.body, html_url: 'https://github.com/fixture/repository/pull/1#note' }); throw new Error('Response lost after accepted POST');
      }
      return { head: { sha: provider.result.rightHash }, base: { sha: provider.result.baseTipHash } };
    } });
  try {
    vscode.window.showInformationMessage = async () => undefined;
    await review.publish(note.id); assert.equal(postCount, 0);
    vscode.window.showInformationMessage = async (_message, _options, choice) => choice;
    await assert.rejects(review.publish(note.id), /Response lost/);
    assert.equal(postCount, 1);
    assert.equal((await review.state(provider.reviewSession)).notes.at(-1).published, undefined);
    await review.publish(note.id); assert.equal(postCount, 1);
    assert.ok((await review.state(provider.reviewSession)).notes.at(-1).published.url);
  } finally { review.github = githubOriginal; vscode.window.showInformationMessage = infoOriginal; provider.input = originalInput; }
  const fetchOriginal = review.fetchPR;
  try {
    provider.input = { ...provider.input, reviewKey: [originalInput.left, originalInput.right], pr: { repository: 'fixture/repository', number: 1, baseRef: 'old-base' } };
    review.github = async () => ({});
    review.fetchPR = async () => ({ base: { sha: provider.result.baseTipHash, ref: 'retargeted-base' }, head: { sha: provider.result.rightHash, ref: 'feature' }, html_url: 'https://github.com/fixture/repository/pull/1' });
    await review.refresh();
    assert.equal(provider.input.pr.baseRef, 'retargeted-base');
    assert.equal(provider.getControls().find(c => c.control === 'base').value, 'retargeted-base');
  } finally { review.fetchPR = fetchOriginal; review.github = githubOriginal; await provider.refresh(originalInput); }
  await review.threadAction(noteThread, 'resolve');
  await provider.refresh({ left: 'main', right: 'feature', mode: 'direct' });
  // Switching mode must no longer reopen repository/ref/mode wizards.
  const originalPickRef = provider.pickRef;
  const originalQuickPick = vscode.window.showQuickPick;
  const originalSelectRepository = provider.selectRepository;
  vscode.window.showQuickPick = async () => { throw new Error('Unexpected selection wizard'); };
  try {
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
    await vscode.commands.executeCommand('kianReview.branches');
    await waitVisible(provider.view);
    assert.equal(provider.result.mode, 'merge-base');
    assert.equal(provider.view.visible, true);
    assert.equal(provider.result.files.length, 4);
    await vscode.commands.executeCommand('kianReview.commit');
    assert.equal(provider.input.mode, 'commit');
    await vscode.commands.executeCommand('kianReview.branches');
    assert.equal(provider.input.mode, 'merge-base');
    assert.equal(provider.input.left, 'main');
    assert.equal(provider.input.right, 'feature');
    assert.deepEqual(provider.getControls().map(n => n.control), ['repository', 'mode', 'base', 'target']);
    let picks = 0;
    provider.pickRef = async () => { picks++; return 'HEAD'; };
    await vscode.commands.executeCommand('kianReview.base');
    assert.equal(picks, 1); assert.equal(provider.input.left, 'HEAD');
    provider.pickRef = async () => { picks++; return 'feature'; };
    await vscode.commands.executeCommand('kianReview.target');
    assert.equal(picks, 2); assert.equal(provider.input.right, 'feature');
    const tabs = () => vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(tab => tab.input instanceof vscode.TabInputTextDiff).length;
    const previousTabs = tabs();
    await vscode.commands.executeCommand('kianReview.expand');
    await vscode.commands.executeCommand('kianReview.collapse');
    assert.equal(tabs(), previousTabs);
    assert.equal(provider.context.workspaceState.get('comparisons')[provider.repo.rootUri.toString()].branchInput.right, 'feature');
    provider.pickRef = originalPickRef;
    vscode.window.showQuickPick = async items => items.find(item => item.ref === 'main');
    assert.equal(await provider.pickRef('fixture', 'deleted-old-branch'), 'main');
    await provider.refresh({ right: 'feature', mode: 'commit' });
    const featureHash = provider.result.rightHash;
    const mainHash = await provider.git.resolve('main');
    const initialHistory = provider.commitHistory;
    assert.equal(initialHistory.hashes[0], featureHash);
    const commitState = await workbench.snapshot();
    assert.equal(commitState.selected, featureHash);
    assert.equal(provider.commitHistory.source, 'feature');
    assert.equal(commitState.controls.find(c => c.control === 'base').value, mainHash.slice(0, 8));
    assert.equal(commitState.historySource, 'feature');
    assert.equal(commitState.controls.find(c => c.control === 'target').name, 'Commit');
    assert.match(commitState.details.message, /feature/);
    assert.equal(commitState.canPrevious, true);
    assert.equal(commitState.canNext, false);
    let commitPicks = 0;
    vscode.window.showQuickPick = async items => {
      commitPicks++;
      assert.ok(items.some(item => item.hash === mainHash));
      assert.ok(items.filter(item => item.hash).every(item => item.label.includes(item.hash.slice(0, 8)) && item.description.includes(' · ')));
      assert.ok(items.every(item => !item.ref));
      return items.find(item => item.hash === mainHash);
    };
    await vscode.commands.executeCommand('kianReview.target');
    assert.equal(commitPicks, 1);
    assert.equal(provider.result.rightHash, mainHash);
    assert.equal(provider.result.leftHash, null);
    assert.equal(provider.commitHistory.source, 'feature');
    assert.equal(provider.getControls().find(c => c.control === 'base').value, 'Empty tree');
    await vscode.commands.executeCommand('kianReview.previousCommit');
    assert.equal(provider.result.rightHash, mainHash); // Oldest boundary is a no-op.
    provider.commitHistory = null; // Restoring an old selection must retain newer history entries.
    await provider.refresh(provider.input);
    await vscode.commands.executeCommand('kianReview.nextCommit');
    assert.equal(provider.result.rightHash, featureHash);
    await vscode.commands.executeCommand('kianReview.nextCommit');
    assert.equal(provider.result.rightHash, featureHash); // Newest boundary is a no-op.
    await vscode.commands.executeCommand('kianReview.commit');
    assert.equal(commitPicks, 2); // Repeated toolbar click opens the same list.
    const selected = provider.input;
    vscode.window.showQuickPick = async () => undefined;
    await vscode.commands.executeCommand('kianReview.target');
    assert.equal(provider.input, selected);
    const originalCommits = provider.git.commits;
    const skips = [];
    try {
      provider.git.commits = async (skip, hash) => {
        skips.push([skip, hash]);
        return skip === 0 ? Array.from({ length: 200 }, () => ({ hash: featureHash, subject: 'fixture', author: 'Test', date: '2026-11-17' }))
          : [{ hash: mainHash, subject: 'initial', author: 'Test', date: '2026-11-17' }];
      };
      vscode.window.showQuickPick = async items => items.find(item => item.more) || items.find(item => item.hash);
      assert.equal(await provider.pickCommit('feature'), mainHash);
      assert.deepEqual(skips.map(([skip]) => skip), [0, 200]);
      assert.equal(skips[0][1], skips[1][1]);
    } finally { provider.git.commits = originalCommits; }
    const originalInputBox = vscode.window.showInputBox;
    try {
      vscode.window.showQuickPick = async items => items.find(item => item.custom);
      vscode.window.showInputBox = async () => 'main';
      assert.equal(await provider.pickCommit('feature'), mainHash);
    } finally { vscode.window.showInputBox = originalInputBox; }
    await provider.refresh({ left: 'main', right: 'feature', mode: 'merge-base' });
    const originalDefaults = provider.defaultBranches;
    let resume, started;
    const waiting = new Promise(resolve => { started = resolve; });
    provider.defaultBranches = async () => {
      started(); await new Promise(resolve => { resume = resolve; });
      return { left: 'main', right: 'feature', mode: 'direct' };
    };
    provider.input = null;
    const stale = provider.refresh(null);
    await waiting;
    await provider.refresh({ left: 'main', right: 'feature', mode: 'merge-base' });
    resume(); await stale;
    assert.equal(provider.input.mode, 'merge-base');
    provider.defaultBranches = originalDefaults;
  } finally {
    provider.pickRef = originalPickRef;
    provider.selectRepository = originalSelectRepository;
    vscode.window.showQuickPick = originalQuickPick;
  }
  const resolveOriginal = provider.git.resolve;
  const pinnedResult = provider.result;
  try {
    provider.git.resolve = async function(ref) { return ref === provider.input.right ? 'f'.repeat(40) : resolveOriginal.call(this, ref); };
    await review.checkUpdates();
    assert.equal(review.updateInfo.available, true); assert.equal(provider.result, pinnedResult);
  } finally { provider.git.resolve = resolveOriginal; }
  await review.checkUpdates(); assert.equal(review.updateInfo.available, false);
  // Overlapping refresh notifications must not run snapshots concurrently.
  if (workbench.updating) await workbench.updating;
  const snapshotOriginal = workbench.snapshot.bind(workbench);
  let activeSnapshots = 0, maxSnapshots = 0, snapshots = 0, releaseSnapshot;
  const snapshotGate = new Promise(resolve => { releaseSnapshot = resolve; });
  workbench.snapshot = async () => {
    snapshots++; activeSnapshots++; maxSnapshots = Math.max(maxSnapshots, activeSnapshots);
    try { await snapshotGate; return await snapshotOriginal(); }
    finally { activeSnapshots--; }
  };
  try {
    const updates = [workbench.update(), workbench.update(), workbench.update()];
    releaseSnapshot(); await Promise.all(updates);
    assert.equal(maxSnapshots, 1); assert.equal(snapshots, 2);
  } finally { workbench.snapshot = snapshotOriginal; }
  const execOriginal = provider.git.exec.bind(provider.git);
  let shows = 0;
  provider.git.exec = async (args, options) => { if (args[0] === 'show') shows++; return execOriginal(args, options); };
  workbench.commitDetails = null;
  try { await workbench.snapshot(); await workbench.snapshot(); assert.equal(shows, 1); }
  finally { provider.git.exec = execOriginal; }
  const updateOriginal = provider.view.update;
  let pollsRendered = 0;
  provider.view.update = async () => { pollsRendered++; };
  try { await review.checkUpdates(); await review.checkUpdates(); assert.equal(pollsRendered, 0); }
  finally { provider.view.update = updateOriginal; }
  // Instrument the production renderer only inside this disposable test webview.
  const fs = require('node:fs');
  const renderer = fs.readFileSync(extension.extensionPath + '/media/workbench.js', 'utf8');
  const probeCode = fs.readFileSync(extension.extensionPath + '/test/webview-probe.js', 'utf8');
  const html = workbench.webviewView.webview.html;
  const nonce = html.match(/nonce="([a-f0-9]+)"/)[1];
  const instrumented = renderer.replace('  api.postMessage({ type: \'ready\' });', () => probeCode + '\n  api.postMessage({ type: \'ready\' });');
  const messages = [];
  const listener = workbench.webviewView.webview.onDidReceiveMessage(message => messages.push(message));
  workbench.webviewView.webview.html = html.replace(/<script nonce="[^"]+" src="[^"]*workbench\.js"><\/script>/, () => `<script nonce="${nonce}">${instrumented}</script>`);
  const until = async predicate => {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error('Webview renderer did not respond');
  };
  try {
    await until(() => messages.some(message => message.type === 'ready'));
    const probe = async action => {
      const id = String(Math.random());
      await workbench.webviewView.webview.postMessage({ type: 'probe', id, action });
      await until(() => messages.some(message => message.type === 'probe-result' && message.id === id));
      return messages.find(message => message.type === 'probe-result' && message.id === id);
    };
    let report = await probe();
    assert.equal(report.files, 4); assert.equal(report.commits, 1); assert.equal(report.controls, 3);
    assert.equal(report.horizontalOverflow, false);
    assert.ok(['grid', 'flex'].includes(report.layoutDisplay));
    assert.equal(report.toolbarDisplay, 'flex');
    report = await probe('toggle-resolved');
    assert.ok(report.noteTimes.length >= 2);
    assert.ok(report.noteTimes.every(time => time.datetime && time.text.includes('202') && time.title.includes(' · ')));
    await probe('toggle-resolved');
    const sourceState = await workbench.snapshot();
    const longSource = 'work/' + 'very-long-branch-name-'.repeat(40);
    await workbench.webviewView.webview.postMessage({ type: 'state', state: { ...sourceState, historySource: longSource } });
    report = await probe();
    assert.equal(report.sourceHidden, false); assert.ok(report.sourceTitle.endsWith(longSource));
    assert.equal(report.sourceEllipsis, 'ellipsis'); assert.equal(report.horizontalOverflow, false);
    await workbench.webviewView.webview.postMessage({ type: 'state', state: sourceState });
    report = await probe(); assert.equal(report.sourceHidden, true);
    report = await probe('advanced-filter'); assert.equal(report.files, 2);
    report = await probe('regex-filter'); assert.equal(report.files, 1);
    report = await probe('invalid-filter'); assert.equal(report.filterError, true); assert.equal(report.files, 1);
    report = await probe('clear-advanced-filter'); assert.equal(report.filterError, false); assert.equal(report.files, 4);
    await probe('pending-mode');
    await workbench.webviewView.webview.postMessage({ type: 'error', message: 'fixture timeout' });
    report = await probe();
    assert.equal(report.modeValue, provider.input.mode);
    assert.equal(report.busy, false); assert.equal(report.statusText, 'fixture timeout');
    const safeState = await workbench.snapshot();
    await probe('mark-reviewed');
    await until(() => workbench.state?.review.files['demo.py']?.reviewed);
    report = await probe(); assert.equal(report.unreadFiles, 3); assert.equal(report.reviewedFiles, 1);
    await probe('mark-unread');
    await until(() => !workbench.state?.review.files['demo.py']?.reviewed);
    report = await probe(); assert.equal(report.unreadFiles, 4); assert.equal(report.reviewedFiles, 0);
    await workbench.webviewView.webview.postMessage({ type: 'state', state: { ...safeState, review: { ...safeState.review,
      files: { ...safeState.review.files, 'demo.py': { ...safeState.review.files['demo.py'], updated: true, targetChanged: true } } } } });
    report = await probe(); assert.equal(report.deltaButtons, 1);
    const unsafeText = '<img src=x onerror="throw Error(1)">';
    await workbench.webviewView.webview.postMessage({ type: 'state', state: { ...safeState,
      commits: safeState.commits.map(c => ({ ...c, subject: unsafeText })), details: { ...safeState.details, message: unsafeText } } });
    report = await probe(); assert.equal(report.injectedElements, 0);
    await workbench.webviewView.webview.postMessage({ type: 'state', state: safeState });
    report = await probe('expand'); assert.equal(report.openFolders, report.folders);
    report = await probe('collapse'); assert.equal(report.openFolders, 0);
    report = await probe('filter'); assert.equal(report.files, 1);
    report = await probe('clear-filter'); assert.equal(report.files, 4);
    report = await probe('hide-details'); assert.equal(report.detailsHidden, true);
    report = await probe('show-details'); assert.equal(report.detailsHidden, false);
    const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs).length;
    await probe('select-commit');
    await until(() => provider.input.mode === 'commit');
    await until(() => workbench.state?.mode === 'commit');
    report = await probe(); assert.equal(report.selected, 1); assert.equal(report.previousDisabled, false); assert.equal(report.nextDisabled, true);
    assert.equal(vscode.window.tabGroups.all.flatMap(g => g.tabs).length, tabs);
    assert.deepEqual(execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: root }), before);
  } finally { listener.dispose(); }
  // Select PRs without branch pickers, using real local Git objects and mocked read-only GitHub responses.
  const pickerOriginal = vscode.window.showQuickPick, inputOriginal = vscode.window.showInputBox;
  const githubForPicker = review.github;
  const repository = 'fixture/magiattn';
  execFileSync('git', ['remote', 'add', 'origin', `https://github.com/${repository}.git`], { cwd: root });
  try {
    await provider.repo.status();
    await provider.refresh({ left: 'main', right: 'feature', mode: 'merge-base' });
    const legacyScope = provider.reviewSession.notesScope;
    const left = provider.result.baseTipHash, right = provider.result.rightHash;
    const pr = number => ({ number, title: `Review feature ${number}`, state: number === 99 ? 'closed' : 'open', user: { login: 'author' },
      html_url: `https://github.com/${repository}/pull/${number}`, base: { sha: left, ref: 'main', repo: { full_name: repository } },
      head: { sha: right, ref: 'feature', label: 'author:feature', repo: { full_name: 'author/fork' } } });
    const routes = [];
    review.github = async () => ({ request: async (route, method = 'GET') => {
      assert.equal(method, 'GET'); routes.push(route);
      if (route.includes('?')) return route.includes('state=all') ? [pr(99)] : route.includes('page=2') ? [pr(31)] : Array.from({ length: 30 }, (_, i) => pr(i + 1));
      return pr(Number(route.split('/').at(-1)));
    } });
    vscode.window.showQuickPick = async () => undefined;
    const cancelledInput = provider.input;
    assert.equal(await review.connectPR(), false); assert.equal(provider.input, cancelledInput);
    vscode.window.showQuickPick = async items => items.find(item => item.link?.number === 1);
    assert.equal(await review.connectPR(), true);
    assert.equal(provider.input.mode, 'merge-base'); assert.equal(provider.input.pr.number, 1);
    assert.equal(provider.getControls().find(c => c.control === 'base').value, 'main');
    assert.equal(provider.getControls().find(c => c.control === 'target').value, 'feature');
    assert.equal(provider.reviewSession.notesScope, legacyScope);
    await review.mark(provider.result.files.find(f => f.path === 'demo.py'), true);
    const legacyNotes = (await review.state(provider.reviewSession)).notes;
    vscode.window.showQuickPick = async items => items.find(item => item.link?.number === 2);
    await review.connectPR();
    assert.notEqual(provider.reviewSession.notesScope, legacyScope);
    assert.equal((await review.state(provider.reviewSession)).notes.length, 0);
    assert.equal((await review.state(provider.reviewSession)).files['demo.py'].reviewed, false);
    vscode.window.showQuickPick = async items => items.find(item => item.link?.number === 1);
    await review.connectPR();
    assert.equal(provider.reviewSession.notesScope, legacyScope);
    assert.deepEqual((await review.state(provider.reviewSession)).notes, legacyNotes);
    assert.equal((await review.state(provider.reviewSession)).files['demo.py'].reviewed, true);
    await provider.refresh({ left: 'main', right: 'feature', mode: 'merge-base' });
    vscode.window.showQuickPick = async items => items.find(item => item.link?.number === 3);
    await review.connectPR();
    assert.notEqual(provider.reviewSession.notesScope, legacyScope);
    assert.equal((await review.state(provider.reviewSession)).notes.length, 0);
    let chooseClosed = false;
    vscode.window.showQuickPick = async items => {
      if (!chooseClosed) { chooseClosed = true; return items.find(item => item.action === 'state'); }
      return items.find(item => item.link?.number === 99);
    };
    await review.connectPR(); assert.equal(provider.input.pr.number, 99);
    assert.ok(routes.some(route => route.includes('state=all')));
    vscode.window.showQuickPick = async items => items.find(item => item.action === 'url');
    vscode.window.showInputBox = async () => '#2';
    await review.connectPR(); assert.equal(provider.input.pr.number, 2);
    let chooseMore = false;
    vscode.window.showQuickPick = async items => {
      if (!chooseMore) { chooseMore = true; return items.find(item => item.action === 'more'); }
      return items.find(item => item.link?.number === 31);
    };
    await review.connectPR(); assert.equal(provider.input.pr.number, 31);
    assert.ok(routes.some(route => route.includes('page=2')));
    assert.deepEqual(execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: root }), before);
  } finally {
    review.github = githubForPicker; vscode.window.showQuickPick = pickerOriginal; vscode.window.showInputBox = inputOriginal;
    execFileSync('git', ['remote', 'remove', 'origin'], { cwd: root }); await provider.repo.status();
  }
  const ordinaryRoot = require('node:path').join(require('node:path').dirname(root), 'ordinary-project');
  execFileSync('git', ['clone', '-q', root, ordinaryRoot]);
  const ordinary = await api.openRepository(vscode.Uri.file(ordinaryRoot));
  assert.ok(ordinary);
  assert.equal(provider.repo.rootUri.fsPath, root);
  const magiInput = provider.input;
  try {
    vscode.window.showQuickPick = async items => {
      assert.equal(items[0].repo.rootUri.fsPath, root);
      return items.find(item => item.repo.rootUri.fsPath === ordinaryRoot);
    };
    await vscode.commands.executeCommand('kianReview.repository');
    assert.equal(provider.repo.rootUri.fsPath, ordinaryRoot);
    assert.equal(provider.reviewSession.root, ordinaryRoot);
    assert.equal((await review.state(provider.reviewSession)).notes.length, 0);
    assert.equal(await provider.selectRepository(), true);
    assert.equal(provider.repo.rootUri.fsPath, ordinaryRoot);
    vscode.window.showQuickPick = async items => items.find(item => item.repo.rootUri.fsPath === root);
    await vscode.commands.executeCommand('kianReview.repository');
    assert.equal(provider.repo.rootUri.fsPath, root);
    assert.deepEqual(provider.input, magiInput);
  } finally { vscode.window.showQuickPick = pickerOriginal; }
  console.log('KIAN_REVIEW_EXTENSION_HOST_PASSED');
}

module.exports = { run };
