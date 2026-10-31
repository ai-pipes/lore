import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { LlmStreamEvent } from '../application/ports.js';
import { createLanguageModel, createOpenAiCompatibleModel } from './openai-compatible.js';

type Handler = (req: IncomingMessage, res: ServerResponse, body: Record<string, any>) => void;

let server: Server | undefined;
const bodies: Record<string, any>[] = [];
const headers: IncomingMessage['headers'][] = [];

async function stub(handler: Handler): Promise<string> {
  bodies.length = 0;
  headers.length = 0;
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      bodies.push(body);
      headers.push(req.headers);
      handler(req, res, body);
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
}

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server!.close(r));
    server = undefined;
  }
});

const sse = (chunks: unknown[]): Handler => (_req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.end('data: [DONE]\n\n');
};
const delta = (d: object, finish: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] });
const json = (status: number, payload: unknown): Handler => (_req, res) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
};

async function collect(events: AsyncIterable<LlmStreamEvent>) {
  const out: LlmStreamEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}
const base = { timeoutMs: 5000, messages: [{ role: 'user' as const, content: 'hi' }], tools: [] };

describe('openai-compatible model', () => {
  it('streams text and ends with stop', async () => {
    const baseUrl = await stub(sse([delta({ content: 'Hel' }), delta({ content: 'lo' }), delta({}, 'stop')]));
    const m = createOpenAiCompatibleModel({ baseUrl, model: 'm' });
    expect(await collect(m.stream(base))).toEqual([
      { type: 'text', text: 'Hel' },
      { type: 'text', text: 'lo' },
      { type: 'end', reason: 'stop' },
    ]);
  });

  it('assembles parallel tool calls split across chunks', async () => {
    const baseUrl = await stub(
      sse([
        delta({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'get_document', arguments: '{"slug":' } }] }),
        delta({ tool_calls: [{ index: 1, id: 'c2', function: { name: 'list_libraries', arguments: '{}' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] }),
        delta({}, 'tool_calls'),
      ]),
    );
    const m = createOpenAiCompatibleModel({ baseUrl, model: 'm' });
    expect(await collect(m.stream(base))).toEqual([
      { type: 'tool_call', call: { id: 'c1', name: 'get_document', arguments: '{"slug":"a"}' } },
      { type: 'tool_call', call: { id: 'c2', name: 'list_libraries', arguments: '{}' } },
      { type: 'end', reason: 'tool_calls' },
    ]);
  });

  it('does not duplicate a tool-call name repeated in every chunk', async () => {
    const baseUrl = await stub(
      sse([
        delta({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'get_document', arguments: '{"a":' } }] }),
        delta({ tool_calls: [{ index: 0, function: { name: 'get_document', arguments: '1}' } }] }),
        delta({}, 'tool_calls'),
      ]),
    );
    const m = createOpenAiCompatibleModel({ baseUrl, model: 'm' });
    expect(await collect(m.stream(base))).toEqual([
      { type: 'tool_call', call: { id: 'c1', name: 'get_document', arguments: '{"a":1}' } },
      { type: 'end', reason: 'tool_calls' },
    ]);
  });

  it('gives a tool call without an id one from its index', async () => {
    const baseUrl = await stub(
      sse([
        delta({ tool_calls: [{ index: 0, function: { name: 'list_libraries', arguments: '{}' } }] }),
        delta({}, 'tool_calls'),
      ]),
    );
    const m = createOpenAiCompatibleModel({ baseUrl, model: 'm' });
    expect(await collect(m.stream(base))).toEqual([
      { type: 'tool_call', call: { id: 'call_0', name: 'list_libraries', arguments: '{}' } },
      { type: 'end', reason: 'tool_calls' },
    ]);
  });

  it('maps finish reasons', async () => {
    for (const [raw, want] of [['length', 'length'], ['content_filter', 'other']] as const) {
      const baseUrl = await stub(sse([delta({ content: 'x' }, raw)]));
      const m = createOpenAiCompatibleModel({ baseUrl, model: 'm' });
      expect((await collect(m.stream(base))).at(-1)).toEqual({ type: 'end', reason: want });
      await new Promise((r) => server!.close(r));
      server = undefined;
    }
  });

  it('tolerates empty choices and a missing finish reason', async () => {
    const baseUrl = await stub(sse([{ choices: [] }, delta({ content: 'x' })]));
    const m = createOpenAiCompatibleModel({ baseUrl, model: 'm' });
    const events = await collect(m.stream(base));
    expect(events).toEqual([
      { type: 'text', text: 'x' },
      { type: 'end', reason: 'other' },
    ]);
  });

  it('sends Lore messages in the OpenAI wire format', async () => {
    const baseUrl = await stub(sse([delta({}, 'stop')]));
    const m = createOpenAiCompatibleModel({ baseUrl, model: 'the-model', apiKey: 'k' });
    await collect(
      m.stream({
        timeoutMs: 5000,
        temperature: 0.3,
        messages: [
          { role: 'system', content: 's' },
          { role: 'user', content: 'u' },
          { role: 'assistant', content: null, toolCalls: [{ id: 'c1', name: 'f', arguments: '{}' }] },
          { role: 'tool', toolCallId: 'c1', content: 'r' },
        ],
        tools: [{ name: 'f', description: 'd', parameters: { type: 'object' } }],
      }),
    );
    expect(bodies[0]).toMatchObject({
      model: 'the-model',
      temperature: 0.3,
      stream: true,
      messages: [
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'c1', content: 'r' },
      ],
      tools: [{ type: 'function', function: { name: 'f', description: 'd', parameters: { type: 'object' } } }],
    });
    expect(headers[0]?.authorization).toBe('Bearer k');
  });

  it('complete returns the message text and passes json and max tokens', async () => {
    const baseUrl = await stub(json(200, { choices: [{ message: { content: '{"a":1}' } }] }));
    const m = createOpenAiCompatibleModel({ baseUrl, model: 'm' });
    expect(await m.complete({ ...base, json: true, maxTokens: 50 })).toBe('{"a":1}');
    expect(bodies[0]).toMatchObject({ response_format: { type: 'json_object' }, max_tokens: 50 });
    await m.complete(base);
    expect(bodies[1]).not.toHaveProperty('response_format');
    expect(bodies[1]).not.toHaveProperty('max_tokens');
  });

  it('complete returns an empty string for null content', async () => {
    const baseUrl = await stub(json(200, { choices: [{ message: { content: null } }] }));
    expect(await createOpenAiCompatibleModel({ baseUrl, model: 'm' }).complete(base)).toBe('');
  });

  it('rejects on an HTTP error without leaking the key', async () => {
    const baseUrl = await stub(json(402, { error: { message: 'Insufficient credits' } }));
    const m = createOpenAiCompatibleModel({ baseUrl, model: 'm', apiKey: 'sk-or-secret-test' });
    const err = await m.complete(base).then(() => null, (e) => e);
    expect(err).not.toBeNull();
    expect(String(err)).toContain('402');
    expect(String(err)).not.toContain('sk-or-secret-test');
  });

  it('stream rejects on an HTTP error without leaking the key', async () => {
    const baseUrl = await stub(json(401, { error: { message: 'Invalid key' } }));
    const m = createOpenAiCompatibleModel({ baseUrl, model: 'm', apiKey: 'sk-or-secret-test' });
    const err = await collect(m.stream(base)).then(() => null, (e) => e);
    expect(err).not.toBeNull();
    expect(String(err)).toContain('401');
    expect(String(err)).not.toContain('sk-or-secret-test');
  });

  it('aborts when the signal fires', async () => {
    const baseUrl = await stub(() => {});
    const m = createOpenAiCompatibleModel({ baseUrl, model: 'm' });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 30);
    const started = Date.now();
    await expect(m.complete({ ...base, signal: ac.signal })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('times out', async () => {
    const baseUrl = await stub(() => {});
    const m = createOpenAiCompatibleModel({ baseUrl, model: 'm' });
    const started = Date.now();
    await expect(m.complete({ ...base, timeoutMs: 50 })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('unconfigured model', () => {
  it('reports not configured and rejects', async () => {
    const m = createLanguageModel({});
    expect(m.configured()).toBe(false);
    await expect(m.complete(base)).rejects.toThrow('No LLM is configured');
    await expect(collect(m.stream(base))).rejects.toThrow('No LLM is configured');
  });
  it('is configured only with a model and a key or base URL', () => {
    expect(createLanguageModel({ LLM_MODEL: 'm' }).configured()).toBe(false);
    expect(createLanguageModel({ LLM_API_KEY: 'k', LLM_MODEL: 'm' }).configured()).toBe(true);
  });
});
