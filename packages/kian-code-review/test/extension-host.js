const assert = require('node:assert/strict');
const vscode = require('vscode');
const { execFileSync } = require('node:child_process');

async function run() {
  const extension = vscode.extensions.getExtension('strivin0311.kian-code-review');
  const { provider } = await extension.activate();
  const api = vscode.extensions.getExtension('vscode.git').exports.getAPI(1);
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  await api.openRepository(vscode.Uri.file(root));
  const before = execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: root });
  await vscode.commands.executeCommand('kianReview.compare', { root, left: 'main', right: 'feature' });
  assert.equal(provider.result.files.length, 3);
  assert.equal(vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(tab => tab.input instanceof vscode.TabInputTextDiff).length, 0);
  const tree = provider.getChildren();
  const leaf = tree.find(node => node.file?.path === 'demo.py');
  assert.ok(leaf);
  const oldClipboard = await vscode.env.clipboard.readText();
  try {
    await vscode.commands.executeCommand('kianReview.copyRelative', leaf);
    assert.equal(await vscode.env.clipboard.readText(), 'demo.py');
    await vscode.commands.executeCommand('kianReview.copyAbsolute', leaf);
    assert.equal(await vscode.env.clipboard.readText(), root + '/demo.py');
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
  console.log('KIAN_REVIEW_EXTENSION_HOST_PASSED');
}

module.exports = { run };
