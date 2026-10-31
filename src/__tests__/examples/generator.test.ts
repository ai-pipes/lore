import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { readFileSync } from 'fs';
import matter from 'gray-matter';
import { createLanguageModel, type LanguageModel } from '../../modules/llm/index.js';
import { collectOperations, generatorLlmEnv, skeletonDoc, llmDoc } from '../../../examples/generator/generate.js';

const spec = JSON.parse(readFileSync('examples/generator/petstore.openapi.json', 'utf8'));

describe('example generator', () => {
  it('derives slugs, domains and entry types from the spec', () => {
    const ops = collectOperations(spec);
    expect(ops.map((o) => o.slug)).toEqual([
      'pets/list-pets', 'pets/create-pet', 'pets/get-pet', 'orders/place-order', 'orders/refund-order',
    ]);
    expect(ops.find((o) => o.slug === 'pets/get-pet')).toMatchObject({ entryType: 'query_handler', handlerClass: 'GetPetHandler', method: 'GET', route: '/api/v1/pets/{petId}' });
  });

  it('writes skeleton documents in Lore format without an LLM', () => {
    const op = collectOperations(spec).find((o) => o.slug === 'orders/place-order')!;
    const doc = matter(skeletonDoc(spec, op));
    expect(doc.data).toMatchObject({ slug: 'orders/place-order', domain: 'orders', entry_type: 'handler', http_method: 'POST', route: '/api/v1/orders' });
    expect(doc.content).toContain('## Request');
    expect(doc.content).toContain('| `pet_ids` | body |');
    expect(doc.content).toContain('| `409` | A pet is not available |');
  });

  describe('LLM path (fake OpenAI-compatible server)', () => {
    let server: http.Server;
    let model: LanguageModel;
    let lastModel = '';
    let lastPrompt = '';
    let reply = '';

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const parsed = JSON.parse(body);
          lastPrompt = parsed.messages[0].content;
          lastModel = parsed.model;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: reply } }] }));
        });
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const env = { LLM_API_KEY: 'test', LLM_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, LLM_MODEL: 'server-model' };
      model = createLanguageModel(generatorLlmEnv(env, 'generator-model'));
    });
    afterAll(() => new Promise<void>((r) => server.close(() => r())));

    const op = () => collectOperations(spec).find((o) => o.slug === 'orders/refund-order')!;
    const known = ['orders/place-order', 'orders/refund-order'];

    it('renders the generator prompt and keeps only known links', async () => {
      reply = '```markdown\n---\nslug: orders/refund-order\ndomain: orders\nsummary: Refunds a delivered order\nlinks:\n  - slug: orders/place-order\n    type: related_to\n  - slug: invented/doc\n    type: calls\n---\n\n# RefundOrderHandler\n\nBody.\n```';
      const out = await llmDoc(model, spec, op(), known);
      expect(lastModel).toBe('generator-model');
      expect(lastPrompt).toContain('POST /api/v1/orders/{orderId}/refund');
      expect(lastPrompt).toContain('slug: orders/refund-order');
      const doc = matter(out!);
      expect(doc.data.links).toEqual([{ slug: 'orders/place-order', type: 'related_to' }]);
      expect(doc.content).toContain('# RefundOrderHandler');
    });

    it('rejects output with a different slug (caller falls back to a skeleton)', async () => {
      reply = '---\nslug: something/else\n---\n\n# X\n';
      expect(await llmDoc(model, spec, op(), known)).toBeNull();
    });
  });
});
