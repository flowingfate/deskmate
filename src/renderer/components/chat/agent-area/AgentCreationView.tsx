import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Plus, Sparkles, ChevronRight } from 'lucide-react'
import AgentPane from '@/pages/layout/agent/agent-pane'

const AgentCreationView: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (location.state?.refresh) {
      setRefreshKey(prev => prev + 1)
    }
  }, [location.state?.refresh])

  const handleCustomAgentClick = useCallback(() => {
    navigate('/agent/creation/custom-agent')
  }, [navigate])

  return (
    <AgentPane className="h-full w-full" key={refreshKey}>
      <AgentPane.Head>
        <div className="flex items-center gap-2">
          <Plus size={20} strokeWidth={1.5} />
          <span className="text-sm font-medium">New Agent</span>
        </div>
      </AgentPane.Head>

      <AgentPane.Body className="flex items-center justify-center overflow-y-auto p-12">
        <div className="w-full max-w-140 text-center" key={`content-${refreshKey}`}>
          <h2 className="mb-2 text-[28px] font-bold leading-tight text-gray-800">Create a New Agent</h2>
          <p className="mb-10 text-base text-gray-500">Build a personalized agent</p>

          <div className="flex flex-col gap-4">
            <OptionCard
              icon={<Sparkles size={32} strokeWidth={1.5} />}
              title="Custom Agent"
              description="Create a personalized agent with custom name, emoji, system prompt, and MCP servers configuration."
              onClick={handleCustomAgentClick}
            />
          </div>
        </div>
      </AgentPane.Body>
    </AgentPane>
  )
}

function OptionCard({ icon, title, description, onClick }: {
  icon: React.ReactNode
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-4 rounded-2xl border border-black/10 bg-white p-6 text-left transition-all hover:-translate-y-0.5 hover:border-black/15 hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] active:translate-y-0 active:shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
    >
      <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-gray-50 to-gray-100 text-gray-700 transition-colors group-hover:from-gray-100 group-hover:to-gray-200 group-hover:text-[#272320]">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="mb-1 text-base font-semibold text-gray-800">{title}</h3>
        <p className="text-sm leading-relaxed text-gray-500">{description}</p>
      </div>
      <ChevronRight size={20} className="shrink-0 text-gray-400 transition-all group-hover:translate-x-1 group-hover:text-gray-500" />
    </button>
  )
}

export default AgentCreationView
