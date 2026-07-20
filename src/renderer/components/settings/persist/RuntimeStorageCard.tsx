'use client'

import React from 'react'
import { FolderOpen, Terminal } from 'lucide-react'
import { Button } from '@/shadcn/button'
import type { RuntimeStorageOverview } from '@shared/ipc/persist'
import { formatFileSize } from '../../../lib/utilities/contentUtils'
import { DetailRow, ProportionBar } from './StoragePrimitives'
import { RUNTIME_META } from './storageMeta'

interface RuntimeStorageCardProps {
  overview: RuntimeStorageOverview | null
  loading: boolean
  onReveal: (absPath: string) => void
}

const RuntimeStorageCard: React.FC<RuntimeStorageCardProps> = ({ overview, loading, onReveal }) => {
  if (loading && !overview) {
    return (
      <div className="bg-white rounded-md p-4 border border-black/7 text-sm text-content-secondary">
        Scanning app-managed runtime files…
      </div>
    )
  }

  if (!overview) return null

  return (
    <div className="bg-white rounded-md p-4 border border-black/7 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Terminal size={16} className="text-content-secondary shrink-0" aria-hidden="true" />
            <label className="text-base font-medium text-content">Runtime Environment</label>
          </div>
          <p className="text-xs text-content-secondary mt-0.5 leading-normal">
            Bun, uv, Python, global packages, and caches shared by every profile.
          </p>
          <p
            className="mt-2 text-xs text-content-secondary font-mono break-all leading-relaxed"
            title={overview.envRoot}
          >
            {overview.envRoot}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xl font-semibold text-content tabular-nums leading-none">
            {formatFileSize(overview.totalBytes)}
          </div>
          <div className="mt-1 text-xs text-content-secondary tabular-nums">
            {overview.fileCount.toLocaleString()} {overview.fileCount === 1 ? 'file' : 'files'}
          </div>
        </div>
      </div>

      {overview.exists ? (
        <>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => onReveal(overview.envRoot)}>
              <FolderOpen size={14} className="mr-1.5" />
              Open Runtime Folder
            </Button>
          </div>

          {overview.categories.length > 0 ? (
            <>
              <ProportionBar
                segments={overview.categories.map((category) => ({
                  id: category.key,
                  label: category.label,
                  bytes: category.bytes,
                  color: RUNTIME_META[category.key].color,
                }))}
                total={overview.totalBytes}
              />
              <div className="flex flex-col divide-y divide-black/5">
                {overview.categories.map((category) => {
                  const { Icon, color } = RUNTIME_META[category.key]
                  return (
                    <DetailRow
                      key={category.key}
                      Icon={Icon}
                      color={color}
                      label={category.label}
                      sublabel={category.description}
                      bytes={category.bytes}
                      total={overview.totalBytes}
                      onReveal={() => onReveal(category.path)}
                    />
                  )
                })}
              </div>
            </>
          ) : (
            <p className="text-sm text-content-secondary">No app-managed runtime files yet.</p>
          )}
        </>
      ) : (
        <p className="text-sm text-content-secondary">
          The runtime directory has not been created yet. It is created when the app installs or uses a managed runtime.
        </p>
      )}

      <p className="text-xs text-content-secondary leading-relaxed">
        File sizes are logical file sizes. Filesystem compression, clones, and sparse files can make actual disk allocation differ.
        Scanned at {new Date(overview.generatedAt).toLocaleTimeString()}.
      </p>
    </div>
  )
}

export default RuntimeStorageCard
