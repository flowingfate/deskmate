import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shadcn/dialog';
import { Button } from '@/shadcn/button';
import { Input } from '@/shadcn/input';
import { Textarea } from '@/shadcn/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/shadcn/select';
import { DoctorModelField } from './DoctorModelField';
import {
  doctorInquiryAtom,
  doctorAnalyzeAtom,
  NONE_OPTION,
  UNSURE_TEXT,
  TIME_AGNOSTIC_TEXT,
} from '@/states/doctor.atom';
import { useAgents } from '@/states/agents.atom';
import { useAgentSessions } from '@/states/sessionIndex.atom';
import { Clipboard, Upload, X, AlertCircle } from 'lucide-react';
import { doctor_icon } from './Icon';

const fieldControl =
  'border-neutral-200 bg-white text-neutral-900 ' +
  'placeholder:text-neutral-400 hover:border-neutral-300 ' +
  'focus:border-neutral-900 focus-visible:ring-neutral-900/10';

function DoctorInquiry() {
  const [state, actions] = doctorInquiryAtom.use();
  const [analyze] = doctorAnalyzeAtom.use();
  const { form, type, error } = state;
  const open = type === 'idle-show';

  const fileInputRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const agents = useAgents();
  const sessions = useAgentSessions(
    form.agentId && form.agentId !== NONE_OPTION ? form.agentId : '',
  );

  const submitting = analyze.status === 'pending' || analyze.status === 'analyzing';

  const handleFiles = useCallback((files: FileList | File[]) => {
    const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;
    actions.updateForm((f) => { f.screenshots.push(...images); });
  }, [actions]);

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [handleFiles]);

  const onPasteFromClipboard = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of items) {
        for (const itemType of item.types) {
          if (itemType.startsWith('image/')) {
            const blob = await item.getType(itemType);
            files.push(new File([blob], `clipboard-${Date.now()}.png`, { type: itemType }));
          }
        }
      }
      if (files.length > 0) handleFiles(files);
    } catch {
      // User denied permission or there's no image on the clipboard — silently ignore
    }
  }, [handleFiles]);

  const removeScreenshot = useCallback((idx: number) => {
    actions.updateForm((f) => { f.screenshots.splice(idx, 1); });
  }, [actions]);

  const previews = useMemo(
    () => form.screenshots.map((file) => URL.createObjectURL(file)),
    [form.screenshots],
  );
  useEffect(() => {
    return () => { previews.forEach((url) => URL.revokeObjectURL(url)); };
  }, [previews]);

  const onAgentChange = useCallback((id: string) => {
    actions.updateForm((f) => {
      f.agentId = id;
      f.chatSessionId = undefined;
    });
  }, [actions]);

  const fillUnsure = useCallback(() => {
    actions.updateForm((f) => { f.reproSteps = UNSURE_TEXT; });
  }, [actions]);

  const fillTimeAgnostic = useCallback(() => {
    actions.updateForm((f) => { f.occurredAt = TIME_AGNOSTIC_TEXT; });
  }, [actions]);

  const valid = actions.isAllValid();
  const hasValidField = actions.hasValidField();

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) actions.hide(); }}>
      <DialogContent initialFocusRef={descriptionRef} data-dbg="doctor-inquiry-dialog" className="max-w-xl max-h-[88vh] p-0 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-neutral-100 bg-linear-to-r from-neutral-50 to-neutral-50 shrink-0">
          {doctor_icon}
          <DialogHeader className="flex-1 min-w-0">
            <DialogTitle className="text-base font-semibold text-neutral-900 mb-0">
              Doctor · Self-Diagnosis
            </DialogTitle>
            <DialogDescription className="mt-0 text-xs text-neutral-600">
              Describe the problem you encountered. The Doctor Agent will analyze it and generate a diagnostic report.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex flex-col gap-5 px-6 py-5 overflow-y-auto flex-1 min-h-0">
          <Field label="Problem Description" required>
            <Textarea
              ref={descriptionRef}
              value={form.description}
              onChange={(e) => actions.updateForm((f) => { f.description = e.target.value; })}
              placeholder="Briefly describe what you observed..."
              rows={3}
              className={`${fieldControl} resize-y`}
            />
          </Field>

          <Field label="Steps to Reproduce" required>
            <Textarea
              value={form.reproSteps}
              onChange={(e) => actions.updateForm((f) => { f.reproSteps = e.target.value; })}
              placeholder={'1. Open...\n2. Click...\n3. Error appears...'}
              rows={3}
              className={`${fieldControl} resize-y`}
            />
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={fillUnsure}
              className="mt-1.5 h-auto p-0 text-xs text-neutral-600 hover:text-neutral-700"
            >
              I'm not sure →
            </Button>
          </Field>

          <Field label="When It Happened" required>
            <Input
              type="text"
              value={form.occurredAt}
              onChange={(e) => actions.updateForm((f) => { f.occurredAt = e.target.value; })}
              placeholder="e.g. around 3pm today / just now / after 11pm last night..."
              className={fieldControl}
            />
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={fillTimeAgnostic}
              className="mt-1.5 h-auto p-0 text-xs text-neutral-600 hover:text-neutral-700"
            >
              Not time-related →
            </Button>
          </Field>

          <Field label="Affected Agent" required>
            <Select value={form.agentId || undefined} onValueChange={(v) => onAgentChange(v)}>
              <SelectTrigger className={fieldControl}><SelectValue placeholder="Please select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_OPTION}>Not agent-related</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.emoji ? `${a.emoji} ` : ''}{a.name || a.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {form.agentId && form.agentId !== NONE_OPTION && (
            <Field label="Affected Session" required>
              <Select value={form.chatSessionId || undefined} onValueChange={(v) => actions.updateForm((f) => { f.chatSessionId = v; })} disabled={sessions.length === 0}>
                <SelectTrigger className={fieldControl}><SelectValue placeholder="Please select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_OPTION}>Not session-related</SelectItem>
                  {sessions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.title || s.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {sessions.length === 0 && (
                <p className="mt-1.5 text-xs text-neutral-400">This agent has no session history yet</p>
              )}
            </Field>
          )}

          <Field label="Diagnosis Model" required>
            <DoctorModelField value={form.modelKey} onChange={actions.setModelKey} />
            <p className="mt-1.5 text-xs text-neutral-400">Choose the provider/model the Doctor Agent uses for diagnosis.</p>
          </Field>

          <Field label="Screenshots (optional)">
            <div className="flex gap-2 mb-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="gap-1.5"
              >
                <Upload size={14} /> Upload File
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onPasteFromClipboard}
                className="gap-1.5"
              >
                <Clipboard size={14} /> Paste from Clipboard
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={onFileSelect}
                className="hidden"
              />
            </div>
            {form.screenshots.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {form.screenshots.map((file, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={previews[i]}
                      alt={file.name || `Screenshot ${i + 1}`}
                      className="h-16 w-16 rounded-md border border-neutral-200 object-cover"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeScreenshot(i)}
                      className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                      aria-label="Remove screenshot"
                    >
                      <X size={12} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Field>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-3 border-t border-neutral-100 bg-neutral-50/50 gap-2 shrink-0">
          {hasValidField && (
            <Button variant="destructive" onClick={actions.discard} type="button" size="sm">
              Discard
            </Button>
          )}
          <Button variant="outline" onClick={actions.hide} type="button" size="sm">
            {hasValidField ? "Hide" : "Close"}
          </Button>
          <Button
            onClick={actions.submit}
            disabled={!valid || submitting}
            type="button"
            size="sm"
            className="bg-neutral-900 text-neutral-50 hover:bg-neutral-800 disabled:bg-neutral-400"
          >
            {submitting ? 'Submitting...' : 'Submit Diagnosis'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface FieldProps {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}
const Field: React.FC<FieldProps> = ({ label, required, children }) => (
  <div>
    <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-neutral-600">
      {label}
      {required && <span className="ml-1 text-red-500 normal-case">*</span>}
    </label>
    {children}
  </div>
);

export default DoctorInquiry;
