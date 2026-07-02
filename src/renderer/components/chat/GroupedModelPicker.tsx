/**
 * 按 provider 分组的模型选择下拉内容（Step 9）。
 *
 * 给三处复用：ChatInput.ModelSelector（Popover）、AgentBasicTab（侧栏下拉）、
 * CreateCustomAgentViewContent（创建表单下拉）。本组件只负责"模型列表渲染 +
 * 选中态展示"，下拉容器（Popover / div.model-dropdown）由各调用方持有，避免
 * 改三套 SCSS。
 *
 * value/onChange 都用复合 key `${provider}::${modelId}`；显示用 modelId 的
 * 模型 name。空 groups → 提示用户先去 Settings → Providers 登录。
 */

import React from 'react';
import { Check } from 'lucide-react';
import { Badge } from '@/shadcn/badge';
import { Button } from '@/shadcn/button';
import { useGroupedProviderModels, type ProviderModelGroup } from '@/lib/models/useGroupedProviderModels';
import { formatAgentModel, parseAgentModel } from '@shared/utils/agentModelId';

interface Props {
  /** 当前选中的 `${provider}::${modelId}`；空串/无效都视为未选 */
  value: string;
  onChange: (composite: string) => void;
  /** 单条模型项的样式（chat-input vs agent-editor 不同）。默认走 popover 样式 */
  variant?: 'popover' | 'list';
  disabled?: boolean;
}

export const GroupedModelPicker: React.FC<Props> = ({ value, onChange, variant = 'popover', disabled = false }) => {
  const { groups, isLoading, error } = useGroupedProviderModels();

  if (isLoading) {
    return <div className="px-3 py-2 text-sm text-muted-foreground">Loading models…</div>;
  }
  if (error) {
    return <div className="px-3 py-2 text-sm text-red-500">{error}</div>;
  }
  if (groups.length === 0) {
    return (
      <div className="px-3 py-2 text-sm text-muted-foreground">
        No providers connected. Sign in via <strong>Settings → Providers</strong>.
      </div>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <div key={group.providerId} className="mb-1 last:mb-0">
          <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {group.providerName}
          </div>
          {group.models.map((model) => {
            const composite = formatAgentModel(group.providerId, model.id);
            const isSelected = composite === value;
            return (
              <Button
                key={composite}
                variant="ghost"
                disabled={disabled}
                onClick={() => onChange(composite)}
                className={
                  variant === 'popover'
                    ? `flex items-center w-full gap-2 justify-start px-2 py-1.5 h-auto ${isSelected ? 'bg-sc-accent/50' : ''}`
                    : `model-option ${isSelected ? 'selected' : ''}`
                }
              >
                <Check size={14} strokeWidth={2} className={`shrink-0 ${isSelected ? 'opacity-100' : 'opacity-0'}`} />
                <div className="flex flex-col items-start gap-0.5 min-w-0 flex-1">
                  <span className="truncate text-sm">{model.name}</span>
                  <div className="flex gap-1 flex-wrap">
                    {model.reasoning && (
                      <Badge className="border-0 px-1.5 py-0.5 text-xs font-medium bg-neutral-500/10 text-neutral-600">Reasoning</Badge>
                    )}
                    {model.toolCalls && (
                      <Badge className="border-0 px-1.5 py-0.5 text-xs font-medium bg-green-500/10 text-green-600">Tools</Badge>
                    )}
                    {model.vision && (
                      <Badge className="border-0 px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-orange-600">Image</Badge>
                    )}
                  </div>
                </div>
              </Button>
            );
          })}
        </div>
      ))}
    </>
  );
};

/**
 * 给"按钮上显示当前 model name"的常用场景。
 * - composite 解析失败 → { label: 'Select Model', invalid: true }
 * - 解析成功但 provider 未登录或模型未列出 → 用裸 modelId 兜底显示
 * - 正常 → 显示模型 name（不带 provider 前缀，避免 UI 暴露 `::` 分隔符）
 */
export function useModelDisplayLabel(composite: string | null | undefined): {
  label: string;
  invalid: boolean;
} {
  const { groups } = useGroupedProviderModels();
  const parsed = parseAgentModel(composite);
  if (!parsed) {
    return { label: composite || 'Select Model', invalid: Boolean(composite) };
  }
  const group: ProviderModelGroup | undefined = groups.find((g) => g.providerId === parsed.provider);
  const model = group?.models.find((m) => m.id === parsed.modelId);
  return { label: model?.name ?? parsed.modelId, invalid: false };
}
