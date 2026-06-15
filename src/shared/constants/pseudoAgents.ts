export const PSEUDO_AGENT_SEARCH_GOOGLE = 'pseudo-agent-search-google' as const;
export const PSEUDO_AGENT_SEARCH_BING = 'pseudo-agent-search-bing' as const;

export type PseudoSearchAgentId = typeof PSEUDO_AGENT_SEARCH_GOOGLE | typeof PSEUDO_AGENT_SEARCH_BING;

const PSEUDO_SEARCH_AGENT_IDS = new Set<string>([
  PSEUDO_AGENT_SEARCH_GOOGLE,
  PSEUDO_AGENT_SEARCH_BING,
]);

export function isPseudoSearchAgent(agentId: string): boolean {
  return PSEUDO_SEARCH_AGENT_IDS.has(agentId);
}
