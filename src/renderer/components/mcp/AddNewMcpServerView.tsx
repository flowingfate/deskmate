'use client'

import React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Cable, CornerUpLeft } from 'lucide-react'
import { Button } from '@/shadcn/button'
import SettingsLayout from '../settings/SettingsLayout'
import AddNewMcpServerViewContent from './AddNewMcpServerViewContent'

const AddNewMcpServerView: React.FC = () => {
  const navigate = useNavigate()
  const { editServerName } = useParams<{ editServerName?: string }>()

  // 编辑态与新建态共用同一视图，仅标题不同
  const title = editServerName ? 'Edit Server' : 'Add New Server'

  return (
    <SettingsLayout
      icon={<Cable size={18} />}
      title={title}
      actions={
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate('/settings/mcp')}
          title="Back"
        >
          <CornerUpLeft size={14} />
        </Button>
      }
    >
      <AddNewMcpServerViewContent editServerName={editServerName} />
    </SettingsLayout>
  )
}

export default AddNewMcpServerView
