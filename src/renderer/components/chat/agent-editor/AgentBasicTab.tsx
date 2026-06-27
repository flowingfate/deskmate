import React, { useState, useCallback, useEffect } from 'react'

import { TabComponentProps } from './types'
import { Button } from '@/shadcn/button'
import { Popover, PopoverTrigger, PopoverContent } from '@/shadcn/popover'
import { Badge } from '@/shadcn/badge'
import { AlertTriangle, Cpu, ChevronDown } from 'lucide-react'
import EmojiPicker from './EmojiPicker'
import { useAgents } from '@/states/agents.atom'
import { AgentAvatar } from '../../common/AgentAvatar'
import { GroupedModelPicker, useModelDisplayLabel } from '../GroupedModelPicker'

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

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    emoji: '🤖',
    avatar: '', // Agent avatar URL
    role: '', // Retained but unused
    model: EMPTY_MODEL
  })

  // Agent metadata (read-only display)
  const [agentMeta, setAgentMeta] = useState({
    version: '',
  })

  // UI state
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [isInitialized, setIsInitialized] = useState(false)
  const [loadedAgentId, setLoadedAgentId] = useState<string | null>(null)
  const [nameWarning, setNameWarning] = useState<string>('')

  // 受保护(locked)的 agent：身份(name/emoji/avatar)不可编辑
  const isLocked = agentData?.locked === true

  // avatar/emoji/name are not editable for locked agents or in read-only mode
  const isAvatarNameDisabled = readOnly || isLocked
  const isModelDisabled = readOnly

  // Initial data used to detect modifications
  const [initialData, setInitialData] = useState({
    name: '',
    emoji: '🤖',
    avatar: '',
    role: '',
    model: EMPTY_MODEL
  })

  // Available model list 由 GroupedModelPicker 内部 hook 拉取
  const { label: modelDisplayLabel, invalid: modelInvalid } = useModelDisplayLabel(formData.model)

  // Load existing data - only runs on initial component mount or when explicit re-sync is needed
  useEffect(() => {
    // In Update mode, or Add mode when agent is already created, sync data to form
    if (agentData && (mode === 'update' || (mode === 'add' && agentData.id))) {
      // Only reset form data when not yet initialized or agentId changes
      if (!isInitialized || loadedAgentId !== agentData.id) {
        const baseData = {
          name: agentData.name,
          emoji: agentData.emoji,
          avatar: agentData.avatar || '', // Agent avatar URL
          role: '', // Always set to empty
          model: agentData.model
        }

        // Set metadata (read-only)
        setAgentMeta({
          version: agentData.version || '',
        })

        // If cached data exists, prefer it over the base data
        const finalData = cachedData ? {
          name: cachedData.name !== undefined ? cachedData.name : baseData.name,
          emoji: cachedData.emoji !== undefined ? cachedData.emoji : baseData.emoji,
          avatar: cachedData.avatar !== undefined ? cachedData.avatar : baseData.avatar,
          role: cachedData.role !== undefined ? cachedData.role : baseData.role,
          model: cachedData.model !== undefined ? cachedData.model : baseData.model
        } : baseData

        setFormData(finalData)
        setInitialData(baseData) // Initial data is always the original data
        setLoadedAgentId(agentData.id)
        setIsInitialized(true)
      }
    } else if (!isInitialized) {
      // Initial state in Add mode
      const defaultInitialData = {
        name: '',
        emoji: '🤖',
        avatar: '',
        role: '',
        model: EMPTY_MODEL
      }

      // Reset metadata
      setAgentMeta({
        version: '',
      })

      // If cached data exists, use it
      const finalData = cachedData ? {
        name: cachedData.name !== undefined ? cachedData.name : defaultInitialData.name,
        emoji: cachedData.emoji !== undefined ? cachedData.emoji : defaultInitialData.emoji,
        avatar: cachedData.avatar !== undefined ? cachedData.avatar : defaultInitialData.avatar,
        role: cachedData.role !== undefined ? cachedData.role : defaultInitialData.role,
        model: cachedData.model !== undefined ? cachedData.model : defaultInitialData.model
      } : defaultInitialData

      setFormData(finalData)
      setInitialData(defaultInitialData)
      setLoadedAgentId(null)
      setIsInitialized(true)
    }
  }, [mode, agentData?.id, isInitialized, loadedAgentId, cachedData])


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

  // Check if data has been modified
  const hasChanges = useCallback(() => {
    return (
      formData.name !== initialData.name ||
      formData.emoji !== initialData.emoji ||
      formData.avatar !== initialData.avatar ||
      formData.role !== initialData.role ||
      formData.model !== initialData.model
    )
  }, [formData, initialData])

  // Notify parent component when data changes
  useEffect(() => {
    if (isInitialized && onDataChange) {
      const changes = hasChanges()
      onDataChange('basic', formData, changes)
    }
  }, [formData, hasChanges, isInitialized, onDataChange])

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
    setModelPickerOpen(false)
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
        <div className="mb-[18px]">
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
                version={agentMeta.version}
              />
            </div>
            <span className="text-content-secondary text-[13px] font-normal">
              {readOnly ? "Avatar cannot be modified" : isLocked ? "This agent is locked; its avatar cannot be modified" : "Click to choose avatar"}
            </span>
          </div>
        </div>

        {/* Agent Name */}
        <div className="mb-[18px]">
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
        <div className="mb-[18px]">
          <label className="block mb-1.5 text-[13px] font-medium text-content">Agent Model</label>
          <Popover open={modelPickerOpen} onOpenChange={(o) => !isModelDisabled && setModelPickerOpen(o)}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                type="button"
                disabled={isModelDisabled}
                className={`w-full justify-start gap-2 h-auto px-3 py-2 font-normal ${validationErrors.model ? 'border-destructive' : ''}`}
              >
                <Cpu size={16} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />
                <span className="flex-1 text-left truncate">
                  {modelInvalid ? <><AlertTriangle size={12} className="inline mr-1 text-amber-500" />Select Model</> : modelDisplayLabel}
                </span>
                <ChevronDown
                  size={16}
                  strokeWidth={1.75}
                  className={`shrink-0 opacity-50 transition-transform ${modelPickerOpen ? 'rotate-180' : ''}`}
                />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[var(--radix-popover-trigger-width)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overflow-x-hidden p-1"
              align="start"
              sideOffset={4}
            >
              <GroupedModelPicker
                value={formData.model}
                onChange={handleModelSelect}
                variant="popover"
              />
            </PopoverContent>
          </Popover>
          {validationErrors.model && (
            <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-md text-[13px] bg-[#FEE2E2] border-l-2 border-status-error text-red-900">{validationErrors.model}</div>
          )}
        </div>

        {agentMeta.version && (
          <div className="mb-[18px] mt-2 pt-4 border-t border-slate-300/50">
            <label className="block mb-1.5 text-[13px] font-medium text-content">Agent Info</label>
            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-content-secondary font-medium">Version:</span>
                <span className="text-[13px] text-content-heading font-normal">{agentMeta.version}</span>
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
