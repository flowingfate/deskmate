import { useState, useEffect, memo } from 'react';
import { useAgentById } from '@/states/agents.atom';
import { updateAgent } from '../../../lib/chat/agentOps';
import { ModelSelectPopover } from '../ModelSelectPopover';

interface Props {
  agentId: string;
  shouldLockComposeUi: boolean;
}

function Selector(props: Props) {
  const { agentId, shouldLockComposeUi } = props;

  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const agent = useAgentById(agentId);
  const currentModel = agent?.model ?? null;
  const displayModel = pendingModel ?? currentModel;

  // 服务端落实 → 清掉 pending
  useEffect(() => {
    if (pendingModel && currentModel === pendingModel) {
      setPendingModel(null);
    }
  }, [pendingModel, currentModel]);

  const [isLoading, setIsLoading] = useState(false);

  const handleModelSelect = async (composite: string) => {
    if (isLoading) return;
    setPendingModel(composite);
    setIsLoading(true);
    try {
      const result = await updateAgent(agentId, { model: composite });
      if (!result.success) {
        setPendingModel(null);
      }
    } catch {
      setPendingModel(null);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ModelSelectPopover
      value={displayModel ?? ''}
      onChange={handleModelSelect}
      smallTigger
      disabled={isLoading || shouldLockComposeUi}
      contentClassName="w-auto min-w-(--radix-popover-trigger-width) max-w-80 max-h-100"
    />
  );
}

export const ModelSelector = memo(Selector);
