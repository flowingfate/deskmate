'use client'

import React from 'react'
import { Button } from '@/shadcn/button'
import { Switch } from '@/shadcn/switch'
import ShortcutRecorder from '../../ui/ShortcutRecorder'
import type { ScreenshotSettings } from '@shared/ipc/screenshot'

interface ScreenshotSettingsContentViewProps {
  settings: ScreenshotSettings
  error: string | null
  onSettingsChange: (settings: ScreenshotSettings) => void
  onShortcutChange: (shortcut: string) => void
  onSelectSavePath: () => void
  onResetSavePath: () => void
}

const ScreenshotSettingsContentView: React.FC<ScreenshotSettingsContentViewProps> = ({
  settings,
  error,
  onSettingsChange,
  onShortcutChange,
  onSelectSavePath,
  onResetSavePath,
}) => {
  return (
    <div className="flex flex-col p-6 bg-(--bg-primary) h-full overflow-auto" data-dbg="screenshot-settings">
      <div className="max-w-4xl mx-auto w-full">
        {/* Error Message */}
        {error && (
          <div className="glass-surface mb-4 p-4 border border-[#fecaca] rounded-xl text-[#b91c1c]">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-(--status-error-light) shrink-0"></div>
              <span className="font-medium">Error:</span>
            </div>
            <p className="mt-1 text-sm leading-5">{error}</p>
          </div>
        )}

        {/* Settings Form */}
        <div className="transition-all duration-300 max-h-500 opacity-100 px-6 pb-6 space-y-6">
          {/* Enable Screenshot */}
          <div className="bg-white rounded-md p-3 border border-(--shadow-md) gap-2 flex items-center justify-between">
            <div className="flex-1">
              <label className="block text-(--text-primary) text-base font-normal">Enable Screenshot</label>
            </div>
            <Switch
              checked={settings.enabled}
              onCheckedChange={(checked) =>
                onSettingsChange({
                  ...settings,
                  enabled: checked,
                })
              }
            />
          </div>

          {/* Shortcut Configuration */}
          <div className="bg-white rounded-md p-2 border border-(--shadow-md) flex flex-col gap-2">
            <div className="flex items-center justify-between px-1 py-2.5 mb-2">
              <div className="flex-1">
                <label className="block text-(--text-primary) text-base font-normal">Enable Shortcut</label>
              </div>
              <Switch
                checked={settings.shortcutEnabled}
                onCheckedChange={(checked) =>
                  onSettingsChange({
                    ...settings,
                    shortcutEnabled: checked,
                  })
                }
              />
            </div>
            <label className="block text-(--text-primary) text-base font-normal px-1 py-2.5">Shortcut</label>
            <ShortcutRecorder
              value={settings.shortcut}
              onChange={onShortcutChange}
              requireModifier
              disabled={!settings.shortcutEnabled}
            />
          </div>

          {/* Save Path Configuration */}
          <div className="bg-white rounded-md p-2 border border-(--shadow-md) flex flex-col gap-2">
            <div className="px-1 py-2.5">
              <label className="block text-(--text-primary) text-base font-normal mb-2">Save Path</label>
              <div className="flex items-center gap-2">
                <div className="flex-1 px-3 py-1.75 bg-[#F3F4F6] rounded border border-[#E5E7EB] text-sm overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: settings.savePath ? '#272320' : '#6B7280' }}>
                  {settings.savePath || 'Downloads (Default)'}
                </div>
                <Button size="sm" onClick={onSelectSavePath}>
                  Browse...
                </Button>
              </div>
              {settings.savePath && (
                <Button variant="link" size="sm" onClick={onResetSavePath} className="mt-2">
                  Reset to Default
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ScreenshotSettingsContentView
