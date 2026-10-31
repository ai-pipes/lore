// Bad fixture: domain imports a Node built-in.
import { randomUUID } from 'node:crypto';

export const id = (): string => randomUUID();
