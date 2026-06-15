export interface SystemPromptWriterResponse {
  success: boolean;
  originalPrompt?: string;
  improvedPrompt?: string;
  changeSummary?: string[];
  warnings?: string[];
  errors?: string[];
  rawResponse?: string;
}

export interface McpConfigFormatterResponse {
  success: boolean;
  originalFormat?: string;
  transportType?: string;
  serverName?: string;
  nameSource?: string;
  config?: Record<string, any>;
  warnings?: string[];
  errors?: string[];
  rawResponse?: string;
}

export interface ChatSessionTitleSummarizerResponse {
  success: boolean;
  originalMessage?: string;
  title?: string;
  tokenCount?: number;
  warnings?: string[];
  errors?: string[];
  rawResponse?: string;
}

export interface FileNameGeneratorResponse {
  success: boolean;
  fileName?: string;
  extension?: string;
  fullFileName?: string;
  warnings?: string[];
  errors?: string[];
  rawResponse?: string;
}

export interface DocumentSummaryGeneratorResponse {
  success: boolean;
  summary?: string;
  fileName?: string;
  warnings?: string[];
  errors?: string[];
}
