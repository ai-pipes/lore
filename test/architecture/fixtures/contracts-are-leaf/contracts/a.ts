// Bad fixture: contracts import platform code.
import { db } from '../platform/db.js';

export const a = (): string => db;
