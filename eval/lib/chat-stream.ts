import type { ChatRun } from './answer-checks.js';
import { docKey } from './golden.js';

/** Parses the NDJSON body of POST /api/chat into a ChatRun. */
export function parseChatStream(ndjson: string, durationMs: number): ChatRun {
  const lines = ndjson.split('\n').filter((l) => l.trim() !== '');
  let text = '';
  const toolSlugs: string[] = [];
  const sources: string[] = [];
  let error: string | undefined;
  let done = false;

  lines.forEach((l, i) => {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(l) as Record<string, unknown>;
    } catch {
      if (i === lines.length - 1) error ??= 'truncated stream';
      return;
    }
    switch (ev.type) {
      case 'text':
        if (typeof ev.content === 'string') text += ev.content;
        break;
      case 'tool':
        if (ev.name === 'get_document' && typeof ev.query === 'string') toolSlugs.push(ev.query);
        break;
      case 'sources':
        for (const d of (ev.docs as { library_id: string; slug: string }[] | undefined) ?? []) {
          sources.push(docKey(d));
        }
        break;
      case 'error':
        error ??= typeof ev.message === 'string' ? ev.message : 'error event';
        break;
      case 'done':
        done = true;
        break;
    }
  });

  if (!done) error ??= 'no done event';
  return { text, toolSlugs, sources, durationMs, ...(error ? { error } : {}) };
}
