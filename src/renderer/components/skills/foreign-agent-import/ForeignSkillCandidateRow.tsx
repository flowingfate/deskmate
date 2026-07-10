import React from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

import { Badge } from '@/shadcn/badge';
import { Checkbox } from '@/shadcn/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shadcn/select';

import type { ForeignSkillInstallMode } from '@shared/types/skillTypes';
import type { CandidateViewModel } from './useForeignSkillSelection';

interface ForeignSkillCandidateRowProps {
  item: CandidateViewModel;
  importSuccess: boolean;
  importing: boolean;
  onToggle: () => void;
  onModeChange: (mode: ForeignSkillInstallMode) => void;
}

export const ForeignSkillCandidateRow: React.FC<ForeignSkillCandidateRowProps> = ({
  item,
  importSuccess,
  importing,
  onToggle,
  onModeChange,
}) => {
  const { candidate, selected, disabled, willOverwrite, hasSourceConflict, mode, importError } = item;

  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-border bg-background/60 p-3"
      data-disabled={disabled || undefined}
    >
      <Checkbox
        checked={selected}
        disabled={disabled || importing || importSuccess}
        onCheckedChange={onToggle}
        aria-label={`Select ${candidate.name}`}
        className="mt-1"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{candidate.name}</span>
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {candidate.version || 'No version'}
          </Badge>
          {willOverwrite && (
            <Badge variant="destructive" className="shrink-0 text-[10px]">
              Will replace existing skill
            </Badge>
          )}
          {hasSourceConflict && (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              Multiple sources
            </Badge>
          )}
          {importSuccess && (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <CheckCircle2 size={13} /> Imported
            </span>
          )}
        </div>

        <p className="line-clamp-2 text-xs text-muted-foreground">
          {candidate.description}
        </p>

        <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
          <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono">
            {candidate.sourcePathDisplay}
          </code>
        </div>

        {!candidate.valid && candidate.invalidReason && (
          <div className="inline-flex items-center gap-1 text-xs text-destructive">
            <XCircle size={13} />
            {candidate.invalidReason}
          </div>
        )}
        {importError && (
          <div className="inline-flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle size={13} />
            {importError}
          </div>
        )}
      </div>

      <Select value={mode} onValueChange={(value) => onModeChange(value as ForeignSkillInstallMode)} disabled={disabled || importing || importSuccess}>
        <SelectTrigger className="h-8 w-24 shrink-0 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="link">Link</SelectItem>
          <SelectItem value="copy">Copy</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
};
