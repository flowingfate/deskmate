'use client'

/**
 * SkillsAddButton —— 「从设备添加/更新技能」下拉按钮。
 *
 * 自持下拉：`<DropdownMenu>` 直接包裹自己的触发器（`asChild`），开合状态全部内聚在
 * Radix 内部，不经页面外部菜单注册表。
 *
 * 菜单两个动作：
 * - `Add from Device`：调共享 hook（不带 mode）→ main 弹一个原生对话框，用户在同一个
 *   框里选 folder / .zip / .skill（mac/Linux 单对话框即可，Windows 因原生限制先弹类型
 *   选择）。
 * - `Update from Device...`：先弹一次性说明确认框（AlertDialog），告知用户「所选包
 *   必须与某个已装 skill 同名才会被接受，否则拒绝」；确认后才唤起同一套原生文件选择
 *   对话框。目标 skill 不再由某一行的下拉菜单预先指定——由所选包自身 `SKILL.md` 的
 *   name 自动判定并在 profile skill 库里查找匹配项。此前散落在每个 skill 行
 *   `SkillDropdownMenu` 里的 per-item「Update from Device」入口已移除，统一收敛到此处。
 *
 * 触发器由 `children` 提供（标题栏 icon 按钮 / 空态 outline 按钮各自传入），组件只负责
 * 下拉菜单、确认框与动作分发。
 */

import React, { useRef, useState } from 'react'
import { Plus, RefreshCw, ScanSearch } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/shadcn/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shadcn/alert-dialog'
import { useAddSkillFromDevice } from './useAddSkillFromDevice'
import { useUpdateSkillFromDevice } from './useUpdateSkillFromDevice'
import { ImportForeignAgentSkillsDialog } from './foreign-agent-import/ImportForeignAgentSkillsDialog'

interface SkillsAddButtonProps {
  children: React.ReactNode
  align?: 'start' | 'center' | 'end'
}

const SkillsAddButton: React.FC<SkillsAddButtonProps> = ({ children, align = 'end' }) => {
  const addSkillFromDevice = useAddSkillFromDevice()
  const updateSkillFromDevice = useUpdateSkillFromDevice()
  const [showUpdateConfirm, setShowUpdateConfirm] = useState(false)
  const [showForeignImportDialog, setShowForeignImportDialog] = useState(false)
  const chooseFileActionRef = useRef<HTMLButtonElement>(null)

  const confirmUpdate = () => {
    setShowUpdateConfirm(false)
    void updateSkillFromDevice()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align={align} sideOffset={4}>
          <DropdownMenuItem onClick={() => void addSkillFromDevice()}>
            <Plus size={14} strokeWidth={1.5} />
            <span>Add from Device</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowForeignImportDialog(true)}>
            <ScanSearch size={14} strokeWidth={1.5} />
            <span>Add from Other Agents...</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowUpdateConfirm(true)}>
            <RefreshCw size={12} strokeWidth={1.5} />
            <span>Update from Device</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ImportForeignAgentSkillsDialog
        open={showForeignImportDialog}
        onOpenChange={setShowForeignImportDialog}
      />

      <AlertDialog open={showUpdateConfirm} onOpenChange={setShowUpdateConfirm}>
        <AlertDialogContent initialFocusRef={chooseFileActionRef}>
          <AlertDialogHeader>
            <AlertDialogTitle>Update a skill from device</AlertDialogTitle>
            <AlertDialogDescription>
              Select a package (folder, .zip, or .skill) whose name matches an already
              installed skill — it will overwrite that skill in place. Packages that
              don't match any installed skill name will be rejected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction ref={chooseFileActionRef} onClick={confirmUpdate}>Choose File...</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default SkillsAddButton

