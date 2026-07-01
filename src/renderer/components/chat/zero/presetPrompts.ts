import { unit } from '@/atom/unit';
import type { PresetIconKey } from './presetIcons';

/**
 * 预设提示词（Preset Prompt）—— 聊天空态里可点击的引导卡片。
 *
 * 点击卡片不会立即发送，而是把 `prompt` 填入底部 ComposeInput，交给用户确认/编辑后再发。
 *
 * ⚠️ 当前为渲染层 mock —— 尚未接入持久化。数据只在视图层流转：
 * 空态（ZeroState）与编辑 tab（AgentPresetsTab）共享同一个模块级 `unit` store，
 * 任一处增删改，另一处即时可见。接入持久化时，替换本文件的取数/写入实现即可，
 * 上层组件只依赖 `usePresetPrompts` / `presetPromptActions`，无需改动。
 */
export interface PresetPrompt {
  /** 稳定标识，用作 React key，后续也用于持久化行主键。 */
  id: string;
  /** 卡片标题：一句话概括这条提示词做什么。 */
  title: string;
  /** 可选的次级说明，展示在标题下方。 */
  description?: string;
  /** 点击后填入 ComposeInput 的完整提示词文本。 */
  prompt: string;
  /** 图标 key，经 `resolvePresetIcon` 解析成 Lucide 组件。 */
  iconKey: PresetIconKey;
}

/** 新建/编辑表单的输入形态（不含 id —— 新建时由 store 生成）。 */
export type PresetPromptInput = Omit<PresetPrompt, 'id'>;

/** 每个 agent 的预设提示词上限。达到后禁止新增（store 与 UI 双重把关）。 */
export const MAX_PRESET_PROMPTS = 6;

/** 每个 agent 首次访问时用于播种的默认列表。 */
const DEFAULT_PRESETS: readonly PresetPrompt[] = [
  {
    id: 'seed-brainstorm',
    title: '头脑风暴',
    description: '围绕一个主题快速发散想法',
    prompt: '帮我围绕以下主题做一次头脑风暴，给出 10 个有新意的方向，并简要说明每个方向的价值：\n\n主题：',
    iconKey: 'idea',
  },
  {
    id: 'seed-summarize',
    title: '总结要点',
    description: '把长文压缩成清晰的要点',
    prompt: '请把下面的内容总结成 5 条以内的要点，突出关键结论，去掉冗余细节：\n\n',
    iconKey: 'checklist',
  },
  {
    id: 'seed-write',
    title: '帮我写作',
    description: '起草邮件、文案或文档',
    prompt: '帮我起草一份内容。请先跟我确认目标读者与语气，然后给出初稿。\n\n我想写：',
    iconKey: 'write',
  },
  {
    id: 'seed-research',
    title: '深入调研',
    description: '就一个问题做系统性 research',
    prompt: '请就下面的问题做一次系统性调研，给出结构化的分析、关键事实与信息来源：\n\n问题：',
    iconKey: 'search',
  },
  {
    id: 'seed-code',
    title: '写 / 改代码',
    description: '实现功能或排查 bug',
    prompt: '帮我实现下面的需求。请先说明你的方案与取舍，再给出代码：\n\n需求：',
    iconKey: 'code',
  },
  {
    id: 'seed-explain',
    title: '解释概念',
    description: '用易懂的方式讲清楚',
    prompt: '请用通俗易懂、循序渐进的方式给我解释下面这个概念，并配一个贴切的类比：\n\n概念：',
    iconKey: 'learn',
  },
];

/** agentId → 该 agent 的预设列表。缺席即"尚未编辑过"，回退到默认播种列表。 */
type PresetStore = Record<string, PresetPrompt[]>;

const store = unit<PresetStore>({});

/** 无 agentId 时的兜底键，保证空态在无当前 agent 时仍有一致的可编辑列表。 */
const FALLBACK_KEY = '__default__';

function keyOf(agentId?: string | null): string {
  return agentId && agentId.length > 0 ? agentId : FALLBACK_KEY;
}

function seed(): PresetPrompt[] {
  return DEFAULT_PRESETS.map((p) => ({ ...p }));
}

/** Hook：订阅某 agent 的预设列表。未编辑过时返回默认播种列表。 */
export function usePresetPrompts(agentId?: string | null): PresetPrompt[] {
  const map = store.use();
  return map[keyOf(agentId)] ?? seed();
}

/** 命令式读取（非 hook），供事件回调使用。 */
export function getPresetPrompts(agentId?: string | null): PresetPrompt[] {
  return store.get()[keyOf(agentId)] ?? seed();
}

function newId(): string {
  return `pp_${crypto.randomUUID()}`;
}

/**
 * 预设增删改操作。均按 agent 隔离；首次写入时把默认列表固化进 store，
 * 之后的编辑都基于该固化副本。
 */
export const presetPromptActions = {
  add(agentId: string | null | undefined, input: PresetPromptInput): void {
    const key = keyOf(agentId);
    store.change((prev) => {
      const list = prev[key] ?? seed();
      // 达到上限则原样返回（no-op）—— UI 已禁用入口，这里是防御性把关。
      if (list.length >= MAX_PRESET_PROMPTS) return prev;
      return { ...prev, [key]: [...list, { ...input, id: newId() }] };
    });
  },

  update(agentId: string | null | undefined, id: string, input: PresetPromptInput): void {
    const key = keyOf(agentId);
    store.change((prev) => {
      const list = prev[key] ?? seed();
      return { ...prev, [key]: list.map((p) => (p.id === id ? { ...input, id } : p)) };
    });
  },

  remove(agentId: string | null | undefined, id: string): void {
    const key = keyOf(agentId);
    store.change((prev) => {
      const list = prev[key] ?? seed();
      return { ...prev, [key]: list.filter((p) => p.id !== id) };
    });
  },
};
