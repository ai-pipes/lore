import { describe, expect, it } from 'vitest';
import { llmConfigFromEnv } from './config.js';

describe('llmConfigFromEnv', () => {
  it('returns null for an empty environment', () => {
    expect(llmConfigFromEnv({})).toBeNull();
  });
  it('defaults to OpenRouter', () => {
    expect(llmConfigFromEnv({ LLM_API_KEY: 'k', LLM_MODEL: 'm' })).toEqual({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'k',
      model: 'm',
    });
  });
  it('allows a keyless local endpoint', () => {
    const cfg = llmConfigFromEnv({ LLM_BASE_URL: 'http://localhost:11434/v1', LLM_MODEL: 'llama3' });
    expect(cfg).toEqual({ baseUrl: 'http://localhost:11434/v1', model: 'llama3' });
    expect(cfg).not.toHaveProperty('apiKey');
  });
  it('does not fall back to the removed OPENAI_API_KEY', () => {
    expect(llmConfigFromEnv({ OPENAI_API_KEY: 'sk-x' })).toBeNull();
  });
  it('requires a key or a base URL', () => {
    expect(llmConfigFromEnv({ LLM_MODEL: 'm' })).toBeNull();
  });
  it('requires a model', () => {
    expect(llmConfigFromEnv({ LLM_API_KEY: 'k' })).toBeNull();
  });
});
