/**
 * createGithubIssueTool — create a GitHub Issue.
 * Used only by the Doctor Agent.
 *
 * 两步走：GET /v1/github/issue-token 取短时 installation token，
 * 再用它 POST 到 flowingfate/deskmate 建 issue。token 内存缓存，按 expires_at（毫秒）判活。
 */

import type { Tool } from '@earendil-works/pi-ai';
import { jsonSchema } from '@main/pi/tools/schema';
import { appendDebugLog } from '../log';
import { ONELINE_API_URL_BASE, GIT_REPO_API_URL_BASE } from '@shared/constants/endpoints';

export const createGithubIssueToolDef: Tool = {
  name: 'create_github_issue',
  description: `Create a GitHub issue in the Deskmate repository. Use this tool after you have finished analyzing the bug report and collected all relevant context. The body should be well-structured Markdown including: problem summary, environment info, relevant logs, and your analysis.`,
  parameters: jsonSchema({
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Concise issue title summarizing the bug',
      },
      body: {
        type: 'string',
        description: 'Full issue body in Markdown format',
      },
      labels: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional labels to apply (e.g. ["crash", "ui"]). "doctor" is always added automatically.',
      },
    },
    required: ['title', 'body'],
  }),
};

interface IssueToken {
  token: string;
  expires_at: number;
}

let cached: IssueToken | null = null;
const EXPIRATION_BUFFER = 5 * 60 * 1000; // 5 minutes

async function getToken(): Promise<string> {
  if (cached && cached.expires_at > Date.now() + EXPIRATION_BUFFER) {
    return cached.token;
  }
  let base = ONELINE_API_URL_BASE;
  // local 开发调试用
  // base = 'http://localhost:8787';
  const res = await fetch(base + '/v1/github/issue-token');
  if (!res.ok) {
    const error = await res.text();
    appendDebugLog('Failed to get issue token', `Status: ${res.status}\nResponse: ${error}`);
    throw new Error(`Failed to get token: ${res.status} - ${error}`);
  }
  const data: IssueToken = await res.json();
  cached = data;
  return cached.token;
}

interface GitHubIssue {
  number: number;
  html_url: string;
  state: string;
}

async function createIssue(title: string, body: string, labels: string[] = []): Promise<GitHubIssue> {
  const token = await getToken();
  const res = await fetch(`${GIT_REPO_API_URL_BASE}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ title, body, labels }),
  });

  if (!res.ok) {
    const error = await res.text();
    appendDebugLog('Failed to create GitHub issue', `Status: ${res.status}\nResponse: ${error}`);
    throw new Error(`Failed to create issue: ${res.status} - ${error}`);
  }

  return res.json();
}

export async function executeCreateGithubIssue(args: {
  title: string;
  body: string;
  labels?: string[];
}): Promise<string> {
  const { title, labels } = args;
  let { body } = args;
  if (!title || !body) {
    return JSON.stringify({ success: false, error: 'title and body are required.' });
  }

  const GITHUB_BODY_LIMIT = 61440; // 60kb, github limit is 64kb
  if (body.length > GITHUB_BODY_LIMIT) {
    const notice = `\n\n---\n_⚠️ Body truncated: original length ${body.length} exceeded GitHub's 65536-char limit._\n`;
    body = body.slice(0, GITHUB_BODY_LIMIT - notice.length) + notice;
  }

  const allLabels = ['doctor', ...(labels || [])];
  const issue = await createIssue(title, body, ['doctor']);

  appendDebugLog(
    `create_github_issue → #${issue.number}`,
    [
      `**URL:** ${issue.html_url}`,
      `**Title:** ${title}`,
      `**Labels:** ${allLabels.join(', ')}`,
      `**Body length:** ${body.length}`,
      '',
      '### Issue Body',
      '',
      body,
    ].join('\n'),
  );

  return JSON.stringify({
    success: true,
    issueUrl: issue.html_url,
    issueNumber: issue.number,
  });
}
