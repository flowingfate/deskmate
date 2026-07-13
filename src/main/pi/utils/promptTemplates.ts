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
export function boundSkillsBlock(
  items: BoundSkillItem[],
  options: { hasLazySkills?: boolean } = {},
): string {
  const skillsList = items.length === 0
    ? options.hasLazySkills
      ? 'No live skills are configured. The user may explicitly reference a lazy skill with an `@skill://<name>` URI.'
      : 'No valid skills configured for this agent.'
    : items.map((s, i) => (
      `${i + 1}. **${s.name}**\n` +
      `   - Description: ${s.description}\n` +
      `   - Version: ${s.version}\n` +
      `   - File Path: \`${s.filePath}\`\n`
    )).join('\n');

  const content = `
---
**Skills Instructions:**


**What are Skills?**
Skills are specialized capabilities that extend your abilities for specific tasks. Each skill is a directory containing a \`SKILL.md\` instruction file, plus optional scripts and reference files.


**How to Use Skills:**
1. **Load authorized skills on demand:** Live skills expose metadata here; lazy skills are revealed only by the user's explicit URI. Before acting on either, you MUST call \`read skill://<name>\` to load its full \`SKILL.md\` — the full instructions are NOT auto-injected.
2. **Read skill files:** \`SKILL.md\` may reference other files by relative path (e.g. \`REFERENCE.md\`, \`scripts/run.py\`). Read any of them via \`read skill://<name>/<relative-path>\` — the relative path is exactly as written in \`SKILL.md\`, rooted at the skill name.
3. **Run skill scripts:** To execute a script a skill ships, pass its authorized \`skill://<name>/<relative-path>\` URI directly to the \`shell\` tool (e.g. \`python skill://pdf/scripts/fill.py input.pdf\`). The \`shell\` tool auto-resolves it in the command and \`cwd\` to a real filesystem path — you never need the absolute path.
4. **Follow Instructions:** Each skill provides specific workflows and best practices — follow them carefully.
5. **Combine Skills:** You can use multiple skills together to accomplish complex tasks.


**Available Skills for This Agent:**

${skillsList}

**Best Practices:**
- Load skills only when they're relevant to the current task
- Follow the specific instructions and workflows in each skill
- Use skill-provided scripts for deterministic operations
- Combine multiple skills when needed for complex workflows
- Always check skill metadata first before loading full content

---`;

  return wrapInSystemReminder(content);
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
