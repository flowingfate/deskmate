// AddNewMcpServerView 的全部表单逻辑：状态、校验、AI 校验(Verify)、增/改提交。
// 视图层只消费这个 hook 返回的状态与回调，不直接碰 McpOps / llmApi。

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useMcpRuntimeServers,
  getMcpRuntimeServerByName,
  refreshMcpRuntime,
} from '@/states/mcpRuntime.atom'
import { useToast } from '../../ui/ToastProvider'
import { McpOps } from '../../../lib/mcp/mcpOps'
import { DeskmateAppMCPServerConfig } from '../../../types/mcpTypes'
import { llmApi } from '@/ipc/llm'
import type { McpConfigFormatterResponse } from '@shared/types/llmTypes'
import {
  type McpTransport,
  cleanInvisibleCharacters,
  generateTimestampServerName,
  incrementPatchVersion,
  serverToConfigJson,
} from './mcpServerConfig'
import { validateServerConfig, validateServerName } from './mcpServerValidation'

interface ValidationErrors {
  serverName?: string
  serverConfig?: string
}

export interface AddMcpServerForm {
  isEditMode: boolean
  /** 表单字段 */
  serverName: string
  serverType: McpTransport
  serverConfig: string
  /** 状态 */
  isLoading: boolean
  isVerifying: boolean
  isVerified: boolean
  verifyError: string | null
  verifyResult: string | null
  validationErrors: ValidationErrors
  hasValidationErrors: boolean
  /** 提交成功后的"应用到 Agents"弹窗 */
  applyDialogOpen: boolean
  applyMcpServerName: string
  /** 回调 */
  onConfigChange: (value: string) => void
  onServerNameChange: (value: string) => void
  onServerTypeChange: (type: McpTransport) => void
  onVerify: () => void
  onSubmit: () => void
  onCancel: () => void
  onApplyDialogOpenChange: (open: boolean) => void
}

export function useAddMcpServerForm(editServerName?: string): AddMcpServerForm {
  const navigate = useNavigate()
  const servers = useMcpRuntimeServers()
  const { showError, showSuccess, showWarning } = useToast()

  const isEditMode = !!editServerName
  const editingServer = isEditMode ? getMcpRuntimeServerByName(editServerName!) : null

  const [serverName, setServerName] = useState('')
  const [serverType, setServerType] = useState<McpTransport>('stdio')
  const [serverConfig, setServerConfig] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const [isVerified, setIsVerified] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<string | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  const [applyDialogOpen, setApplyDialogOpen] = useState(false)
  const [applyMcpServerName, setApplyMcpServerName] = useState('')

  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({})

  // 查重时排除当前编辑中的 server 名
  const otherServerNames = servers
    .map((s) => s.name)
    .filter((name) => (isEditMode ? name !== editServerName : true))

  // 进入编辑态加载既有配置；非编辑态重置表单。同时清空校验/Verify 状态。
  useEffect(() => {
    if (isEditMode && editingServer) {
      setServerName(editingServer.name)
      setServerType(editingServer.transport)
      setServerConfig(serverToConfigJson(editingServer))
    } else if (isEditMode && !editingServer) {
      // 编辑态但 runtime 里还没有该 server：强制刷新一次，待数据回填后 effect 会重跑
      refreshMcpRuntime().catch(() => {})
    } else {
      setServerName('')
      setServerType('stdio')
      setServerConfig('')
    }
    setValidationErrors({})
    setIsVerified(false)
    setIsVerifying(false)
    setVerifyResult(null)
    setVerifyError(null)
    // editingServer 由 editServerName 派生，无需单列依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode, editServerName])

  const onConfigChange = useCallback(
    (value: string) => {
      setServerConfig(value)
      // 配置改动后需要重新 Verify
      if (isVerified) {
        setIsVerified(false)
        setVerifyResult(null)
        setVerifyError(null)
      }
    },
    [isVerified],
  )

  const onServerNameChange = useCallback(
    (value: string) => {
      setServerName(value)
      // Add 态改名后保留 isVerified（否则字段会因条件渲染消失），仅清空 Verify 提示
      if (isVerified && !isEditMode) {
        setVerifyResult(null)
        setVerifyError(null)
      }
    },
    [isVerified, isEditMode],
  )

  const onServerTypeChange = useCallback(
    (type: McpTransport) => {
      setServerType(type)
      if (isVerified) {
        // 同样保留 isVerified，仅清空提示
        setVerifyResult(null)
        setVerifyError(null)
      }
      // 用新 transport 重新校验当前配置
      const configError = serverConfig.trim() ? validateServerConfig(serverConfig, type) : undefined
      setValidationErrors((prev) => ({ ...prev, serverConfig: configError ?? undefined }))
    },
    [serverConfig, isVerified],
  )

  const onVerify = useCallback(async () => {
    if (!serverConfig.trim()) {
      setVerifyError('Please fill in Server Config')
      setVerifyResult(null)
      setIsVerified(false)
      return
    }

    try {
      setIsVerifying(true)
      setVerifyError(null)
      setVerifyResult(null)

      const ipcResult = await llmApi.formatMcpConfig(serverConfig)

      let llmResponse: McpConfigFormatterResponse
      if (ipcResult.success) {
        llmResponse = ipcResult.data
      } else {
        // AI 格式化失败时退回基础 JSON 解析
        try {
          llmResponse = {
            success: true,
            config: JSON.parse(serverConfig),
            transportType: serverType,
            serverName: serverName || generateTimestampServerName(),
            warnings: [`AI formatting failed (${ipcResult.error}), using basic validation`],
          }
        } catch (parseError) {
          llmResponse = {
            success: false,
            errors: [
              `Configuration parsing failed: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
            ],
          }
        }
      }

      if (!llmResponse.success) {
        const errorMessage =
          llmResponse.errors?.join(', ') || llmResponse.warnings?.join(', ') || 'Formatting failed'
        setVerifyError(`Configuration validation failed: ${errorMessage}`)
        setVerifyResult(null)
        setIsVerified(false)
        return
      }

      // 回填 AI 格式化后的配置
      if (llmResponse.config) {
        let configToUse = llmResponse.config
        // 兜底：config 被嵌套在 serverName 下时取出
        if (llmResponse.serverName && llmResponse.config[llmResponse.serverName]) {
          configToUse = llmResponse.config[llmResponse.serverName]
        }
        setServerConfig(JSON.stringify(configToUse, null, 2))
      }

      if (llmResponse.transportType) {
        setServerType(llmResponse.transportType as McpTransport)
      }

      // 仅 Add 态回填名称；Edit 态名称固定不变
      if (!isEditMode) {
        const name = llmResponse.serverName?.trim() || generateTimestampServerName()
        setServerName(name)
      }

      setVerifyResult('Configuration validation successful')
      setIsVerified(true)
      setValidationErrors({})
    } catch (error) {
      setVerifyError(`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      setVerifyResult(null)
      setIsVerified(false)
    } finally {
      setIsVerifying(false)
    }
  }, [serverConfig, isEditMode, serverType, serverName])

  const onSubmit = useCallback(async () => {
    try {
      setIsLoading(true)

      if (!isVerified) {
        showWarning('Please verify the configuration first')
        return
      }

      // Add 态校验名称+配置；Edit 态名称固定，仅校验配置
      const nameError = isEditMode ? null : validateServerName(serverName, otherServerNames)
      const configError = validateServerConfig(serverConfig, serverType)
      if (nameError || configError) {
        setValidationErrors({
          serverName: nameError || undefined,
          serverConfig: configError || undefined,
        })
        return
      }

      if (!serverName.trim() || !serverConfig.trim()) {
        showWarning('Please provide server name and configuration')
        return
      }

      const parsedConfig = JSON.parse(cleanInvisibleCharacters(serverConfig))

      // Edit 态 patch 版本自增；Add 态从 1.0.0 起
      const currentEditingServer = isEditMode ? getMcpRuntimeServerByName(editServerName!) : null
      const version =
        isEditMode && currentEditingServer
          ? incrementPatchVersion(currentEditingServer.version || '1.0.0')
          : '1.0.0'

      const mcpServerConfig: DeskmateAppMCPServerConfig = {
        name: serverName,
        transport: serverType,
        in_use: true, // 添加/更新后立即连接
        url: parsedConfig.url || '',
        command: parsedConfig.command || '',
        args: parsedConfig.args || [],
        env: parsedConfig.env || {},
        version,
      }

      const result = isEditMode
        ? await McpOps.update(editServerName!, mcpServerConfig)
        : await McpOps.add(mcpServerConfig)

      if (!result.success) {
        showError(`Failed to ${isEditMode ? 'update' : 'add'} server: ${result.error || 'Unknown error'}`)
        return
      }

      // 等后端处理完成后刷新 runtime（更新耗时略长）
      setTimeout(() => {
        refreshMcpRuntime().catch(() => {})
      }, isEditMode ? 200 : 100)

      showSuccess(
        `Server "${serverName}" ${isEditMode ? 'updated' : 'added'} successfully! ${isEditMode ? 'Reconnecting...' : 'Connecting...'}`,
      )

      if (isEditMode) {
        navigate('/settings/mcp')
      } else {
        // 新增成功后先弹"应用到 Agents"
        setApplyMcpServerName(serverName)
        setApplyDialogOpen(true)
      }
    } catch (err) {
      showError(
        `Failed to ${isEditMode ? 'update' : 'add'} server: ${err instanceof Error ? err.message : 'Unknown error'}`,
      )
    } finally {
      setIsLoading(false)
    }
  }, [
    serverName,
    serverConfig,
    serverType,
    otherServerNames,
    showWarning,
    showSuccess,
    showError,
    isEditMode,
    editServerName,
    navigate,
    isVerified,
  ])

  const onCancel = useCallback(() => navigate('/settings/mcp'), [navigate])

  const onApplyDialogOpenChange = useCallback(
    (open: boolean) => {
      setApplyDialogOpen(open)
      if (!open) navigate('/settings/mcp')
    },
    [navigate],
  )

  return {
    isEditMode,
    serverName,
    serverType,
    serverConfig,
    isLoading,
    isVerifying,
    isVerified,
    verifyError,
    verifyResult,
    validationErrors,
    hasValidationErrors: !!(validationErrors.serverName || validationErrors.serverConfig),
    applyDialogOpen,
    applyMcpServerName,
    onConfigChange,
    onServerNameChange,
    onServerTypeChange,
    onVerify,
    onSubmit,
    onCancel,
    onApplyDialogOpenChange,
  }
}
