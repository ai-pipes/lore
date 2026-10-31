import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DEFAULT_URL, NotLoggedInError, writeCredentials } from '../../cli/credentials.js';
import { demoCredentials } from '../../../scripts/demo-credentials.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'lore-demo-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('demoCredentials (Review Focus 5)', () => {
  it('never sends LORE_API_KEY to the server in the credentials file', () => {
    writeCredentials({ url: 'https://lore.company', token: 'sk_f' }, home);
    expect(demoCredentials({ LORE_API_KEY: 'admin' }, home)).toMatchObject({ url: DEFAULT_URL, token: 'admin' });
  });

  it('does not target the server in the credentials file without LORE_URL', () => {
    writeCredentials({ url: 'https://lore.company', token: 'sk_f' }, home);
    expect(() => demoCredentials({}, home)).toThrow(NotLoggedInError);
    expect(() => demoCredentials({}, home)).toThrow(`not logged in to ${DEFAULT_URL}`);
  });

  it('uses the file token only for LORE_URL or the default url', () => {
    writeCredentials({ url: 'https://lore.company', token: 'sk_f' }, home);
    expect(demoCredentials({ LORE_URL: 'https://lore.company/' }, home)).toMatchObject({ url: 'https://lore.company', token: 'sk_f' });
    writeCredentials({ url: DEFAULT_URL, token: 'sk_local' }, home);
    expect(demoCredentials({}, home)).toMatchObject({ url: DEFAULT_URL, token: 'sk_local' });
  });

  it('LORE_TOKEN beats LORE_API_KEY, both go to LORE_URL', () => {
    expect(demoCredentials({ LORE_URL: 'https://b', LORE_TOKEN: 'sk_e', LORE_API_KEY: 'admin' }, home)).toMatchObject({ url: 'https://b', token: 'sk_e' });
    expect(demoCredentials({ LORE_URL: 'https://b', LORE_API_KEY: 'admin' }, home)).toMatchObject({ url: 'https://b', token: 'admin' });
  });
});
