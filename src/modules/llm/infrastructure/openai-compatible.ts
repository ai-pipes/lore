import OpenAI from 'openai';
import type {
  CompleteRequest,
  LanguageModel,
  LlmFinishReason,
  LlmMessage,
  LlmStreamEvent,
  LlmToolCall,
  StreamRequest,
} from '../application/ports.js';
import { llmConfigFromEnv, type LlmConfig } from './config.js';

type WireMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function toWire(m: LlmMessage): WireMessage {
  switch (m.role) {
    case 'assistant':
      return {
        role: 'assistant',
        content: m.content,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: 'function' as const,
                function: { name: c.name, arguments: c.arguments },
              })),
            }
          : {}),
      };
    case 'tool':
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    default:
      return { role: m.role, content: m.content };
  }
}

function mapFinish(reason: string | null | undefined): LlmFinishReason {
  if (reason === 'stop' || reason === 'tool_calls' || reason === 'length') return reason;
  return 'other';
}

function requestOptions(req: { timeoutMs: number; maxRetries?: number; signal?: AbortSignal }) {
  return {
    timeout: req.timeoutMs,
    maxRetries: req.maxRetries ?? 0,
    ...(req.signal ? { signal: req.signal } : {}),
  };
}

/** A LanguageModel over any OpenAI-compatible chat-completions endpoint. */
export function createOpenAiCompatibleModel(cfg: LlmConfig): LanguageModel {
  const client = new OpenAI({ apiKey: cfg.apiKey ?? 'not-needed', baseURL: cfg.baseUrl });
  return {
    configured: () => true,
    async complete(req: CompleteRequest) {
      const res = await client.chat.completions.create(
        {
          model: cfg.model,
          messages: req.messages.map(toWire),
          ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(req.json ? { response_format: { type: 'json_object' as const } } : {}),
        },
        requestOptions(req),
      );
      return res.choices[0]?.message?.content ?? '';
    },
    async *stream(req: StreamRequest): AsyncIterable<LlmStreamEvent> {
      const stream = await client.chat.completions.create(
        {
          model: cfg.model,
          messages: req.messages.map(toWire),
          stream: true,
          ...(req.tools.length
            ? {
                tools: req.tools.map((t) => ({
                  type: 'function' as const,
                  function: { name: t.name, description: t.description, parameters: t.parameters },
                })),
              }
            : {}),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        },
        requestOptions(req),
      );
      const calls = new Map<number, LlmToolCall>();
      let finish: string | null | undefined;
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const text = choice.delta?.content;
        if (text) yield { type: 'text', text };
        for (const tc of choice.delta?.tool_calls ?? []) {
          const cur = calls.get(tc.index) ?? { id: '', name: '', arguments: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.arguments += tc.function.arguments;
          calls.set(tc.index, cur);
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
      for (const index of [...calls.keys()].sort((a, b) => a - b)) {
        const call = calls.get(index)!;
        // Some providers leave out the id; the tool result still needs one to answer
        yield { type: 'tool_call', call: call.id ? call : { ...call, id: `call_${index}` } };
      }
      yield { type: 'end', reason: mapFinish(finish) };
    },
  };
}

const unconfigured: LanguageModel = {
  configured: () => false,
  complete: () => Promise.reject(new Error('No LLM is configured')),
  stream: () => ({
    [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('No LLM is configured')) }),
  }),
};

export function createLanguageModel(env: Record<string, string | undefined> = process.env): LanguageModel {
  const cfg = llmConfigFromEnv(env);
  return cfg ? createOpenAiCompatibleModel(cfg) : unconfigured;
}
