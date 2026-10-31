/** Provider-neutral language-model port. Adapters live in `infrastructure/`. */

export interface LlmToolCall {
  id: string;
  name: string;
  /** JSON-encoded arguments, exactly as the model produced them. */
  arguments: string;
}

export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema of the arguments. */
  parameters: Record<string, unknown>;
}

export type LlmFinishReason = 'stop' | 'tool_calls' | 'length' | 'other';

export type LlmStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; call: LlmToolCall }
  | { type: 'end'; reason: LlmFinishReason };

export interface LlmCallOptions {
  timeoutMs: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

export interface CompleteRequest extends LlmCallOptions {
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
}

export interface StreamRequest extends LlmCallOptions {
  messages: LlmMessage[];
  tools: LlmTool[];
  temperature?: number;
}

export interface LanguageModel {
  configured(): boolean;
  complete(req: CompleteRequest): Promise<string>;
  stream(req: StreamRequest): AsyncIterable<LlmStreamEvent>;
}
