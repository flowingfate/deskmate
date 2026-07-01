/**
 * `toMediaUrl` 构建器单测 —— 纯函数,验证 `media://` URL 文法、per-authority
 * 必填 ctx、percent-encoding、非 servable scheme 兜底。
 */
import { describe, it, expect } from 'vitest';

import { toMediaUrl, imageMimeFromPath, toImageDisplaySrc } from '../mediaUrl';

const CTX = { agentId: 'a_1', sessionId: 's_1' };

describe('toMediaUrl', () => {
  it('local 附 agent+session+mime,path 段 encode', () => {
    const url = toMediaUrl('local://uploads/shot.png', 'image/png', CTX);
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.protocol).toBe('media:');
    expect(parsed.hostname).toBe('local');
    expect(parsed.pathname).toBe('/uploads/shot.png');
    expect(parsed.searchParams.get('agent')).toBe('a_1');
    expect(parsed.searchParams.get('session')).toBe('s_1');
    expect(parsed.searchParams.get('mime')).toBe('image/png');
  });

  it('文件名含空格 → percent-encoded', () => {
    const url = toMediaUrl('local://uploads/my shot.png', 'image/png', CTX);
    expect(url).toContain('my%20shot.png');
  });

  it('knowledge 不带 session', () => {
    const url = toMediaUrl('knowledge://diagram.png', 'image/png', CTX);
    const parsed = new URL(url!);
    expect(parsed.hostname).toBe('knowledge');
    expect(parsed.searchParams.has('session')).toBe(false);
    expect(parsed.searchParams.get('agent')).toBe('a_1');
  });

  it('local 缺 session → null', () => {
    expect(toMediaUrl('local://uploads/shot.png', 'image/png', { agentId: 'a_1', sessionId: null })).toBeNull();
  });

  it('缺 agent → null', () => {
    expect(toMediaUrl('local://uploads/shot.png', 'image/png', { agentId: null, sessionId: 's_1' })).toBeNull();
  });

  it('非 servable scheme(skill)→ null', () => {
    expect(toMediaUrl('skill://foo', 'image/png', CTX)).toBeNull();
  });

  it('非 URI 字符串 → null', () => {
    expect(toMediaUrl('/abs/path.png', 'image/png', CTX)).toBeNull();
  });

  it('空路径 → null', () => {
    expect(toMediaUrl('local://', 'image/png', CTX)).toBeNull();
  });
});

describe('imageMimeFromPath', () => {
  it('常见图片扩展名', () => {
    expect(imageMimeFromPath('a/b/shot.PNG')).toBe('image/png');
    expect(imageMimeFromPath('local://uploads/x.jpeg')).toBe('image/jpeg');
    expect(imageMimeFromPath('icon.svg')).toBe('image/svg+xml');
  });
  it('非图片扩展名 → null', () => {
    expect(imageMimeFromPath('notes.md')).toBeNull();
    expect(imageMimeFromPath('noext')).toBeNull();
  });
});

describe('toImageDisplaySrc', () => {
  it('local:// 图片 → media://', () => {
    const src = toImageDisplaySrc('local://uploads/shot.png', CTX);
    expect(src.startsWith('media://local/')).toBe(true);
    expect(src).toContain('mime=image%2Fpng');
  });
  it('knowledge:// 图片 → media://', () => {
    const src = toImageDisplaySrc('knowledge://diagram.png', CTX);
    expect(src.startsWith('media://knowledge/')).toBe(true);
  });
  it('裸绝对路径 → file://', () => {
    expect(toImageDisplaySrc('/abs/path/shot.png', CTX)).toBe('file:///abs/path/shot.png');
  });
  it('已是 file:// / http(s):// → 原样', () => {
    expect(toImageDisplaySrc('file:///x/y.png', CTX)).toBe('file:///x/y.png');
    expect(toImageDisplaySrc('https://e.com/i.jpg', CTX)).toBe('https://e.com/i.jpg');
  });
  it('local:// 缺 session → 回退原 uri(onError 兜底)', () => {
    expect(toImageDisplaySrc('local://uploads/shot.png', { agentId: 'a_1', sessionId: null })).toBe(
      'local://uploads/shot.png',
    );
  });
  it('internal uri 非图片扩展名 → 回退原 uri', () => {
    expect(toImageDisplaySrc('local://notes.md', CTX)).toBe('local://notes.md');
  });
});
