import { describe, expect, it } from 'vitest';

import {
  parseAgentMarkdown,
  patchFrontMatter,
  patchSystemPrompt,
  serializeAgentMarkdown,
} from '../markdown';
import type { AgentMarkdownFile } from '../types';

const SAMPLE: AgentMarkdownFile = {
  frontMatter: {
    name: 'Kobi',
    version: '1.0.0',
    model: 'github-copilot::claude-sonnet-4.6',
    emoji: '🤖',
    skills: ['web-search'],
  },
  systemPrompt: 'You are a highly capable AI assistant.\n',
};

describe('shared/persist/markdown', () => {
  it('round-trips serialize → parse → serialize byte-equally', () => {
    const raw = serializeAgentMarkdown(SAMPLE);
    const parsed = parseAgentMarkdown(raw);
    const reSerialized = serializeAgentMarkdown(parsed);
    expect(reSerialized).toBe(raw);
    expect(parsed.frontMatter.name).toBe('Kobi');
    expect(parsed.systemPrompt).toBe(SAMPLE.systemPrompt);
  });

  it('rejects content without front-matter', () => {
    expect(() => parseAgentMarkdown('no fences here')).toThrow(/front-matter/);
  });

  it('rejects front-matter missing required fields', () => {
    const bad = '---\nname: x\n---\nbody\n';
    expect(() => parseAgentMarkdown(bad)).toThrow(/version/);
  });

  it('patchFrontMatter merges fields and preserves body', () => {
    const raw = serializeAgentMarkdown(SAMPLE);
    const patched = patchFrontMatter(raw, { version: '2.0.0' });
    const parsed = parseAgentMarkdown(patched);
    expect(parsed.frontMatter.version).toBe('2.0.0');
    expect(parsed.frontMatter.name).toBe('Kobi');
    expect(parsed.systemPrompt).toBe(SAMPLE.systemPrompt);
  });

  it('patchSystemPrompt replaces body and preserves front-matter', () => {
    const raw = serializeAgentMarkdown(SAMPLE);
    const patched = patchSystemPrompt(raw, 'new body');
    const parsed = parseAgentMarkdown(patched);
    expect(parsed.systemPrompt).toBe('new body\n');
    expect(parsed.frontMatter.name).toBe('Kobi');
  });
});
