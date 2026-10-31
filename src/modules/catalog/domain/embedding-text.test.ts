import { describe, it, expect } from 'vitest';
import { embeddingText } from './embedding-text.js';

describe('embeddingText', () => {
  it('joins the summary and the content with a newline', () => {
    expect(embeddingText({ summary: 'Sum', content: 'Body' })).toBe('Sum\nBody');
  });

  it('drops an empty or missing summary', () => {
    expect(embeddingText({ summary: '', content: 'Body' })).toBe('Body');
    expect(embeddingText({ summary: null, content: 'Body' })).toBe('Body');
    expect(embeddingText({ content: 'Body' })).toBe('Body');
  });

  it('truncates to 8000 characters', () => {
    expect(embeddingText({ summary: 'S', content: 'x'.repeat(9000) })).toHaveLength(8000);
  });
});
