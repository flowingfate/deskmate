/**
 * 单聊会话的 thinking level 选择器（pi-ai `ThinkingLevel`）。
 *
 * 渲染策略：
 * - 只有当活跃 model 支持 ≥2 个 thinking level（`info.thinkingLevels`）时才出现；
 *   单档/不支持时直接 `return null`。
 * - 当前未设置（detail.thinkingLevel == null）时显示 "Auto"，含义是"由 provider
 *   决定默认"。pi-ai 的 `streamSimple({ reasoning })` 在 reasoning=undefined 时
 *   会走 provider 默认 —— 我们不在前端假装知道哪个等级是默认值。
 * - dropdown 顶部一项 "Auto"，下面按 `info.thinkingLevels` 顺序列出可选等级。
 *
 * 写路径：
 * - 选具体等级 → `updateAgent(agentId, { thinkingLevel })`
 * - 选 "Auto"  → `updateAgent(agentId, { thinkingLevel: null })`（null 是
 *   AgentFrontPatch 的三态 sentinel，清除字段；undefined 反而是"不修改"）
 *
 * 字段不再做 toLowerCase 防御：新 schema 写入路径都来自此组件本身或 sync 复制，
 * 类型层（ThinkingLevel = 'minimal'|...|'xhigh'）已经锁住合法值。
 */

import { memo, useState } from 'react';
import { Check } from 'lucide-react';
import { useAgentById } from '@/states/agents.atom';
import { useAgentDetail } from '@/states/agentDetail.atom';
import { updateAgent } from '../../../lib/chat/agentOps';
import { useModelInfo } from '@/lib/models/useModelInfo';
import type { ThinkingLevel } from '@shared/persist/types'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/shadcn/dropdown-menu';
import { Button } from '@/shadcn/button';

interface Props {
  currentAgentId: string | null;
  shouldLockComposeUi: boolean;
}

const AUTO_LABEL = 'Auto';

function Selector({ currentAgentId, shouldLockComposeUi }: Props) {
  const [isLoading, setIsLoading] = useState(false);

  const agent = useAgentById(currentAgentId);
  // thinkingLevel 是 cold 字段：detail 尚未到位时按"未设置"处理（Auto），与
  // 加载完后的"显式无值"行为对齐，避免按钮在 detail 异步到位前闪一次具体等级。
  const detail = useAgentDetail(currentAgentId);
  const modelId = agent?.model ?? null;
  const current: ThinkingLevel | undefined = detail?.thinkingLevel;

  const { info } = useModelInfo(modelId);
  const supported = info?.thinkingLevels;
  // 单档不渲染（用户没的选）；空数组表示该 model 不支持 reasoning。
  if (!supported || supported.length <= 1) return null;

  const buttonLabel = current && supported.includes(current)
    ? formatLabel(current)
    : AUTO_LABEL;

  // 选 ThinkingLevel：透传；选 null：清除字段（语义 "Auto"）。
  const handleSelect = async (next: ThinkingLevel | null) => {
    if ((next ?? undefined) === current) return;
    if (!currentAgentId) return;
    setIsLoading(true);
    try {
      await updateAgent(currentAgentId, { thinkingLevel: next });
    } catch {
      /* 失败：agentDetail.atom 不会被更新，UI 自动回到旧值 */
    } finally {
      setIsLoading(false);
    }
  };

  const isAuto = current === undefined || !supported.includes(current);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={isLoading || shouldLockComposeUi}
          title="Thinking level"
        >
          <span className="thinking-level-label">{buttonLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4}>
        <DropdownMenuItem onClick={() => handleSelect(null)}>
          <Check
            size={14}
            strokeWidth={2}
            className={isAuto ? 'opacity-100' : 'opacity-0'}
          />
          <span>{AUTO_LABEL}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {supported.map(level => (
          <DropdownMenuItem
            key={level}
            onClick={() => handleSelect(level)}
          >
            <Check
              size={14}
              strokeWidth={2}
              className={!isAuto && current === level ? 'opacity-100' : 'opacity-0'}
            />
            <span>{formatLabel(level)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatLabel(level: ThinkingLevel): string {
  // 显示用：'xhigh' → 'XHigh' 比 'Xhigh' 更易读；其它直接首字母大写。
  if (level === 'xhigh') return 'XHigh';
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export const ThinkingLevelSelector = memo(Selector);
