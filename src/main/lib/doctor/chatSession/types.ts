/**
 * Internal types for the Doctor chatSession module.
 */

import type { Message } from '@shared/persist/types'
import type { ContextState } from '@shared/persist/types'

export type HistoryView = 'ui' | 'llm';

export interface SkeletonOptions {}

/**
 * Doctor 视角下的一份 chat session — 在持久化层切换为 PersistedJsonLine 之前/之后都
 * 让 doctor 自己持有 Domain Message[]。`tools/*.ts` 通过
 * `session.loadDomainMessages()` 构造,然后传给 messageReader / skeletonFormatter。
 */
export interface DoctorSessionFile {
  chatSession_id: string;
  last_updated: string;
  title: string;
  messages: Message[];
  contextState: ContextState;
}
