import { useState } from 'react';
import type { Story } from '@ladle/react';
import { TooltipProvider } from '@/shadcn/tooltip';
import { ToolChip } from '@/components/chat/tool/ToolChip';

export default { title: 'Chat / Tools / Tool Chip' };

export const States: Story = () => {
  const [selected, setSelected] = useState<string | null>(null);
  const chips = [
    { id: 'completed', label: 'web:search', status: 'completed' as const, failed: false },
    { id: 'executing', label: 'shell: npm test', status: 'executing' as const, failed: false },
    { id: 'failed', label: 'read', status: 'completed' as const, failed: true },
    { id: 'interrupted', label: 'write', status: 'interrupted' as const, failed: false },
    { id: 'mcp', label: 'search:docs', status: 'completed' as const, failed: false, mcpServer: 'docs' },
  ];
  return (
    <TooltipProvider>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <ToolChip
            key={chip.id}
            toolName={chip.id}
            label={chip.label}
            status={chip.status}
            failed={chip.failed}
            selected={selected === chip.id}
            mcpServer={chip.mcpServer}
            onClick={() => setSelected((current) => current === chip.id ? null : chip.id)}
          />
        ))}
      </div>
    </TooltipProvider>
  );
};
