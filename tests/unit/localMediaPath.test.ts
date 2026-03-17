import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveLocalMediaPath } from '../../electron/main/services/localMediaPath';
import {
  INTERNAL_ROOT,
  WORKSPACE_ROOT
} from '../../electron/main/services/workspacePaths';

const tempDirs: string[] = [];

const createTempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kian-local-media-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveLocalMediaPath', () => {
  it('resolves a single-encoded absolute path', () => {
    const root = createTempDir();
    const target = path.join(root, '我的项目', 'assets', 'user_files', 'demo.jpg');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'x');

    const encoded = encodeURIComponent(target);
    const resolved = resolveLocalMediaPath(encoded);
    expect(resolved).toBe(path.normalize(target));
  });

  it('resolves mixed double-encoded segments by preferring existing path', () => {
    const root = createTempDir();
    const chineseDir = '我的项目';
    const target = path.join(root, chineseDir, 'assets', 'user_files', 'demo.jpg');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'x');

    const onceEncodedSegmentPath = target.replace(chineseDir, encodeURIComponent(chineseDir));
    const encoded = encodeURIComponent(onceEncodedSegmentPath);
    const resolved = resolveLocalMediaPath(encoded);
    expect(resolved).toBe(path.normalize(target));
  });

  it('keeps literal percent-encoded folder names when they actually exist', () => {
    const root = createTempDir();
    const literalDir = '%E6%88%91%E7%9A%84%E9%A1%B9%E7%9B%AE';
    const target = path.join(root, literalDir, 'assets', 'user_files', 'demo.jpg');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'x');

    const encoded = encodeURIComponent(target);
    const resolved = resolveLocalMediaPath(encoded);
    expect(resolved).toBe(path.normalize(target));
  });

  it('resolves relative path with project id', () => {
    const relativePath = 'assets/user_files/demo.jpg';
    const encoded = encodeURIComponent(relativePath);
    const resolved = resolveLocalMediaPath(encoded, { projectId: 'demo-project' });
    expect(resolved).toBe(path.join(WORKSPACE_ROOT, 'demo-project', relativePath));
  });

  it('resolves relative path with main-agent scope id', () => {
    const relativePath = 'assets/generated/demo.jpg';
    const encoded = encodeURIComponent(relativePath);
    const resolved = resolveLocalMediaPath(encoded, { projectId: 'main-agent' });
    expect(resolved).toBe(path.join(INTERNAL_ROOT, 'main-agent', relativePath));
  });

  it('rejects relative traversal outside project directory', () => {
    const encoded = encodeURIComponent('../outside.txt');
    const resolved = resolveLocalMediaPath(encoded, { projectId: 'demo-project' });
    expect(resolved).toBeNull();
  });

  it('prefers the current document directory for bare paths', () => {
    const projectRoot = createTempDir();
    const documentLocal = path.join(projectRoot, 'docs', 'nested', 'notes', 'image.png');
    const docsRoot = path.join(projectRoot, 'docs', 'image.png');
    const projectRootFile = path.join(projectRoot, 'image.png');
    fs.mkdirSync(path.dirname(documentLocal), { recursive: true });
    fs.mkdirSync(path.dirname(docsRoot), { recursive: true });
    fs.writeFileSync(documentLocal, 'doc-local');
    fs.writeFileSync(docsRoot, 'docs-root');
    fs.writeFileSync(projectRootFile, 'project-root');

    const resolved = resolveLocalMediaPath(encodeURIComponent('image.png'), {
      documentPath: 'nested/notes/demo.md',
      projectRootOverride: projectRoot,
    });

    expect(resolved).toBe(path.normalize(documentLocal));
  });

  it('falls back to docs root before project root for bare paths', () => {
    const projectRoot = createTempDir();
    const docsRoot = path.join(projectRoot, 'docs', 'shared', 'clip.mp4');
    const projectRootFile = path.join(projectRoot, 'shared', 'clip.mp4');
    fs.mkdirSync(path.dirname(docsRoot), { recursive: true });
    fs.mkdirSync(path.dirname(projectRootFile), { recursive: true });
    fs.writeFileSync(docsRoot, 'docs-root');
    fs.writeFileSync(projectRootFile, 'project-root');

    const resolved = resolveLocalMediaPath(encodeURIComponent('shared/clip.mp4'), {
      documentPath: 'nested/notes/demo.md',
      projectRootOverride: projectRoot,
    });

    expect(resolved).toBe(path.normalize(docsRoot));
  });

  it('keeps explicit workspace-root prefixes stable when document context exists', () => {
    const projectRoot = createTempDir();
    const assetPath = path.join(projectRoot, 'assets', 'generated', 'demo.png');
    fs.mkdirSync(path.dirname(assetPath), { recursive: true });
    fs.writeFileSync(assetPath, 'asset');

    const resolved = resolveLocalMediaPath(
      encodeURIComponent('assets/generated/demo.png'),
      {
        documentPath: 'nested/notes/demo.md',
        projectRootOverride: projectRoot,
      },
    );

    expect(resolved).toBe(path.normalize(assetPath));
  });

  it('resolves explicit document-relative paths inside docs root', () => {
    const projectRoot = createTempDir();
    const target = path.join(projectRoot, 'docs', 'nested', 'poster.jpg');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'poster');

    const resolved = resolveLocalMediaPath(encodeURIComponent('../poster.jpg'), {
      documentPath: 'nested/notes/demo.md',
      projectRootOverride: projectRoot,
    });

    expect(resolved).toBe(path.normalize(target));
  });
});
