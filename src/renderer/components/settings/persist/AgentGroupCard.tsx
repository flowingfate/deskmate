'use client'

import React from 'react'
import { Bot, FolderOpen, Lock } from 'lucide-react'
import { Button } from '@/shadcn/button'
import { formatFileSize } from '../../../lib/utilities/contentUtils'
import type { AgentStorageGroup } from '@shared/ipc/persist'
import { DetailRow, ProportionBar } from './StoragePrimitives'
import { PART_META, type Segment } from './storageMeta'

/** agent 头像：有 avatar URL 用图片，否则 emoji，再否则默认机器人图标。 */
const AgentAvatar: React.FC<{ group: AgentStorageGroup }> = ({ group }) => {
  if (group.avatar) {
    return (
      <img
        src={group.avatar}
        alt=""
        className="w-9 h-9 rounded-lg object-cover border border-black/6 shrink-0"
      />
    )
  }
  return (
    <span className="flex items-center justify-center w-9 h-9 shrink-0 rounded-lg bg-black/5 text-lg">
      {group.emoji || <Bot size={18} className="text-content-secondary" />}
    </span>
  )
}

/** 单个 agent 的存储分组卡：头部（头像/名称/model/总量/打开）+ 占比条 + 四子项明细。 */
const AgentGroupCard: React.FC<{
  group: AgentStorageGroup
  onReveal: (absPath: string) => void
}> = ({ group, onReveal }) => {
  const segments: Segment[] = group.parts.map((p) => ({
    id: p.key,
    label: p.label,
    bytes: p.bytes,
    color: PART_META[p.key].color,
  }))
  return (
    <div className="bg-white rounded-md p-3 border border-black/7 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <AgentAvatar group={group} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-content truncate">{group.name}</span>
            {group.locked && (
              <span title="Protected agent" className="text-content-secondary shrink-0">
                <Lock size={12} />
              </span>
            )}
          </div>
          <p className="text-xs text-content-secondary truncate mt-0.5" title={group.model}>
            {group.model || 'No model set'}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-semibold text-content tabular-nums leading-none">
            {formatFileSize(group.totalBytes)}
          </div>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          className="shrink-0"
          aria-label={`Open ${group.name} folder`}
          title="Open agent folder"
          onClick={() => onReveal(group.agentRoot)}
        >
          <FolderOpen size={15} />
        </Button>
      </div>

      <ProportionBar segments={segments} total={group.totalBytes} className="h-2" />

      {/* Parts */}
      <div className="flex flex-col divide-y divide-black/5">
        {group.parts.map((part) => {
          const { Icon, color } = PART_META[part.key]
          return (
            <DetailRow
              key={part.key}
              Icon={Icon}
              color={color}
              label={part.label}
              count={part.count}
              bytes={part.bytes}
              total={group.totalBytes}
              onReveal={() => onReveal(part.path)}
            />
          )
        })}
      </div>
    </div>
  )
}

export default AgentGroupCard
