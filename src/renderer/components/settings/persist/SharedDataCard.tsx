'use client'

import React from 'react'
import type { StorageCategory } from '@shared/ipc/persist'
import { DetailRow, ProportionBar } from './StoragePrimitives'
import { SHARED_META } from './storageMeta'

/** profile 级共享数据卡：标题 + 占比条 + 各分类明细行。 */
const SharedDataCard: React.FC<{
  shared: StorageCategory[]
  onReveal: (absPath: string) => void
}> = ({ shared, onReveal }) => {
  const total = shared.reduce((acc, c) => acc + c.bytes, 0)
  return (
    <div className="bg-white rounded-md p-4 border border-black/7 flex flex-col gap-4">
      <div>
        <label className="text-base font-medium text-content">Shared Data</label>
        <p className="text-xs text-content-secondary mt-0.5 leading-normal">
          Profile-level resources shared by all agents, plus settings and derived caches.
        </p>
      </div>
      <ProportionBar
        segments={shared.map((c) => ({
          id: c.key,
          label: c.label,
          bytes: c.bytes,
          color: SHARED_META[c.key].color,
        }))}
        total={total}
      />
      <div className="flex flex-col divide-y divide-black/5">
        {shared.map((cat) => {
          const { Icon, color } = SHARED_META[cat.key]
          return (
            <DetailRow
              key={cat.key}
              Icon={Icon}
              color={color}
              label={cat.label}
              sublabel={cat.description}
              count={cat.count}
              bytes={cat.bytes}
              total={total}
              onReveal={() => onReveal(cat.path)}
            />
          )
        })}
      </div>
    </div>
  )
}

export default SharedDataCard
