import React, { useState, useCallback, useEffect } from 'react'

import { Button } from '@/shadcn/button'
import { Sparkles, Loader2, Lock } from 'lucide-react'
import { TabComponentProps } from './types'
import MarkdownEditor from './MarkdownEditor'
import { useToast } from '../../ui/ToastProvider'
import { llmApi } from '@/ipc/llm';

const AgentSystemPromptTab: React.FC<TabComponentProps> = ({
  mode,
  agentId,
  agentData,
  onSave,
  onDataChange,
  cachedData,
  readOnly = false
}) => {
  // 受保护(locked)的 agent：system prompt 不可编辑
  const isLocked = agentData?.locked === true

  // Check if editing is disabled (read-only mode or locked agent)
  const isEditDisabled = readOnly || isLocked

  const [systemPrompt, setSystemPrompt] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [optimizationError, setOptimizationError] = useState<string | null>(null)
  const [optimizationWarnings, setOptimizationWarnings] = useState<string[]>([])
  const [isInitialized, setIsInitialized] = useState(false)

  // Initial data used to detect modifications
  const [initialSystemPrompt, setInitialSystemPrompt] = useState('')

  // Load existing system prompt - only runs on initial component mount or when explicit re-sync is needed
  useEffect(() => {
    // Avoid resetting state while user is editing
    if (!isInitialized) {
      let basePrompt = ''
      if (agentData?.systemPrompt !== undefined) {
        // If systemPrompt has an explicit value (including empty string)
        basePrompt = agentData.systemPrompt
      } else if (mode === 'update') {
        // Only set default system prompt in update mode
        basePrompt = `You are a helpful AI assistant.

Please follow these guidelines:
- Be concise and clear
- Provide accurate information
- Ask clarifying questions when needed

## Specific Instructions
Add your specific instructions here...`
      }

      // If cached data exists, prefer it over the base prompt
      const finalPrompt = cachedData?.systemPrompt !== undefined ? cachedData.systemPrompt : basePrompt

      setSystemPrompt(finalPrompt)
      setInitialSystemPrompt(basePrompt) // Initial data is always the original data
      setIsInitialized(true)
    }
  }, [agentData?.id, mode, isInitialized, cachedData])

  // Check if data has been modified
  const hasChanges = useCallback(() => {
    return systemPrompt !== initialSystemPrompt
  }, [systemPrompt, initialSystemPrompt])

  // Notify parent component when data changes
  useEffect(() => {
    if (isInitialized && onDataChange) {
      const changes = hasChanges()
      onDataChange('prompt', { systemPrompt }, changes)
    }
  }, [systemPrompt, hasChanges, isInitialized, onDataChange])

  // Toggle edit/preview mode
  const handleTogglePreview = useCallback(() => {
    setShowPreview(prev => !prev)
  }, [])

  // Handle content change
  const handleContentChange = useCallback((value: string) => {
    setSystemPrompt(value)
    // When content changes, clear previous errors and warnings
    if (optimizationError) {
      setOptimizationError(null)
    }
    if (optimizationWarnings.length > 0) {
      setOptimizationWarnings([])
    }
  }, [optimizationError, optimizationWarnings.length])

  // AI optimization feature
  const handleAIOptimize = useCallback(async () => {
    // Clear previous errors and warnings
    setOptimizationError(null)
    setOptimizationWarnings([])

    // Validate that input is not empty
    const trimmedPrompt = systemPrompt.trim()
    if (!trimmedPrompt) {
      setOptimizationError('System prompt cannot be empty.')
      return
    }

    setIsOptimizing(true)
    try {

      // Call the main process systemPromptLlmWriter via IPC
      const ipcResult = await llmApi.improveSystemPrompt(trimmedPrompt)

      if (ipcResult.success) {
        const result = ipcResult.data

        if (result.success && result.improvedPrompt) {
          setSystemPrompt(result.improvedPrompt)
          if (result.warnings && result.warnings.length > 0) {
            setOptimizationWarnings(result.warnings)
          }
        } else {
          const errorMessages = result.errors || ['AI optimization failed with unknown error']
          setOptimizationError(errorMessages.join('; '))
        }
      } else {
        throw new Error(ipcResult.error || 'AI optimization failed')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred during AI optimization'
      setOptimizationError(`AI optimization failed: ${errorMessage}`)
    } finally {
      setIsOptimizing(false)
    }
  }, [systemPrompt])

  return (
    <div className="agent-tab flex h-full min-h-0 flex-col">
      {/* Tab Header */}
      <div className="flex items-center justify-between p-2 min-h-[44px] shrink-0 bg-surface-primary border-b border-black/[0.08]">
        <div className="flex items-center shrink-0">
          <div
            className={`relative px-3 py-1.5 rounded-md bg-transparent text-content-secondary font-medium text-[13px] cursor-pointer select-none transition-all hover:bg-black/5 hover:text-content ${!showPreview ? 'bg-black/5 text-content' : ''}`}
            onClick={() => !showPreview || handleTogglePreview()}
          >
            Contents
          </div>
          <div
            className={`relative px-3 py-1.5 rounded-md bg-transparent text-content-secondary font-medium text-[13px] cursor-pointer select-none transition-all hover:bg-black/5 hover:text-content ${showPreview ? 'bg-black/5 text-content' : ''}`}
            onClick={() => showPreview || handleTogglePreview()}
          >
            Preview
          </div>
        </div>
        <div className="flex items-center shrink-0">
          {!isEditDisabled && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={handleAIOptimize}
              disabled={isOptimizing || !systemPrompt.trim()}
              title={!systemPrompt.trim() ? 'Enter a prompt first' : 'Polish prompt'}
            >
              {isOptimizing
                ? <Loader2 size={14} className="animate-spin" />
                : <Sparkles size={14} strokeWidth={1.75} />}
              {isOptimizing ? 'Polishing...' : 'Polish with AI'}
            </Button>
          )}
        </div>
      </div>

      {/* Tab Body */}
      <div className="flex flex-1 min-h-0 flex-col p-2">
        <div className="min-h-0 flex-1">
          <MarkdownEditor
            value={systemPrompt}
            onChange={handleContentChange}
            showPreview={showPreview}
            onTogglePreview={handleTogglePreview}
            readOnly={isEditDisabled}
          />
        </div>
        {isEditDisabled && (
          <div className="flex shrink-0 items-center gap-2 mt-2 px-3 py-2 rounded-md text-[13px] bg-[#FEF3C7] border-l-2 border-status-warning text-amber-800">
            <Lock size={14} className="shrink-0" />
            <span>
              {readOnly
                ? "Library Agent's system prompt cannot be modified."
                : "This agent is locked; its system prompt cannot be modified."}
            </span>
          </div>
        )}
      </div>

    </div>
  )
}

export default AgentSystemPromptTab