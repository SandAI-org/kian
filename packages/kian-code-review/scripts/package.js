const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const { name, version } = require('../package.json');
const output = path.join(root, 'dist', `${name}-${version}.vsix`);
fs.mkdirSync(path.dirname(output), { recursive: true });
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
  'exec', '--yes', '--package=@vscode/vsce@4.1.1', '--', 'vsce', 'package',
  '--no-dependencies', '--allow-missing-repository', '--out', output,
], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
