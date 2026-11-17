const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

class GitRepository {
  constructor(root, git = 'git') { this.root = root; this.git = git; this.timeout = 30000; }

  async exec(args) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const start = Date.now();
      try {
        const { stdout } = await run(this.git, ['--no-pager', ...args], {
          cwd: this.root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: this.timeout,
          env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
        });
        return stdout;
      } catch (error) {
        const timedOut = error.killed === true && error.signal === 'SIGTERM' && error.code === null;
        error.git = { root: this.root, args, attempt, elapsedMs: Date.now() - start,
          timeoutMs: this.timeout, timedOut, code: error.code, signal: error.signal, killed: error.killed,
          stderr: error.stderr || '' };
        if (timedOut && attempt === 1) continue;
        throw error;
      }
    }
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

  async commits(skip = 0, ref = 'HEAD', exclude) {
    const hash = await this.resolve(ref);
    const excluded = exclude ? ['^' + await this.resolve(exclude)] : [];
    const output = await this.exec(['log', '--topo-order', '-200', `--skip=${skip}`, '--format=%H%x00%s%x00%an%x00%as%x00%P', hash, ...excluded, '--']);
    return output.trimEnd().split('\n').filter(Boolean).map(line => {
      const [hash, subject, author, date, parents] = line.split('\0'); return { hash, subject, author, date, parents: parents?.split(' ').filter(Boolean) || [] };
    });
  }

  async worktrees() {
    const output = await this.exec(['worktree', 'list', '--porcelain', '-z']);
    return output.split('\0\0').filter(Boolean).map(block => {
      const fields = block.split('\0');
      const value = key => fields.find(field => field.startsWith(key + ' '))?.slice(key.length + 1);
      return { path: value('worktree'), head: value('HEAD'), branch: value('branch'), prunable: fields.some(f => f.startsWith('prunable')) };
    }).filter(w => w.path && w.head && !w.prunable);
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
    const [worktrees, leftRef, rightRef] = await Promise.all([
      this.worktrees(),
      leftHash ? this.exec(['rev-parse', '--symbolic-full-name', mode === 'direct' && left ? left : leftHash]) : '',
      this.exec(['rev-parse', '--symbolic-full-name', right]),
    ]);
    const locate = (hash, ref) => {
      const name = ref.trim();
      const matches = worktrees.filter(w => w.head === hash && (!name.startsWith('refs/heads/') || w.branch === name));
      return (matches.find(w => w.path === this.root) || matches[0])?.path || null;
    };
    return { leftHash, rightHash, files, mode, parentCount,
      leftWorktree: leftHash ? locate(leftHash, leftRef) : null, rightWorktree: locate(rightHash, rightRef) };
  }
}

function buildTree(files) {
  const root = { children: new Map(), stats: { added: 0, removed: 0, binary: 0, count: 0 } };
  const accumulate = (node, file) => {
    node.stats.added += file.added || 0; node.stats.removed += file.removed || 0;
    node.stats.binary += Number(file.added === null); node.stats.count++;
  };
  for (const file of files) {
    const parts = file.path.split('/'); let parent = root;
    accumulate(parent, file);
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i];
      if (!parent.children.has(name)) parent.children.set(name, { name, children: new Map(), stats: { added: 0, removed: 0, binary: 0, count: 0 }, path: parts.slice(0, i + 1).join('/') });
      parent = parent.children.get(name);
      accumulate(parent, file);
    }
    parent.children.set(`file:${parts.at(-1)}`, { name: parts.at(-1), file });
  }
  return root;
}

function isMagiRepository(repo) {
  const supported = name => /^(magi|odin(?:$|[-_]))/i.test(name);
  if (supported(require('node:path').basename(repo.rootUri.fsPath))) return true;
  return (repo.state.remotes || []).some(remote => [remote.fetchUrl, remote.pushUrl].some(url =>
    url && supported(url.replace(/\.git\/?$/, '').split(/[/:]/).at(-1))));
}

module.exports = { GitRepository, buildTree, isMagiRepository };
