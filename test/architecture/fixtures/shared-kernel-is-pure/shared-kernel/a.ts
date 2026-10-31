// Bad fixture: shared-kernel imports a Node built-in.
import { existsSync } from 'node:fs';

export const exists = (p: string): boolean => existsSync(p);
