/**
 * pi/prompt.ts 用到的静态/参数化模板字符串。
 *
 * 抽到这里是为了让 prompt.ts 只剩"取数据 + 决定段是否出现"的组合逻辑，
 * 模板本身的修订（措辞、Best Practices 长篇等）不必滚动整个文件。
 */

import { wrapInSystemReminder } from './systemReminderUtils';

/** Identity 段：告诉 LLM 当前 agent 的身份；纯字符串模板。 */
export function identityBlock(agentName: string): string {
  return `\n---\n**Your Identity:**\n- You are **${agentName}**, an AI assistant.\n- When users ask about "${agentName}" or refer to "you", they are asking about you as ${agentName}.\n- Your configured knowledge can include Knowledge Base files. When users ask questions related to "${agentName}", treat all enabled knowledge sources as relevant context.\n---`;
}

/** Knowledge Sources 段:LLM 视角下 KB 用 `knowledge://<path>` URI 引用(不暴露绝对路径)。 */
export function knowledgeBlock(): string {
  return `\n---\n\n**Your Knowledge Sources:**\n- Knowledge Base files are enabled.\n- Reference them via the \`knowledge://<relative_path>\` URI (e.g. \`read knowledge://notes.md\`).\n\n---`;
}


export interface BoundSkillItem {
  name: string;
  description: string;
  version: string;
  filePath: string;
}

/** agent 绑定的 skills 段（含 What/How/Best Practices 长篇说明，含 system-reminder 包裹）。 */
export function boundSkillsBlock(items: BoundSkillItem[]): string {
  const sections: string[] = [];
  sections.push('\n---\n**Skills Instructions:**\n');
  sections.push('\n**What are Skills?**');
  sections.push('Skills are specialized capabilities that extend your abilities for specific tasks. Each skill contains instructions, scripts, and resources to help you complete tasks in a consistent, repeatable way.\n');

  sections.push('\n**How to Use Skills:**');
  sections.push('1. **Progressive Disclosure:** Skills information is loaded dynamically - you receive skill metadata first, then full instructions when relevant');
  sections.push('2. **Skill Selection:** Review available skills and load the ones relevant to the current task');
  sections.push('3. **Follow Instructions:** Each skill provides specific workflows and best practices - follow them carefully');
  sections.push('4. **Combine Skills:** You can use multiple skills together to accomplish complex tasks');
  sections.push('5. **Executable Scripts:** Some skills include code that you can run directly without loading into context\n');

  sections.push('\n**Available Skills for This Agent:**\n');
  if (items.length === 0) {
    sections.push('No valid skills configured for this agent.');
  } else {
    items.forEach((s, i) => {
      sections.push(`${i + 1}. **${s.name}**`);
      sections.push(`   - Description: ${s.description}`);
      sections.push(`   - Version: ${s.version}`);
      sections.push(`   - File Path: \`${s.filePath}\``);
      sections.push('');
    });
  }

  sections.push('\n**Best Practices:**');
  sections.push('- Load skills only when they\'re relevant to the current task');
  sections.push('- Follow the specific instructions and workflows in each skill');
  sections.push('- Use skill-provided scripts for deterministic operations');
  sections.push('- Combine multiple skills when needed for complex workflows');
  sections.push('- Always check skill metadata first before loading full content\n');
  sections.push('---');

  return wrapInSystemReminder(sections.join('\n'));
}

export interface SubAgentItem {
  name: string;
  displayName: string;
  emoji: string;
  description: string;
  capabilities: string[];   // 已格式化的 capability 短语数组
}

/** Sub-agents 段：可用 sub-agent 列表 + `app subagent` 使用指南。 */
export function subAgentsBlock(items: SubAgentItem[]): string {
  const descriptions = items.map((sa) => (
    `### ${sa.emoji} ${sa.displayName} (\`${sa.name}\`)\n**Description:** ${sa.description}\n**Capabilities:** ${sa.capabilities.join(' | ')}`
  )).join('\n\n');

  return `
---
## 🤖 Available Sub-Agents

You have access to the following sub-agents that can handle specialized tasks autonomously.

${descriptions}

### How to Use Sub-Agents

Spawn sub-agents via the \`app\` shell command — sub-agent management lives
under the \`subagent\` namespace.

**Single task** — \`app("subagent spawn <name> \\"<task>\\"")\`:
- Provide a **clear, detailed task description** — the sub-agent works independently.
- Choose the most appropriate sub-agent based on the task requirements.
- Pass \`--share-context\` to forward the parent context summary (ignored
  when the sub-agent's context_access is "isolated").
- The sub-agent returns a JSON envelope when complete.

**Parallel batch** — \`app("subagent spawn-many --task \\"<name>:<task>\\" --task \\"...\\"")\`:
- Each \`--task\` entry is \`"<name>:<task description>"\`; the first \`:\` is
  the separator, so task text may include further \`:\` characters freely.
- For per-task \`shareContext\` differences, switch to
  \`--config-json '[{ "name":..., "task":..., "shareContext":... }]'\`.
- All tasks share the cmdline-level \`--share-context\` setting when given.

### Guidelines
1. **Delegate appropriately**: Use sub-agents for tasks that match their specialization.
2. **Be specific**: Provide complete task descriptions with all necessary context.
3. **Handle failures gracefully**: If a sub-agent fails, analyze the error envelope and decide next steps.
4. **Don't over-delegate**: For simple tasks, handle them directly.
5. **Recursion is rejected**: sub-agents cannot themselves spawn other sub-agents.
---`;
}
