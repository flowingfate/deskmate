import { useState, useEffect, memo } from 'react';
import { ChevronDown, AlertTriangle } from 'lucide-react';
import { useAgentById } from '@/states/agents.atom';
import { updateAgent } from '../../../lib/chat/agentOps';
import { Popover, PopoverTrigger, PopoverContent } from '@/shadcn/popover';
import { Button } from '@/shadcn/button';
import { GroupedModelPicker, useModelDisplayLabel } from '../GroupedModelPicker';
import { parseAgentModel } from '@shared/utils/agentModelId';

interface Props {
  currentAgentId: string | null;
  shouldLockComposeUi: boolean;
  setSupportsImages: (supports: boolean) => void;
}

function Selector(props: Props) {
  const { currentAgentId, shouldLockComposeUi, setSupportsImages } = props;

  const [open, setOpen] = useState(false);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const agent = useAgentById(currentAgentId);
  const currentModel = agent?.model ?? null;
  const displayModel = pendingModel ?? currentModel;

  useEffect(() => {
    // Step 9 起 model 字段是 `${provider}::${modelId}`；只有 GHC 系列才能从
    // 本地 cache 拿到 vision 标志。其他 provider 暂以"未知 → 不开图片"处理，
    // 后续可在 pi.listModelsForProvider 里返回 vision 字段后再细化。
    const parsed = parseAgentModel(displayModel);
    setSupportsImages(false);
    if (!parsed) return;
  }, [displayModel, setSupportsImages]);

  // 服务端落实 → 清掉 pending
  useEffect(() => {
    if (pendingModel && currentModel === pendingModel) {
      setPendingModel(null);
    }
  }, [pendingModel, currentModel]);

  const [isLoading, setIsLoading] = useState(false);

  const handleModelSelect = async (composite: string) => {
    if (isLoading || !currentAgentId) return;
    setPendingModel(composite);
    setIsLoading(true);
    try {
      const result = await updateAgent(currentAgentId, { model: composite });
      if (!result.success) {
        setPendingModel(null);
      }
    } catch {
      setPendingModel(null);
    } finally {
      setIsLoading(false);
    }
    setOpen(false);
  };

  const { label, invalid } = useModelDisplayLabel(displayModel);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={isLoading || shouldLockComposeUi}
          title={invalid ? 'Model misconfigured, please select a model' : 'Select AI Model'}
          className={invalid ? 'border-amber-500 text-amber-600' : ''}
        >
          {invalid && <AlertTriangle size={14} className="mr-1" />}
          <span className="model-name">{invalid ? 'Select Model' : label}</span>
          <ChevronDown
            size={14}
            strokeWidth={2}
            className={`opacity-50 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto min-w-[var(--radix-popover-trigger-width)] max-w-80 max-h-[400px] overflow-y-auto overflow-x-hidden p-1"
        align="start"
        sideOffset={4}
      >
        <GroupedModelPicker
          value={displayModel ?? ''}
          onChange={handleModelSelect}
          variant="popover"
          disabled={isLoading || shouldLockComposeUi}
        />
      </PopoverContent>
    </Popover>
  );
}

export const ModelSelector = memo(Selector);
