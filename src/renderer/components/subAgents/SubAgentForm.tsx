import React from 'react'
import { useSkills } from '../userData/userDataProvider'
import { useMcpRuntimeServers } from '@/states/mcpRuntime.atom'
import type { SubAgentContextAccess, AgentMcpServer } from '../../lib/userData/types'
import { INHERIT_MODEL_VALUE } from '@shared/constants/subAgent'
import { Button } from '@/shadcn/button'
import { Input } from '@/shadcn/input'
import { Textarea } from '@/shadcn/textarea'
import SubAgentModelSelect from './SubAgentModelSelect'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/shadcn/select'
import { Checkbox } from '@/shadcn/checkbox'

/**
 * Sub-agent form data structure shared between Create and Edit views.
 */
export interface SubAgentFormData {
  name: string
  display_name: string
  description: string
  emoji: string
  system_prompt: string
  model: string
  context_access: SubAgentContextAccess
  max_turns: number
  workspace: string
  mcp_servers: AgentMcpServer[]
  inherit_mcp_servers: boolean
  skills: string[]
  inherit_skills: boolean
  knowledgeBase: string
  inherit_knowledge_base: boolean
}

export const DEFAULT_FORM_DATA: SubAgentFormData = {
  name: '',
  display_name: '',
  description: '',
  emoji: '🤖',
  system_prompt: '',
  model: INHERIT_MODEL_VALUE,
  context_access: 'isolated',
  max_turns: 25,
  workspace: '',
  mcp_servers: [],
  inherit_mcp_servers: true,
  skills: [],
  inherit_skills: true,
  knowledgeBase: '',
  inherit_knowledge_base: true,
}

interface SubAgentFormProps {
  formData: SubAgentFormData
  errors: Record<string, string>
  /** Whether the name field is editable (true for Create, false for Edit) */
  isNameEditable: boolean
  isSubmitting: boolean
  submitLabel: string
  submittingLabel: string
  onUpdateField: (field: string, value: string | number) => void
  onUpdateFormData: React.Dispatch<React.SetStateAction<SubAgentFormData>>
  onSubmit: () => void
  onCancel: () => void
}

const SubAgentForm: React.FC<SubAgentFormProps> = ({
  formData,
  errors,
  isNameEditable,
  isSubmitting,
  submitLabel,
  submittingLabel,
  onUpdateField,
  onUpdateFormData,
  onSubmit,
  onCancel,
}) => {
  const mcpServersList = useMcpRuntimeServers()
  const mcpLoading = false
  const { skills: skillsList, isLoading: skillsLoading } = useSkills()

  const toggleMcpServer = (serverName: string) => {
    if (formData.inherit_mcp_servers) return
    onUpdateFormData(prev => {
      const exists = prev.mcp_servers.some(s => s.name === serverName)
      return {
        ...prev,
        mcp_servers: exists
          ? prev.mcp_servers.filter(s => s.name !== serverName)
          : [...prev.mcp_servers, { name: serverName, tools: [] }],
      }
    })
  }

  const toggleSkill = (skillName: string) => {
    if (formData.inherit_skills) return
    onUpdateFormData(prev => ({
      ...prev,
      skills: prev.skills.includes(skillName)
        ? prev.skills.filter(s => s !== skillName)
        : [...prev.skills, skillName],
    }))
  }

  const handleBrowseKnowledgeBase = async () => {
    try {
      const result = await (window as any).electronAPI?.dialog?.showOpenDialog?.({
        properties: ['openDirectory'],
        title: 'Select Knowledge Base Directory',
      })
      if (result?.filePaths?.[0]) {
        onUpdateFormData(prev => ({ ...prev, knowledgeBase: result.filePaths[0] }))
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="max-w-[720px] flex flex-col gap-5">
      {/* Name */}
      <div className="flex flex-col">
        <label className="block text-[13px] font-medium text-[#444444] mb-1.5">
          Name {isNameEditable && <span className="text-[#ef4444]">*</span>}
        </label>
        {isNameEditable ? (
          <Input
            type="text"
            className={errors.name ? 'border-red-500' : ''}
            value={formData.name}
            onChange={(e) => onUpdateField('name', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="e.g., web-researcher"
          />
        ) : (
          <Input
            type="text"
            value={formData.name}
            disabled
          />
        )}
        {errors.name && <p className="text-xs text-[#ef4444] mt-1">{errors.name}</p>}
        <p className="text-xs text-[#9ca3af] mt-1">
          {isNameEditable
            ? 'Unique identifier. Lowercase letters, numbers, and hyphens only.'
            : 'Name cannot be changed after creation.'}
        </p>
      </div>

      {/* Display Name + Emoji */}
      <div className="flex gap-3">
        <div className="flex flex-col">
          <label className="block text-[13px] font-medium text-[#444444] mb-1.5">Emoji</label>
          <Input
            type="text"
            className="w-20 text-xl text-center"
            value={formData.emoji}
            onChange={(e) => onUpdateField('emoji', e.target.value)}
          />
        </div>
        <div className="flex flex-col flex-1">
          <label className="block text-[13px] font-medium text-[#444444] mb-1.5">
            Display Name <span className="text-[#ef4444]">*</span>
          </label>
          <Input
            type="text"
            className={errors.display_name ? 'border-red-500' : ''}
            value={formData.display_name}
            onChange={(e) => onUpdateField('display_name', e.target.value)}
            placeholder="e.g., Web Researcher"
          />
          {errors.display_name && <p className="text-xs text-[#ef4444] mt-1">{errors.display_name}</p>}
        </div>
      </div>

      {/* Description */}
      <div className="flex flex-col">
        <label className="block text-[13px] font-medium text-[#444444] mb-1.5">
          Description <span className="text-[#ef4444]">*</span>
        </label>
        <Textarea
          className={errors.description ? 'border-red-500' : ''}
          value={formData.description}
          onChange={(e) => onUpdateField('description', e.target.value)}
          placeholder="Describe what this sub-agent does..."
          rows={2}
        />
        {errors.description && <p className="text-xs text-[#ef4444] mt-1">{errors.description}</p>}
      </div>

      {/* System Prompt */}
      <div className="flex flex-col">
        <label className="block text-[13px] font-medium text-[#444444] mb-1.5">
          System Prompt <span className="text-[#ef4444]">*</span>
        </label>
        <Textarea
          className={`font-mono ${errors.system_prompt ? 'border-red-500' : ''}`}
          value={formData.system_prompt}
          onChange={(e) => onUpdateField('system_prompt', e.target.value)}
          placeholder="Provide the system prompt that defines this sub-agent's behavior..."
          rows={8}
        />
        {errors.system_prompt && <p className="text-xs text-[#ef4444] mt-1">{errors.system_prompt}</p>}
      </div>

      {/* Model */}
      <div className="flex flex-col">
        <label className="block text-[13px] font-medium text-[#444444] mb-1.5">Model</label>
        <SubAgentModelSelect
          value={formData.model}
          onChange={(modelId) => onUpdateField('model', modelId)}
        />
        <p className="text-xs text-[#9ca3af] mt-1">
          Use the parent agent model by default, or choose a specific model for this sub-agent.
        </p>
      </div>

      {/* Context Access */}
      <div className="flex flex-col">
        <label className="block text-[13px] font-medium text-[#444444] mb-1.5">Context Access</label>
        <Select value={formData.context_access} onValueChange={(v) => onUpdateField('context_access', v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="isolated">Isolated — No access to parent context</SelectItem>
            <SelectItem value="parent_summary">Summary — Receives a summary of parent conversation</SelectItem>
            <SelectItem value="full_history">Full History — Receives full parent conversation history</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-[#9ca3af] mt-1">
          Controls how much context the sub-agent receives from the parent conversation.
        </p>
      </div>

      {/* Max Turns */}
      <div className="flex flex-col">
        <label className="block text-[13px] font-medium text-[#444444] mb-1.5">Max Turns</label>
        <Input
          type="number"
          className="w-30"
          value={formData.max_turns}
          onChange={(e) => onUpdateField('max_turns', parseInt(e.target.value) || 25)}
          min={1}
          max={100}
        />
        <p className="text-xs text-[#9ca3af] mt-1">
          Maximum number of conversation turns for this sub-agent (1-100).
        </p>
      </div>

      {/* Workspace (optional) */}
      <div className="flex flex-col">
        <label className="block text-[13px] font-medium text-[#444444] mb-1.5">
          Workspace Path <span className="text-xs text-[#9ca3af] font-normal">(optional)</span>
        </label>
        <Input
          type="text"
          value={formData.workspace}
          onChange={(e) => onUpdateField('workspace', e.target.value)}
          placeholder="Leave empty to inherit from parent agent"
        />
      </div>

      {/* ═══ Capabilities Section ═══ */}
      <div className="border-t-2 border-black/8 pt-4 mt-1">
        <h3 className="text-[15px] font-semibold text-[#1c1c1c] m-0 mb-4">Capabilities</h3>

        {/* MCP Servers */}
        <div className="mb-5 last:mb-0 p-3 border border-black/10 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <label className="text-[13px] font-medium text-[#444444]">MCP Servers</label>
            <label className="flex items-center gap-1.5 text-xs text-[#6b7280] cursor-pointer">
              <Checkbox
                checked={formData.inherit_mcp_servers}
                onCheckedChange={(checked) => onUpdateFormData(prev => ({ ...prev, inherit_mcp_servers: !!checked }))}
              />
              Inherit from parent agent
            </label>
          </div>
          {formData.inherit_mcp_servers && (
            <p className="text-xs text-[#404040] mb-2 italic">
              All MCP servers will be inherited from the parent agent and cannot be changed individually.
            </p>
          )}
          <div className="max-h-40 overflow-y-auto custom-scrollbar">
            {mcpLoading ? (
              <p className="text-xs text-[#9ca3af]">Loading servers...</p>
            ) : mcpServersList.length === 0 ? (
              <p className="text-xs text-[#9ca3af]">No MCP servers configured. Add servers in Settings → MCP.</p>
            ) : (
              mcpServersList.map(server => (
                <label key={server.name} className={`flex items-center gap-2 py-1 text-[13px] text-[#444444] cursor-pointer${formData.inherit_mcp_servers ? ' opacity-60 cursor-not-allowed' : ''}`}>
                  <Checkbox
                    checked={formData.inherit_mcp_servers || formData.mcp_servers.some(s => s.name === server.name)}
                    onCheckedChange={() => toggleMcpServer(server.name)}
                    disabled={formData.inherit_mcp_servers}
                  />
                  <span className="inline-flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full inline-block ${server.status === 'connected' ? 'bg-[#22c55e]' : 'bg-[#d1d5db]'}`} />
                    {server.name}
                  </span>
                  {server.tools && <span className="text-[11px] text-[#9ca3af]">({server.tools.length} tools)</span>}
                </label>
              ))
            )}
          </div>
        </div>

        {/* Skills */}
        <div className="mb-5 last:mb-0 p-3 border border-black/10 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <label className="text-[13px] font-medium text-[#444444]">Skills</label>
            <label className="flex items-center gap-1.5 text-xs text-[#6b7280] cursor-pointer">
              <Checkbox
                checked={formData.inherit_skills}
                onCheckedChange={(checked) => onUpdateFormData(prev => ({ ...prev, inherit_skills: !!checked }))}
              />
              Inherit from parent agent
            </label>
          </div>
          {formData.inherit_skills && (
            <p className="text-xs text-[#404040] mb-2 italic">
              All skills will be inherited from the parent agent and cannot be changed individually.
            </p>
          )}
          <div className="max-h-40 overflow-y-auto custom-scrollbar">
            {skillsLoading ? (
              <p className="text-xs text-[#9ca3af]">Loading skills...</p>
            ) : skillsList.length === 0 ? (
              <p className="text-xs text-[#9ca3af]">No skills installed. Add skills in Settings → Skills.</p>
            ) : (
              skillsList.map(skill => (
                <label key={skill.name} className={`flex items-center gap-2 py-1 text-[13px] text-[#444444] cursor-pointer${formData.inherit_skills ? ' opacity-60 cursor-not-allowed' : ''}`}>
                  <Checkbox
                    checked={formData.inherit_skills || formData.skills.includes(skill.name)}
                    onCheckedChange={() => toggleSkill(skill.name)}
                    disabled={formData.inherit_skills}
                  />
                  {skill.name}
                  {skill.description && <span className="text-[11px] text-[#9ca3af]">— {skill.description}</span>}
                </label>
              ))
            )}
          </div>
        </div>

        {/* Knowledge Base */}
        <div className="mb-5 last:mb-0 p-3 border border-black/10 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <label className="text-[13px] font-medium text-[#444444]">Knowledge Base</label>
            <label className="flex items-center gap-1.5 text-xs text-[#6b7280] cursor-pointer">
              <Checkbox
                checked={formData.inherit_knowledge_base}
                onCheckedChange={(checked) => onUpdateFormData(prev => ({ ...prev, inherit_knowledge_base: !!checked }))}
              />
              Inherit from parent agent
            </label>
          </div>
          {formData.inherit_knowledge_base && (
            <p className="text-xs text-[#404040] mb-2 italic">
              Leave empty to use parent agent's knowledge base at runtime.
            </p>
          )}
          <div className="flex gap-2">
            <Input
              type="text"
              className="flex-1"
              value={formData.knowledgeBase}
              onChange={(e) => onUpdateFormData(prev => ({ ...prev, knowledgeBase: e.target.value }))}
              placeholder={formData.inherit_knowledge_base ? 'Leave empty to inherit from parent' : 'Enter knowledge base directory path'}
            />
            <Button
              type="button"
              variant="secondary"
              className="px-3 py-2 text-[13px] whitespace-nowrap"
              onClick={handleBrowseKnowledgeBase}
            >
              Browse
            </Button>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-end gap-2 pt-3 border-t border-black/8">
        <Button
          variant="secondary"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          onClick={onSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? submittingLabel : submitLabel}
        </Button>
      </div>
    </div>
  )
}

export default SubAgentForm
