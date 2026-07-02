import React, { useCallback, useEffect } from 'react';
import { ModelSelectPopover } from '../chat/ModelSelectPopover';

const MODEL_KEY_STORAGE = 'doctorModelKey';

function loadModelKey(): string {
  try {
    return localStorage.getItem(MODEL_KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

function saveModelKey(modelKey: string): void {
  try {
    localStorage.setItem(MODEL_KEY_STORAGE, modelKey);
  } catch {
    /* ignore quota / privacy-mode failures */
  }
}

interface Props {
  /** Current pi composite model key `${provider}::${modelId}`; '' = not chosen. */
  value: string;
  /** Push the user's selection up to the form. */
  onChange: (composite: string) => void;
}

/**
 * Doctor 诊断模型选择器。复用 ModelSelectPopover（field 外观）+ GroupedModelPicker，
 * 并独立负责「上次选择」的 localStorage 持久化：
 * - 挂载时若父级 value 为空，用存储值水合（让每次打开对话框都记住上次的模型）。
 * - 每次选择先落 localStorage 再上抛。
 * value 为空/非法时触发器显示「Select Model」提示——该字段必选，无内置默认。
 *
 * Popover Portal 渲染到 body（避开 Dialog 的 overflow-hidden 裁切），但也落在
 * Dialog 的 react-remove-scroll 锁区外，滚轮会被吞掉——故传 stopWheelPropagation。
 */
export const DoctorModelField: React.FC<Props> = ({ value, onChange }) => {
  // 挂载水合：仅在父级尚未有值时用存储值回填，避免覆盖已选。onChange 来自 atom
  // actions，跨渲染稳定；本 effect 只在挂载时跑一次。
  useEffect(() => {
    if (!value) {
      const stored = loadModelKey();
      if (stored) onChange(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = useCallback((composite: string) => {
    saveModelKey(composite);
    onChange(composite);
  }, [onChange]);

  return (
    <ModelSelectPopover
      value={value}
      onChange={handleSelect}
      triggerClassName="w-full"
      stopWheelPropagation
    />
  );
};
