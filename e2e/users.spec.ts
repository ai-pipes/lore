// e2e/users.spec.ts — the admin's Users page: add a member, disable and enable them, with no CSP
// violations. Users are not reset between tests, so logins are unique per run.
import { test, expect } from '@playwright/test';
import { signIn } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('admin adds, disables and enables a user, resets their password and unlocks them', async ({ page, request }) => {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy|Refused to/i.test(msg.text())) violations.push(msg.text());
  });
  const login = `e2e-user-${Date.now()}`;

  await page.goto('/');
  await expect(page.locator('#navUsers')).toBeVisible();
  await page.locator('#navUsers').click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.locator('tr[data-user="e2e-admin"]')).toBeVisible();
  // You cannot disable yourself
  await expect(page.locator('[data-user-toggle="e2e-admin"]')).toBeDisabled();

  await page.locator('#newLogin').fill(login);
  await page.locator('#newDisplayName').fill('E2E User');
  await page.locator('#newPassword').fill('short');
  await page.locator('#userForm button').click();
  await expect(page.locator('#userError')).toBeVisible();

  await page.locator('#newPassword').fill('a-long-enough-password');
  await page.locator('#userForm button').click();
  const row = page.locator(`tr[data-user="${login}"]`);
  await expect(row).toContainText('E2E User');

  page.once('dialog', (d) => d.accept());
  await row.locator('[data-user-toggle]').click();
  await expect(row).toContainText('disabled');
  await row.locator('[data-user-toggle]').click();
  await expect(row).not.toContainText('disabled');

  // a separate request context: page.request would sign the admin's page in as the new user
  const res = await request.post('/api/auth/login', { data: { login, password: 'a-long-enough-password' } });
  expect(res.status()).toBe(204);

  // Reset the password: a confirm (sessions end, tokens are revoked), then the new password
  const answers: (string | undefined)[] = [undefined, 'a-new-long-password-2'];
  const onDialog = (d: import('@playwright/test').Dialog) => void d.accept(answers.shift());
  page.on('dialog', onDialog);
  await row.locator('[data-user-reset]').click();
  await expect(page.locator('#userNotice')).toContainText('personal tokens were revoked');
  page.off('dialog', onDialog);
  await row.locator('[data-user-unlock]').click();
  await expect(page.locator('#userNotice')).toContainText('unlocked');
  expect(violations).toEqual([]);
});
