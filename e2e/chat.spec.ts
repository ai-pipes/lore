// e2e/chat.spec.ts
import { test, expect } from '@playwright/test';
import { addMessage, cleanDb, createDocument, createLibrary, createSession, createVersion, promoteVersion, signIn } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await cleanDb();
  await signIn(page);
});

test('send message — user bubble appears immediately', async ({ page }) => {
  await page.goto('/');

  // Type a message and submit
  await page.locator('#input').fill('What is the payment flow?');
  await page.locator('#sendBtn').click();

  // User bubble appears synchronously in DOM
  const bubble = page.locator('.msg.user .bubble.u', { hasText: 'What is the payment flow?' });
  await expect(bubble).toBeVisible({ timeout: 8_000 });
});

test('send message — search notice appears and pulses', async ({ page }) => {
  await page.goto('/');

  await page.locator('#input').fill('What is the payment flow?');
  await page.locator('#sendBtn').click();

  // Search notice div appears in the messages area
  const notice = page.locator('.search-notice');
  await expect(notice).toBeVisible({ timeout: 5_000 });

  // The dot should initially have class "pulsing"
  const dot = notice.locator('.sn-dot');
  await expect(dot).toHaveClass(/pulsing/, { timeout: 3_000 });
});

test('an insight shows its author in the document drawer; a service doc shows none', async ({ page }) => {
  await createLibrary('orders-api', 'Orders API');
  await createVersion('orders-api', 'v1');
  await createDocument('orders-api', 'v1', { slug: 'orders/refund', content: '# Refund\n\nRefunds are async.' });
  await promoteVersion('orders-api', 'v1');

  const session = await createSession({ title: 'Authors' });
  await addMessage(session.id, 'user', 'Who wrote this?');
  await addMessage(session.id, 'assistant', 'See [ref:insights/insight/refunds] and [ref:orders-api/orders/refund]');

  // Publishing needs an LLM, which e2e runs without: serve the insight as GET /api/document would.
  await page.route('**/api/document?library_id=insights*', (route) =>
    route.fulfill({
      json: {
        slug: 'insight/refunds',
        summary: 'Refund insights',
        content: '# Refund insights\n\nRefunds are async.',
        library_id: 'insights',
        version_id: 'insights',
        author: { user_id: null, name: 'Alice <b>Admin</b>' },
      },
    }),
  );

  await page.goto('/');
  await page.locator('.sb-item').first().click();
  const chips = page.locator('.cite-chip');
  await expect(chips).toHaveCount(2, { timeout: 5_000 });

  await chips.nth(0).click();
  const author = page.locator('#docDrawerAuthor');
  await expect(page.locator('#docDrawerBody')).toContainText('Refunds are async.');
  await expect(author).toBeVisible();
  await expect(author).toHaveText('by Alice <b>Admin</b>'); // text, never markup
  await page.locator('#docDrawerClose').click();

  await chips.nth(1).click();
  await expect(page.locator('#docDrawerBody')).toContainText('Refunds are async.');
  await expect(author).toBeHidden();
});
