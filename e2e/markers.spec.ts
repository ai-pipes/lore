// e2e/markers.spec.ts — citation/suggestion chips render in a real browser and
// hostile marker values cannot execute script (stored XSS regression).
import { test, expect } from '@playwright/test';
import { cleanDb, createSession, addMessage, signIn } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await cleanDb();
  await signIn(page);
});

test('restored answer renders chips and neutralises hostile markers', async ({ page }) => {
  const session = await createSession({ title: 'Markers' });
  await addMessage(session.id, 'user', 'How do refunds work?');
  await addMessage(
    session.id,
    'assistant',
    'Refunds are async. [ref:orders-api/orders/refund-create]\n\n' +
      'Also see [suggest:payments-service.payments/charge-card]\n\n' +
      'Hostile: [suggest:x" onmouseover="window.__xss=1" a=".slug] ' +
      '[ref:lib/a" autofocus onfocus="window.__xss=1] <img src=x onerror="window.__xss=1">',
  );

  await page.goto('/');
  await page.locator('.sb-item').first().click();

  const cite = page.locator('.cite-chip');
  await expect(cite).toHaveCount(1, { timeout: 5_000 });
  await expect(cite).toHaveAttribute('data-slug', 'orders/refund-create');
  await expect(page.locator('.suggest-add')).toHaveCount(1);

  await page.locator('.bubble').last().hover();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(await page.locator('[onmouseover], [onfocus], [onerror]').count()).toBe(0);
});
