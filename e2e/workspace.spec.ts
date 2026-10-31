// e2e/workspace.spec.ts
import { test, expect } from '@playwright/test';
import {
  cleanDb, createLibrary, createVersion, createDocument,
  createSession, addMessage, promoteVersion, signIn,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await cleanDb();
  await signIn(page);
});

test('initial load — sidebar shows existing sessions', async ({ page }) => {
  const session = await createSession({ title: 'My Test Chat' });
  expect(session.id).toBeTruthy();

  await page.goto('/');

  const item = page.locator('.sb-item-title', { hasText: 'My Test Chat' });
  await expect(item).toBeVisible({ timeout: 5_000 });
});

test('initial load — scope selector shows services', async ({ page }) => {
  await createLibrary('test-svc', 'Test Service');
  await createVersion('test-svc', 'v1');
  await promoteVersion('test-svc', 'v1');
  await createDocument('test-svc', 'v1', { slug: 'some/doc', content: '# Doc\nContent here.', domain: 'test-service' });

  await page.goto('/');

  // Open the scope dropdown
  await page.click('#scopeBtn');

  // Library display name appears in the list
  const item = page.locator('.scope-item .scope-name', { hasText: 'Test Service' });
  await expect(item).toBeVisible({ timeout: 5_000 });
});

test('session restore — loads messages', async ({ page }) => {
  const session = await createSession({ title: 'Restored Chat' });
  await addMessage(session.id, 'user', 'Hello from user');
  await addMessage(session.id, 'assistant', 'Hello from assistant');

  await page.goto('/');

  // After addMessage with a user message, autoTitle renames the session to the message text.
  // The sidebar will show the first user message as the title.
  await page.locator('.sb-item-title', { hasText: 'Hello from user' }).click();

  // Both messages should appear
  const userBubble = page.locator('.msg.user .bubble.u', { hasText: 'Hello from user' });
  await expect(userBubble).toBeVisible({ timeout: 5_000 });

  const assistantMsg = page.locator('.msg:not(.user) .bubble.a');
  await expect(assistantMsg).toContainText('Hello from assistant', { timeout: 5_000 });
});

test('session restore — restores scope filters', async ({ page }) => {
  await createLibrary('scoped-lib', 'Scoped Library');
  await createSession({ scope_filters: ['scoped-lib'] });

  await page.goto('/');

  await page.locator('.sb-item').first().click();

  // scopeBtn should have class "filtered" and show the library id
  const btn = page.locator('#scopeBtn');
  await expect(btn).toHaveClass(/filtered/, { timeout: 5_000 });
  await expect(page.locator('#scopeBtnLabel')).toHaveText('scoped-lib', { timeout: 5_000 });
});
