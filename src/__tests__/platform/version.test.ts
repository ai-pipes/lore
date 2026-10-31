import { readFileSync } from 'fs';
import { LORE_VERSION } from '../../platform/version.js';

describe('LORE_VERSION', () => {
  it('is the version in package.json, so `lore --version` and MCP report the released version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(LORE_VERSION).toBe(pkg.version);
    expect(LORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
