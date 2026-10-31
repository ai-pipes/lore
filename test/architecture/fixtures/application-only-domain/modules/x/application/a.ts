// Bad fixture: application imports an npm package outside the allowlist.
import Fastify from 'fastify';

export const app = (): unknown => Fastify();
