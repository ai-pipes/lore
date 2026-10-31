// e2e/auth.spec.ts — the sign-in flows end to end: anonymous redirect, password sign-in, a personal
// token shown once, CLI device approval and what a member may not see (the CSP of the new pages: csp.spec.ts).
// Users are not reset between tests, so member logins are unique per run.
import { test, expect, type Page } from '@playwright/test';
import { E2E_LOGIN, E2E_PASSWORD, signIn, watchCsp } from './helpers.js';


/** Creates a member through the admin API (as the signed-in e2e admin) and signs `page` in as them. */
async function signInAsMember(admin: Page, member: Page): Promise<string> {
  await signIn(admin);
  const login = `e2e-member-${Date.now()}`;
  const password = 'a-member-password-1';
  const created = await admin.request.post('/api/users', { data: { login, password, role: 'member' } });
  expect(created.status()).toBe(201);
  const res = await member.request.post('/api/auth/login', { data: { login, password } });
  expect(res.status()).toBe(204);
  return login;
}

test('an anonymous visit to / lands on the sign-in page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login(\?|$)/);
  await expect(page.locator('#loginForm')).toBeVisible();
});

test('password sign-in shows the chat with the user name', async ({ page }) => {
  const violations = watchCsp(page);
  await page.goto('/');
  await page.locator('#login').fill(E2E_LOGIN);
  await page.locator('#password').fill(E2E_PASSWORD);
  await page.locator('#loginBtn').click();
  await expect(page.locator('#input')).toBeVisible();
  await expect(page.locator('#userName')).toHaveText(E2E_LOGIN);
  expect(violations).toEqual([]);
});

test('the Tokens page shows a new token and its MCP command once', async ({ page }) => {
  await signIn(page);
  await page.goto('/tokens');
  const name = `e2e-once-${Date.now()}`;
  await page.locator('#tokenName').fill(name);
  await page.locator('#createTokenBtn').click();
  await expect(page.locator('#newToken')).toHaveText(/^sk_/);
  await expect(page.locator('#mcpCommand')).toContainText('claude mcp add --transport http lore');
  const token = (await page.locator('#newToken').textContent())!;

  await page.reload();
  await expect(page.locator('#tokenRows tr', { hasText: name })).toHaveCount(1);
  await expect(page.locator('#newToken')).toHaveCount(0);
  await expect(page.locator('#mcpCommand')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(token);
});

test('device approval shows the hostname and the poll returns approved', async ({ page, request }) => {
  const start = await request.post('/api/cli/login/start', { data: { hostname: 'auth-e2e-host' } });
  expect(start.status()).toBe(200);
  const s = (await start.json()) as { device_code: string; user_code: string; verification_url: string; interval: number };
  expect(s.interval).toBe(5);

  await signIn(page);
  const url = new URL(s.verification_url);
  await page.goto(url.pathname + url.search);
  await page.locator('#cliCodeInput').fill(s.user_code);
  await page.locator('#cliLookup').click();
  await expect(page.locator('#cliHost')).toHaveText('auth-e2e-host');
  await expect(page.locator('#cliCode')).toHaveText(s.user_code);
  await page.locator('#cliApprove').click();
  await expect(page.locator('#cliDone')).toBeVisible();

  const poll = await request.post('/api/cli/login/poll', { data: { device_code: s.device_code } });
  const body = (await poll.json()) as { status: string; token?: string };
  expect(body.status).toBe('approved');
  expect(body.token).toMatch(/^sk_/);
  // The issued token authenticates as the approver
  const me = await request.get('/api/auth/me', { headers: { Authorization: `Bearer ${body.token}` } });
  expect(me.status()).toBe(200);
  expect(await me.json()).toMatchObject({ kind: 'user', login: E2E_LOGIN });
});

test('a member sees no Users link and gets 403 on /admin/users', async ({ page, browser }) => {
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  try {
    const login = await signInAsMember(page, member);
    await member.goto('/');
    await expect(member.locator('#userName')).toHaveText(login);
    await expect(member.locator('#navTokens')).toBeVisible();
    await expect(member.locator('#navUsers')).toBeHidden();
    await expect(member.locator('#navNamespaces')).toBeHidden();

    const res = await member.request.get('/admin/users');
    expect(res.status()).toBe(403);
    expect((await member.request.get('/api/users')).status()).toBe(403);
  } finally {
    await memberContext.close();
  }
});
