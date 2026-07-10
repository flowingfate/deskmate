import { useCallback, useMemo, useState } from 'react';
import type {
  ForeignSkillCandidate,
  ForeignSkillCategory,
  ForeignSkillInstallMode,
  ImportForeignSkillItem,
} from '@shared/types/skillTypes';
import type { SkillRecord } from '@shared/persist/types';

export interface CandidateViewModel {
  candidate: ForeignSkillCandidate;
  selected: boolean;
  disabled: boolean;
  willOverwrite: boolean;
  hasSourceConflict: boolean;
  mode: ForeignSkillInstallMode;
  importError?: string;
}

interface UseForeignSkillSelectionArgs {
  categories: ForeignSkillCategory[];
  installedSkills: SkillRecord[];
  importErrors: Record<string, string>;
}

export function useForeignSkillSelection({
  categories,
  installedSkills,
  importErrors,
}: UseForeignSkillSelectionArgs) {
  const [selectedCandidateByName, setSelectedCandidateByName] = useState<Record<string, string>>({});
  const [modesByCandidateId, setModesByCandidateId] = useState<Record<string, ForeignSkillInstallMode>>({});

  const installedNames = useMemo(
    () => new Set(installedSkills.map((skill) => skill.name)),
    [installedSkills],
  );

  const allCandidates = useMemo(
    () => categories.flatMap((category) => category.candidates),
    [categories],
  );

  const candidateById = useMemo(() => {
    const map = new Map<string, ForeignSkillCandidate>();
    for (const candidate of allCandidates) {
      map.set(candidate.id, candidate);
    }
    return map;
  }, [allCandidates]);

  const duplicateNames = useMemo(() => {
    const names = new Set<string>();
    for (const candidate of allCandidates) {
      if (candidate.duplicateSourceCount > 1) {
        names.add(candidate.name);
      }
    }
    return names;
  }, [allCandidates]);

  const viewModelsById = useMemo(() => {
    const map = new Map<string, CandidateViewModel>();
    for (const candidate of allCandidates) {
      map.set(candidate.id, {
        candidate,
        selected: selectedCandidateByName[candidate.name] === candidate.id,
        disabled: !candidate.valid,
        willOverwrite: installedNames.has(candidate.name),
        hasSourceConflict: duplicateNames.has(candidate.name),
        mode: modesByCandidateId[candidate.id] ?? 'link',
        importError: importErrors[candidate.id],
      });
    }
    return map;
  }, [allCandidates, duplicateNames, importErrors, installedNames, modesByCandidateId, selectedCandidateByName]);

  const selectedItems = useMemo(() => {
    const items: ImportForeignSkillItem[] = [];
    for (const candidateId of Object.values(selectedCandidateByName)) {
      const candidate = candidateById.get(candidateId);
      if (!candidate || !candidate.valid) {
        continue;
      }
      items.push({
        candidateId: candidate.id,
        sourceId: candidate.sourceId,
        sourcePath: candidate.sourcePath,
        installMode: modesByCandidateId[candidate.id] ?? 'link',
        overwrite: installedNames.has(candidate.name),
        selectedSkillName: candidate.name,
      });
    }
    return items;
  }, [candidateById, duplicateNames, installedNames, modesByCandidateId, selectedCandidateByName]);

  const overwriteCount = selectedItems.filter((item) => item.overwrite).length;
  const sourceConflictNameCount = duplicateNames.size;

  const toggleCandidate = useCallback((candidate: ForeignSkillCandidate) => {
    if (!candidate.valid) {
      return;
    }

    setSelectedCandidateByName((current) => {
      if (current[candidate.name] === candidate.id) {
        const next = { ...current };
        delete next[candidate.name];
        return next;
      }
      return { ...current, [candidate.name]: candidate.id };
    });
  }, []);

  const setMode = useCallback((candidateId: string, mode: ForeignSkillInstallMode) => {
    setModesByCandidateId((current) => ({ ...current, [candidateId]: mode }));
  }, []);

  const selectCategory = useCallback((category: ForeignSkillCategory) => {
    setSelectedCandidateByName((current) => {
      const next = { ...current };
      for (const candidate of category.candidates) {
        if (!candidate.valid || duplicateNames.has(candidate.name) || installedNames.has(candidate.name)) {
          continue;
        }
        next[candidate.name] = candidate.id;
      }
      return next;
    });
  }, [duplicateNames, installedNames]);

  return {
    selectedItems,
    selectedCount: selectedItems.length,
    overwriteCount,
    sourceConflictNameCount,
    viewModelsById,
    toggleCandidate,
    setMode,
    selectCategory,
  };
}
