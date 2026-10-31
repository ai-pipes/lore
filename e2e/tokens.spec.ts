// e2e/tokens.spec.ts — the Tokens page: create a token (shown once with the MCP command), use it, revoke it.
import { test, expect } from '@playwright/test';
import { signIn } from './helpers.js';

test('create, use and revoke a personal token without CSP violations', async ({ page, request }) => {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy|Refused to/i.test(msg.text())) violations.push(msg.text());
  });
  await signIn(page);

  await page.goto('/');
  await expect(page.locator('#navTokens')).toBeVisible();
  await page.locator('#navTokens').click();
  await expect(page).toHaveURL(/\/tokens$/);

  const name = `e2e-${Date.now()}`;
  await page.locator('#tokenName').fill(name);
  await page.locator('#createTokenBtn').click();
  await expect(page.locator('#newToken')).toHaveText(/^sk_[A-Za-z0-9_-]{43}$/);
  const token = (await page.locator('#newToken').textContent())!;
  await expect(page.locator('#mcpCommand')).toHaveText(
    `claude mcp add --transport http lore http://localhost:4738/mcp --header "Authorization: Bearer ${token}"`,
  );
  const row = page.locator('#tokenRows tr', { hasText: name });
  await expect(row).toHaveCount(1);
  await expect(row).not.toContainText(token);

  const me = await request.get('/api/auth/me', { headers: { authorization: `Bearer ${token}` } });
  expect(me.status()).toBe(200);

  page.once('dialog', (d) => void d.accept());
  await row.getByRole('button', { name: `Revoke ${name}` }).click();
  await expect(row).toHaveClass(/revoked/);
  const after = await request.get('/api/auth/me', { headers: { authorization: `Bearer ${token}` } });
  expect(after.status()).toBe(401);

  // The token is not shown again after a reload
  await page.reload();
  await expect(page.locator('#tokenRows tr', { hasText: name })).toHaveCount(1);
  await expect(page.locator('#newToken')).toHaveCount(0);
  expect(violations).toEqual([]);
});
