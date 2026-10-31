import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import {
  DEFAULT_URL,
  NotLoggedInError,
  credentialsPath,
  deleteCredentials,
  readCredentials,
  resolveCredentials,
  writeCredentials,
} from '../../cli/credentials.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'lore-cred-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('credentials file', () => {
  it('lives at <home>/.config/lore/credentials.json', () => {
    expect(credentialsPath(home)).toBe(join(home, '.config', 'lore', 'credentials.json'));
  });

  it('round-trips and is deleted', () => {
    expect(readCredentials(home)).toBeNull();
    writeCredentials({ url: 'https://a', token: 'sk_f' }, home);
    expect(readCredentials(home)).toEqual({ url: 'https://a', token: 'sk_f' });
    expect(statSync(dirname(credentialsPath(home))).mode & 0o777).toBe(0o700);
    expect(statSync(credentialsPath(home)).mode & 0o777).toBe(0o600);
    deleteCredentials(home);
    expect(existsSync(credentialsPath(home))).toBe(false);
    deleteCredentials(home); // no file: a no-op
  });

  it('writes mode 600 even over an existing 644 file', () => {
    // Review Focus 5
    mkdirSync(dirname(credentialsPath(home)), { recursive: true });
    writeFileSync(credentialsPath(home), '{}', { mode: 0o644 });
    writeCredentials({ url: 'https://a', token: 'sk_f' }, home);
    expect(statSync(credentialsPath(home)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(credentialsPath(home), 'utf8'))).toEqual({ url: 'https://a', token: 'sk_f' });
  });

  it('a malformed file reads as no credentials', () => {
    mkdirSync(dirname(credentialsPath(home)), { recursive: true });
    writeFileSync(credentialsPath(home), 'not json');
    expect(readCredentials(home)).toBeNull();
    writeFileSync(credentialsPath(home), '{"url":1}');
    expect(readCredentials(home)).toBeNull();
  });
});

describe('resolveCredentials', () => {
  it('env beats file', () => {
    writeCredentials({ url: 'https://a', token: 'sk_f' }, home);
    expect(resolveCredentials({}, { LORE_TOKEN: 'sk_e', LORE_URL: 'https://a' }, home)).toEqual({ url: 'https://a', token: 'sk_e', source: 'env' });
  });

  it('uses the file for its own url', () => {
    writeCredentials({ url: 'https://a', token: 'sk_f' }, home);
    expect(resolveCredentials({}, {}, home)).toEqual({ url: 'https://a', token: 'sk_f', source: 'file' });
    expect(resolveCredentials({ url: 'https://a/' }, {}, home)).toEqual({ url: 'https://a', token: 'sk_f', source: 'file' });
  });

  it('file token is not sent to another server', () => {
    // Review Focus 5
    writeCredentials({ url: 'https://a', token: 'sk_f' }, home);
    expect(() => resolveCredentials({ url: 'https://b' }, {}, home)).toThrow('not logged in to https://b');
    expect(() => resolveCredentials({}, { LORE_URL: 'https://b' }, home)).toThrow(NotLoggedInError);
  });

  it('--url beats LORE_URL, and the default url is used without anything', () => {
    expect(resolveCredentials({ url: 'https://c/' }, { LORE_URL: 'https://b', LORE_TOKEN: 'lpk_x' }, home)).toEqual({ url: 'https://c', token: 'lpk_x', source: 'env' });
    expect(() => resolveCredentials({}, {}, home)).toThrow(`not logged in to ${DEFAULT_URL}: run lore login --url ${DEFAULT_URL}`);
  });
});
