import type { ChatRun } from './answer-checks.js';
import { parseChatStream } from './chat-stream.js';
import type { GoldenQuestion } from './golden.js';
import type { SearchResponse } from './metrics.js';

type Scope = GoldenQuestion['scope'];

export interface LoreClient {
  search(q: string, scope?: Scope): Promise<SearchResponse>;
  chat(q: string, scope?: Scope, timeoutMs?: number): Promise<ChatRun>;
}

export function loginError(status: number): string {
  if (status === 401) return 'wrong LORE_ADMIN_LOGIN/LORE_ADMIN_PASSWORD (login rejected)';
  if (status === 429) return 'login rate-limited, wait and retry';
  if (status === 403) return 'SSO-only server: password login is disabled, chat runs need password sign-in';
  return `login failed: HTTP ${status}`;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function login(base: string, o: { login: string; password: string }): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: o.login, password: o.password }),
    });
  } catch (e) {
    throw new Error(`cannot reach Lore at ${base}: ${errMessage(e)}`, { cause: e });
  }
  if (res.status !== 204) throw new Error(loginError(res.status));
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]!).find((c) => c.startsWith('lore_session='));
  if (!cookie) throw new Error('login succeeded but no lore_session cookie was returned');
  return cookie;
}

export async function connect(o: {
  url: string;
  apiKey: string;
  login: string;
  password: string;
  needChat: boolean;
}): Promise<LoreClient> {
  const base = o.url.replace(/\/+$/, '');
  const cookie = o.needChat ? await login(base, o) : undefined;

  return {
    async search(q, scope) {
      const params = new URLSearchParams({ q });
      if (scope?.library_id) params.set('library_id', scope.library_id);
      if (scope?.branch) params.set('branch', scope.branch);
      const url = `${base}/api/search?${params}`;
      let res: Response;
      try {
        res = await fetch(url, { headers: { authorization: `Bearer ${o.apiKey}` } });
      } catch (e) {
        throw new Error(`cannot reach Lore at ${url}: ${errMessage(e)}`, { cause: e });
      }
      if (!res.ok) throw new Error(`search failed: HTTP ${res.status} (${url})`);
      return (await res.json()) as SearchResponse;
    },

    async chat(q, scope, timeoutMs = 180_000) {
      if (!cookie) throw new Error('chat requires connect({ needChat: true })');
      const body: Record<string, unknown> = { messages: [{ role: 'user', content: q }] };
      if (scope?.library_id) body.library_ids = [scope.library_id];
      if (scope?.branch) body.branch = scope.branch;
      const started = Date.now();
      const failed = (error: string): ChatRun => ({ text: '', toolSlugs: [], sources: [], durationMs: Date.now() - started, error });
      try {
        const res = await fetch(`${base}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return failed(`chat failed: HTTP ${res.status}`);
        const text = await res.text();
        return parseChatStream(text, Date.now() - started);
      } catch (e) {
        if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) return failed('timeout');
        return failed(errMessage(e));
      }
    },
  };
}
