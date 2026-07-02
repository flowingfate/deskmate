import React from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from '@/shadcn/button'


interface ErrorHandlerProps {
  error: string | null
  onDismiss?: () => void
  className?: string
}

type ErrorHandlerVariant = 'error' | 'warning' | 'info' | 'success'

const VARIANT_STYLES: Record<ErrorHandlerVariant, { container: string; text: string; dismiss: string }> = {
  error: {
    container: 'border-red-500/80 bg-[#FEE2E2] shadow-[0_2px_8px_rgba(239,68,68,0.1)]',
    text: '',
    dismiss: 'text-red-800 hover:bg-red-500/15 hover:text-red-900',
  },
  warning: {
    container: 'border-status-warning bg-[#FEF3C7] shadow-[0_2px_8px_rgba(251,191,36,0.1)]',
    text: 'text-amber-800',
    dismiss: 'text-amber-800 hover:bg-amber-400/10 hover:text-slate-700',
  },
  info: {
    container: 'border-neutral-500/80 bg-neutral-50/95 shadow-[0_2px_8px_rgba(0,0,0,0.1)]',
    text: 'text-neutral-900',
    dismiss: 'text-neutral-900 hover:bg-neutral-500/15 hover:text-neutral-950',
  },
  success: {
    container: 'border-green-500/80 bg-[#DCFCE7] shadow-[0_2px_8px_rgba(34,197,94,0.1)]',
    text: 'text-green-900',
    dismiss: 'text-green-900 hover:bg-green-500/15 hover:text-green-950',
  },
}

const resolveVariant = (className: string): ErrorHandlerVariant => {
  const tokens = className.split(/\s+/)
  if (tokens.includes('warning')) return 'warning'
  if (tokens.includes('success')) return 'success'
  if (tokens.includes('info')) return 'info'
  return 'error'
}

const ErrorHandler: React.FC<ErrorHandlerProps> = ({
  error,
  onDismiss,
  className = ''
}) => {
  if (!error) return null

  const variant = VARIANT_STYLES[resolveVariant(className)]

  return (
    <div className={`my-4 p-4 rounded-lg border animate-[slideIn_0.2s_ease-out] ${variant.container} ${className}`}>
      <div className="flex items-center gap-3">
        <AlertTriangle className="text-lg shrink-0" size={16} strokeWidth={1.75} />
        <div className={variant.text}>{error}</div>
        {onDismiss && (
          <Button
            variant="ghost"
            size="icon"
            className={`flex items-center justify-center size-6 p-1 rounded-md bg-transparent border-none text-base font-medium cursor-pointer transition-all shrink-0 ${variant.dismiss}`}
            onClick={onDismiss}
            aria-label="Dismiss error"
          >
            <X size={15} />
          </Button>
        )}
      </div>
    </div>
  )
}

export default ErrorHandler