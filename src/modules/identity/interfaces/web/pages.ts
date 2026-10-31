/**
 * HTML shells of the account pages (sign-in, and later tokens, users, namespaces, CLI sign-in).
 * They load only `/assets/lore.css` and `/assets/account.js` and hold no inline code or styles:
 * account.js picks the page from `<body data-page>`.
 */
export type AccountPage = 'login' | 'tokens' | 'users' | 'namespaces' | 'cli-login';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const LOGIN_BODY = `<div class="pub-modal-bg open account-login">
  <form class="pub-modal" id="loginForm" novalidate>
    <h3>Sign in to Lore</h3>
    <div id="passwordFields">
      <label for="login">Login</label>
      <input type="text" id="login" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus>
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autocomplete="current-password" required>
    </div>
    <p class="login-error" id="loginError" role="alert" hidden></p>
    <div class="pub-modal-actions">
      <a class="pub-confirm sso-button" id="ssoBtn" href="/api/auth/sso/login" hidden>Sign in with SSO</a>
      <button class="pub-confirm" type="submit" id="loginBtn">Sign in</button>
    </div>
  </form>
</div>`;

const BODIES: Record<AccountPage, string> = {
  login: LOGIN_BODY,
  tokens: '<main class="account-page" id="account"></main>',
  users: '<main class="account-page" id="account"></main>',
  namespaces: '<main class="account-page" id="account"></main>',
  'cli-login': '<main class="account-page" id="account"></main>',
};

export function renderAccountPage(page: AccountPage, title: string, body: string = BODIES[page]): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Lore — ${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/lore.css">
<script src="/assets/account.js" defer></script>
</head>
<body data-page="${page}">
${body}
</body>
</html>`;
}

/**
 * The CLI sign-in (device approval) page: a blank form for the code the person's terminal shows.
 * Links never carry the code (a link someone else sends cannot lead to a one-click approval).
 * account.js looks the code up and then shows the hostname the CLI reported and the address the
 * request came from, so the person can tell a request they did not start.
 */
export function renderCliLoginPage(): string {
  return renderAccountPage(
    'cli-login',
    'Sign in the CLI',
    `<div class="pub-modal-bg open account-login">
  <section class="pub-modal cli-login">
    <h3>Sign in the CLI</h3>
    <form id="cliCodeForm" novalidate>
      <label for="cliCodeInput">Type the code your terminal shows after <code>lore login</code></label>
      <input type="text" id="cliCodeInput" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX" maxlength="16" required autofocus>
      <div class="pub-modal-actions">
        <button class="pub-confirm" type="submit" id="cliLookup">Continue</button>
      </div>
    </form>
    <div id="cliRequest" hidden>
      <p class="cli-login-code" id="cliCode"></p>
      <dl class="cli-login-facts">
        <dt>Hostname (reported by the CLI, not verified)</dt>
        <dd id="cliHost"></dd>
        <dt>Requested from IP address</dt>
        <dd id="cliIp"></dd>
      </dl>
      <p class="cli-login-note">Approve only if you just ran <code>lore login</code> yourself, from this machine and address. The CLI gets a personal token named <code id="cliTokenName"></code> that expires; you can revoke it on the Tokens page.</p>
      <div class="pub-modal-actions" id="cliActions">
        <button class="pub-cancel" type="button" id="cliDeny">Deny</button>
        <button class="pub-confirm" type="button" id="cliApprove">Approve</button>
      </div>
    </div>
    <p class="login-error" id="cliError" role="alert" hidden></p>
    <p class="cli-login-note" id="cliDone" role="status" hidden></p>
  </section>
</div>`,
  );
}
