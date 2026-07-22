import React, { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../ui/ToastProvider'
import { getAgents, listenAgents, useAgents } from '@/states/agents.atom'
import { addAgentConfig } from '../../../lib/chat/agentOps'
import EmojiPicker from '@/shadcn/emoji-picker'
import { Button } from '@/shadcn/button'
import { AlertTriangle } from 'lucide-react'
import { log } from '@/log';
import { ModelSelectPopover } from '../ModelSelectPopover'
import { newEntityId } from '@shared/persist/id'
const logger = log.child({ mod: 'CreateCustomAgentViewContent' });


interface AgentFormData {
  name: string
  description: string
  emoji: string
  model: string
}

const CreateCustomAgentViewContent: React.FC = () => {
  const navigate = useNavigate()
  const agents = useAgents()
  const { showToast } = useToast()

  // Form data
  const [formData, setFormData] = useState<AgentFormData>({
    name: '',
    description: '',
    emoji: '🤖',
    model: '',
  })
  const [isCreating, setIsCreating] = useState(false)
  const [nameWarning, setNameWarning] = useState<string>('')
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})


  // 模型列表由 GroupedModelPicker 内部 hook 拉取，无需在此 effect 同步

  // Validate Agent name logic
  const validateAgentName = useCallback((name: string): boolean => {
    if (!name || !name.trim()) {
      return false
    }

    // Check if the name duplicates an existing Agent
    return !agents.some(a => a.name === name.trim())
  }, [agents])

  const isFormValid = Boolean(formData.name.trim() && validateAgentName(formData.name))

  // Handle input changes
  const handleInputChange = useCallback((field: keyof AgentFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))

    // For the name field, check for duplicates and validity in real time
    if (field === 'name') {
      if (value.trim() && !validateAgentName(value)) {
        setNameWarning('This agent name already exists')
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
  }, [handleInputChange])

  const handleEmojiSelect = useCallback((emoji: string) => {
    handleInputChange('emoji', emoji)
  }, [handleInputChange])

  // Wait for the new agent to appear in the atom after the IPC round trip.
  const waitForAgentInCache = useCallback((agentId: string, timeout = 5000): Promise<boolean> => {
    return new Promise((resolve) => {
      if (getAgents().some((agent) => agent.id === agentId)) {
        resolve(true)
        return
      }

      let timeoutId: NodeJS.Timeout
      const unsubscribe = listenAgents((cachedAgents) => {
        if (cachedAgents.some((agent) => agent.id === agentId)) {
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

  const handleCreate = useCallback(async (destination: 'settings' | 'chat') => {
    if (!isFormValid) {
      showToast('Please enter a valid agent name', 'error')
      return
    }

    // Re-validate the name for duplicates (guard against concurrent creation).
    if (!validateAgentName(formData.name)) {
      showToast('Agent name already exists. Please choose a different name.', 'error')
      return
    }

    setIsCreating(true)

    try {
      const result = await addAgentConfig({
        agent: {
          name: formData.name.trim(),
          description: formData.description.trim(),
          emoji: formData.emoji,
          role: '',
          model: formData.model,
          version: '1.0.0',
          system_prompt: '',
          // tools: [] ⇒ 默认全开本地工具;mcp_servers: [] ⇒ 不引外部 MCP。
          // 两个维度独立,见 AgentMarkdownFrontBase.tools / mcp_servers 语义。
          mcp_servers: [],
          tools: [],
          skills: {},
        }
      })

      if (!result.success || !result.data) {
        showToast(result.error || 'Failed to create agent', 'error')
        return
      }

      const agentId = result.data.agent_id
      const agentAvailable = await waitForAgentInCache(agentId)
      if (!agentAvailable) {
        logger.warn({ msg: 'Agent not found in cache after timeout, navigating anyway', agentId })
      }

      showToast(`Agent "${formData.name}" created successfully!`, 'success')
      if (destination === 'settings') {
        navigate(`/agent/${agentId}/settings/basic`)
      } else {
        navigate(`/agent/${agentId}/${newEntityId('s')}`)
      }
    } catch (error) {
      logger.error({ msg: 'Failed to create agent:', err: error })
      showToast('Failed to create agent', 'error')
    } finally {
      setIsCreating(false)
    }
  }, [formData, isFormValid, navigate, showToast, validateAgentName, waitForAgentInCache])

  return (
    <div className="flex-1 overflow-y-auto bg-white p-6">
      {/* Agent Avatar section */}
      <div className="mb-6">
        <label className="mb-2 block text-sm font-semibold leading-5 text-[#272320]">Agent Avatar</label>
        <div className="flex items-center gap-4">
          <EmojiPicker onEmojiSelect={handleEmojiSelect}>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-16 rounded-xl p-0 text-3xl"
              title="Click to change emoji"
              aria-label="Choose agent avatar"
            >
              {formData.emoji}
            </Button>
          </EmojiPicker>
          <span className="text-sm font-medium text-gray-500">Click to choose avatar</span>
        </div>
      </div>

      {/* Agent Name section */}
      <div className="mb-6">
        <label className="mb-2 block text-sm font-semibold leading-5 text-[#272320]">Agent Name</label>
        <input
          type="text"
          className={`w-full rounded-lg border bg-white px-4 py-3 text-sm leading-5 text-[#272320] outline-none transition-colors focus:shadow-[0_0_0_3px_rgba(0,122,255,0.1)] ${
            validationErrors.name
              ? 'border-[#FF3B30] bg-[#FF3B30]/5'
              : nameWarning
                ? 'border-amber-500 bg-amber-100/10 focus:border-amber-500 focus:shadow-[0_0_0_3px_rgba(245,158,11,0.1)]'
                : 'border-black/20 focus:border-[#404040]'
          }`}
          value={formData.name}
          onChange={(e) => handleInputChange('name', e.target.value)}
          placeholder="Enter agent name..."
        />
        {validationErrors.name && (
          <div className="mt-1 text-xs leading-4 text-[#FF3B30]">
            {validationErrors.name}
          </div>
        )}
        {nameWarning && !validationErrors.name && (
          <div className="mt-2 flex items-center gap-2 rounded-md border-l-2 border-amber-500 bg-amber-100/90 px-3 py-2 text-[13px] text-amber-900">
            <AlertTriangle size={14} className="shrink-0" />
            <span>{nameWarning}</span>
          </div>
        )}
      </div>

      {/* Agent Description section */}
      <div className="mb-6">
        <label htmlFor="agent-description" className="mb-2 block text-sm font-semibold leading-5 text-[#272320]">
          Agent Description <span className="font-normal text-gray-500">(optional)</span>
        </label>
        <p id="agent-description-helper" className="mb-2 text-sm text-gray-500">
          Describe this agent&apos;s expertise to help other agents select it as a delegation target.
        </p>
        <textarea
          id="agent-description"
          className="min-h-24 w-full resize-y rounded-lg border border-black/20 bg-white px-4 py-3 text-sm leading-5 text-[#272320] outline-none transition-colors focus:border-[#404040] focus:shadow-[0_0_0_3px_rgba(0,122,255,0.1)]"
          value={formData.description}
          onChange={(event) => handleInputChange('description', event.target.value)}
          placeholder="Describe this agent&apos;s expertise..."
          aria-describedby="agent-description-helper"
        />
      </div>

      {/* Agent Model section */}
      <div className="mb-6">
        <label className="mb-2 block text-sm font-semibold leading-5 text-[#272320]">Agent Model</label>
        <ModelSelectPopover
          value={formData.model}
          onChange={handleModelSelect}
          smallTigger
          contentClassName="max-h-(--radix-popover-content-available-height)"
        />
      </div>

      {/* Action buttons */}
      <div className="mt-8 flex items-center justify-end gap-3 border-t border-black/10 pt-6">
        <Button
          variant="secondary"
          onClick={() => navigate('/agent/creation')}
          disabled={isCreating}
        >
          Cancel
        </Button>

        <Button
          variant="secondary"
          onClick={() => handleCreate('settings')}
          disabled={isCreating || !isFormValid}
          type="button"
        >
          {isCreating ? 'Creating...' : 'Create and Configure Advanced Options'}
        </Button>

        <Button
          onClick={() => handleCreate('chat')}
          disabled={isCreating || !isFormValid}
          type="button"
        >
          {isCreating ? 'Creating...' : 'Create and Start Chatting'}
        </Button>
      </div>

    </div>
  )
}

export default CreateCustomAgentViewContent