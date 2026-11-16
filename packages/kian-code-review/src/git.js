const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

class GitRepository {
  constructor(root, git = 'git') { this.root = root; this.git = git; }

  async exec(args) {
    const { stdout } = await run(this.git, ['--no-pager', ...args], {
      cwd: this.root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30000,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
  }

  async resolve(ref) {
    return (await this.exec(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim();
  }

  async refs() {
    const output = await this.exec(['for-each-ref', '--sort=-committerdate',
      '--format=%(refname:short)%00%(objectname:short)%00%(symref)', 'refs/heads', 'refs/remotes', 'refs/tags']);
    return output.trim().split('\n').filter(Boolean).map(line => {
      const [name, hash, symbolic] = line.split('\0'); return { name, hash, symbolic };
    }).filter(ref => !ref.symbolic);
  }

  async commits(skip = 0) {
    const output = await this.exec(['log', '-200', `--skip=${skip}`, '--format=%H%x00%s%x00%an%x00%as', 'HEAD', '--']);
    return output.trimEnd().split('\n').filter(Boolean).map(line => {
      const [hash, subject, author, date] = line.split('\0'); return { hash, subject, author, date };
    });
  }

  async compare({ left, right, mode = 'direct' }) {
    const rightHash = await this.resolve(right);
    let leftHash = left ? await this.resolve(left) : null;
    let parentCount;
    if (mode === 'commit') {
      const parents = (await this.exec(['rev-list', '--parents', '-n', '1', rightHash, '--'])).trim().split(' ').slice(1);
      parentCount = parents.length;
      leftHash = parents[0] || null;
    } else if (mode === 'merge-base') {
      leftHash = (await this.exec(['merge-base', leftHash, rightHash])).trim();
    }
    // diff-tree --root handles initial commits without writing an empty object.
    const prefix = leftHash ? ['diff', leftHash, rightHash] : ['diff-tree', '--root', '--no-commit-id', '-r', rightHash];
    const options = ['--no-ext-diff', '--no-textconv', '--find-renames'];
    const [names, numbers] = await Promise.all([
      this.exec([...prefix, ...options, '--name-status', '-z', '--']),
      this.exec([...prefix, ...options, '--numstat', '-z', '--']),
    ]);
    const stats = new Map();
    const nums = numbers.split('\0');
    for (let i = 0; i < nums.length && nums[i]; i++) {
      const match = nums[i].match(/^([^\t]+)\t([^\t]+)\t([\s\S]*)$/);
      if (!match) throw new Error('Invalid git numstat record');
      let file = match[3];
      if (file === '') { i++; file = nums[++i]; }
      stats.set(file, { added: match[1] === '-' ? null : Number(match[1]), removed: match[2] === '-' ? null : Number(match[2]) });
    }
    const fields = names.split('\0'); const files = [];
    for (let i = 0; i < fields.length && fields[i];) {
      const status = fields[i++]; const oldPath = fields[i++];
      const newPath = /^[RC]/.test(status) ? fields[i++] : oldPath;
      files.push({ status, oldPath, path: newPath, ...stats.get(newPath) });
    }
    return { leftHash, rightHash, files, mode, parentCount };
  }
}

function buildTree(files) {
  const root = { children: new Map() };
  for (const file of files) {
    const parts = file.path.split('/'); let parent = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i];
      if (!parent.children.has(name)) parent.children.set(name, { name, children: new Map(), path: parts.slice(0, i + 1).join('/') });
      parent = parent.children.get(name);
    }
    parent.children.set(`file:${parts.at(-1)}`, { name: parts.at(-1), file });
  }
  return root;
}

module.exports = { GitRepository, buildTree };
