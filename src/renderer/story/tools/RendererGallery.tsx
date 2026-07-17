import { TooltipProvider } from '@/shadcn/tooltip';
import { ToolDetailView } from '@/components/chat/tool/ToolDetailView';
import { appRenderer } from '@/components/chat/tool/renderers/app';
import { shellRenderer } from '@/components/chat/tool/renderers/shell';
import { webRenderer } from '@/components/chat/tool/renderers/web';
import { writeRenderer } from '@/components/chat/tool/renderers/write';
import { subagentRenderer } from '@/components/chat/tool/renderers/subagent';
import {
  appCall,
  completedSubagentCall,
  shellCall,
  webCall,
  writeCall,
} from './fixtures';

const entries = [
  { title: 'App command', toolCall: appCall, renderer: appRenderer },
  { title: 'Shell command', toolCall: shellCall, renderer: shellRenderer },
  { title: 'Web command', toolCall: webCall, renderer: webRenderer },
  { title: 'Write result', toolCall: writeCall, renderer: writeRenderer },
  { title: 'Delegated result', toolCall: completedSubagentCall, renderer: subagentRenderer },
];

export default function RendererGallery() {
  return (
    <TooltipProvider>
      <div className="grid max-w-4xl grid-cols-1 gap-5 lg:grid-cols-2">
        {entries.map((entry) => (
          <section key={entry.title} className="rounded-lg border border-sc-border bg-sc-card p-4">
            <h2 className="m-0 mb-3 text-sm font-semibold text-sc-card-foreground">{entry.title}</h2>
            <ToolDetailView
              toolCall={entry.toolCall}
              executionStatus="completed"
              renderer={entry.renderer}
            />
          </section>
        ))}
      </div>
    </TooltipProvider>
  );
}
