/**
 * Public API of the llm module: the provider-neutral `LanguageModel` port with its
 * OpenAI-compatible adapter (OpenRouter by default), and the prompt templates.
 */
export type {
  CompleteRequest,
  LanguageModel,
  LlmCallOptions,
  LlmFinishReason,
  LlmMessage,
  LlmStreamEvent,
  LlmTool,
  LlmToolCall,
  StreamRequest,
} from './application/ports.js';
export { llmConfigFromEnv, OPENROUTER_BASE_URL, type LlmConfig } from './infrastructure/config.js';
export { createLanguageModel } from './infrastructure/openai-compatible.js';
export { renderPrompt, type PromptName, type PromptVars } from './infrastructure/prompts.js';
