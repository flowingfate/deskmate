import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/shadcn/button';
import { Checkbox } from '@/shadcn/checkbox';
import { Label } from '@/shadcn/label';
import { RadioGroup, RadioGroupItem } from '@/shadcn/radio-group';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shadcn/card';
import { appApi } from '@/ipc/app';
import { requestConfirmation } from '@/components/ui/ConfirmationDialog';
import type { CrashIncidentExportResult, CrashIncidentExportSummary } from '@shared/ipc/app';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}

export const CrashIncidentExportCard: React.FC = () => {
  const [incidents, setIncidents] = useState<CrashIncidentExportSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [includeMinidumps, setIncludeMinidumps] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    appApi.listCrashIncidentsForExport()
      .then((items) => {
        if (!active) return;
        setIncidents(items);
        setSelectedId(items[0]?.incidentId ?? '');
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selected = useMemo(
    () => incidents.find((incident) => incident.incidentId === selectedId) ?? null,
    [incidents, selectedId],
  );

  const executeExport = async (confirmedLargeExport: boolean): Promise<CrashIncidentExportResult | null> => {
    if (!selected) return null;
    return appApi.exportCrashIncident(selected.incidentId, {
      includeMinidumps,
      confirmedSensitiveMinidumps: includeMinidumps,
      confirmedLargeExport,
    });
  };

  const exportSelected = async (): Promise<void> => {
    if (!selected || exporting) return;
    if (includeMinidumps) {
      const confirmed = await requestConfirmation({
        title: 'Include sensitive minidump data?',
        description: `The selected incident has ${selected.artifactCount} dump file(s), totaling ${formatBytes(selected.artifactBytes)}. Minidumps may contain tokens, user text, and other process memory.`,
        confirmLabel: 'Include Minidumps',
        destructive: true,
      });
      if (!confirmed) return;
    }

    setExporting(true);
    setMessage('');
    try {
      let result = await executeExport(false);
      if (result && !result.success && result.requiresLargeExportConfirmation) {
        const confirmed = await requestConfirmation({
          title: 'Export exceeds 100 MiB',
          description: 'This incident export is unusually large. Continue only if you intend to share or archive this amount of diagnostic data.',
          confirmLabel: 'Export Anyway',
        });
        if (!confirmed) return;
        result = await executeExport(true);
      }
      if (!result) return;
      setMessage(result.success ? `Saved ${result.fileName} to Downloads.` : result.error);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Export crash incident</CardTitle>
        <CardDescription>
          Exports one bounded, redacted incident. Minidumps are excluded unless you explicitly include them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <p className="text-sm text-sc-muted-foreground" role="status">Loading incidents…</p>
        ) : incidents.length === 0 ? (
          <p className="text-sm text-sc-muted-foreground">No crash incidents are available.</p>
        ) : (
          <RadioGroup value={selectedId} onValueChange={setSelectedId} aria-label="Crash incident">
            {incidents.map((incident) => (
              <Label
                key={incident.incidentId}
                htmlFor={`incident-${incident.incidentId}`}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-sc-border p-3 font-normal transition-colors hover:bg-sc-muted"
              >
                <RadioGroupItem id={`incident-${incident.incidentId}`} value={incident.incidentId} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-medium">{incident.summary}</span>
                  <span className="text-xs text-sc-muted-foreground">
                    {incident.kind} · {incident.severity} · {formatTime(incident.firstEventAt)}
                  </span>
                  {incident.artifactCount > 0 && (
                    <span className="text-xs text-sc-muted-foreground">
                      {incident.artifactCount} minidump(s), {formatBytes(incident.artifactBytes)}
                    </span>
                  )}
                </span>
              </Label>
            ))}
          </RadioGroup>
        )}

        <div className="flex items-start gap-3">
          <Checkbox
            id="include-incident-minidumps"
            checked={includeMinidumps}
            disabled={!selected || selected.artifactCount === 0}
            onCheckedChange={(checked) => setIncludeMinidumps(checked === true)}
          />
          <div className="flex flex-col gap-1">
            <Label htmlFor="include-incident-minidumps">Include minidumps</Label>
            <p className="text-xs text-sc-muted-foreground">
              Disabled by default. Dump files may contain sensitive process memory.
            </p>
          </div>
        </div>

        {message && <p className="text-sm text-sc-muted-foreground" role="status">{message}</p>}
      </CardContent>
      <CardFooter className="justify-end">
        <Button disabled={!selected || exporting} onClick={exportSelected}>
          {exporting ? 'Exporting…' : 'Export Incident'}
        </Button>
      </CardFooter>
    </Card>
  );
};
