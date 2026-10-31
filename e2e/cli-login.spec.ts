// e2e/cli-login.spec.ts — a person approves a CLI device login in the browser (strict CSP).
import { test, expect } from '@playwright/test';
import { signIn } from './helpers.js';

test('the approval page signs the CLI in with one click and no CSP violations', async ({ page, request }) => {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy|Refused to/i.test(msg.text())) violations.push(msg.text());
  });

  const start = await request.post('/api/cli/login/start', { data: { hostname: 'e2e-box' } });
  expect(start.status()).toBe(200);
  const s = (await start.json()) as { device_code: string; user_code: string; verification_url: string };
  const poll = async () =>
    ((await (await request.post('/api/cli/login/poll', { data: { device_code: s.device_code } })).json()) as { status: string; token?: string });
  expect((await poll()).status).toBe('pending');

  await signIn(page);
  expect(new URL(s.verification_url).search).toBe(''); // the link carries no code
  await page.goto(new URL(s.verification_url).pathname);
  await expect(page.locator('#cliCodeInput')).toHaveValue('');
  await page.locator('#cliCodeInput').fill(s.user_code.toLowerCase());
  await page.locator('#cliLookup').click();
  await expect(page.locator('#cliCode')).toHaveText(s.user_code);
  await expect(page.locator('#cliHost')).toHaveText('e2e-box');
  await expect(page.locator('#cliIp')).not.toBeEmpty();
  await expect(page.getByText('reported by the CLI')).toBeVisible();
  await page.locator('#cliApprove').click();
  await expect(page.locator('#cliDone')).toContainText('The CLI is signed in');
  await expect(page.locator('#cliActions')).toBeHidden();

  const approved = await poll();
  expect(approved.status).toBe('approved');
  expect(approved.token).toMatch(/^sk_/);
  expect((await poll()).status).toBe('expired');
  expect(violations).toEqual([]);
});

test('deny in the browser makes the poll say denied', async ({ page, request }) => {
  const s = (await (await request.post('/api/cli/login/start', { data: { hostname: 'e2e-box' } })).json()) as {
    device_code: string;
    user_code: string;
  };
  await signIn(page);
  await page.goto(`/cli/login?code=${s.user_code}`); // a code in a link is ignored
  await expect(page.locator('#cliCodeInput')).toHaveValue('');
  await page.locator('#cliCodeInput').fill(s.user_code);
  await page.locator('#cliLookup').click();
  await page.locator('#cliDeny').click();
  await expect(page.locator('#cliDone')).toContainText('denied');
  const p = await (await request.post('/api/cli/login/poll', { data: { device_code: s.device_code } })).json();
  expect(p).toEqual({ status: 'denied' });
});

test('an unknown code is explained and offers no buttons', async ({ page }) => {
  await signIn(page);
  await page.goto('/cli/login');
  await page.locator('#cliCodeInput').fill('BBBB-BBBB');
  await page.locator('#cliLookup').click();
  await expect(page.locator('#cliError')).toContainText('No sign-in request has this code');
  await expect(page.locator('#cliApprove')).toBeHidden();
});

test('an anonymous visitor is sent to sign in first', async ({ page }) => {
  await page.goto('/cli/login?code=BCDF-GHJK');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fcli%2Flogin%3Fcode%3DBCDF-GHJK$/);
});
