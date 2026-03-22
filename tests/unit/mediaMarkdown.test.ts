import { describe, expect, it } from 'vitest';
import {
  buildAttachmentMarkdown,
  buildFileMarkdown,
  extractExtendedMarkdownTokens,
  normalizeMediaMarkdownInText
} from '../../electron/main/services/mediaMarkdown';

describe('normalizeMediaMarkdownInText', () => {
  it('converts bare absolute image path to extended markdown', () => {
    const input = '生成完成：/Users/lei/kianWorkspace/p1/assets/generated/abc.png';
    const output = normalizeMediaMarkdownInText(input);
    expect(output).toContain('@[image](/Users/lei/kianWorkspace/p1/assets/generated/abc.png)');
  });

  it('keeps existing markdown media syntax unchanged', () => {
    const input = '预览：@[image](/Users/lei/kianWorkspace/p1/assets/generated/abc.png)';
    const output = normalizeMediaMarkdownInText(input);
    expect(output).toBe(input);
  });

  it('keeps existing extended markdown with relative media path unchanged', () => {
    const input = '预览：@[image](assets/generated/abc.png)';
    const output = normalizeMediaMarkdownInText(input);
    expect(output).toBe(input);
  });

  it('keeps standard markdown image with relative media path unchanged', () => {
    const input = '预览：![示例图](assets/generated/abc.png)';
    const output = normalizeMediaMarkdownInText(input);
    expect(output).toBe(input);
  });

  it('does not rewrite fenced code blocks', () => {
    const input = [
      '```json',
      '{',
      '  "saved_path": "/Users/lei/kianWorkspace/p1/assets/generated/abc.png"',
      '}',
      '```'
    ].join('\n');
    const output = normalizeMediaMarkdownInText(input);
    expect(output).toBe(input);
  });

  it('converts windows absolute video path', () => {
    const input = 'saved_path: C:\\\\temp\\\\clips\\\\demo.mp4';
    const output = normalizeMediaMarkdownInText(input);
    expect(output).toContain('@[video](C:\\\\temp\\\\clips\\\\demo.mp4)');
  });

  it('converts bare remote image url to extended markdown', () => {
    const input = '封面：https://cdn.example.com/assets/poster.png?size=large';
    const output = normalizeMediaMarkdownInText(input);
    expect(output).toContain(
      '@[image](https://cdn.example.com/assets/poster.png?size=large)',
    );
  });

  it('converts bare remote audio url and preserves trailing punctuation', () => {
    const input = '试听地址：https://cdn.example.com/audio/demo.m4a?t=12。';
    const output = normalizeMediaMarkdownInText(input);
    expect(output).toBe(
      '试听地址：@[audio](https://cdn.example.com/audio/demo.m4a?t=12)。',
    );
  });

  it('keeps remote media url inside markdown destination unchanged', () => {
    const input = '[试听](https://cdn.example.com/audio/demo.m4a?t=12)';
    const output = normalizeMediaMarkdownInText(input);
    expect(output).toBe(input);
  });

  it('builds file markdown syntax', () => {
    expect(buildFileMarkdown('/tmp/demo.txt')).toBe('@[file](/tmp/demo.txt)');
  });

  it('builds attachment markdown syntax', () => {
    expect(buildAttachmentMarkdown('/tmp/demo.txt')).toBe('@[attachment](/tmp/demo.txt)');
  });

  it('extracts extended markdown tokens including file and attachment', () => {
    const input = '预览：@[image](/tmp/a.png)\n文件：@[file](/tmp/readme.md)\n附件：@[attachment](/tmp/archive.zip)';
    const tokens = extractExtendedMarkdownTokens(input);
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toMatchObject({ kind: 'image', path: '/tmp/a.png' });
    expect(tokens[1]).toMatchObject({ kind: 'file', path: '/tmp/readme.md' });
    expect(tokens[2]).toMatchObject({ kind: 'attachment', path: '/tmp/archive.zip' });
  });

  it('extracts extended markdown tokens with size hints', () => {
    const tokens = extractExtendedMarkdownTokens(
      '预览：@[image|960](https://cdn.example.com/demo.png)'
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      kind: 'image',
      hint: '960',
      path: 'https://cdn.example.com/demo.png'
    });
  });
});
