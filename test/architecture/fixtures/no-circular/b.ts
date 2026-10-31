import { a } from './a.js';

export const b = (): string => (typeof a === 'function' ? 'b' : '');
