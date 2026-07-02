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
import './SubAgentsView.scss'

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
    <div className="sub-agent-form-inner">
      {/* Name */}
      <div className="sub-agent-form-field">
        <label className="sub-agent-form-label">
          Name {isNameEditable && <span className="required">*</span>}
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
        {errors.name && <p className="sub-agent-form-error">{errors.name}</p>}
        <p className="sub-agent-form-hint">
          {isNameEditable
            ? 'Unique identifier. Lowercase letters, numbers, and hyphens only.'
            : 'Name cannot be changed after creation.'}
        </p>
      </div>

      {/* Display Name + Emoji */}
      <div className="sub-agent-form-row">
        <div className="sub-agent-form-field">
          <label className="sub-agent-form-label">Emoji</label>
          <Input
            type="text"
            className="w-20 text-xl text-center"
            value={formData.emoji}
            onChange={(e) => onUpdateField('emoji', e.target.value)}
          />
        </div>
        <div className="sub-agent-form-field" style={{ flex: 1 }}>
          <label className="sub-agent-form-label">
            Display Name <span className="required">*</span>
          </label>
          <Input
            type="text"
            className={errors.display_name ? 'border-red-500' : ''}
            value={formData.display_name}
            onChange={(e) => onUpdateField('display_name', e.target.value)}
            placeholder="e.g., Web Researcher"
          />
          {errors.display_name && <p className="sub-agent-form-error">{errors.display_name}</p>}
        </div>
      </div>

      {/* Description */}
      <div className="sub-agent-form-field">
        <label className="sub-agent-form-label">
          Description <span className="required">*</span>
        </label>
        <Textarea
          className={errors.description ? 'border-red-500' : ''}
          value={formData.description}
          onChange={(e) => onUpdateField('description', e.target.value)}
          placeholder="Describe what this sub-agent does..."
          rows={2}
        />
        {errors.description && <p className="sub-agent-form-error">{errors.description}</p>}
      </div>

      {/* System Prompt */}
      <div className="sub-agent-form-field">
        <label className="sub-agent-form-label">
          System Prompt <span className="required">*</span>
        </label>
        <Textarea
          className={`font-mono ${errors.system_prompt ? 'border-red-500' : ''}`}
          value={formData.system_prompt}
          onChange={(e) => onUpdateField('system_prompt', e.target.value)}
          placeholder="Provide the system prompt that defines this sub-agent's behavior..."
          rows={8}
        />
        {errors.system_prompt && <p className="sub-agent-form-error">{errors.system_prompt}</p>}
      </div>

      {/* Model */}
      <div className="sub-agent-form-field">
        <label className="sub-agent-form-label">Model</label>
        <SubAgentModelSelect
          value={formData.model}
          onChange={(modelId) => onUpdateField('model', modelId)}
        />
        <p className="sub-agent-form-hint">
          Use the parent agent model by default, or choose a specific model for this sub-agent.
        </p>
      </div>

      {/* Context Access */}
      <div className="sub-agent-form-field">
        <label className="sub-agent-form-label">Context Access</label>
        <Select value={formData.context_access} onValueChange={(v) => onUpdateField('context_access', v)}>
          <SelectTrigger className="sub-agent-form-select"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="isolated">Isolated — No access to parent context</SelectItem>
            <SelectItem value="parent_summary">Summary — Receives a summary of parent conversation</SelectItem>
            <SelectItem value="full_history">Full History — Receives full parent conversation history</SelectItem>
          </SelectContent>
        </Select>
        <p className="sub-agent-form-hint">
          Controls how much context the sub-agent receives from the parent conversation.
        </p>
      </div>

      {/* Max Turns */}
      <div className="sub-agent-form-field">
        <label className="sub-agent-form-label">Max Turns</label>
        <Input
          type="number"
          className="w-30"
          value={formData.max_turns}
          onChange={(e) => onUpdateField('max_turns', parseInt(e.target.value) || 25)}
          min={1}
          max={100}
        />
        <p className="sub-agent-form-hint">
          Maximum number of conversation turns for this sub-agent (1-100).
        </p>
      </div>

      {/* Workspace (optional) */}
      <div className="sub-agent-form-field">
        <label className="sub-agent-form-label">
          Workspace Path <span className="optional">(optional)</span>
        </label>
        <Input
          type="text"
          value={formData.workspace}
          onChange={(e) => onUpdateField('workspace', e.target.value)}
          placeholder="Leave empty to inherit from parent agent"
        />
      </div>

      {/* ═══ Capabilities Section ═══ */}
      <div className="sub-agent-capabilities-section">
        <h3 className="sub-agent-capabilities-title">Capabilities</h3>

        {/* MCP Servers */}
        <div className="sub-agent-capability-card">
          <div className="sub-agent-capability-header">
            <label className="sub-agent-capability-label">MCP Servers</label>
            <label className="sub-agent-inherit-toggle">
              <Checkbox
                checked={formData.inherit_mcp_servers}
                onCheckedChange={(checked) => onUpdateFormData(prev => ({ ...prev, inherit_mcp_servers: !!checked }))}
              />
              Inherit from parent agent
            </label>
          </div>
          {formData.inherit_mcp_servers && (
            <p className="sub-agent-inherit-hint">
              All MCP servers will be inherited from the parent agent and cannot be changed individually.
            </p>
          )}
          <div className="sub-agent-capability-list">
            {mcpLoading ? (
              <p className="sub-agent-capability-empty">Loading servers...</p>
            ) : mcpServersList.length === 0 ? (
              <p className="sub-agent-capability-empty">No MCP servers configured. Add servers in Settings → MCP.</p>
            ) : (
              mcpServersList.map(server => (
                <label key={server.name} className={`sub-agent-capability-item${formData.inherit_mcp_servers ? ' inherited' : ''}`}>
                  <Checkbox
                    checked={formData.inherit_mcp_servers || formData.mcp_servers.some(s => s.name === server.name)}
                    onCheckedChange={() => toggleMcpServer(server.name)}
                    disabled={formData.inherit_mcp_servers}
                  />
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <span className={`sub-agent-mcp-status-dot ${server.status === 'connected' ? 'connected' : 'disconnected'}`} />
                    {server.name}
                  </span>
                  {server.tools && <span className="sub-agent-capability-tools-count">({server.tools.length} tools)</span>}
                </label>
              ))
            )}
          </div>
        </div>

        {/* Skills */}
        <div className="sub-agent-capability-card">
          <div className="sub-agent-capability-header">
            <label className="sub-agent-capability-label">Skills</label>
            <label className="sub-agent-inherit-toggle">
              <Checkbox
                checked={formData.inherit_skills}
                onCheckedChange={(checked) => onUpdateFormData(prev => ({ ...prev, inherit_skills: !!checked }))}
              />
              Inherit from parent agent
            </label>
          </div>
          {formData.inherit_skills && (
            <p className="sub-agent-inherit-hint">
              All skills will be inherited from the parent agent and cannot be changed individually.
            </p>
          )}
          <div className="sub-agent-capability-list">
            {skillsLoading ? (
              <p className="sub-agent-capability-empty">Loading skills...</p>
            ) : skillsList.length === 0 ? (
              <p className="sub-agent-capability-empty">No skills installed. Add skills in Settings → Skills.</p>
            ) : (
              skillsList.map(skill => (
                <label key={skill.name} className={`sub-agent-capability-item${formData.inherit_skills ? ' inherited' : ''}`}>
                  <Checkbox
                    checked={formData.inherit_skills || formData.skills.includes(skill.name)}
                    onCheckedChange={() => toggleSkill(skill.name)}
                    disabled={formData.inherit_skills}
                  />
                  {skill.name}
                  {skill.description && <span className="sub-agent-capability-description">— {skill.description}</span>}
                </label>
              ))
            )}
          </div>
        </div>

        {/* Knowledge Base */}
        <div className="sub-agent-capability-card">
          <div className="sub-agent-capability-header">
            <label className="sub-agent-capability-label">Knowledge Base</label>
            <label className="sub-agent-inherit-toggle">
              <Checkbox
                checked={formData.inherit_knowledge_base}
                onCheckedChange={(checked) => onUpdateFormData(prev => ({ ...prev, inherit_knowledge_base: !!checked }))}
              />
              Inherit from parent agent
            </label>
          </div>
          {formData.inherit_knowledge_base && (
            <p className="sub-agent-inherit-hint">
              Leave empty to use parent agent's knowledge base at runtime.
            </p>
          )}
          <div className="sub-agent-kb-row">
            <Input
              type="text"
              value={formData.knowledgeBase}
              onChange={(e) => onUpdateFormData(prev => ({ ...prev, knowledgeBase: e.target.value }))}
              placeholder={formData.inherit_knowledge_base ? 'Leave empty to inherit from parent' : 'Enter knowledge base directory path'}
            />
            <Button
              type="button"
              variant="secondary"
              style={{ padding: '8px 12px', fontSize: '13px', whiteSpace: 'nowrap' }}
              onClick={handleBrowseKnowledgeBase}
            >
              Browse
            </Button>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="sub-agent-form-actions">
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
