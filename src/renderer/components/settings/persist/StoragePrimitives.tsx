'use client'

import React from 'react'
import { FolderOpen } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/shadcn/button'
import { formatFileSize } from '../../../lib/utilities/contentUtils'
import type { Segment } from './storageMeta'

/** 顶部计数格子。 */
export const StatCell: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="flex flex-col items-center justify-center rounded-md border border-black/6 bg-white px-2 py-3">
    <span className="text-lg font-semibold text-content tabular-nums leading-none">{value.toLocaleString()}</span>
    <span className="mt-1 text-xs text-content-secondary text-center leading-tight">{label}</span>
  </div>
)

/** 多段占比横条。segments 已带颜色；空/零总量退化为空条。 */
export const ProportionBar: React.FC<{ segments: Segment[]; total: number; className?: string }> = ({
  segments,
  total,
  className,
}) => {
  const base = 'flex w-full overflow-hidden rounded-full bg-black/8 ' + (className ?? 'h-2.5')
  if (total <= 0) return <div className={base} />
  return (
    <div className={base} role="img" aria-label="Storage usage breakdown">
      {segments.map((seg) => {
        const pct = (seg.bytes / total) * 100
        if (pct <= 0) return null
        return (
          <div
            key={seg.id}
            style={{ width: `${pct}%`, backgroundColor: seg.color }}
            title={`${seg.label} — ${formatFileSize(seg.bytes)} (${pct.toFixed(1)}%)`}
          />
        )
      })}
    </div>
  )
}

/** 通用明细行：图标块 + 标签/描述 + 字节/百分比 + hover 打开按钮。agent 子项与共享分类共用。 */
export const DetailRow: React.FC<{
  Icon: LucideIcon
  color: string
  label: string
  sublabel?: string
  count?: number
  bytes: number
  total: number
  onReveal: () => void
}> = ({ Icon, color, label, sublabel, count, bytes, total, onReveal }) => {
  const pct = total > 0 ? (bytes / total) * 100 : 0
  return (
    <div className="group flex items-center gap-3 py-2">
      <span
        className="flex items-center justify-center w-7 h-7 shrink-0 rounded-md"
        style={{ backgroundColor: color + '1a', color }}
      >
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-content">{label}</span>
          {count !== undefined && (
            <span className="text-xs text-content-secondary tabular-nums">
              {count.toLocaleString()} {count === 1 ? 'item' : 'items'}
            </span>
          )}
        </div>
        {sublabel && (
          <p className="text-xs text-content-secondary mt-0.5 leading-tight truncate" title={sublabel}>
            {sublabel}
          </p>
        )}
      </div>
      <div className="text-right shrink-0 w-20">
        <div className="text-sm font-medium text-content tabular-nums leading-none">
          {formatFileSize(bytes)}
        </div>
        <div className="text-[11px] text-content-secondary tabular-nums mt-0.5">{pct.toFixed(1)}%</div>
      </div>
      <Button
        size="icon-sm"
        variant="ghost"
        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        aria-label={`Open ${label} in file manager`}
        title="Open in file manager"
        onClick={onReveal}
      >
        <FolderOpen size={15} />
      </Button>
    </div>
  )
}
