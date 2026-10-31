// e2e/sso-login.spec.ts — the sign-in page in single sign-on mode and its ?loginError= messages
import { test, expect } from '@playwright/test';

test('in SSO mode the sign-in page offers only "Sign in with SSO", keeping returnTo', async ({ page }) => {
  // The e2e server runs in password mode; the page decides from GET /api/auth/config.
  await page.route('**/api/auth/config', (route) => route.fulfill({ json: { method: 'sso' } }));
  await page.goto('/login?returnTo=%2F%3Fq%3D1');
  const sso = page.locator('#ssoBtn');
  await expect(sso).toBeVisible();
  await expect(sso).toHaveText('Sign in with SSO');
  await expect(sso).toHaveAttribute('href', '/api/auth/sso/login?returnTo=%2F%3Fq%3D1');
  await expect(page.locator('#login')).toBeHidden();
  await expect(page.locator('#password')).toBeHidden();
  await expect(page.locator('#loginBtn')).toBeHidden();
});

test('password mode hides the SSO button; ?loginError= shows a fixed message', async ({ page }) => {
  await page.goto('/login?loginError=not_allowed');
  await expect(page.locator('#loginError')).toHaveText(
    'Your account is not in a group that may use Lore. Ask an administrator for access.',
  );
  await expect(page.locator('#ssoBtn')).toBeHidden();
  await expect(page.locator('#login')).toBeVisible();

  await page.goto('/login?loginError=%3Cimg%20src%3Dx%3E');
  await expect(page.locator('#loginError')).toHaveText('Sign-in failed. Try again.');
});
