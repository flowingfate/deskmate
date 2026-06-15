import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/shadcn/button'

interface ImportMcpServerViewHeaderProps {
  onBack?: () => void
}

const ImportMcpServerViewHeader: React.FC<ImportMcpServerViewHeaderProps> = ({
  onBack
}) => {
  const navigate = useNavigate()

  const handleBack = () => {
    if (onBack) {
      onBack()
    } else {
      // Default behavior: navigate back to settings/mcp
      navigate('/settings/mcp')
    }
  }

  return (
    <div className="unified-header">
      <div className="header-title">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBack}
          title="Back"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 11H7.83L13.42 5.41L12 4L4 12L12 20L13.41 18.59L7.83 13H20V11Z" fill="#272320"/>
          </svg>
        </Button>
        <span className="header-name">Import MCP servers</span>
      </div>
      <div className="header-actions">
        {/* Additional action buttons can be added here on the right side */}
      </div>
    </div>
  )
}

export default ImportMcpServerViewHeader