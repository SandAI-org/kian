const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function version(file) {
  return digest([file.path, file.oldPath, file.status, file.leftObject, file.rightObject]);
}

function scopeKey(identity, input, result) {
  return digest([identity, input.mode, input.mode === 'commit' ? result.rightHash : input.reviewKey || [input.left, input.right]]);
}

function reviewStatus(file, record) {
  const changed = Boolean(record && record.version !== version(file));
  return { reviewed: Boolean(record && !record.unread && !changed), updated: changed,
    targetChanged: Boolean(record && record.rightObject?.oid !== file.rightObject?.oid), baseline: record || null };
}

function promptsMarkdown(notes, root) {
  return notes.filter(note => !note.resolved).map(note => {
    const location = `${note.anchor.absolutePath || path.join(root, note.anchor.path)}:${note.anchor.start + 1}${note.anchor.end > note.anchor.start ? `-${note.anchor.end + 1}` : ''}`;
    return `- ${JSON.stringify(location)} (${note.anchor.side}, ${note.anchor.ref?.slice(0, 12) || 'empty'})\n${note.text.split('\n').map(line => `  ${line}`).join('\n')}`;
  }).join('\n\n');
}

class ReviewStore {
  constructor(root) { this.root = root; }
  folder(scope, kind) { return path.join(this.root, scope, kind); }
  async read(scope, kind, id) {
    try { return JSON.parse(await fs.readFile(path.join(this.folder(scope, kind), digest(id) + '.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async write(scope, kind, id, value) {
    const folder = this.folder(scope, kind); await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    const dest = path.join(folder, digest(id) + '.json'), temp = dest + '.' + crypto.randomUUID();
    await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await fs.rename(temp, dest);
  }
  async entries(scope, kind) {
    let files;
    try { files = await fs.readdir(this.folder(scope, kind)); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return Promise.all(files.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(async name => JSON.parse(await fs.readFile(path.join(this.folder(scope, kind), name), 'utf8'))));
  }
  objectPath(oid) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid)) throw new Error('Invalid Git object ID');
    return path.join(this.root, 'objects', oid);
  }
  async cacheObject(git, object) {
    if (!object || object.type !== 'blob') return;
    const dest = this.objectPath(object.oid);
    try { await fs.access(dest); return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const content = await git.exec(['cat-file', 'blob', object.oid], { encoding: null });
    await fs.mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
    const temp = dest + '.' + crypto.randomUUID(); await fs.writeFile(temp, content, { mode: 0o600 }); await fs.rename(temp, dest);
  }
  async mark(scope, file, result, git, reviewed) {
    if (!reviewed) {
      const old = await this.read(scope, 'files', file.path);
      if (old) await this.write(scope, 'files', file.path, { ...old, unread: true });
      return;
    }
    await this.cacheObject(git, file.rightObject);
    await this.write(scope, 'files', file.path, { path: file.path, oldPath: file.oldPath, version: version(file),
      leftHash: result.leftHash, rightHash: result.rightHash, leftObject: file.leftObject, rightObject: file.rightObject,
      reviewedAt: new Date().toISOString(), unread: false });
  }
  async addNote(scope, anchor, text) {
    const note = { id: crypto.randomUUID(), anchor, text, resolved: false, createdAt: new Date().toISOString() };
    await this.write(scope, 'notes', note.id, note); return note;
  }
}

module.exports = { ReviewStore, version, scopeKey, reviewStatus, promptsMarkdown };
