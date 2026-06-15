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
import './InteractiveRequestCard.scss';
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
      className="interactive-request-description"
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
        <div className="interactive-request-actions-row">
          <Button variant="outline" size="sm" onClick={() => setAllDecisions(true)}>
            Approve All
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAllDecisions(false)}>
            Reject All
          </Button>
        </div>
      ) : null}

      <div className="interactive-request-section">
        {request.items.map((item) => {
          const decision = decisions[item.itemId];
          return (
            <div key={item.itemId} className="interactive-request-item">
              <div className="interactive-request-item-header">
                <div>
                  <div className="interactive-request-item-title">{item.toolName}</div>
                  <div className="interactive-request-item-message">{item.message}</div>
                </div>
                <div className="interactive-request-choice-buttons">
                  <button
                    type="button"
                    className={`interactive-choice-button ${decision === true ? 'is-selected-approve' : ''}`}
                    onClick={() => setDecisions((prev) => ({ ...prev, [item.itemId]: true }))}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className={`interactive-choice-button ${decision === false ? 'is-selected-reject' : ''}`}
                    onClick={() => setDecisions((prev) => ({ ...prev, [item.itemId]: false }))}
                  >
                    Reject
                  </button>
                </div>
              </div>
              {item.paths.length > 0 ? (
                <div className="interactive-request-path-list">
                  {item.paths.map((p) => (
                    <div key={p.path} className="interactive-request-path">{p.normalizedPath || p.path}</div>
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
      <div className="interactive-choice-meta">
        {request.mode === 'multi'
          ? 'Select one or more options'
          : 'Select one option'}
      </div>

      <div className="interactive-request-section">
        <div className="interactive-choice-grid">
          {request.options.map((option) => {
            const selected = selectedValues.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                className={`interactive-option-card ${selected ? 'is-selected' : ''}`}
                disabled={option.disabled}
                aria-pressed={selected}
                onMouseDown={handleOptionMouseDown}
                onClick={(event) => handleOptionClick(event, () => toggleValue(option.value))}
              >
                <div className="interactive-option-header">
                  <div className="interactive-option-label">{option.label}</div>
                </div>
                {option.description ? (
                  <div className="interactive-option-description">{option.description}</div>
                ) : null}
              </button>
            );
          })}
          <button
            type="button"
            className={`interactive-option-card ${customSelected ? 'is-selected' : ''}`}
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
            <div className="interactive-option-header">
              <div className="interactive-option-label">Other</div>
            </div>
            <div className="interactive-option-description">Enter a custom value if none of the preset options fit.</div>
          </button>
        </div>
        {customSelected ? (
          <div className="interactive-custom-input-wrap">
            <label className="interactive-form-label" htmlFor={`${id}_custom_choice`}>
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

      <div className="interactive-request-footer">
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
      <div className="interactive-request-section">
        {request.fields.map((field) => {
          const value = values[field.key];
          const error = errors[field.key];
          const inputId = `${id}_${field.key}`;
          const labelId = `${inputId}_label`;
          return (
            <div key={field.key} className="interactive-form-field">
              <label id={labelId} htmlFor={inputId} className="interactive-form-label">
                {field.label}
                {field.required ? <span className="interactive-form-required">*</span> : null}
              </label>

              {field.description ? (
                <div className="interactive-option-description">{field.description}</div>
              ) : null}

              {field.control === 'checkbox' ? (
                <label className="interactive-choice-button is-checkbox-like">
                  <Checkbox
                    id={inputId}
                    checked={value === true}
                    onCheckedChange={(checked) => setFieldValue(field, !!checked)}
                  />
                  <span>{field.placeholder || 'Enabled'}</span>
                </label>
              ) : field.type === 'boolean' ? (
                <Select value={value === true ? 'true' : 'false'} onValueChange={(v) => setFieldValue(field, v === 'true')}>
                  <SelectTrigger className={`${error ? 'border-pink-700/55' : ''}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">True</SelectItem>
                    <SelectItem value="false">False</SelectItem>
                  </SelectContent>
                </Select>
              ) : field.control === 'folder' ? (
                <div className="interactive-folder-input">
                  <Input
                    id={inputId}
                    className={`flex-1 ${error ? 'border-pink-700/55' : ''}`}
                    value={String(value ?? '')}
                    readOnly
                    placeholder={field.placeholder || 'Select a folder'}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="interactive-folder-button"
                    onClick={() => handleFolderSelect(field.key)}
                  >
                    <Folder size={16} />
                  </Button>
                </div>
              ) : field.control === 'file' ? (
                <div className="interactive-folder-input">
                  <Input
                    id={inputId}
                    className={`flex-1 ${error ? 'border-pink-700/55' : ''}`}
                    value={String(value ?? '')}
                    readOnly
                    placeholder={field.placeholder || 'Select a file'}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="interactive-folder-button"
                    onClick={() => handleFileSelect(field.key)}
                  >
                    <FileText size={16} />
                  </Button>
                </div>
              ) : field.control === 'textarea' ? (
                <Textarea
                  id={inputId}
                  className={`${error ? 'border-pink-700/55' : ''}`}
                  value={String(value ?? '')}
                  placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                  rows={4}
                  onChange={(event) => setFieldValue(field, event.target.value)}
                />
              ) : field.control === 'time' ? (
                <div className="interactive-inline-input">
                  <Input
                    id={inputId}
                    className={`${error ? 'border-pink-700/55' : ''}`}
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
                    className={`interactive-select-grid ${error ? 'has-error' : ''}`}
                  >
                    {(field.options || []).map((option) => {
                      const isSelected = Array.isArray(value)
                        ? value.includes(option.value)
                        : value === option.value;

                      return (
                      <button
                        key={option.value}
                        type="button"
                        className={`interactive-select-option ${isSelected ? 'is-selected' : ''}`}
                        disabled={option.disabled}
                        aria-pressed={isSelected}
                        onMouseDown={handleOptionMouseDown}
                        onClick={(event) => handleOptionClick(event, () => setFieldValue(field, toggleSelectFieldValue(field, value, option.value)))}
                      >
                        <span className="interactive-select-option-label">{option.label}</span>
                        {option.description ? (
                          <span className="interactive-select-option-description">{option.description}</span>
                        ) : null}
                      </button>
                      );
                    })}
                    <button
                      type="button"
                      className={`interactive-select-option ${customSelectEnabled[field.key] ? 'is-selected' : ''}`}
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
                      <span className="interactive-select-option-label">Other</span>
                      <span className="interactive-select-option-description">Enter a custom value if the presets do not fit.</span>
                    </button>
                  </div>
                  {customSelectEnabled[field.key] ? (
                    <div className="interactive-custom-input-wrap">
                      <label className="interactive-form-label" htmlFor={`${inputId}_custom`}>
                        Custom option
                      </label>
                      <Input
                        id={`${inputId}_custom`}
                        className={`${error ? 'border-pink-700/55' : ''}`}
                        type="text"
                        value={customSelectValues[field.key] || ''}
                        placeholder={isMultiValueField(field) ? 'Enter one or more values, separated by commas' : 'Enter a custom value'}
                        onChange={(event) => setCustomSelectValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
                      />
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="interactive-inline-input">
                  <Input
                    id={inputId}
                    className={`${error ? 'border-pink-700/55' : ''}`}
                    type={field.type === 'int' || field.type === 'double' || field.control === 'number' ? 'number' : 'text'}
                    step={field.type === 'double' ? 'any' : undefined}
                    value={String(value ?? '')}
                    placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                    onChange={(event) => setFieldValue(field, event.target.value)}
                  />
                </div>
              )}

              {error ? <div className="interactive-form-error">{error}</div> : null}
            </div>
          );
        })}
      </div>

      <div className="interactive-request-footer">
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
    <div className="interactive-request-card">
      <div className="interactive-request-header">
        <div className="interactive-request-title-wrap">
          <Icon size={18} className="interactive-request-icon" />
          <div>
            <div className="interactive-request-title">{data.request.title}</div>
            {renderHtmlDescription(data.request.description)}
          </div>
        </div>
      </div>
      {content}
    </div>
  );
};

export default InteractiveRequestCard;
