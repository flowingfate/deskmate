/**
 * GreetingMessage — 渲染欢迎消息与可选 say-hi 动作项。
 *
 * 内容来自 `CurrentSessionGreeting` 全局原子，由 SayHi 模块预解析为
 * markdown body + 动作组。这里只装配 MarkdownView 和 SayHiActionItems。
 */

import React from 'react';
import { CurrentSessionGreeting } from '@/lib/chat/agentSessionCacheManager';
import { MarkdownView } from './MarkdownView';
import SayHiActionItems, { parseSayHiContent } from './SayHiActionItems';

export const GreetingMessage: React.FC = () => {
  const greetingContent = CurrentSessionGreeting.use();
  if (!greetingContent) return null;

  const { markdownBody, actionItemGroups } = parseSayHiContent(greetingContent);

  return (
    <div className="message assistant-message">
      <div className="message-content markdown-body">
        <div className="assistant-message-flow min-w-0 w-full max-w-full">
          <MarkdownView text={markdownBody} />
          {actionItemGroups.length > 0 && <SayHiActionItems groups={actionItemGroups} />}
        </div>
      </div>
    </div>
  );
};
