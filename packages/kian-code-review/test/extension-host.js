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
