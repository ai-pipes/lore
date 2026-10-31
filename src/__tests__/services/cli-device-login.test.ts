import { describe, it, expect, afterEach, vi } from 'vitest';
import { browserCommand, deviceLogin } from '../../cli/auth-commands.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fake server: `/start` returns `verification_url`, `/poll` approves at once. */
function stubServer(verificationUrl: string, userCode = 'BCDF-GHJK') {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url);
    const body = url.endsWith('/api/cli/login/start')
      ? { device_code: 'd', user_code: userCode, verification_url: verificationUrl, expires_in: 600, interval: 1 }
      : { status: 'approved', token: 'sk_t' };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return calls;
}

async function run(verificationUrl: string, base = 'https://lore.company', userCode?: string) {
  stubServer(verificationUrl, userCode);
  const open = vi.fn(async () => {});
  const printed: string[] = [];
  const creds = await deviceLogin(base, 'devbox', { print: (s) => void printed.push(s), open, sleep: async () => {} });
  expect(creds).toEqual({ url: base, token: 'sk_t' });
  return { opened: (open.mock.calls as unknown as [string][]).map((c) => c[0]), printed: printed.join('\n') };
}

describe('deviceLogin opens only a URL on the server it signs in to', () => {
  it('opens the server URL when it is http(s) on the same origin, and asks to type the code', async () => {
    const { opened, printed } = await run('https://lore.company/cli/login');
    expect(opened).toEqual(['https://lore.company/cli/login']);
    expect(printed).toContain('https://lore.company/cli/login');
    expect(printed).toContain('type the code BCDF-GHJK');
  });

  it.each([
    ['another origin', 'https://evil.example/cli/login'],
    ['another port', 'https://lore.company:8443/cli/login'],
    ['a file: URL', 'file:///etc/passwd'],
    ['a custom scheme', 'vscode://x/y'],
    ['not a URL', 'not a url'],
    ['cmd metacharacters', 'https://lore.company/cli/login?x=1&calc.exe'],
  ])('does not open %s; prints the approval page of the base URL instead', async (name, verificationUrl) => {
    const { opened, printed } = await run(verificationUrl);
    if (name === 'cmd metacharacters') {
      // same origin and https: opened as is, but never through a shell (see browserCommand)
      expect(opened).toEqual([verificationUrl]);
      return;
    }
    expect(opened).toEqual([]);
    expect(printed).toContain('https://lore.company/cli/login');
    expect(printed).not.toContain(verificationUrl);
  });

  it('keeps the base path of a server under a prefix', async () => {
    const { opened, printed } = await run('https://evil.example/', 'https://corp.example/lore');
    expect(opened).toEqual([]);
    expect(printed).toContain('https://corp.example/lore/cli/login');
  });
});

describe('browserCommand', () => {
  const u = 'http://x/?code=A&calc.exe';
  it('does not hand the URL to cmd.exe on Windows', () => {
    expect(browserCommand(u, 'win32')).toEqual(['rundll32', ['url.dll,FileProtocolHandler', u]]);
  });
  it('uses open on macOS and xdg-open elsewhere', () => {
    expect(browserCommand(u, 'darwin')).toEqual(['open', [u]]);
    expect(browserCommand(u, 'linux')).toEqual(['xdg-open', [u]]);
  });
});
