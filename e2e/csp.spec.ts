// e2e/csp.spec.ts — the UI loads nothing from other origins and triggers no CSP violations.
import { test, expect } from '@playwright/test';
import { cleanDb, createSession, addMessage, signIn, watchCsp } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await cleanDb();
  await signIn(page);
});

test('page makes no external requests and has no CSP violations', async ({ page, baseURL }) => {
  const external: string[] = [];
  const violations = watchCsp(page);
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith(baseURL!) && !url.startsWith('data:') && !url.startsWith('blob:')) external.push(url);
  });

  const session = await createSession({ title: 'Code' });
  await addMessage(session.id, 'user', 'show code');
  await addMessage(session.id, 'assistant', 'Example:\n\n```js\nconst x = 1;\n```\n\n**Bold** and a [ref:orders-api/orders/refund-create] chip.');

  await page.goto('/');
  await expect(page.locator('#input')).toBeVisible();
  await page.locator('.sb-item').first().click();
  await expect(page.locator('.cite-chip')).toHaveCount(1, { timeout: 5_000 });
  await expect(page.locator('pre code.hljs')).toHaveCount(1); // highlight.js ran
  await page.locator('#input').fill('refunds');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.search-notice')).toBeVisible({ timeout: 5_000 });
  await page.waitForLoadState('networkidle');

  expect(external).toEqual([]);
  expect(violations).toEqual([]);
});

// Mermaid/d3 set inline style attributes, which the CSP blocks (logged as violations);
// the diagram still renders from the theme stylesheet that carries the page nonce.
test('mermaid diagrams render under the CSP', async ({ page }) => {
  const session = await createSession({ title: 'Diagram' });
  await addMessage(session.id, 'user', 'diagram');
  await addMessage(session.id, 'assistant', '```mermaid\nflowchart LR\n  A[Order] --> B[Payment]\n```');
  await page.goto('/');
  await page.locator('.sb-item').first().click();
  const svg = page.locator('.mermaid-diagram svg');
  await expect(svg).toHaveCount(1, { timeout: 10_000 });
  await expect(svg).toContainText('Payment');
  // labels are SVG text (htmlLabels: false), so they are measured without inline styles
  expect(await svg.locator('foreignObject').count()).toBe(0);
});

// Regression: diagram directives from documents/LLM output must not inject CSS.
test('mermaid %%{init}%% themeCSS directives cannot inject styles', async ({ page }) => {
  const session = await createSession({ title: 'Evil diagram' });
  await addMessage(session.id, 'user', 'diagram');
  await addMessage(
    session.id,
    'assistant',
    '```mermaid\n%%{init: {"theme": "base", "themeCSS": ".node rect { fill: rgb(255, 0, 0) !important; } body { display: none }", "themeVariables": {"primaryColor": "#ff0000"}}}%%\nflowchart LR\n  A[Order] --> B[Payment]\n```',
  );
  await page.goto('/');
  await page.locator('.sb-item').first().click();
  const svg = page.locator('.mermaid-diagram svg');
  await expect(svg).toHaveCount(1, { timeout: 10_000 });
  expect(await svg.locator('style').count()).toBe(0);
  expect(await page.locator('[nonce]').count()).toBe(0);
  const fill = await svg.locator('.node rect').first().evaluate((el) => getComputedStyle(el).fill);
  expect(fill).not.toBe('rgb(255, 0, 0)');
  await expect(page.locator('body')).toBeVisible();
});

test('the sign-in page loads under the CSP and signs in', async ({ page, baseURL }) => {
  const external: string[] = [];
  const violations = watchCsp(page);
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith(baseURL!) && !url.startsWith('data:') && !url.startsWith('blob:')) external.push(url);
  });

  await page.goto('/login?returnTo=%2F%3Fq%3D1');
  await expect(page.locator('#loginForm')).toBeVisible();
  await page.locator('#login').fill('e2e-admin');
  await page.locator('#password').fill('wrong-password-123');
  await page.locator('#loginBtn').click();
  await expect(page.locator('#loginError')).toHaveText('Invalid login or password.');

  await page.locator('#password').fill('e2e-admin-password-1');
  await page.locator('#loginBtn').click();
  await page.waitForURL('**/?q=1');
  await expect(page.locator('#userName')).toHaveText('e2e-admin');
  await page.waitForLoadState('networkidle');

  await page.locator('#signOutBtn').click();
  await page.waitForURL('**/login');
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);

  expect(external).toEqual([]);
  expect(violations).toEqual([]);
});

test('the account and admin pages load with no external requests and no CSP violations', async ({ page, baseURL }) => {
  const external: string[] = [];
  const violations = watchCsp(page);
  page.on('request', (req) => {
    const u = req.url();
    if (!u.startsWith(baseURL!) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
  });

  await page.goto('/login');
  await expect(page.locator('#loginForm')).toBeVisible();
  await page.waitForLoadState('networkidle');

  await signIn(page);
  for (const [path, ready] of [
    ['/tokens', '#tokenName'],
    ['/admin/users', '#userForm'],
    ['/admin/namespaces', '#namespaceForm'],
    ['/cli/login', '#cliCodeForm'],
  ] as const) {
    await page.goto(path);
    await expect(page.locator(ready)).toBeVisible();
    await page.waitForLoadState('networkidle');
  }

  expect(external).toEqual([]);
  expect(violations).toEqual([]);
});
