import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, SearchX } from 'lucide-react';

import { Button } from '@/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shadcn/dialog';
import { skillsApi } from '@/ipc/skill';
import { useToast } from '../../ui/ToastProvider';
import { useSkills } from '@/states/skills.atom';
import type {
  ForeignSkillCandidate,
  ForeignSkillCategory,
  ForeignSkillInstallMode,
  ImportForeignSkillItemResult,
} from '@shared/types/skillTypes';

import { ForeignSkillCategorySection } from './ForeignSkillCategorySection';
import { useForeignSkillSelection } from './useForeignSkillSelection';

interface ImportForeignAgentSkillsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function flattenCandidates(categories: ForeignSkillCategory[]): ForeignSkillCandidate[] {
  return categories.flatMap((category) => category.candidates);
}

export const ImportForeignAgentSkillsDialog: React.FC<ImportForeignAgentSkillsDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const installedSkills = useSkills();
  const { showSuccess, showError } = useToast();
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [categories, setCategories] = useState<ForeignSkillCategory[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [importResults, setImportResults] = useState<ImportForeignSkillItemResult[]>([]);

  const importErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const result of importResults) {
      if (!result.success && result.error) {
        errors[result.candidateId] = result.error;
      }
    }
    return errors;
  }, [importResults]);

  const importedSuccessIds = useMemo(() => (
    new Set(importResults.filter((result) => result.success).map((result) => result.candidateId))
  ), [importResults]);

  const selection = useForeignSkillSelection({ categories, installedSkills, importErrors });
  const candidates = useMemo(() => flattenCandidates(categories), [categories]);
  const visibleCategories = categories.filter((category) => category.exists && category.candidates.length > 0);
  const warningCount = categories.reduce((count, category) => count + category.warnings.length, 0);

  const load = useCallback(async () => {
    setLoading(true);
    setScanError(null);
    setImportResults([]);
    try {
      const result = await skillsApi.scanForeignAgentSkills();
      setCategories(result.categories);
      if (!result.success) {
        setScanError(result.error || 'Failed to scan external skill directories');
      }
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Failed to scan external skill directories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    void load();
  }, [load, open]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (importing) {
      return;
    }
    onOpenChange(nextOpen);
  }, [importing, onOpenChange]);

  const handleToggleCandidate = useCallback((candidateId: string) => {
    const candidate = candidates.find((item) => item.id === candidateId);
    if (candidate) {
      selection.toggleCandidate(candidate);
    }
  }, [candidates, selection]);

  const handleImport = useCallback(async () => {
    if (selection.selectedItems.length === 0) {
      return;
    }

    setImporting(true);
    try {
      const result = await skillsApi.importForeignAgentSkills(selection.selectedItems);
      setImportResults(result.results);
      if (result.importedCount > 0) {
        showSuccess(`Imported ${result.importedCount} skill${result.importedCount > 1 ? 's' : ''}. Apply them to agents from the Skills tab when ready.`);
      }
      if (result.failedCount > 0) {
        showError(`${result.failedCount} skill${result.failedCount > 1 ? 's' : ''} failed to import. Review the row errors and retry.`);
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to import selected skills');
    } finally {
      setImporting(false);
    }
  }, [selection.selectedItems, showError, showSuccess]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[82vh] w-[860px] max-w-[92vw] flex-col">
        <DialogHeader>
          <DialogTitle>Import skills from other agents</DialogTitle>
          <DialogDescription>
            Deskmate found skills installed for other local agents. Select the ones you trust and import them into the current profile. Linked skills stay connected to the original folder; copied skills become independent Deskmate-owned copies.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          {selection.sourceConflictNameCount > 0 && (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {selection.sourceConflictNameCount} skill name{selection.sourceConflictNameCount > 1 ? 's have' : ' has'} multiple sources. Choose one source for each name before importing.
            </div>
          )}
          {selection.overwriteCount > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {selection.overwriteCount} selected skill{selection.overwriteCount > 1 ? 's' : ''} will replace existing skills.
            </div>
          )}
          {warningCount > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <AlertTriangle size={14} />
              {warningCount} source warning{warningCount > 1 ? 's' : ''} recorded during scan.
            </div>
          )}
          {scanError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {scanError}
            </div>
          )}

          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
            <div className="flex flex-col gap-4 p-4">
              {loading && (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                  <Loader2 size={16} className="animate-spin" />
                  Scanning local agent skill directories...
                </div>
              )}

              {!loading && candidates.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-muted-foreground">
                  <SearchX size={24} />
                  <div>No external skills found.</div>
                </div>
              )}

              {!loading && visibleCategories.map((category) => (
                <ForeignSkillCategorySection
                  key={category.sourceId}
                  category={category}
                  viewModelsById={selection.viewModelsById}
                  importedSuccessIds={importedSuccessIds}
                  importing={importing}
                  onSelectCategory={() => selection.selectCategory(category)}
                  onToggleCandidate={handleToggleCandidate}
                  onModeChange={(candidateId: string, mode: ForeignSkillInstallMode) => selection.setMode(candidateId, mode)}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={importing}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={importing || selection.selectedCount === 0}>
            {importing ? 'Importing...' : `Import ${selection.selectedCount} skill${selection.selectedCount === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
