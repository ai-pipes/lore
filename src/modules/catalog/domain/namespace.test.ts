import { describe, expect, it } from 'vitest';
import { DEFAULT_NAMESPACE, INSIGHTS_NAMESPACE, isSystemNamespace, isValidNamespaceId, NAMESPACE_ID_RE } from './namespace.js';

describe('namespace id', () => {
  it('accepts lowercase slugs of up to 63 characters', () => {
    expect(isValidNamespaceId('pay')).toBe(true);
    expect(isValidNamespaceId('team_a-2')).toBe(true);
    expect(isValidNamespaceId('a'.repeat(63))).toBe(true);
    expect(NAMESPACE_ID_RE.test('0x')).toBe(true);
  });

  it('rejects empty, long, uppercase and separator-first ids', () => {
    expect(isValidNamespaceId('')).toBe(false);
    expect(isValidNamespaceId('a'.repeat(64))).toBe(false);
    expect(isValidNamespaceId('Pay')).toBe(false);
    expect(isValidNamespaceId('-pay')).toBe(false);
    expect(isValidNamespaceId('pay/x')).toBe(false);
  });
});

describe('reserved namespaces', () => {
  it('default and insights are reserved; only insights is a system namespace', () => {
    expect(DEFAULT_NAMESPACE).toBe('default');
    expect(INSIGHTS_NAMESPACE).toBe('insights');
    expect(isSystemNamespace('insights')).toBe(true);
    expect(isSystemNamespace('default')).toBe(false);
    expect(isSystemNamespace('pay')).toBe(false);
  });
});
