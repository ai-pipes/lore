/**
 * Citation Behavior Tests
 *
 * Debug and regression suite for [ref:library_id/slug] citation markers.
 *
 * Three failure modes investigated:
 *   1. System prompt doesn't instruct citations → prompt assertions
 *   2. get_document result omits library_id → model can't form correct [ref:...] → tool result assertions
 *   3. [ref:...] text is stripped somewhere in the streaming pipeline → passthrough assertions
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ── llm module mock ──────────────────────────────────────────────────────────
// The server's one LanguageModel is a scripted fake: `complete` answers search term extraction,
// `stream` plays one scripted turn per call.

const { mockComplete, mockStream } = vi.hoisted(() => ({ mockComplete: vi.fn(), mockStream: vi.fn() }));

vi.mock('../../modules/llm/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../modules/llm/index.js')>()),
  createLanguageModel: vi.fn(() => ({ configured: () => true, complete: mockComplete, stream: mockStream })),
}));

import { buildServer } from '../../platform/http/server.js';
import type { LlmMessage, StreamRequest } from '../../modules/llm/index.js';
import { cleanDb, createTestLibrary, createTestUser, createTestVersion, createTestDocument } from '../helpers.js';
import { streamOf, textTurn } from '../../../test/fakes/llm.js';

// ── Fake stream helpers ───────────────────────────────────────────────────────

const textStream = (text: string) => streamOf(textTurn(text));

/** Simulates LLM choosing to call get_document, then producing text on the second turn. */
function setupToolThenTextMock(
  toolArgs: { library_id: string; slug: string },
  secondTurnText: string,
  onSecondTurnMessages?: (messages: LlmMessage[]) => void,
) {
  const toolId = 'call_test_123';

  mockComplete.mockResolvedValueOnce('transfer create'); // extractSearchTerms call
  mockStream
    .mockImplementationOnce(() =>
      streamOf([
        { type: 'tool_call', call: { id: toolId, name: 'get_document', arguments: JSON.stringify(toolArgs) } },
        { type: 'end', reason: 'tool_calls' },
      ]),
    ) // turn 1: tool call
    .mockImplementationOnce(({ messages }: StreamRequest) => {
      onSecondTurnMessages?.([...messages]);
      return textStream(secondTurnText);
    });
}

/** The request of the first streamed model turn. */
const firstTurn = () => mockStream.mock.calls[0][0] as StreamRequest;

/** Parse NDJSON lines from a raw HTTP response body */
function parseNdjson(body: string): unknown[] {
  return body
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

/** Collect all text chunks from parsed NDJSON events */
function collectText(events: unknown[]): string {
  return (events as Array<{ type: string; content?: string }>)
    .filter(e => e.type === 'text' && e.content)
    .map(e => e.content!)
    .join('');
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let app: FastifyInstance;
/** Chat is for signed-in users: every request carries a member's `sk_` token. */
let USER: { authorization: string };

beforeAll(async () => {
  app = await buildServer();
  await cleanDb();
  USER = (await createTestUser()).bearer;
  await createTestLibrary('test-lib', 'Test Library');
  await createTestVersion('test-lib', 'v1');
  await createTestDocument('test-lib', 'v1', {
    slug: 'store/transfer-create',
    content: '# Transfer Create\n\nCreates a transfer.\n\nFromLocationId: integer (required).',
    summary: 'Creates an internal transfer',
    domain: 'inventory',
    entry_type: 'handler',
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── 1. System prompt assertions ───────────────────────────────────────────────

describe('System prompt: citation instruction', () => {
  it('system message contains mandatory citation instruction', async () => {
    // extractSearchTerms call + main LLM call
    mockComplete.mockResolvedValueOnce('test');
    mockStream.mockImplementationOnce(() => textStream('hello world'));

    await app.inject({
      headers: USER,
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'test query' }] },
    });

    // One term extraction, then the main LLM call
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockStream).toHaveBeenCalledTimes(1);
    const systemMessages = firstTurn().messages
      .filter(m => m.role === 'system')
      .map(m => m.content)
      .join('\n');

    expect(systemMessages).toContain('CITATIONS');
    expect(systemMessages).toContain('[ref:library_id/slug]');
    expect(systemMessages).toContain('NEVER skip citations');
    expect(systemMessages).toContain('Answer ONLY from the documents provided');
    expect(systemMessages).toContain("I don't have documentation for this specific detail");
  });

  it('chat completions are called with temperature 0', async () => {
    mockComplete.mockResolvedValueOnce('test');
    mockStream.mockImplementationOnce(() => textStream('hello world'));

    await app.inject({
      headers: USER,
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'test query' }] },
    });

    expect(firstTurn().temperature).toBe(0);
  });

  it('system message tells model to cite from search context without get_document', async () => {
    mockComplete.mockResolvedValueOnce('transfer create');
    mockStream.mockImplementationOnce(() => textStream('here is the answer'));

    await app.inject({
      headers: USER,
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'how does transfer create work?' }] },
    });

    const combined = firstTurn().messages
      .filter(m => m.role === 'system')
      .map(m => m.content)
      .join('\n');

    // The search context section should be injected and contain library_id/slug hints
    expect(combined).toContain('## Relevant documentation');
    expect(combined).toContain('library_id');
    expect(combined).toContain('slug');
  });
});

// ── 2. get_document tool result includes library_id ───────────────────────────

describe('get_document tool result: library_id is present', () => {
  it('tool result sent to LLM includes library_id alongside slug', async () => {
    let capturedToolResult: unknown;

    setupToolThenTextMock(
      { library_id: 'test-lib', slug: 'store/transfer-create' },
      'Creates a transfer. [ref:test-lib/store/transfer-create]',
      (messages) => {
        capturedToolResult = messages.find(m => m.role === 'tool')?.content;
      },
    );

    await app.inject({
      headers: USER,
      method: 'POST',
      url: '/api/chat',
      payload: {
        messages: [{ role: 'user', content: 'how does transfer create work?' }],
      },
    });

    expect(capturedToolResult).toBeDefined();
    const parsed = JSON.parse(capturedToolResult as string);
    expect(parsed).toHaveProperty('library_id', 'test-lib');
    expect(parsed).toHaveProperty('slug', 'store/transfer-create');
    expect(parsed).toHaveProperty('content');
  });
});

// ── 3. Stream passthrough ─────────────────────────────────────────────────────

describe('Stream: [ref:...] markers pass through unmodified', () => {
  it('[ref:library_id/slug] in LLM output arrives in stream as-is', async () => {
    const textWithCitation =
      'Creates a transfer between locations. [ref:test-lib/store/transfer-create]';

    mockComplete.mockResolvedValueOnce('transfer');
    mockStream.mockImplementationOnce(() => textStream(textWithCitation));

    const res = await app.inject({
      headers: USER,
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'transfer create?' }] },
    });

    const text = collectText(parseNdjson(res.body));
    expect(text).toContain('[ref:test-lib/store/transfer-create]');
  });

  it('multiple [ref:...] markers pass through unmodified', async () => {
    const textWithCitations =
      'Uses create endpoint. [ref:orders-api/orders/refund-create] See also list. [ref:orders-api/orders/refund-list]';

    mockComplete.mockResolvedValueOnce('transfer');
    mockStream.mockImplementationOnce(() => textStream(textWithCitations));

    const res = await app.inject({
      headers: USER,
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'transfers?' }] },
    });

    const text = collectText(parseNdjson(res.body));
    expect(text).toContain('[ref:orders-api/orders/refund-create]');
    expect(text).toContain('[ref:orders-api/orders/refund-list]');
  });

  it('stream ends with done event', async () => {
    mockComplete.mockResolvedValueOnce('q');
    mockStream.mockImplementationOnce(() => textStream('hello'));

    const res = await app.inject({
      headers: USER,
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'test' }] },
    });

    const events = parseNdjson(res.body);
    const last = events[events.length - 1] as { type: string };
    expect(last.type).toBe('done');
  });
});

// ── 4. Context (pinned docs) mode ─────────────────────────────────────────────

describe('Context mode: pinned doc sections include library_id/slug for citations', () => {
  it('pinned section header contains [library_id: ..., slug: ...] metadata', async () => {
    let capturedSystemContent = '';

    mockStream.mockImplementationOnce(({ messages }: StreamRequest) => {
      capturedSystemContent = messages
        .filter(m => m.role === 'system')
        .map(m => m.content)
        .join('\n');
      return textStream('answer with [ref:test-lib/store/transfer-create]');
    });

    await app.inject({
      headers: USER,
      method: 'POST',
      url: '/api/chat',
      payload: {
        messages: [{ role: 'user', content: 'how does this work?' }],
        pinned_docs: [{ library_id: 'test-lib', slug: 'store/transfer-create' }],
      },
    });

    // The pinned section header must carry library_id and slug so the model can cite
    expect(capturedSystemContent).toContain('[library_id: test-lib, slug: store/transfer-create]');
    expect(capturedSystemContent).toContain('CITATIONS — MANDATORY');
  });

  it('[ref:...] from pinned doc response passes through stream', async () => {
    mockStream.mockImplementationOnce(() =>
      textStream('Creates a transfer. [ref:test-lib/store/transfer-create]'),
    );

    const res = await app.inject({
      headers: USER,
      method: 'POST',
      url: '/api/chat',
      payload: {
        messages: [{ role: 'user', content: 'explain this' }],
        pinned_docs: [{ library_id: 'test-lib', slug: 'store/transfer-create' }],
      },
    });

    const text = collectText(parseNdjson(res.body));
    expect(text).toContain('[ref:test-lib/store/transfer-create]');
  });
});
