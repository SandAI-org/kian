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
  const { provider } = await extension.activate();
  const api = vscode.extensions.getExtension('vscode.git').exports.getAPI(1);
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  await api.openRepository(vscode.Uri.file(root));
  const before = execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: root });
  await vscode.commands.executeCommand('kianReview.compare', { root, left: 'main', right: 'feature' });
  assert.equal(provider.result.files.length, 4);
  await waitVisible(provider.view);
  assert.equal(provider.view.visible, true);
  for (const node of provider.getChildren()) assert.ok(provider.getTreeItem(node));
  assert.equal(vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(tab => tab.input instanceof vscode.TabInputTextDiff).length, 0);
  const tree = provider.getChildren();
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
    assert.deepEqual(provider.getChildren().slice(0, 4).map(n => n.control), ['repository', 'mode', 'base', 'target']);
    let picks = 0;
    provider.pickRef = async () => { picks++; return 'HEAD'; };
    await vscode.commands.executeCommand('kianReview.base');
    assert.equal(picks, 1); assert.equal(provider.input.left, 'HEAD');
    provider.pickRef = async () => { picks++; return 'feature'; };
    await vscode.commands.executeCommand('kianReview.target');
    assert.equal(picks, 2); assert.equal(provider.input.right, 'feature');
    const tabs = () => vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(tab => tab.input instanceof vscode.TabInputTextDiff).length;
    const previousTabs = tabs();
    const folder = provider.getChildren().find(n => n.name === 'deep');
    assert.equal(folder.stats.added, 1); assert.equal(folder.stats.removed, 0);
    await vscode.commands.executeCommand('kianReview.expand');
    assert.equal(provider.getTreeItem(folder).collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    await provider.view.reveal(provider.getChildren(folder)[0], { expand: true, focus: false });
    await vscode.commands.executeCommand('kianReview.collapse');
    assert.equal(provider.getTreeItem(folder).collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
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
    assert.equal(provider.getTreeItem(provider.getControls()[3]).contextValue, 'reviewCommitControl');
    assert.match(provider.getTreeItem(provider.getControls()[3]).description, /feature/);
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
  console.log('KIAN_REVIEW_EXTENSION_HOST_PASSED');
}

module.exports = { run };
