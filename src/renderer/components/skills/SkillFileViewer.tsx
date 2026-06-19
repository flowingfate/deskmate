'use client'

import React, { useState } from 'react'
import { ArrowLeft, Copy, Check, FileText } from 'lucide-react'
import { Button } from '@/shadcn/button'
import { Badge } from '@/shadcn/badge'
import { ScrollArea } from '@/shadcn/scroll-area'
import { MarkdownView } from '../chat/message/MarkdownView'
import { SkillConfig } from '../../lib/userData/types'
import { FileInfo } from './SkillViewPanel'
import { FrontMatter, parseFrontMatter } from '../../lib/utils/yamlFrontMatter'

interface SkillFileViewerProps {
  skill: SkillConfig
  fileInfo: FileInfo | null
  onBack: () => void
}

// Front matter — 紧凑的 key/value 表(Tailwind)
const FrontMatterTable: React.FC<{ frontMatter: FrontMatter }> = ({ frontMatter }) => {
  const entries = Object.entries(frontMatter)
  if (entries.length === 0) return null

  return (
    <div className="mb-5 overflow-hidden rounded-md border border-sc-border">
      <table className="w-full text-sm">
        <tbody>
          {entries.map(([key, value], i) => (
            <tr key={key} className={i > 0 ? 'border-t border-sc-border' : undefined}>
              <td className="w-32 whitespace-nowrap bg-sc-muted/40 px-3 py-2 align-top font-medium text-sc-muted-foreground">
                {key}
              </td>
              <td className="break-words px-3 py-2 text-sc-foreground">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// 代码 / 纯文本块 — 浅色边框卡片,风格与 ToolDetailView 的 schema pre 一致
const CodeBlock: React.FC<{ code: string; language: string }> = ({ code, language }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-sc-border">
      <div className="flex items-center justify-between border-b border-sc-border bg-sc-muted/40 px-3 py-1.5">
        <span className="text-xs font-medium tracking-wide text-sc-muted-foreground">{language}</span>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={handleCopy}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="overflow-auto bg-sc-muted/20 p-3 font-mono text-xs leading-relaxed text-sc-foreground">
        <code>{code}</code>
      </pre>
    </div>
  )
}

// Display name for the language badge / code header
const getLanguageDisplayName = (extension: string): string => {
  const languageMap: Record<string, string> = {
    'md': 'Markdown',
    'js': 'JavaScript',
    'jsx': 'JavaScript (JSX)',
    'ts': 'TypeScript',
    'tsx': 'TypeScript (TSX)',
    'py': 'Python',
    'json': 'JSON',
    'yaml': 'YAML',
    'yml': 'YAML',
    'css': 'CSS',
    'html': 'HTML',
    'xml': 'XML',
    'txt': 'Text'
  }
  return languageMap[extension] || extension.toUpperCase()
}

const CODE_EXTENSIONS: Record<string, true> = {
  js: true, jsx: true, ts: true, tsx: true, py: true, json: true,
  yaml: true, yml: true, css: true, html: true, xml: true,
}

const SkillFileViewer: React.FC<SkillFileViewerProps> = ({
  skill,
  fileInfo,
  onBack
}) => {
  if (!fileInfo) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-sm text-sc-muted-foreground">
        <FileText className="size-10 opacity-40" />
        <span>No file selected</span>
      </div>
    )
  }

  // Render file content
  const renderContent = () => {
    if (!fileInfo.isSupported) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center text-sc-muted-foreground">
          <FileText size={48} strokeWidth={1} className="opacity-40" />
          <span className="text-sm font-medium">This format is not supported for preview</span>
          <span className="text-xs text-sc-muted-foreground/70">
            File type: {fileInfo.extension ? `.${fileInfo.extension}` : 'Unknown'}
          </span>
        </div>
      )
    }

    if (!fileInfo.content) {
      return (
        <div className="flex items-center justify-center py-16 text-sm text-sc-muted-foreground">
          <span>File content is empty</span>
        </div>
      )
    }

    if (fileInfo.extension === 'md') {
      const { frontMatter, content: markdownContent } = parseFrontMatter(fileInfo.content)
      return (
        <div>
          {frontMatter && <FrontMatterTable frontMatter={frontMatter} />}
          <MarkdownView text={markdownContent} />
        </div>
      )
    }

    if (CODE_EXTENSIONS[fileInfo.extension]) {
      return (
        <CodeBlock
          code={fileInfo.content}
          language={getLanguageDisplayName(fileInfo.extension)}
        />
      )
    }

    // Plain text
    return (
      <pre className="overflow-auto whitespace-pre-wrap break-words rounded-md border border-sc-border bg-sc-muted/20 p-3 font-mono text-xs leading-relaxed text-sc-foreground">
        {fileInfo.content}
      </pre>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: file name and back button */}
      <div className="flex shrink-0 items-center gap-2 border-b border-sc-border px-3 py-2.5">
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={onBack}
          title="Back to folder"
        >
          <ArrowLeft size={16} />
        </Button>
        <FileText size={16} className="shrink-0 text-sc-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-sc-foreground">
          {fileInfo.fileName}
        </span>
        <Badge variant="secondary" className="shrink-0 text-xs">
          {getLanguageDisplayName(fileInfo.extension)}
        </Badge>
      </div>

      {/* Content: file content */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4 pb-12">{renderContent()}</div>
      </ScrollArea>
    </div>
  )
}

export default SkillFileViewer
