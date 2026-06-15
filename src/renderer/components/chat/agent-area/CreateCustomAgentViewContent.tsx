import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../ui/ToastProvider'
import { getAgents, listenAgents, useAgents } from '@/states/agents.atom'
import { addAgentConfig } from '../../../lib/chat/agentOps'
import EmojiPicker from '../agent-editor/EmojiPicker'
import { BUILTIN_SKILL_NAMES } from '../../../../shared/constants/builtinSkills'
import { Button } from '@/shadcn/button'
import { AlertTriangle } from 'lucide-react'
import './AgentCreation.scss'
import { log } from '@/log';
import { GroupedModelPicker, useModelDisplayLabel } from '../GroupedModelPicker'
const logger = log.child({ mod: 'CreateCustomAgentViewContent' });

interface CreateCustomAgentViewContentProps {
  // Add needed props here
}

// Simplified Agent data type
interface AgentFormData {
  name: string
  emoji: string
  model: string
}

const CreateCustomAgentViewContent: React.FC<CreateCustomAgentViewContentProps> = () => {
  const navigate = useNavigate()
  const agents = useAgents()
  const { showToast } = useToast()

  // Form data
  const [formData, setFormData] = useState<AgentFormData>({
    name: '',
    emoji: '🤖',
    model: '' // Step 9+：让用户主动选 provider::modelId
  })
  const [isCreating, setIsCreating] = useState(false)

  // UI state
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [isFormValid, setIsFormValid] = useState(false)
  const [nameWarning, setNameWarning] = useState<string>('')
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const modelDropdownRef = React.useRef<HTMLDivElement>(null)
  const { label: modelDisplayLabel, invalid: modelInvalid } = useModelDisplayLabel(formData.model)

  // 模型列表由 GroupedModelPicker 内部 hook 拉取，无需在此 effect 同步

  // Handle clicking outside to close model dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setShowModelDropdown(false)
      }
    }

    if (showModelDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [showModelDropdown])

  // Validate Agent name logic
  const validateAgentName = useCallback((name: string): boolean => {
    if (!name || !name.trim()) {
      return false
    }

    // Check if the name duplicates an existing Agent
    return !agents.some(a => a.name === name.trim())
  }, [agents])

  // Validate form data
  React.useEffect(() => {
    const isValid = formData.name.trim() && validateAgentName(formData.name) && formData.model
    setIsFormValid(Boolean(isValid))
  }, [formData, validateAgentName])

  // Handle input changes
  const handleInputChange = useCallback((field: keyof AgentFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))

    // For the name field, check for duplicates and validity in real time
    if (field === 'name') {
      if (value.trim() && !validateAgentName(value)) {
        setNameWarning('⚠️ This agent name already exists')
      } else {
        setNameWarning('')
      }

      // Clear the validation error for this field
      if (validationErrors.name) {
        setValidationErrors(prev => {
          const newErrors = { ...prev }
          delete newErrors.name
          return newErrors
        })
      }
    }
  }, [validateAgentName, validationErrors])

  // Handle model selection
  const handleModelSelect = useCallback((modelId: string) => {
    handleInputChange('model', modelId)
    setShowModelDropdown(false)
  }, [handleInputChange])

  // Handle Emoji selection
  const handleEmojiSelect = useCallback((emoji: string) => {
    handleInputChange('emoji', emoji)
    setShowEmojiPicker(false)
  }, [handleInputChange])

  // Helper function to wait for the new agent to appear in the atom (after IPC roundtrip)
  const waitForChatInCache = useCallback((agentId: string, timeout = 5000): Promise<boolean> => {
    return new Promise((resolve) => {
      if (getAgents().some(a => a.id === agentId)) {
        resolve(true)
        return
      }

      let timeoutId: NodeJS.Timeout
      const unsubscribe = listenAgents((agents) => {
        if (agents.some(a => a.id === agentId)) {
          clearTimeout(timeoutId)
          unsubscribe()
          resolve(true)
        }
      })

      timeoutId = setTimeout(() => {
        unsubscribe()
        resolve(false)
      }, timeout)
    })
  }, [])

  // Create and continue to configure
  const handleCreateAndContinue = useCallback(async () => {
    if (!isFormValid || !formData.name.trim()) {
      showToast('Please enter a valid agent name', 'error')
      return
    }

    // Re-validate the name for duplicates (guard against concurrent creation)
    if (!validateAgentName(formData.name)) {
      showToast('Agent name already exists. Please choose a different name.', 'error')
      return
    }

    setIsCreating(true)

    try {
      // Create the new Chat configuration
      const result = await addAgentConfig({
        agent: {
          name: formData.name.trim(),
          emoji: formData.emoji,
          role: '',
          model: formData.model,
          version: '1.0.0',
          system_prompt: '',
          // tools: [] ⇒ 默认全开本地工具;mcp_servers: [] ⇒ 不引外部 MCP。
          // 两个维度独立,见 AgentMarkdownFrontBase.tools / mcp_servers 语义。
          mcp_servers: [],
          tools: [],
          skills: [...BUILTIN_SKILL_NAMES],
        }
      })

      if (result.success && result.data) {
        const agentId = result.data.agent_id

        // Wait for ProfileDataManager to receive the new Chat configuration
        logger.debug({ msg: "Waiting for chat to appear in cache:", data: agentId })
        const chatAvailable = await waitForChatInCache(agentId)

        if (chatAvailable) {
          showToast(`Agent "${formData.name}" created successfully!`, 'success')
          // Navigate to the agent/chat/{agent_id}/settings/workspace page
          navigate(`/agent/${agentId}/settings/workspace`)
        } else {
          logger.warn({ msg: "Chat not found in cache after timeout, navigating anyway" })
          showToast(`Agent "${formData.name}" created successfully!`, 'success')
          navigate(`/agent/${agentId}/settings/workspace`)
        }
      } else {
        showToast(result.error || 'Failed to create agent', 'error')
      }
    } catch (error) {
      logger.error({ msg: "Failed to create agent:", err: error })
      showToast('Failed to create agent', 'error')
    } finally {
      setIsCreating(false)
    }
  }, [formData, navigate, showToast, waitForChatInCache, validateAgentName])

  return (
    <div className="create-agent-content">
      {/* Agent Avatar section */}
      <div className="agent-avatar-section">
        <label className="form-label">Agent Avatar</label>
        <div className="emoji-section">
          <div
            className="emoji-display"
            onClick={() => setShowEmojiPicker(true)}
            title="Click to change emoji"
          >
            {formData.emoji}
          </div>
          <span className="emoji-hint">Click to choose avatar</span>
        </div>
      </div>

      {/* Agent Name section */}
      <div className="agent-name-section">
        <label className="form-label">Agent Name</label>
        <input
          type="text"
          className={`agent-name-input ${validationErrors.name ? 'error' : ''} ${nameWarning ? 'warning' : ''}`}
          value={formData.name}
          onChange={(e) => handleInputChange('name', e.target.value)}
          placeholder="Enter agent name..."
        />
        {validationErrors.name && (
          <div className="validation-error">
            {validationErrors.name}
          </div>
        )}
        {nameWarning && !validationErrors.name && (
          <div className="warning-message">
            {nameWarning}
          </div>
        )}
      </div>

      {/* Agent Model section */}
      <div className="agent-model-section">
        <label className="form-label">Agent Model</label>
        <div className="model-selector" ref={modelDropdownRef}>
          <Button
            type="button"
            variant="ghost"
            className="model-button"
            onClick={() => setShowModelDropdown(!showModelDropdown)}
          >
            <svg
              className="model-icon"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
            <span className="model-name">
              {modelInvalid ? <><AlertTriangle size={12} className="inline mr-1 text-amber-500" />Select Model</> : modelDisplayLabel}
            </span>
            <svg
              className={`dropdown-arrow ${showModelDropdown ? 'rotated' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </Button>
          {showModelDropdown && (
            <div className="model-dropdown">
              <div className="model-list">
                <GroupedModelPicker
                  value={formData.model}
                  onChange={handleModelSelect}
                  variant="list"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="agent-actions">
        <Button
          variant="secondary"
          onClick={() => navigate('/agent/creation')}
        >
          Cancel
        </Button>

        <Button
          onClick={handleCreateAndContinue}
          disabled={isCreating || !isFormValid}
          type="button"
        >
          {isCreating ? 'Creating...' : 'Create and Continue Configuration'}
        </Button>
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

export default CreateCustomAgentViewContent