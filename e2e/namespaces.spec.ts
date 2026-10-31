// e2e/namespaces.spec.ts — the admin's Namespaces & keys page: create a namespace, move a library,
// issue a project key (shown once) and revoke it, with no CSP violations.
import { test, expect } from '@playwright/test';
import { cleanDb, createLibrary, signIn } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await cleanDb();
  await signIn(page);
});

test('admin manages namespaces and project keys', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy|Refused to/i.test(msg.text())) violations.push(msg.text());
  });
  await createLibrary('billing', 'Billing');

  await page.goto('/');
  await expect(page.locator('#navNamespaces')).toBeVisible();
  await page.locator('#navNamespaces').click();
  await expect(page).toHaveURL(/\/admin\/namespaces$/);
  await expect(page.locator('#namespaceRows tr')).toHaveCount(2);

  await page.locator('#nsId').fill('payments');
  await page.locator('#nsName').fill('Payments');
  await page.locator('#namespaceForm button').click();
  await expect(page.locator('#namespaceRows tr')).toHaveCount(3);

  await page.locator('#assignLibrary').selectOption('billing');
  await page.locator('#assignNamespace').selectOption('payments');
  await page.locator('#assignForm button').click();
  await expect(page.locator('#namespaceRows tr', { hasText: 'payments' })).toContainText('billing');

  await page.locator('#keyNamespace').selectOption('payments');
  await page.locator('#keyName').fill('github-ci');
  await page.locator('#keyForm button').click();
  await expect(page.locator('#newKey')).toContainText('lpk_');
  await expect(page.locator('#keyRows tr')).toHaveCount(1);

  page.once('dialog', (d) => d.accept());
  await page.locator('#keyRows button').click();
  await expect(page.locator('#keyRows tr')).toContainText('revoked');
  expect(violations).toEqual([]);
});
