import type { FastifyPluginAsync } from 'fastify';
import type { CatalogDeps } from '../../application/ports.js';
import { diffRoutes } from './diff.js';
import { documentRoutes } from './documents.js';
import { imageRoutes } from './images.js';
import { libraryRoutes } from './libraries.js';
import { namespaceRoutes } from './namespace-routes.js';
import { pushGuard, type CatalogRouteOptions } from './push-guard.js';
import { serviceRoutes } from './services.js';
import { topologyRoutes } from './topology.js';
import { versionRoutes } from './versions.js';

/**
 * The catalog's HTTP routes: libraries, versions, documents, images, diff, topology, services,
 * namespaces and project keys. The push guard runs on every library route after the platform's
 * authorization gate.
 */
export function catalogRoutes(deps: CatalogDeps, opts: CatalogRouteOptions): FastifyPluginAsync {
  return async (app) => {
    app.addHook('onRequest', pushGuard(deps, opts));
    await libraryRoutes(app, deps, opts);
    await versionRoutes(app, deps);
    await documentRoutes(app, deps);
    await imageRoutes(app, deps);
    await diffRoutes(app, deps);
    await topologyRoutes(app, deps);
    await serviceRoutes(app, deps);
    await namespaceRoutes(app, deps, opts);
  };
}
