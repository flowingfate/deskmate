'use client'

import React, { useEffect, useRef } from 'react'
import { Terminal, Loader2, Sparkles, AlertCircle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utilities/utils'
import { Button } from '@/shadcn/button'
import { Input } from '@/shadcn/input'
import { Textarea } from '@/shadcn/textarea'
import { Label } from '@/shadcn/label'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/shadcn/select'
import ApplyMcpToAgentsDialog from './ApplyMcpToAgentsDialog'
import { useAddMcpServerForm } from './addServer/useAddMcpServerForm'
import {
  type McpTransport,
  MCP_TRANSPORTS,
  TRANSPORT_LABELS,
} from './addServer/mcpServerConfig'
import { STDIO_EXAMPLE, HTTP_EXAMPLE } from './addServer/mcpServerValidation'

interface AddNewMcpServerViewContentProps {
  editServerName?: string
}

/** 校验状态提示框（error / success 两态） */
const StatusNote: React.FC<{ tone: 'error' | 'success'; children: React.ReactNode }> = ({
  tone,
  children,
}) => (
  <div
    className={cn(
      'flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed',
      tone === 'error'
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-emerald-200 bg-emerald-50 text-emerald-700',
    )}
  >
    {tone === 'error' ? (
      <AlertCircle size={14} className="mt-px shrink-0" />
    ) : (
      <CheckCircle2 size={14} className="mt-px shrink-0" />
    )}
    <span>{children}</span>
  </div>
)

const AddNewMcpServerViewContent: React.FC<AddNewMcpServerViewContentProps> = ({
  editServerName,
}) => {
  const form = useAddMcpServerForm(editServerName)

  const configRef = useRef<HTMLTextAreaElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  // 进入 / 验证完成后把焦点落到当前的主输入框
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!form.isEditMode && form.isVerified) {
        nameRef.current?.focus()
      } else {
        configRef.current?.focus()
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [form.isEditMode, form.isVerified])

  const showFields = form.isEditMode || form.isVerified

  // 未验证的新建态展示两种示例，其余按当前 transport 展示单个示例
  const configPlaceholder =
    !form.isEditMode && !form.isVerified
      ? `Example 1 (Stdio):\n${STDIO_EXAMPLE}\n\nExample 2 (Streamable HTTP):\n${HTTP_EXAMPLE}`
      : form.serverType === 'stdio'
        ? STDIO_EXAMPLE
        : HTTP_EXAMPLE

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-6">
        {/* Server Config */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="mcp-server-config" className="text-sm font-semibold">
              Server Config
            </Label>
            <Button
              size="sm"
              onClick={form.onVerify}
              disabled={form.isVerifying || !form.serverConfig.trim()}
            >
              {form.isVerifying ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Verifying with AI…
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  Verify to Continue
                </>
              )}
            </Button>
          </div>

          <Textarea
            id="mcp-server-config"
            ref={configRef}
            value={form.serverConfig}
            onChange={(e) => form.onConfigChange(e.target.value)}
            placeholder={configPlaceholder}
            spellCheck={false}
            className={cn(
              'min-h-[220px] resize-y font-mono text-[13px] leading-relaxed',
              form.validationErrors.serverConfig && 'border-red-500 focus-visible:ring-red-500',
            )}
          />

          {form.validationErrors.serverConfig && (
            <p className="text-xs text-red-600">{form.validationErrors.serverConfig}</p>
          )}
          {form.verifyError && <StatusNote tone="error">{form.verifyError}</StatusNote>}
          {form.verifyResult && <StatusNote tone="success">{form.verifyResult}</StatusNote>}
        </section>

        {showFields && (
          <>
            {/* Server Type */}
            <section className="flex flex-col gap-2">
              <Label className="text-sm font-semibold">Server Type</Label>
              <Select
                value={form.serverType}
                onValueChange={(value) => form.onServerTypeChange(value as McpTransport)}
                disabled={form.isLoading}
              >
                <SelectTrigger className="w-full">
                  <span className="!flex items-center gap-2">
                    <Terminal size={16} className="text-sc-muted-foreground" />
                    <SelectValue />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {MCP_TRANSPORTS.map((type) => (
                    <SelectItem key={type} value={type}>
                      {TRANSPORT_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </section>

            {/* Server Name */}
            <section className="flex flex-col gap-2">
              <Label htmlFor="mcp-server-name" className="text-sm font-semibold">
                Server Name
              </Label>
              <Input
                id="mcp-server-name"
                ref={nameRef}
                value={form.serverName}
                onChange={(e) => form.onServerNameChange(e.target.value)}
                placeholder="Server Name"
                disabled={form.isEditMode}
                className={cn(
                  form.validationErrors.serverName && 'border-red-500 focus-visible:ring-red-500',
                )}
              />
              {form.validationErrors.serverName && (
                <p className="text-xs text-red-600">{form.validationErrors.serverName}</p>
              )}
            </section>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={form.onCancel}>
                Cancel
              </Button>
              <Button
                onClick={form.onSubmit}
                disabled={
                  form.isLoading ||
                  form.hasValidationErrors ||
                  (!form.isEditMode && !form.isVerified)
                }
              >
                {form.isLoading
                  ? form.isEditMode
                    ? 'Updating…'
                    : 'Adding…'
                  : form.isEditMode
                    ? 'Update Server'
                    : 'Add Server'}
              </Button>
            </div>
          </>
        )}
      </div>

      <ApplyMcpToAgentsDialog
        open={form.applyDialogOpen}
        onOpenChange={form.onApplyDialogOpenChange}
        mcpServerNames={[form.applyMcpServerName]}
      />
    </div>
  )
}

export default AddNewMcpServerViewContent
