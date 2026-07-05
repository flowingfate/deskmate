import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  BookMarked,
  BookOpen,
  Boxes,
  Cable,
  CalendarClock,
  Database,
  MessagesSquare,
  SlidersHorizontal,
  Users,
} from 'lucide-react'
import type { AgentStoragePart, StorageCategory } from '@shared/ipc/persist'

/** 比例条的一段（agent 子项 / 共享分类共用）。 */
export interface Segment {
  id: string
  label: string
  bytes: number
  color: string
}

/** agent 子项 key → 图标 + 颜色。颜色定死一份，保证比例条与明细行一一对应。 */
export const PART_META: Record<AgentStoragePart['key'], { Icon: LucideIcon; color: string }> = {
  conversations: { Icon: MessagesSquare, color: '#6366f1' },
  scheduledRuns: { Icon: CalendarClock, color: '#8b5cf6' },
  knowledge: { Icon: BookOpen, color: '#0ea5e9' },
  config: { Icon: SlidersHorizontal, color: '#10b981' },
}

/** profile 级共享分类 key → 图标 + 颜色。 */
export const SHARED_META: Record<StorageCategory['key'], { Icon: LucideIcon; color: string }> = {
  skills: { Icon: BookMarked, color: '#f59e0b' },
  subAgents: { Icon: Users, color: '#14b8a6' },
  mcp: { Icon: Cable, color: '#ec4899' },
  models: { Icon: Boxes, color: '#a855f7' },
  searchIndex: { Icon: Database, color: '#64748b' },
  archive: { Icon: Archive, color: '#94a3b8' },
  profileConfig: { Icon: SlidersHorizontal, color: '#f43f5e' },
}
