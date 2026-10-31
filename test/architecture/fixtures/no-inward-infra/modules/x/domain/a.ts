// Bad fixture: domain imports infrastructure.
import { b } from '../infrastructure/b.js';

export const a = (): string => b;
