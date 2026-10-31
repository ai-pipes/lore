// Bad fixture: a module imports platform code other than platform/db.ts.
import { server } from '../../../platform/http/server.js';

export const a = (): string => server;
