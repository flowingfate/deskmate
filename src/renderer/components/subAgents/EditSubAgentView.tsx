import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useToast } from '../ui/ToastProvider'
import { useSubAgents } from '../userData/userDataProvider'
import { INHERIT_MODEL_VALUE } from '@shared/constants/subAgent'
import SubAgentForm, { DEFAULT_FORM_DATA } from './SubAgentForm'
import type { SubAgentFormData } from './SubAgentForm'
import { Button } from '@/shadcn/button'
import { subAgentApi } from '@/ipc/subAgent'

/**
 * EditSubAgentView - Sub-agent edit form
 *
 * Design reference: SkillsView overall layout (unified-header + scrollable content)
 * Route parameter: /settings/sub-agents/edit/:subAgentName
 */
const EditSubAgentView: React.FC = () => {
  const navigate = useNavigate()
  const { subAgentName } = useParams<{ subAgentName: string }>()
  const { showSuccess, showError } = useToast()
  const { subAgents, isLoading } = useSubAgents()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState<SubAgentFormData>({ ...DEFAULT_FORM_DATA })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isInitialized, setIsInitialized] = useState(false)

  // Load existing sub-agent data
  useEffect(() => {
    if (!subAgentName || isLoading || isInitialized) return

    const decodedName = decodeURIComponent(subAgentName)
    const existing = subAgents.find(sa => sa.name === decodedName)

    if (existing) {
      setFormData({
        name: existing.name,
        display_name: existing.display_name,
        description: existing.description,
        emoji: existing.emoji,
        system_prompt: existing.system_prompt,
        model: existing.model || INHERIT_MODEL_VALUE,
        context_access: existing.context_access,
        max_turns: existing.maxTurns ?? 25,
        workspace: existing.workspace || '',
        mcp_servers: (existing.mcpServers ?? []).map((s) =>
          typeof s === 'string' ? { name: s, tools: [] } : { name: s.name, tools: s.tools ?? [] },
        ),
        inherit_mcp_servers: existing.inherit_mcp_servers ?? true,
        skills: Array.isArray(existing.skills) ? existing.skills : [],
        inherit_skills: existing.inherit_skills ?? true,
        knowledgeBase: existing.knowledgeBase || '',
        inherit_knowledge_base: existing.inherit_knowledge_base ?? true,
      })
      setIsInitialized(true)
    }
  }, [subAgentName, subAgents, isLoading, isInitialized])

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

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
    if (!validateForm() || !subAgentName) return
    setIsSubmitting(true)

    try {
      const decodedName = decodeURIComponent(subAgentName)
      const result = await subAgentApi.update(decodedName, {
        display_name: formData.display_name.trim(),
        description: formData.description.trim(),
        emoji: formData.emoji,
        model: formData.model.trim() || INHERIT_MODEL_VALUE,
        system_prompt: formData.system_prompt.trim(),
        context_access: formData.context_access,
        maxTurns: formData.max_turns,
        workspace: formData.workspace.trim() || undefined,
        mcpServers: formData.mcp_servers,
        skills: formData.skills,
        knowledgeBase: formData.knowledgeBase.trim() || '',
        inherit_mcp_servers: formData.inherit_mcp_servers,
        inherit_skills: formData.inherit_skills,
        inherit_knowledge_base: formData.inherit_knowledge_base,
      })

      if (result.success) {
        showSuccess(`Sub-agent "${formData.display_name}" updated successfully`)

        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('subAgents:refreshList', {
            detail: { subAgentName: decodedName }
          }))
        }, 500)

        navigate('/settings/sub-agents')
      } else {
        showError(`Failed to update sub-agent: ${result.error || 'Unknown error'}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      showError(`Failed to update sub-agent: ${errorMessage}`)
    } finally {
      setIsSubmitting(false)
    }
  }, [formData, subAgentName, navigate, showSuccess, showError])

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

  if (isLoading) {
    return (
      <div className="flex flex-col w-full h-full">
        <div className="flex-1 min-h-0 overflow-y-auto p-6 bg-white custom-scrollbar flex justify-center items-center">
          <div className="w-6 h-6 rounded-full border-2 border-border border-t-accent animate-spin opacity-60" />
        </div>
      </div>
    )
  }

  const decodedName = subAgentName ? decodeURIComponent(subAgentName) : ''
  const existing = subAgents.find(sa => sa.name === decodedName)

  if (!existing && isInitialized) {
    return (
      <div className="flex flex-col w-full h-full">
        <div className="box-border flex justify-between items-center px-6 py-2.5 h-13 bg-white border-b border-black/7">
          <div className="flex flex-row items-center gap-2 h-5.5 flex-none grow-0">
            <Button variant="ghost" size="icon" onClick={() => navigate('/settings/sub-agents')} title="Back">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M20 11H7.83L13.42 5.41L12 4L4 12L12 20L13.41 18.59L7.83 13H20V11Z" fill="#272320"/>
              </svg>
            </Button>
            <span className="h-5.5 not-italic font-semibold text-[15px] leading-5.5 text-black flex-none grow-0 [font-variation-settings:'opsz'_10.5]">Sub-Agent Not Found</span>
          </div>
          <div className="flex items-center shrink-0" />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-6 bg-white custom-scrollbar">
          <p>Sub-agent "{decodedName}" not found.</p>
        </div>
      </div>
    )
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
          <span className="h-5.5 not-italic font-semibold text-[15px] leading-5.5 text-black flex-none grow-0 [font-variation-settings:'opsz'_10.5]">Edit Sub-Agent: {existing?.display_name || decodedName}</span>
        </div>
        <div className="flex items-center shrink-0" />
      </div>

      {/* Scrollable Form Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6 bg-white custom-scrollbar">
        <SubAgentForm
          formData={formData}
          errors={errors}
          isNameEditable={false}
          isSubmitting={isSubmitting}
          submitLabel="Save Changes"
          submittingLabel="Saving..."
          onUpdateField={updateField}
          onUpdateFormData={setFormData}
          onSubmit={handleSubmit}
          onCancel={() => navigate('/settings/sub-agents')}
        />
      </div>
    </div>
  )
}

export default EditSubAgentView
