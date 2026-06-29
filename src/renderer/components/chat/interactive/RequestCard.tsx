import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fsApi } from '@/ipc/fs';
import { workspaceApi } from '@/ipc/workspace';
import {
  ListChecks,
  ShieldAlert,
  SlidersHorizontal,
  Folder,
  FileText,
} from 'lucide-react';
import type {
  ApprovalInteractionResponse,
  FormInteractionField,
} from '@shared/types/interactiveRequestTypes';
import { Checkbox } from '@/shadcn/checkbox';
import { Button } from '@/shadcn/button';
import { Input } from '@/shadcn/input';
import { Textarea } from '@/shadcn/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/shadcn/select';
import { cn } from '@/lib/utilities/utils';
import { PendingInteractiveRequestMap } from '@renderer/lib/chat/session-manager';


function normalizeCustomEntries(rawValue: string): string[] {
  return rawValue
    .split(/\n|,|，/)
    .map((entry) => entry.trim())
    .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);
}

function mergeUniqueValues(presetValues: string[], customValues: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const value of [...presetValues, ...customValues]) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    merged.push(value);
  }

  return merged;
}

function buildChoiceSubmissionValues(
  selectedValues: string[],
  customSelected: boolean,
  customValue: string,
  mode: 'single' | 'multi',
): string[] {
  if (mode === 'single') {
    if (customSelected) {
      const trimmedCustomValue = customValue.trim();
      return trimmedCustomValue ? [trimmedCustomValue] : [];
    }
    return selectedValues;
  }

  return mergeUniqueValues(selectedValues, customSelected ? normalizeCustomEntries(customValue) : []);
}



function buildFormSelectSubmissionValue(
  field: FormInteractionField,
  selectedValue: unknown,
  customSelected: boolean,
  customValue: string,
): string | string[] {
  const trimmedCustomValue = customValue.trim();

  if (isMultiValueField(field)) {
    const presetValues = Array.isArray(selectedValue)
      ? selectedValue.filter((value): value is string => typeof value === 'string')
      : [];

    return mergeUniqueValues(presetValues, customSelected ? normalizeCustomEntries(customValue) : []);
  }

  if (customSelected) {
    return trimmedCustomValue;
  }

  return typeof selectedValue === 'string' ? selectedValue : '';
}


type CardTypes = 'approval' | 'choice' | 'form';

function getRequestIcon(requestType: string) {
  if (requestType === 'approval') {
    return ShieldAlert;
  }

  if (requestType === 'choice') {
    return ListChecks;
  }

  return SlidersHorizontal;
}

function renderHtmlDescription(description?: string) {
  if (!description) {
    return null;
  }

  return (
    <p
      className="mt-1.5 text-[13px] leading-relaxed text-slate-600"
      dangerouslySetInnerHTML={{ __html: description }}
    />
  );
}

function parseNumericValue(rawValue: string, field: FormInteractionField): string | number {
  if (rawValue === '') {
    return '';
  }

  if (field.type === 'int') {
    return Number.parseInt(rawValue, 10);
  }

  if (field.type === 'double') {
    return Number.parseFloat(rawValue);
  }

  return rawValue;
}

function isMultiValueField(field: FormInteractionField) {
  return field.control === 'multiselect';
}

function isSelectField(field: FormInteractionField) {
  return field.control === 'select' || field.control === 'multiselect';
}

function toggleSelectFieldValue(
  field: FormInteractionField,
  currentValue: unknown,
  optionValue: string,
): string | string[] {
  if (isMultiValueField(field)) {
    const currentValues = Array.isArray(currentValue) ? currentValue : [];
    return currentValues.includes(optionValue)
      ? currentValues.filter((value) => value !== optionValue)
      : [...currentValues, optionValue];
  }

  return currentValue === optionValue ? '' : optionValue;
}

function handleOptionMouseDown(event: React.MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

function handleOptionClick(event: React.MouseEvent<HTMLButtonElement>, callback: () => void) {
  event.preventDefault();
  event.stopPropagation();
  callback();
}

function isFieldValueEmpty(value: unknown, field: FormInteractionField): boolean {
  if (isMultiValueField(field)) {
    return !Array.isArray(value) || value.length === 0;
  }

  return value === '' || value === null || value === undefined;
}

function validateFormValues(
  fields: FormInteractionField[],
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const value = values[field.key];
    const isEmpty = isFieldValueEmpty(value, field);

    if (field.required && isEmpty) {
      errors[field.key] = 'This field is required';
      continue;
    }

    if (isEmpty) {
      continue;
    }

    if (field.type === 'int' && !Number.isInteger(typeof value === 'number' ? value : Number(value))) {
      errors[field.key] = 'Please enter a valid integer';
      continue;
    }

    if (field.type === 'double' && Number.isNaN(typeof value === 'number' ? value : Number(value))) {
      errors[field.key] = 'Please enter a valid number';
      continue;
    }

    if (isMultiValueField(field) && Array.isArray(value)) {
      if (typeof field.minSelections === 'number' && value.length < field.minSelections) {
        errors[field.key] = `Please select at least ${field.minSelections} option${field.minSelections === 1 ? '' : 's'}`;
        continue;
      }

      if (typeof field.maxSelections === 'number' && value.length > field.maxSelections) {
        errors[field.key] = `Please select no more than ${field.maxSelections} option${field.maxSelections === 1 ? '' : 's'}`;
      }
    }
  }

  return errors;
}

function ApprovalRequestContent(props: {
  data: PendingInteractiveRequestMap['approval']
}) {
  const { id, request, task } = props.data;
  const [decisions, setDecisions] = useState<Record<string, boolean | null>>({});
  const hasSubmittedRef = useRef(false);

  useEffect(() => {
    const initialState: Record<string, boolean | null> = {};
    for (const item of request.items) {
      initialState[item.itemId] = null;
    }
    setDecisions(initialState);
    hasSubmittedRef.current = false;
  }, [id, request.items]);

  const allDecided = request.items.length > 0 && request.items.every((item) => typeof decisions[item.itemId] === 'boolean');

  const buildApprovalResponse = (): ApprovalInteractionResponse => {
    const approvalItemDecisions = request.items.map((item) => ({
      itemId: item.itemId,
      approved: decisions[item.itemId] === true,
    }));
    const approvedCount = approvalItemDecisions.filter((item) => item.approved).length;

    return {
      action: approvedCount === 0 ? 'reject' : approvedCount === approvalItemDecisions.length ? 'approve' : 'submit',
      approvalItemDecisions,
    };
  };

  useEffect(() => {
    if (!allDecided || hasSubmittedRef.current) {
      return;
    }

    hasSubmittedRef.current = true;
    void task.resolve(buildApprovalResponse());
  }, [allDecided, task, decisions]);

  const setAllDecisions = (approved: boolean) => {
    const nextState: Record<string, boolean> = {};
    for (const item of request.items) {
      nextState[item.itemId] = approved;
    }
    setDecisions(nextState);
  };

  return (
    <>
      {request.items.length > 1 ? (
        <div className="mt-3.5 flex flex-wrap gap-2 max-[720px]:[&_button]:flex-1">
          <Button variant="outline" size="sm" onClick={() => setAllDecisions(true)}>
            Approve All
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAllDecisions(false)}>
            Reject All
          </Button>
        </div>
      ) : null}

      <div className="mt-3.5 flex flex-col gap-3">
        {request.items.map((item) => {
          const decision = decisions[item.itemId];
          return (
            <div key={item.itemId} className="rounded-2xl border border-slate-300/50 bg-white/90 p-3">
              <div className="flex items-start justify-between gap-3 max-[720px]:flex-col">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{item.toolName}</div>
                  <div className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{item.message}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={cn(
                      'inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-semibold transition',
                      decision === true
                        ? 'border-teal-600/55 bg-teal-50/90 shadow-[0_10px_20px_rgba(13,148,136,0.12)]'
                        : 'border-slate-900/12 bg-white text-slate-900 hover:border-slate-900/25',
                    )}
                    onClick={() => setDecisions((prev) => ({ ...prev, [item.itemId]: true }))}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-semibold transition',
                      decision === false
                        ? 'border-rose-600/55 bg-rose-50/90 text-rose-700'
                        : 'border-slate-900/12 bg-white text-slate-900 hover:border-slate-900/25',
                    )}
                    onClick={() => setDecisions((prev) => ({ ...prev, [item.itemId]: false }))}
                  >
                    Reject
                  </button>
                </div>
              </div>
              {item.paths.length > 0 ? (
                <div className="mt-2.5 flex flex-col gap-1.5">
                  {item.paths.map((p) => (
                    <div key={p.path} className="break-all rounded-lg bg-slate-100/80 px-2.5 py-2 text-xs text-slate-800">{p.normalizedPath || p.path}</div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

function ChoiceRequestContent(props: {
  data: PendingInteractiveRequestMap['choice']
}) {
  const { id, request, task } = props.data;
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [customSelected, setCustomSelected] = useState(false);
  const [customValue, setCustomValue] = useState('');

  useEffect(() => {
    setSelectedValues([]);
    setCustomSelected(false);
    setCustomValue('');
  }, [id]);

  const toggleValue = (value: string) => {
    if (request.mode === 'single') {
      setSelectedValues([value]);
      setCustomSelected(false);
    } else {
      setSelectedValues((prev) =>
        prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
      );
    }
  };

  const isValidSelection = useMemo(() => {
    const submissionValues = buildChoiceSubmissionValues(selectedValues, customSelected, customValue, request.mode);
    if (submissionValues.length === 0) return false;
    if (typeof request.minSelections === 'number' && submissionValues.length < request.minSelections) return false;
    if (typeof request.maxSelections === 'number' && submissionValues.length > request.maxSelections) return false;
    return true;
  }, [customSelected, customValue, request.maxSelections, request.minSelections, request.mode, selectedValues]);

  const submissionValues = useMemo(
    () => buildChoiceSubmissionValues(selectedValues, customSelected, customValue, request.mode),
    [customSelected, customValue, request.mode, selectedValues],
  );

  return (
    <>
      <div className="mt-3.5 text-xs leading-snug text-slate-500">
        {request.mode === 'multi'
          ? 'Select one or more options'
          : 'Select one option'}
      </div>

      <div className="mt-3.5 flex flex-col gap-3">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] items-stretch gap-2.5 max-[720px]:grid-cols-1">
          {request.options.map((option) => {
            const selected = selectedValues.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                className={cn(
                  'w-full cursor-pointer rounded-2xl border bg-white/90 p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-55',
                  selected
                    ? 'border-teal-600/55 bg-teal-50/90 shadow-[0_10px_20px_rgba(13,148,136,0.12)]'
                    : 'border-slate-300/50 hover:border-slate-400/60',
                )}
                disabled={option.disabled}
                aria-pressed={selected}
                onMouseDown={handleOptionMouseDown}
                onClick={(event) => handleOptionClick(event, () => toggleValue(option.value))}
              >
                <div className="flex items-start gap-2.5">
                  <div className="text-sm font-semibold text-slate-900">{option.label}</div>
                </div>
                {option.description ? (
                  <div className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{option.description}</div>
                ) : null}
              </button>
            );
          })}
          <button
            type="button"
            className={cn(
              'w-full cursor-pointer rounded-2xl border bg-white/90 p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-55',
              customSelected
                ? 'border-teal-600/55 bg-teal-50/90 shadow-[0_10px_20px_rgba(13,148,136,0.12)]'
                : 'border-slate-300/50 hover:border-slate-400/60',
            )}
            aria-pressed={customSelected}
            onMouseDown={handleOptionMouseDown}
            onClick={(event) => handleOptionClick(event, () => {
              if (request.mode === 'single') {
                setSelectedValues([]);
                setCustomSelected((prev) => !prev);
                return;
              }

              setCustomSelected((prev) => !prev);
            })}
          >
            <div className="flex items-start gap-2.5">
              <div className="text-sm font-semibold text-slate-900">Other</div>
            </div>
            <div className="mt-1.5 text-[13px] leading-relaxed text-slate-600">Enter a custom value if none of the preset options fit.</div>
          </button>
        </div>
        {customSelected ? (
          <div className="mt-2.5 flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold text-slate-900" htmlFor={`${id}_custom_choice`}>
              Custom option
            </label>
            <Input
              id={`${id}_custom_choice`}
              type="text"
              value={customValue}
              placeholder={request.mode === 'multi' ? 'Enter one or more values, separated by commas' : 'Enter a custom value'}
              onChange={(event) => setCustomValue(event.target.value)}
            />
          </div>
        ) : null}
      </div>

      <div className="mt-3.5 flex flex-wrap gap-2 max-[720px]:[&_button]:flex-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => task.resolve({
            action: 'skip',
            selectedValues: [],
          })}
        >
          Skip
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={!isValidSelection}
          onClick={() => task.resolve({
            action: 'submit',
            selectedValues: submissionValues,
          })}
        >
          Continue
        </Button>
      </div>
    </>
  );
}

function FormRequestContent(props: {
  data: PendingInteractiveRequestMap['form']
}) {
  const { id, request, task } = props.data;
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [customSelectEnabled, setCustomSelectEnabled] = useState<Record<string, boolean>>({});
  const [customSelectValues, setCustomSelectValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const initialValues: Record<string, unknown> = {};
    for (const field of request.fields) {
      if (field.type === 'boolean') {
        initialValues[field.key] = typeof field.defaultValue === 'boolean' ? field.defaultValue : false;
      } else if (isMultiValueField(field)) {
        initialValues[field.key] = Array.isArray(field.defaultValue) ? field.defaultValue : [];
      } else {
        initialValues[field.key] = field.defaultValue ?? '';
      }
    }
    setValues(initialValues);
    const initialCustomEnabled: Record<string, boolean> = {};
    const initialCustomValues: Record<string, string> = {};
    for (const field of request.fields) {
      if (!isSelectField(field)) {
        continue;
      }

      if (isMultiValueField(field)) {
        const optionValues = new Set((field.options || []).map((option) => option.value));
        const currentValues = Array.isArray(initialValues[field.key]) ? initialValues[field.key] as string[] : [];
        const customEntries = currentValues.filter((entry) => !optionValues.has(entry));
        initialValues[field.key] = currentValues.filter((entry) => optionValues.has(entry));
        initialCustomEnabled[field.key] = customEntries.length > 0;
        initialCustomValues[field.key] = customEntries.join(', ');
      } else {
        const stringValue = typeof initialValues[field.key] === 'string' ? initialValues[field.key] as string : '';
        const matchesPreset = (field.options || []).some((option) => option.value === stringValue);
        initialCustomEnabled[field.key] = !matchesPreset && stringValue.length > 0;
        initialCustomValues[field.key] = matchesPreset ? '' : stringValue;
        initialValues[field.key] = matchesPreset ? stringValue : '';
      }
    }
    setCustomSelectEnabled(initialCustomEnabled);
    setCustomSelectValues(initialCustomValues);
    setErrors({});
  }, [request.fields, id]);

  const setFieldValue = (field: FormInteractionField, rawValue: string | boolean | string[]) => {
    const nextValue = typeof rawValue === 'boolean' || Array.isArray(rawValue)
      ? rawValue
      : parseNumericValue(rawValue, field);

    setValues((prev) => ({ ...prev, [field.key]: nextValue }));
    setErrors((prev) => {
      if (!prev[field.key]) {
        return prev;
      }
      const nextErrors = { ...prev };
      delete nextErrors[field.key];
      return nextErrors;
    });
  };

  const handleFolderSelect = async (fieldKey: string) => {
    const result = await workspaceApi.selectFolder();
    if (result?.success && result.folderPath) {
      setValues((prev) => ({ ...prev, [fieldKey]: result.folderPath }));
    }
  };

  const handleFileSelect = async (fieldKey: string) => {
    const result = await fsApi.selectFile();
    if (result?.success && result.filePath) {
      setValues((prev) => ({ ...prev, [fieldKey]: result.filePath }));
    }
  };

  const handleSubmit = () => {
    const normalizedValues: Record<string, unknown> = { ...values };
    for (const field of request.fields) {
      if (!isSelectField(field)) {
        continue;
      }
      normalizedValues[field.key] = buildFormSelectSubmissionValue(
        field,
        values[field.key],
        customSelectEnabled[field.key] === true,
        customSelectValues[field.key] || '',
      );
    }

    const nextErrors = validateFormValues(request.fields, normalizedValues);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    task.resolve({
      action: 'submit',
      formValues: normalizedValues,
    });
  };

  return (
    <>
      <div className="mt-3.5 flex flex-col gap-3">
        {request.fields.map((field) => {
          const value = values[field.key];
          const error = errors[field.key];
          const inputId = `${id}_${field.key}`;
          const labelId = `${inputId}_label`;
          return (
            <div key={field.key} className="flex flex-col gap-1.5">
              <label id={labelId} htmlFor={inputId} className="text-[13px] font-semibold text-slate-900">
                {field.label}
                {field.required ? <span className="ml-1 text-rose-700">*</span> : null}
              </label>

              {field.description ? (
                <div className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{field.description}</div>
              ) : null}

              {field.control === 'checkbox' ? (
                <label className="inline-flex w-fit cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-900/12 bg-white px-3 py-2 text-[13px] font-semibold text-slate-900 transition hover:border-slate-900/25">
                  <Checkbox
                    id={inputId}
                    checked={value === true}
                    onCheckedChange={(checked) => setFieldValue(field, !!checked)}
                  />
                  <span>{field.placeholder || 'Enabled'}</span>
                </label>
              ) : field.type === 'boolean' ? (
                <Select value={value === true ? 'true' : 'false'} onValueChange={(v) => setFieldValue(field, v === 'true')}>
                  <SelectTrigger className={cn(error && 'border-pink-700/55')}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">True</SelectItem>
                    <SelectItem value="false">False</SelectItem>
                  </SelectContent>
                </Select>
              ) : field.control === 'folder' ? (
                <div className="flex items-center gap-2">
                  <Input
                    id={inputId}
                    className={cn('flex-1', error && 'border-pink-700/55')}
                    value={String(value ?? '')}
                    readOnly
                    placeholder={field.placeholder || 'Select a folder'}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 border border-slate-900/12"
                    onClick={() => handleFolderSelect(field.key)}
                  >
                    <Folder size={16} />
                  </Button>
                </div>
              ) : field.control === 'file' ? (
                <div className="flex items-center gap-2">
                  <Input
                    id={inputId}
                    className={cn('flex-1', error && 'border-pink-700/55')}
                    value={String(value ?? '')}
                    readOnly
                    placeholder={field.placeholder || 'Select a file'}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 border border-slate-900/12"
                    onClick={() => handleFileSelect(field.key)}
                  >
                    <FileText size={16} />
                  </Button>
                </div>
              ) : field.control === 'textarea' ? (
                <Textarea
                  id={inputId}
                  className={cn(error && 'border-pink-700/55')}
                  value={String(value ?? '')}
                  placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                  rows={4}
                  onChange={(event) => setFieldValue(field, event.target.value)}
                />
              ) : field.control === 'time' ? (
                <div className="flex items-center gap-2">
                  <Input
                    id={inputId}
                    className={cn(error && 'border-pink-700/55')}
                    type="time"
                    value={String(value ?? '')}
                    placeholder={field.placeholder || 'Select time'}
                    onChange={(event) => setFieldValue(field, event.target.value)}
                  />
                </div>
              ) : isSelectField(field) ? (
                <>
                  <div
                    id={inputId}
                    role="group"
                    aria-labelledby={labelId}
                    className={cn('grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] items-stretch gap-2 max-[720px]:grid-cols-1', error && 'rounded-xl border border-rose-700/55 bg-rose-50/45 p-2')}
                  >
                    {(field.options || []).map((option) => {
                      const isSelected = Array.isArray(value)
                        ? value.includes(option.value)
                        : value === option.value;

                      return (
                      <button
                        key={option.value}
                        type="button"
                        className={cn(
                          'flex min-h-14 w-full cursor-pointer flex-col items-start justify-start rounded-xl border bg-white/90 px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-55',
                          isSelected
                            ? 'border-teal-600/55 bg-teal-50/90 shadow-[0_8px_18px_rgba(13,148,136,0.12)]'
                            : 'border-slate-300/55 hover:border-slate-400/60',
                        )}
                        disabled={option.disabled}
                        aria-pressed={isSelected}
                        onMouseDown={handleOptionMouseDown}
                        onClick={(event) => handleOptionClick(event, () => setFieldValue(field, toggleSelectFieldValue(field, value, option.value)))}
                      >
                        <span className="text-[13px] font-semibold text-slate-900">{option.label}</span>
                        {option.description ? (
                          <span className="mt-1 text-xs leading-snug text-slate-500">{option.description}</span>
                        ) : null}
                      </button>
                      );
                    })}
                    <button
                      type="button"
                      className={cn(
                        'flex min-h-14 w-full cursor-pointer flex-col items-start justify-start rounded-xl border bg-white/90 px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-55',
                        customSelectEnabled[field.key]
                          ? 'border-teal-600/55 bg-teal-50/90 shadow-[0_8px_18px_rgba(13,148,136,0.12)]'
                          : 'border-slate-300/55 hover:border-slate-400/60',
                      )}
                      aria-pressed={customSelectEnabled[field.key] === true}
                      onMouseDown={handleOptionMouseDown}
                      onClick={(event) => handleOptionClick(event, () => {
                        setCustomSelectEnabled((prev) => ({
                          ...prev,
                          [field.key]: !prev[field.key],
                        }));

                        if (!isMultiValueField(field)) {
                          setValues((prev) => ({
                            ...prev,
                            [field.key]: '',
                          }));
                        }
                      })}
                    >
                      <span className="text-[13px] font-semibold text-slate-900">Other</span>
                      <span className="mt-1 text-xs leading-snug text-slate-500">Enter a custom value if the presets do not fit.</span>
                    </button>
                  </div>
                  {customSelectEnabled[field.key] ? (
                    <div className="mt-2.5 flex flex-col gap-1.5">
                      <label className="text-[13px] font-semibold text-slate-900" htmlFor={`${inputId}_custom`}>
                        Custom option
                      </label>
                      <Input
                        id={`${inputId}_custom`}
                        className={cn(error && 'border-pink-700/55')}
                        type="text"
                        value={customSelectValues[field.key] || ''}
                        placeholder={isMultiValueField(field) ? 'Enter one or more values, separated by commas' : 'Enter a custom value'}
                        onChange={(event) => setCustomSelectValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
                      />
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    id={inputId}
                    className={cn(error && 'border-pink-700/55')}
                    type={field.type === 'int' || field.type === 'double' || field.control === 'number' ? 'number' : 'text'}
                    step={field.type === 'double' ? 'any' : undefined}
                    value={String(value ?? '')}
                    placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                    onChange={(event) => setFieldValue(field, event.target.value)}
                  />
                </div>
              )}

              {error ? <div className="text-xs text-rose-700">{error}</div> : null}
            </div>
          );
        })}
      </div>

      <div className="mt-3.5 flex flex-wrap gap-2 max-[720px]:[&_button]:flex-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => task.resolve({
            action: 'skip',
            formValues: {},
          })}
        >
          {request.skipLabel || 'Skip'}
        </Button>
        <Button variant="default" size="sm" onClick={handleSubmit}>
          {request.submitLabel || 'Continue'}
        </Button>
      </div>
    </>
  );
}

const InteractiveRequestCard = (props: {
  data: PendingInteractiveRequestMap[CardTypes];
}) => {
  const { data } = props;
  const Icon = getRequestIcon(data.type);

  let content: React.ReactNode = null;
  switch (data.type) {
    case 'approval':
      content = <ApprovalRequestContent data={data} />;
      break;
    case 'choice':
      content = <ChoiceRequestContent data={data} />;
      break;
    case 'form':
      content = <FormRequestContent data={data} />;
      break;
  }

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3 max-[720px]:flex-col">
        <div className="flex items-start gap-2.5">
          <Icon size={18} className="mt-0.5 shrink-0 text-teal-700" />
          <div>
            <div className="text-[15px] font-semibold text-slate-900">{data.request.title}</div>
            {renderHtmlDescription(data.request.description)}
          </div>
        </div>
      </div>
      {content}
    </div>
  );
};

export default InteractiveRequestCard;
