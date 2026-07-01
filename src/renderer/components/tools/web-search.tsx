/**
 * `web search` 工具配置面板 —— 录入 / 更新 Tavily Search API key。
 *
 * key 落在 active profile 的 `settings.json#webSearch.tavilyApiKey`，
 * 经 `persistApi.updateWebSearchSettings` 写盘；main 写回后广播
 * `settings:updated`，本组件通过 `useWebSearchSettings` 自动回流同步。
 *
 * 缺省时 `web search` 会回退环境变量 `TAVILY_API_KEY`，故此处留空合法
 * （等同于"清除已存的 key，改用环境变量 / 禁用搜索"）。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, ExternalLink, KeyRound } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { Label } from '@/shadcn/label';
import { Input } from '@/shadcn/input';
import { useToast } from '../ui/ToastProvider';
import { persistApi } from '@/ipc/persist';
import { useWebSearchSettings } from '@/states/settings.atom';
import { log } from '@/log';

const logger = log.child({ mod: 'web-search-config' });

export function WebSearchConfig() {
  const webSearch = useWebSearchSettings();
  const persistedKey = webSearch?.tavilyApiKey ?? '';

  const [draft, setDraft] = useState(persistedKey);
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const { showSuccess, showError } = useToast();

  // 远端 settings 变化时（含初次 hydrate / 切换 profile）同步草稿。
  useEffect(() => {
    setDraft(persistedKey);
  }, [persistedKey]);

  const trimmed = draft.trim();
  const dirty = trimmed !== persistedKey;

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await persistApi.updateWebSearchSettings({ tavilyApiKey: trimmed });
      if (!res.success) {
        showError(`Failed to save: ${res.error}`);
        return;
      }
      showSuccess(trimmed === '' ? 'Tavily API key cleared' : 'Tavily API key saved');
    } catch (err) {
      logger.warn({ msg: 'updateWebSearchSettings failed', error: String(err) });
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [trimmed, showError, showSuccess]);

  return (
    <>
      <div className="flex items-center gap-2 mt-6 mb-2">
        <KeyRound size={15} className="text-sc-muted-foreground" />
        <h3 className="text-sm font-semibold text-sc-foreground">Web Search Configuration</h3>
      </div>
      <div className="flex flex-col gap-3 rounded-md border border-sc-border bg-sc-muted/20 p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="web-search-tavily-key">Tavily API key:</Label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                id="web-search-tavily-key"
                type={reveal ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                placeholder="tvly-..."
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="pr-9 font-mono"
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-sc-muted-foreground hover:text-sc-foreground"
                aria-label={reveal ? 'Hide key' : 'Show key'}
                tabIndex={-1}
              >
                {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
          <p className="text-xs text-sc-muted-foreground">
            Leave empty to fall back to the <code className="rounded bg-sc-muted px-1 py-0.5 text-[11px]">TAVILY_API_KEY</code> environment variable.
          </p>
          <a
            href="https://app.tavily.com/home"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1 text-xs text-sc-primary hover:underline"
          >
            <ExternalLink size={12} />
            Get an API key from the Tavily dashboard
          </a>
        </div>
      </div>
    </>
  );
}
