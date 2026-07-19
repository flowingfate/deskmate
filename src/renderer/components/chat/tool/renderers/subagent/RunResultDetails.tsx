import { CircleAlert, CircleCheck, CircleX, Clock3, Loader2 } from 'lucide-react';
import type { SubAgentRunResult } from '@shared/persist/types';
import { MarkdownView } from '../../../message/MarkdownView';
import { GeneratedFileCards } from '../../../message/GeneratedFileCards';
import type { SubagentRunResultView } from './parse';

export type FormalSubagentResult = SubAgentRunResult | SubagentRunResultView;

export function SubagentStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <CircleCheck size={15} className="text-emerald-600" aria-hidden="true" />;
    case 'partial':
    case 'blocked':
      return <CircleAlert size={15} className="text-amber-600" aria-hidden="true" />;
    case 'failed':
    case 'cancelled':
      return <CircleX size={15} className="text-rose-600" aria-hidden="true" />;
    case 'running':
      return <Loader2 size={15} className="animate-spin text-sky-600" aria-hidden="true" />;
    default:
      return <Clock3 size={15} className="text-gray-500" aria-hidden="true" />;
  }
}

export function SubagentFormalResultDetails({ agentId, sessionId, result }: { agentId: string; sessionId: string; result: FormalSubagentResult | null }) {
  if (!result) return null;

  let title: string | null = null;
  let content: string | null = null;
  switch (result.status) {
    case 'completed':
      content = result.content;
      break;
    case 'partial':
      title = `Incomplete: ${result.incompleteReason}`;
      content = result.content;
      break;
    case 'blocked':
      title = result.reason;
      content = result.content ?? null;
      break;
    case 'failed':
      title = result.error;
      break;
    case 'cancelled':
      title = result.reason;
      break;
  }

  return (
    <div className="flex flex-col gap-2">
      {title && (
        <p className="m-0 rounded-md bg-amber-50 px-2.5 py-2 text-xs leading-5 text-amber-900">
          {title}
        </p>
      )}
      {content && (
        <div className="rounded-md border border-black/7 bg-white px-3 py-2 text-[13px] leading-5 text-gray-800">
          <MarkdownView text={content} />
        </div>
      )}
      {result.warnings.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {result.warnings.map((warning) => <li key={warning}>Warning: {warning}</li>)}
        </ul>
      )}
      {result.deliverables.length > 0 && (
        <GeneratedFileCards agentId={agentId} sessionId={sessionId} items={result.deliverables.map((fileUri) => ({ fileUri }))} />
      )}
    </div>
  );
}
