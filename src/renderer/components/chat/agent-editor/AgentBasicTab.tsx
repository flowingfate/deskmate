import React, { useState, useCallback, useMemo } from 'react'

import { TabComponentProps } from './types'
import { AlertTriangle } from 'lucide-react'
import EmojiPicker from './EmojiPicker'
import { useAgents } from '@/states/agents.atom'
import { AgentAvatar } from '../../common/AgentAvatar'
import { ModelSelectPopover } from '../ModelSelectPopover'
import { useDirtyTracker } from './useDirtyTracker'

const EMPTY_MODEL = '' // Step 9+：不再默认填一个 GHC modelId；让用户主动选

const AgentBasicTab: React.FC<TabComponentProps> = ({
  mode,
  agentId,
  agentData,
  onSave,
  onAgentCreated,
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
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
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
          }
        : { name: '', emoji: '🤖', avatar: '', role: '', model: EMPTY_MODEL },
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
      a.emoji === b.emoji &&
      a.avatar === b.avatar &&
      a.role === b.role &&
      a.model === b.model,
    fingerprint: (v) => JSON.stringify([v.name, v.emoji, v.avatar, v.role, v.model]),
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

  // Form validation
  const validateForm = useCallback(() => {
    const errors: Record<string, string> = {}

    if (!formData.name.trim()) {
      errors.name = 'Agent name is required'
    } else if (checkDuplicateName(formData.name)) {
      errors.name = 'Agent name already exists'
    }

    if (!formData.model) {
      errors.model = 'Model selection is required'
    }

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }, [formData, checkDuplicateName])

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

  // Handle Emoji selection
  const handleEmojiSelect = useCallback((emoji: string) => {
    handleInputChange('emoji', emoji)
    setShowEmojiPicker(false)
  }, [handleInputChange])

  // Handle model selection
  const handleModelSelect = useCallback((modelId: string) => {
    handleInputChange('model', modelId)
  }, [handleInputChange])

  // Dynamically determine the current effective mode
  const getCurrentMode = useCallback(() => {
    // If in Add mode but Agent is already created, treat it as Update mode
    if (mode === 'add' && agentData?.id) {
      return 'update'
    }
    return mode
  }, [mode, agentData?.id])

  return (
    <div className="agent-tab">
      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto overflow-x-visible p-5 custom-scrollbar">
        {/* Avatar Section */}
        <div className="mb-4.5">
          <label className="block mb-1.5 text-[13px] font-medium text-content">Agent Avatar</label>
          <div className="flex items-center gap-4">
            <div
              className="flex items-center justify-center size-12 rounded-lg border border-black/10 bg-surface-primary text-2xl cursor-pointer transition-all hover:border-gray-400 hover:bg-black/5"
              onClick={() => !isAvatarNameDisabled && setShowEmojiPicker(true)}
              title={readOnly ? "Avatar cannot be modified" : isLocked ? "This agent is locked; its avatar cannot be modified" : "Click to change avatar"}
              style={isAvatarNameDisabled ? { cursor: 'not-allowed', opacity: 0.6 } : undefined}
            >
              <AgentAvatar
                emoji={formData.emoji}
                avatar={formData.avatar}
                name={formData.name}
                size="lg"
                version={version}
              />
            </div>
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

      {/* Emoji Picker Modal */}
      <EmojiPicker
        isOpen={showEmojiPicker}
        onClose={() => setShowEmojiPicker(false)}
        onEmojiSelect={handleEmojiSelect}
        currentEmoji={formData.emoji}
      />

    </div>
  )
}

export default AgentBasicTab
