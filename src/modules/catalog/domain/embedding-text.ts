const MAX_EMBEDDING_CHARS = 8000;

/** The text a document is embedded from: summary and content, capped to what embedding models accept. */
export function embeddingText(doc: { summary?: string | null; content: string }): string {
  return [doc.summary, doc.content].filter(Boolean).join('\n').slice(0, MAX_EMBEDDING_CHARS);
}
