import type { Page } from '@playwright/test';

/** The e2e server port: LORE_E2E_PORT, default 3737 (playwright.config.ts uses the same). */
export const E2E_PORT = parseInt(process.env.LORE_E2E_PORT ?? '3737', 10);
const BASE = `http://127.0.0.1:${E2E_PORT}`;

/** Collects the CSP violations the page logs to the console. */
export function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy|Refused to/i.test(msg.text())) violations.push(msg.text());
  });
  return violations;
}
const API_KEY = process.env.LORE_API_KEY ?? 'changeme';
const AUTH_HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};
/** The first admin, created by bootstrapAdmin from the env in playwright.config.ts. */
export const E2E_LOGIN = 'e2e-admin';
export const E2E_PASSWORD = 'e2e-admin-password-1';

/** Signs the page's browser context in (the `lore_session` cookie lands in its cookie jar). */
export async function signIn(page: Page): Promise<void> {
  const res = await page.request.post('/api/auth/login', { data: { login: E2E_LOGIN, password: E2E_PASSWORD } });
  if (res.status() !== 204) throw new Error(`signIn failed: ${res.status()} ${await res.text()}`);
}

/** Signs in with fetch and returns the `Cookie` header of the new web session. */
export async function apiCookie(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: E2E_LOGIN, password: E2E_PASSWORD }),
  });
  if (res.status !== 204) throw new Error(`apiCookie failed: ${res.status} ${await res.text()}`);
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('apiCookie: no Set-Cookie');
  return setCookie.split(';')[0];
}

/** Chat routes are for users: requests carry the e2e admin's session cookie (one per run). */
let cookie: Promise<string> | undefined;
async function sessionHeaders(): Promise<Record<string, string>> {
  cookie ??= apiCookie();
  return { Cookie: await cookie, 'Content-Type': 'application/json' };
}

export async function cleanDb(): Promise<void> {
  const res = await fetch(`${BASE}/api/test/reset`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`cleanDb failed: ${res.status} ${await res.text()}`);
}

export async function createLibrary(id: string, displayName: string) {
  const res = await fetch(`${BASE}/api/libraries`, {
    method: 'POST',
    headers: AUTH_HEADERS,
    body: JSON.stringify({ id, display_name: displayName }),
  });
  if (!res.ok) throw new Error(`createLibrary failed: ${res.status}`);
  return res.json();
}

export async function createVersion(libraryId: string, versionId: string) {
  const res = await fetch(`${BASE}/api/libraries/${libraryId}/versions`, {
    method: 'POST',
    headers: AUTH_HEADERS,
    body: JSON.stringify({ id: versionId }),
  });
  if (!res.ok) throw new Error(`createVersion failed: ${res.status}`);
  return res.json();
}

export async function promoteVersion(libraryId: string, versionId: string) {
  const res = await fetch(`${BASE}/api/libraries/${libraryId}/versions/${versionId}/promote`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) throw new Error(`promoteVersion failed: ${res.status}`);
  return res.json();
}

export async function createDocument(
  libraryId: string,
  versionId: string,
  data: { slug: string; content: string; summary?: string; domain?: string },
) {
  const form = new FormData();
  form.append('slug', data.slug);
  form.append('content', data.content);
  if (data.summary) form.append('summary', data.summary);
  if (data.domain) form.append('domain', data.domain);
  const res = await fetch(`${BASE}/api/libraries/${libraryId}/versions/${versionId}/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`createDocument failed: ${res.status}`);
  return res.json();
}

export async function createSession(data: {
  title?: string;
  pinned_docs?: Array<{ slug: string; library_id: string }>;
  scope_filters?: string[];
} = {}) {
  const res = await fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: await sessionHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`createSession failed: ${res.status}`);
  return (await res.json()) as { id: string; title: string };
}

export async function addMessage(sessionId: string, role: 'user' | 'assistant', content: string) {
  const res = await fetch(`${BASE}/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: await sessionHeaders(),
    body: JSON.stringify({ role, content }),
  });
  if (!res.ok) throw new Error(`addMessage failed: ${res.status}`);
  return res.json();
}
