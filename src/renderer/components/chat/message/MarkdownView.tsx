/**
 * MarkdownView — 纯净的 Markdown 渲染器。
 *
 * 设计原则：
 * - 无内部 state、无 effect、无 RAF、无打字机；输入即输出。
 * - 由调用方决定何时 memo / 何时刷新（组件本身已 React.memo 包裹）。
 * - 文本预处理（流式期间补齐数字列表等）放在外部，避免在组件中重复跑正则。
 */

import React, { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import MermaidDiagram from './MermaidDiagram';
import CodeBlockCopyButton from './CodeBlockCopyButton';
import { workspaceApi } from '@/ipc/workspace';

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

const CODE_BLOCK_STYLE: React.CSSProperties = {
  margin: 0,
  borderRadius: '0 0 0.375rem 0.375rem',
  fontSize: '0.875rem',
  display: 'block',
  minWidth: 'fit-content',
};

const CODE_TAG_PROPS = {
  style: {
    whiteSpace: 'pre' as const,
    wordWrap: 'normal' as const,
    overflowWrap: 'normal' as const,
  },
};

/**
 * 编码 markdown link 中 URL 部分的空格，避免 ReactMarkdown 无法解析 `[t](path with space)`。
 */
function encodeMarkdownLinkSpaces(text: string): string {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
    if (!url.includes(' ')) return match;
    return `[${linkText}](${url.replace(/ /g, '%20')})`;
  });
}


// react-markdown v10：code 回调的 fenced 块带 language-xxx className，inline 无；pre 仅透传。
const markdownComponents: Components = {
  // 代码块 + 内联代码统一在 code 回调处理：fenced 带 language-xxx className，inline 无。
  code({ className, children }) {
    const match = /language-(\w+)/.exec(className || '');
    if (!match) {
      return <code className="inline-code">{children}</code>;
    }

    const language = match[1];
    const content = String(children ?? '').replace(/\n$/, '');

    if (language === 'mermaid') {
      return <MermaidDiagram definition={content} />;
    }

    return (
      <div className="code-block-wrapper">
        <div className="code-block-header">
          <span className="code-block-language">{`</> ${language}`}</span>
          <CodeBlockCopyButton code={content} />
        </div>
        <SyntaxHighlighter
          PreTag="div"
          language={language}
          style={oneDark}
          customStyle={CODE_BLOCK_STYLE}
          wrapLongLines={false}
          codeTagProps={CODE_TAG_PROPS}
        >
          {content}
        </SyntaxHighlighter>
      </div>
    );
  },

  // pre — 代码块已在 code 回调自带 wrapper，这里仅做透传。
  pre({ children }) {
    return <div className="pre-wrapper">{children}</div>;
  },

  // 表格 — 横向滚动 wrapper。
  table({ children, ...rest }) {
    return (
      <div className="table-wrapper">
        <table {...rest}>{children}</table>
      </div>
    );
  },
  a({ href, children, ...rest }) {
    const isLocalPath = href ? /^\/[^/]/.test(href) || /^[A-Za-z]:[\\/]/.test(href) : false;
    if (href && isLocalPath) {
      return (
        <a
          {...rest}
          href="#"
          className="text-blue-600 underline hover:text-blue-700 cursor-pointer"
          onClick={(e) => {
            e.preventDefault();
            workspaceApi.openPath(decodeURIComponent(href));
          }}
        >
          {children}
        </a>
      );
    }
    return (
      <a
        {...rest}
        href={href}
        className="text-blue-600 underline hover:text-blue-700"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  },
};

export interface MarkdownViewProps {
  text: string;
  className?: string;
}

/**
 * 渲染 Markdown 文本。输入空字符串时不渲染任何 DOM。
 */
const MarkdownViewInner: React.FC<MarkdownViewProps> = ({ text, className }) => {
  const encoded = useMemo(() => encodeMarkdownLinkSpaces(text), [text]);

  if (encoded.trim().length === 0) {
    return null;
  }

  return (
    <div
      data-dbg="markdown-view"
      className={`markdown-view markdown-body relative min-w-0 w-full max-w-full wrap-break-word transition-[min-height] duration-200 ease-out contain-[layout_style] [&_strong]:font-bold [&_em]:italic [&.markdown-body_*]:transition-opacity [&.markdown-body_*]:duration-100 [&_.code-block-wrapper]:transition-opacity [&_.code-block-wrapper]:duration-100  ${className ?? ''}`.trim()}
    >
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={markdownComponents}>
        {encoded}
      </ReactMarkdown>
    </div>
  );
};

export const MarkdownView = React.memo(MarkdownViewInner);
MarkdownView.displayName = 'MarkdownView';
