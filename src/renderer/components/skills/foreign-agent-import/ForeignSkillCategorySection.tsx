import React from 'react';
import { FolderSearch } from 'lucide-react';

import { Button } from '@/shadcn/button';
import { Badge } from '@/shadcn/badge';
import { ForeignSkillCandidateRow } from './ForeignSkillCandidateRow';
import type { ForeignSkillCategory, ForeignSkillInstallMode } from '@shared/types/skillTypes';
import type { CandidateViewModel } from './useForeignSkillSelection';

interface ForeignSkillCategorySectionProps {
  category: ForeignSkillCategory;
  viewModelsById: Map<string, CandidateViewModel>;
  importedSuccessIds: Set<string>;
  importing: boolean;
  onSelectCategory: () => void;
  onToggleCandidate: (candidateId: string) => void;
  onModeChange: (candidateId: string, mode: ForeignSkillInstallMode) => void;
}

export const ForeignSkillCategorySection: React.FC<ForeignSkillCategorySectionProps> = ({
  category,
  viewModelsById,
  importedSuccessIds,
  importing,
  onSelectCategory,
  onToggleCandidate,
  onModeChange,
}) => {
  if (!category.exists || category.candidates.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <FolderSearch size={15} className="shrink-0 text-muted-foreground" />
          <h3 className="truncate text-sm font-semibold text-foreground">{category.sourceLabel}</h3>
          <Badge variant="secondary" className="text-[10px]">
            {category.candidates.length}
          </Badge>
          <code className="truncate text-[11px] text-muted-foreground">{category.sourceRootDisplay}</code>
        </div>
        <Button variant="ghost" size="sm" onClick={onSelectCategory} disabled={importing}>
          Select all safe
        </Button>
      </div>

      {category.warnings.length > 0 && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {category.warnings.length} warning{category.warnings.length > 1 ? 's' : ''} while scanning this source.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {category.candidates.map((candidate) => {
          const item = viewModelsById.get(candidate.id);
          if (!item) return null;
          return (
            <ForeignSkillCandidateRow
              key={candidate.id}
              item={item}
              importSuccess={importedSuccessIds.has(candidate.id)}
              importing={importing}
              onToggle={() => onToggleCandidate(candidate.id)}
              onModeChange={(mode) => onModeChange(candidate.id, mode)}
            />
          );
        })}
      </div>
    </section>
  );
};
