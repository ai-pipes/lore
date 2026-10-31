export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export interface LlmConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

/** Reads `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL`. Configured only with a model and a key or a base URL. */
export function llmConfigFromEnv(env: Record<string, string | undefined>): LlmConfig | null {
  const model = env.LLM_MODEL?.trim();
  const apiKey = env.LLM_API_KEY?.trim();
  const baseUrl = env.LLM_BASE_URL?.trim();
  if (!model || (!apiKey && !baseUrl)) return null;
  return {
    baseUrl: baseUrl || OPENROUTER_BASE_URL,
    ...(apiKey ? { apiKey } : {}),
    model,
  };
}
