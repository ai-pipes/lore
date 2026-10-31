// Bad fixture: module a reaches into module b's internals instead of its index.ts.
import { b } from '../../b/infrastructure/b.js';

export const a = (): string => b;
