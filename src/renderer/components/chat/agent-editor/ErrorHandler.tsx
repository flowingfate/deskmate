import React from 'react'
import { Button } from '@/shadcn/button'


interface ErrorHandlerProps {
  error: string | null
  onDismiss?: () => void
  className?: string
}

const ErrorHandler: React.FC<ErrorHandlerProps> = ({
  error,
  onDismiss,
  className = ''
}) => {
  if (!error) return null

  return (
    <div className={`error-handler ${className}`}>
      <div className="error-content">
        <div className="error-icon">⚠️</div>
        <div className="error-message">{error}</div>
        {onDismiss && (
          <Button
            variant="ghost"
            size="icon"
            className="error-dismiss"
            onClick={onDismiss}
            aria-label="Dismiss error"
          >
            ×
          </Button>
        )}
      </div>

      </div>
  )
}

export default ErrorHandler