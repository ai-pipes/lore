// Bad fixture: a.ts and b.ts import each other.
import { b } from './b.js';

export const a = (): string => `a${b()}`;
