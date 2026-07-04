import React, { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../ui/ToastProvider'
import { INHERIT_MODEL_VALUE } from '@shared/constants/subAgent'
import SubAgentForm, { DEFAULT_FORM_DATA } from './SubAgentForm'
import type { SubAgentFormData } from './SubAgentForm'
import { Button } from '@/shadcn/button'
import { subAgentApi } from '@/ipc/subAgent'

/**
 * CreateSubAgentView - Sub-agent creation form
 *
 * Design reference: SkillsView overall layout (unified-header + scrollable content)
 * Uses IPC to call the main process subAgent:add handler
 */
const CreateSubAgentView: React.FC = () => {
  const navigate = useNavigate()
  const { showSuccess, showError } = useToast()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState<SubAgentFormData>({ ...DEFAULT_FORM_DATA })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required'
    } else if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(formData.name)) {
      newErrors.name = 'Name must contain only lowercase letters, numbers, and hyphens (cannot start or end with a hyphen)'
    }

    if (!formData.display_name.trim()) {
      newErrors.display_name = 'Display name is required'
    }

    if (!formData.description.trim()) {
      newErrors.description = 'Description is required'
    }

    if (!formData.system_prompt.trim()) {
      newErrors.system_prompt = 'System prompt is required'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = useCallback(async () => {
    if (!validateForm()) return
    setIsSubmitting(true)

    try {
      const result = await subAgentApi.add({
        name: formData.name.trim(),
        display_name: formData.display_name.trim(),
        description: formData.description.trim(),
        emoji: formData.emoji,
        version: '1.0.0',
        model: formData.model.trim() || INHERIT_MODEL_VALUE,
        system_prompt: formData.system_prompt.trim(),
        mcpServers: formData.mcp_servers,
        skills: formData.skills,
        tools: [],
        context_access: formData.context_access,
        maxTurns: formData.max_turns,
        workspace: formData.workspace.trim() || undefined,
        knowledgeBase: formData.knowledgeBase.trim() || '',
        inherit_mcp_servers: formData.inherit_mcp_servers,
        inherit_skills: formData.inherit_skills,
        inherit_knowledge_base: formData.inherit_knowledge_base,
      })

      if (result.success) {
        showSuccess(`Sub-agent "${formData.display_name}" created successfully`)

        // Trigger list refresh（subAgents.atom 通过 persist 通道自动刷数据，
        // 此 event 仅用于通知列表组件自动选中新建项）
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('subAgents:refreshList', {
            detail: { subAgentName: formData.name }
          }))
        }, 500)

        // Trigger Apply to Agents dialog
        window.dispatchEvent(new CustomEvent('subAgents:applyToAgents', {
          detail: { subAgentName: formData.name }
        }))

        navigate('/settings/sub-agents')
      } else {
        showError(`Failed to create sub-agent: ${result.error || 'Unknown error'}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      showError(`Failed to create sub-agent: ${errorMessage}`)
    } finally {
      setIsSubmitting(false)
    }
  }, [formData, navigate, showSuccess, showError])

  const updateField = (field: string, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors(prev => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    }
  }

  return (
    <div className="flex flex-col w-full h-full">
      {/* Header */}
      <div className="box-border flex justify-between items-center px-6 py-2.5 h-13 bg-white border-b border-black/7">
        <div className="flex flex-row items-center gap-2 h-5.5 flex-none grow-0">
          <Button variant="ghost" size="icon" onClick={() => navigate('/settings/sub-agents')} title="Back">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20 11H7.83L13.42 5.41L12 4L4 12L12 20L13.41 18.59L7.83 13H20V11Z" fill="#272320"/>
            </svg>
          </Button>
          <span className="h-5.5 not-italic font-semibold text-[15px] leading-5.5 text-black flex-none grow-0 [font-variation-settings:'opsz'_10.5]">Create Sub-Agent</span>
        </div>
        <div className="flex items-center shrink-0" />
      </div>

      {/* Scrollable Form Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6 bg-white custom-scrollbar">
        <SubAgentForm
          formData={formData}
          errors={errors}
          isNameEditable={true}
          isSubmitting={isSubmitting}
          submitLabel="Create Sub-Agent"
          submittingLabel="Creating..."
          onUpdateField={updateField}
          onUpdateFormData={setFormData}
          onSubmit={handleSubmit}
          onCancel={() => navigate('/settings/sub-agents')}
        />
      </div>
    </div>
  )
}

export default CreateSubAgentView
