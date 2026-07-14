export interface InlineEditRegenerateConfirmationSettings {
  /** Skip the confirmation dialog when regenerating from an edited message */
  skipConfirmation: boolean;
}

export interface ConfirmationSettings {
  /** Confirmation preference for inline edit regenerate flow */
  inlineEditRegenerate: InlineEditRegenerateConfirmationSettings;
}

/** `web search` 配置 —— 当前仅承载 Tavily Search API key。 */
export interface WebSearchSettings {
  /** Tavily Search API key（`tvly-...`）。供 `web search` 调用 Tavily REST API；缺省回退环境变量 `TAVILY_API_KEY`。 */
  tavilyApiKey?: string;
}

/** `profiles/{p_id}/settings.json` —— UI 偏好。 */
export interface SettingsFile {
  version: 1;
  confirmation?: ConfirmationSettings;
  webSearch?: WebSearchSettings;
}
