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
import './MarkdownView.scss';

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


// react-markdown 的 component 类型 — code/pre 节点上 className 是 `language-xxx`。
const markdownComponents: Components = {
  // 内联代码 — react-markdown 先回调 pre 再回调 code；代码块走 pre 分支，这里只剩 inline。
  code({ children }) {
    return <code className="inline-code">{children}</code>;
  },

  // 代码块 — children 一定包含一个 <code className="language-xxx"> 节点。
  pre({ children }) {
    const codeChild = React.Children.toArray(children).find(
      (child): child is React.ReactElement<{ className?: string; children?: React.ReactNode }> =>
        React.isValidElement(child) && child.type === 'code',
    );

    if (!codeChild) {
      return <div className="pre-wrapper">{children}</div>;
    }

    const { className, children: codeContent } = codeChild.props;
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : 'text';
    const content = String(codeContent ?? '').replace(/\n$/, '');

    if (language === 'mermaid') {
      return <MermaidDiagram definition={content} />;
    }

    return (
      <div className="code-block-wrapper">
        <div className="code-block-header">
          <span className="code-block-language">
            {language !== 'text' ? `</> ${language.toUpperCase()}` : ''}
          </span>
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
          className="markdown-link markdown-link-local"
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
        className="markdown-link"
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
    <div className={`markdown-view markdown-body ${className ?? ''}`.trim()}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={markdownComponents}>
        {encoded}
      </ReactMarkdown>
    </div>
  );
};

export const MarkdownView = React.memo(MarkdownViewInner);
MarkdownView.displayName = 'MarkdownView';
