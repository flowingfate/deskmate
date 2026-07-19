'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { HardDrive } from 'lucide-react'
import SettingsLayout from '../SettingsLayout'
import PersistSettingsContentView from './PersistSettingsContentView'
import { persistApi, persistEvents } from '@/ipc/persist'
import type { RuntimeStorageOverview, StorageOverview } from '@shared/ipc/persist'
import { useToast } from '../../ui/ToastProvider'
import { log } from '@/log'

const logger = log.child({ mod: 'PersistSettingsView' })

const PersistSettingsView: React.FC = () => {
  const [overview, setOverview] = useState<StorageOverview | null>(null)
  const [runtimeOverview, setRuntimeOverview] = useState<RuntimeStorageOverview | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const { showError } = useToast()

  const loadProfile = useCallback(async () => {
    setLoading(true)
    try {
      const res = await persistApi.getStorageOverview()
      if (res.success && res.data) {
        setOverview(res.data)
        setProfileError(null)
      } else {
        setProfileError(res.success ? 'Empty response' : res.error)
      }
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadRuntime = useCallback(async () => {
    setRuntimeLoading(true)
    try {
      const res = await persistApi.getRuntimeStorageOverview()
      if (res.success && res.data) {
        setRuntimeOverview(res.data)
        setRuntimeError(null)
      } else {
        setRuntimeError(res.success ? 'Empty response' : res.error)
      }
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : String(err))
    } finally {
      setRuntimeLoading(false)
    }
  }, [])

  const load = useCallback(
    async () => Promise.all([loadProfile(), loadRuntime()]),
    [loadProfile, loadRuntime],
  )

  useEffect(() => {
    load()
  }, [load])

  // 存储量随会话 / agent 增删变化：删 session、agent 增删后自动重扫。
  useEffect(() => {
    const onRegistry = (_e: unknown, payload: { kind: string }) => {
      if (payload.kind === 'agents') void loadProfile()
    }
    const unsubs = [
      persistEvents['session:index:updated'](() => void loadProfile()),
      persistEvents['agent:removed'](() => void loadProfile()),
      persistEvents['agent:registry:updated'](onRegistry),
    ]
    return () => unsubs.forEach((u) => u())
  }, [loadProfile])

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

  const error = profileError ?? runtimeError

  return (
    <SettingsLayout icon={<HardDrive size={18} />} title="Local Data">
      <PersistSettingsContentView
        overview={overview}
        runtimeOverview={runtimeOverview}
        error={error}
        loading={loading}
        runtimeLoading={runtimeLoading}
        onReveal={handleReveal}
        onRefresh={() => void load()}
      />
    </SettingsLayout>
  )
}

export default PersistSettingsView
