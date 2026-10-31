// Bad fixture: the client CLI imports server code.
import { x } from '../modules/x/index.js';

export const a = (): string => x;
