import React, { useState, useCallback, useMemo } from 'react'

import { TabComponentProps } from './types'
import { AlertTriangle } from 'lucide-react'
import EmojiPicker from '@/shadcn/emoji-picker'
import { useAgents } from '@/states/agents.atom'
import { AgentAvatar } from '../../common/AgentAvatar'
import { ModelSelectPopover } from '../ModelSelectPopover'
import { useDirtyTracker } from './useDirtyTracker'
import { Button } from '@/shadcn/button'

const EMPTY_MODEL = '' // Step 9+：不再默认填一个 GHC modelId；让用户主动选

const AgentBasicTab: React.FC<TabComponentProps> = ({
  mode,
  agentData,
  onDataChange,
  cachedData,
  fieldErrors,
  readOnly = false,
}) => {
  // Get all agents for duplicate name checking
  const agents = useAgents()

  // 受保护(locked)的 agent：身份(name/emoji/avatar)不可编辑
  const isLocked = agentData?.locked === true
  // avatar/emoji/name are not editable for locked agents or in read-only mode
  const isAvatarNameDisabled = readOnly || isLocked
  const isModelDisabled = readOnly

  // Agent 版本号（只读展示）
  const version = agentData?.version || ''

  // UI state
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [nameWarning, setNameWarning] = useState<string>('')

  // 基线：由 agentData 派生（缺席时用 add 模式默认值）。
  const baseline = useMemo(
    () =>
      agentData
        ? {
            name: agentData.name,
            emoji: agentData.emoji,
            avatar: agentData.avatar || '',
            role: '',
            model: agentData.model,
            description: agentData.description ?? '',
          }
        : { name: '', description: '', emoji: '🤖', avatar: '', role: '', model: EMPTY_MODEL },
    [agentData],
  )

  // cachedData（跨 Tab 编辑缓存）逐字段覆盖基线；缺席字段回退基线。
  const cached = useMemo(() => {
    if (!cachedData) return null
    return {
      name: cachedData.name !== undefined ? cachedData.name : baseline.name,
      emoji: cachedData.emoji !== undefined ? cachedData.emoji : baseline.emoji,
      avatar: cachedData.avatar !== undefined ? cachedData.avatar : baseline.avatar,
      role: cachedData.role !== undefined ? cachedData.role : baseline.role,
      model: cachedData.model !== undefined ? cachedData.model : baseline.model,
      description: cachedData.description !== undefined ? cachedData.description : baseline.description,
    }
  }, [cachedData, baseline])

  const { value: formData, setValue: setFormData } = useDirtyTracker<typeof baseline>({
    tabName: 'basic',
    ready: mode === 'add' || !!agentData?.id,
    agentId: agentData?.id,
    baseline,
    cached,
    equals: (a, b) =>
      a.name === b.name &&
      a.description === b.description &&
      a.emoji === b.emoji &&
      a.avatar === b.avatar &&
      a.role === b.role &&
      a.model === b.model,
    fingerprint: (v) => JSON.stringify([v.name, v.description, v.emoji, v.avatar, v.role, v.model]),
    toPayload: (v) => ({ ...v }),
    onDataChange,
  })


  // Check for duplicate Agent name
  const checkDuplicateName = useCallback((name: string): boolean => {
    if (!name.trim()) return false

    // In Update mode, exclude the agent currently being edited
    const currentAgentName = agentData?.name

    return agents.some(agent => {
      // Skip current agent being edited
      if (mode === 'update' && agent.name === currentAgentName) {
        return false
      }
      return agent.name === name.trim()
    })
  }, [agents, agentData?.name, mode])


  // Handle input change
  const handleInputChange = useCallback((field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))

    // For the name field, check for duplicates in real time
    if (field === 'name') {
      if (value.trim() && checkDuplicateName(value)) {
        setNameWarning('This agent name already exists')
      } else {
        setNameWarning('')
      }
    }

    // Clear the validation error for this field
    if (validationErrors[field]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[field]
        return newErrors
      })
    }

    // When user starts typing, notify parent to clear field errors (via onDataChange triggering parent to update fieldErrors)
    // This clears errors from Save All Changes when user starts editing the name
  }, [validationErrors, checkDuplicateName])

  const handleEmojiSelect = useCallback((emoji: string) => {
    handleInputChange('emoji', emoji)
  }, [handleInputChange])

  // Handle model selection
  const handleModelSelect = useCallback((modelId: string) => {
    handleInputChange('model', modelId)
  }, [handleInputChange])


  return (
    <div className="agent-tab">
      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto overflow-x-visible p-5 custom-scrollbar">
        {/* Avatar Section */}
        <div className="mb-4.5">
          <label className="block mb-1.5 text-[13px] font-medium text-content">Agent Avatar</label>
          <div className="flex items-center gap-4">
            <EmojiPicker onEmojiSelect={handleEmojiSelect}>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-12 rounded-lg p-0"
                disabled={isAvatarNameDisabled}
                title={readOnly ? 'Avatar cannot be modified' : isLocked ? 'This agent is locked; its avatar cannot be modified' : 'Click to change avatar'}
                aria-label="Choose agent avatar"
              >
                <AgentAvatar
                  emoji={formData.emoji}
                  avatar={formData.avatar}
                  name={formData.name}
                  size="lg"
                  version={version}
                />
              </Button>
            </EmojiPicker>
            <span className="text-content-secondary text-[13px] font-normal">
              {readOnly ? "Avatar cannot be modified" : isLocked ? "This agent is locked; its avatar cannot be modified" : "Click to choose avatar"}
            </span>
          </div>
        </div>

        {/* Agent Name */}
        <div className="mb-4.5">
          <label className="block mb-1.5 text-[13px] font-medium text-content">Agent Name</label>
          <input
            type="text"
            className={`w-full px-3 py-2 rounded-lg border border-black/10 bg-surface-primary text-content text-sm transition-all box-border hover:enabled:border-gray-400 focus:outline-none focus:border-content focus:shadow-[0_0_0_1px_#272320] ${(validationErrors.name || fieldErrors?.name || nameWarning) ? 'border-status-warning bg-amber-400/10 focus:border-status-warning focus:shadow-[0_0_0_1px_#f59e0b]' : ''}`}
            value={formData.name}
            onChange={(e) => handleInputChange('name', e.target.value)}
            placeholder="Enter agent name..."
            disabled={isAvatarNameDisabled}
          />
          {(validationErrors.name || fieldErrors?.name) && (
            <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-md text-[13px] bg-[#FEF3C7] border-l-2 border-status-warning text-amber-800">
              <AlertTriangle size={14} className="shrink-0" />
              <span>{validationErrors.name || fieldErrors?.name}</span>
            </div>
          )}
          {nameWarning && !validationErrors.name && !fieldErrors?.name && (
            <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-md text-[13px] bg-[#FEF3C7] border-l-2 border-status-warning text-amber-800">
              <AlertTriangle size={14} className="shrink-0" />
              <span>{nameWarning}</span>
            </div>
          )}
        </div>

        <div className="mb-4.5">
          <label htmlFor="agent-description" className="block mb-1.5 text-[13px] font-medium text-content">Description</label>
          <p className="mb-2 text-[13px] text-content-secondary">
            Used in this agent&apos;s introduction and when other agents choose delegation targets.
          </p>
          <textarea
            id="agent-description"
            className={`min-h-24 w-full resize-y rounded-lg border border-black/10 bg-surface-primary px-3 py-2 text-sm text-content transition-all hover:enabled:border-gray-400 focus:outline-none focus:border-content focus:shadow-[0_0_0_1px_#272320] ${fieldErrors?.description ? 'border-status-error' : ''}`}
            value={formData.description}
            onChange={(event) => handleInputChange('description', event.target.value)}
            placeholder="Describe this agent&apos;s expertise..."
            disabled={readOnly}
            aria-describedby="agent-description-helper"
          />
          <span id="agent-description-helper" className="sr-only">This description helps other agents select a delegation target.</span>
          {fieldErrors?.description && (
            <div className="mt-2 flex items-center gap-2 rounded-md border-l-2 border-status-error bg-red-400/10 px-3 py-2 text-[13px] text-red-900" role="alert">
              <AlertTriangle size={14} className="shrink-0" aria-hidden />
              <span>{fieldErrors.description}</span>
            </div>
          )}
        </div>

        {/* Model Selection */}
        <div className="mb-4.5">
          <label className="block mb-1.5 text-[13px] font-medium text-content">Agent Model</label>
          <ModelSelectPopover
            value={formData.model}
            onChange={handleModelSelect}
            disabled={isModelDisabled}
            smallTigger
            triggerClassName={validationErrors.model ? 'border-destructive' : undefined}
            contentClassName="max-h-(--radix-popover-content-available-height)"
          />
          {validationErrors.model && (
            <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-md text-[13px] bg-[#FEE2E2] border-l-2 border-status-error text-red-900">{validationErrors.model}</div>
          )}
        </div>

        {version && (
          <div className="mb-4.5 mt-2 pt-4 border-t border-slate-300/50">
            <label className="block mb-1.5 text-[13px] font-medium text-content">Agent Info</label>
            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-content-secondary font-medium">Version:</span>
                <span className="text-[13px] text-content-heading font-normal">{version}</span>
              </div>
            </div>
          </div>
        )}

      </div>


    </div>
  )
}

export default AgentBasicTab
