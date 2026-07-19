'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { HardDrive } from 'lucide-react'
import SettingsLayout from '../SettingsLayout'
import PersistSettingsContentView from './PersistSettingsContentView'
import { persistApi, persistEvents } from '@/ipc/persist'
import type { StorageOverview } from '@shared/ipc/persist'
import { useToast } from '../../ui/ToastProvider'
import { log } from '@/log'

const logger = log.child({ mod: 'PersistSettingsView' })

const PersistSettingsView: React.FC = () => {
  const [overview, setOverview] = useState<StorageOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { showError } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await persistApi.getStorageOverview()
      if (res.success && res.data) {
        setOverview(res.data)
        setError(null)
      } else {
        setError(res.success ? 'Empty response' : res.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // 存储量随会话 / agent 增删变化：删 session、agent 增删后自动重扫。
  useEffect(() => {
    const onRegistry = (_e: unknown, payload: { kind: string }) => {
      if (payload.kind === 'agents') load()
    }
    const unsubs = [
      persistEvents['session:index:updated'](() => load()),
      persistEvents['agent:removed'](() => load()),
      persistEvents['agent:registry:updated'](onRegistry),
    ]
    return () => unsubs.forEach((u) => u())
  }, [load])

  const handleReveal = useCallback(
    async (absPath: string) => {
      try {
        const res = await persistApi.revealStoragePath(absPath)
        if (!res.success) showError(res.error)
      } catch (err) {
        logger.warn({ msg: 'revealStoragePath failed', err: String(err) })
      }
    },
    [showError],
  )

  return (
    <SettingsLayout icon={<HardDrive size={18} />} title="Local Data">
      <PersistSettingsContentView
        overview={overview}
        error={error}
        loading={loading}
        onReveal={handleReveal}
        onRefresh={load}
      />
    </SettingsLayout>
  )
}

export default PersistSettingsView
