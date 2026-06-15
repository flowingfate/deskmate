/**
 * ImportMcpServerView Component
 * MCP server import view - header/content layout
 */

import React from 'react'
import { useNavigate } from 'react-router-dom'
import ImportMcpServerViewHeader from './ImportMcpServerViewHeader'
import ImportMcpServerViewContent from './ImportMcpServerViewContent'

const ImportMcpServerView: React.FC = () => {
  const navigate = useNavigate()

  const handleBack = () => {
    // Navigate back to MCP settings page
    navigate('/settings/mcp')
  }

  const handleImportComplete = (importedCount: number) => {
    // Navigate back to MCP settings page after import completes
    navigate('/settings/mcp')
  }

  return (
    <div className="content-view">
      {/* Header */}
      <ImportMcpServerViewHeader onBack={handleBack} />

      {/* Content */}
      <div className="content-main">
        <div className="content-container">
          <ImportMcpServerViewContent
            onImportComplete={handleImportComplete}
          />
        </div>
      </div>
    </div>
  )
}

export default ImportMcpServerView