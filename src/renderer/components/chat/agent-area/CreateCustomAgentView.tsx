import React, { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/shadcn/button'
import AgentPane from '@/pages/layout/agent/agent-pane'
import CreateCustomAgentViewContent from './CreateCustomAgentViewContent'

const CreateCustomAgentView: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (location.state?.refresh) {
      setRefreshKey(prev => prev + 1)
    }
  }, [location.state?.refresh])

  return (
    <AgentPane className="h-full w-full" key={refreshKey}>
      <AgentPane.Head>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => navigate('/agent/creation')}
            aria-label="Back"
          >
            <ArrowLeft size={20} strokeWidth={1.5} />
          </Button>
          <span className="text-sm font-medium">Create Custom Agent</span>
        </div>
      </AgentPane.Head>

      <AgentPane.Body className="overflow-y-auto bg-white">
        <CreateCustomAgentViewContent key={`content-${refreshKey}`} />
      </AgentPane.Body>
    </AgentPane>
  )
}

export default CreateCustomAgentView
