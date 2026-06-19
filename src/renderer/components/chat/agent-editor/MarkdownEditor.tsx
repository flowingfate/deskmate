import React, { useRef, useEffect } from 'react'
import { Textarea } from '@/shadcn/textarea'

import { MarkdownEditorProps } from './types'

const SYSTEM_PROMPT_TIPS = [
  'Enter your system prompt here...',
  '',
  'You can use Markdown formatting:',
  '# Headers',
  '**Bold text**',
  '*Italic text*',
  '- List items',
  '',
  'Example:',
  'You are a helpful AI assistant specialized in [your domain].',
  '',
  '## Guidelines',
  '- Be professional and helpful',
  '- Provide accurate information',
  '- Ask clarifying questions when needed',
  '',
  '## Specific Instructions',
  '[Add your specific instructions here...]'
] as const

const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  value,
  onChange,
  showPreview,
  onTogglePreview,
  readOnly = false
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Remove auto-height adjustment logic; let the textarea keep a fixed height with scrollbars

  // Simple Markdown rendering function
  const renderMarkdown = (text: string): string => {
    // Split by line first
    const lines = text.split('\n')
    const result: string[] = []
    let inList = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()

      if (!line) {
        // Handle empty lines
        if (inList) {
          result.push('</ul>')
          inList = false
        }
        result.push('<br>')
        continue
      }

      // Headers
      if (line.startsWith('### ')) {
        if (inList) {
          result.push('</ul>')
          inList = false
        }
        result.push(`<h3 class="text-lg font-semibold text-content-heading mt-0 mb-1">${line.substring(4)}</h3>`)
      } else if (line.startsWith('## ')) {
        if (inList) {
          result.push('</ul>')
          inList = false
        }
        result.push(`<h2 class="text-xl font-semibold text-content-strong mt-0 mb-2 pb-1 border-b border-border">${line.substring(3)}</h2>`)
      } else if (line.startsWith('# ')) {
        if (inList) {
          result.push('</ul>')
          inList = false
        }
        result.push(`<h1 class="text-2xl font-bold text-content-strong mt-0 mb-2 pb-2 border-b-2 border-border">${line.substring(2)}</h1>`)
      } else if (line.startsWith('- ')) {
        // List items
        if (!inList) {
          result.push('<ul class="mt-0 mb-2 pl-6 list-disc">')
          inList = true
        }
        let listContent = line.substring(2)
        // Apply inline formatting
        listContent = listContent
          .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-content-strong">$1</strong>')
          .replace(/\*(.*?)\*/g, '<em class="italic text-gray-600">$1</em>')
        result.push(`<li class="my-1 text-content-heading first:mt-0 last:mb-0">${listContent}</li>`)
      } else {
        // Regular paragraphs
        if (inList) {
          result.push('</ul>')
          inList = false
        }
        let content = line
        // Apply inline formatting
        content = content
          .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-content-strong">$1</strong>')
          .replace(/\*(.*?)\*/g, '<em class="italic text-gray-600">$1</em>')
        result.push(`<p class="mt-0 mb-2 text-content-heading last:mb-0">${content}</p>`)
      }
    }

    // Close any open list
    if (inList) {
      result.push('</ul>')
    }

    return result.join('')
  }

  return (
    <div className="flex flex-col h-full bg-white">

      {/* Content Area */}
      <div className="flex-1 overflow-hidden relative">
        {showPreview ? (
          /* Preview Mode */
          <div
            className="h-full p-2 overflow-y-auto leading-[1.6] text-content-heading"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(value)
            }}
          />
        ) : (
          /* Edit Mode */
          <>
            {!value && !readOnly && (
              <div className="absolute inset-0 right-0 bottom-auto p-2 text-content-tertiary text-sm leading-[1.6] pointer-events-none whitespace-pre-wrap" aria-hidden="true">
                {SYSTEM_PROMPT_TIPS.map((line, index) => (
                  <span
                    key={`${index}-${line}`}
                    className="block"
                  >
                    {line || '\u00A0'}
                  </span>
                ))}
              </div>
            )}
            <Textarea
              ref={textareaRef}
              className="w-full h-full p-6 border-none outline-none resize-none text-sm leading-[1.6] text-content-heading bg-white box-border overflow-y-auto"
              value={value}
              onChange={(e) => !readOnly && onChange(e.target.value)}
              readOnly={readOnly}
              style={readOnly ? { cursor: 'not-allowed', backgroundColor: '#f5f5f5' } : undefined}
            />
          </>
        )}
      </div>

      </div>
  )
}

export default MarkdownEditor