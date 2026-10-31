import http from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { authenticateBearer, createPgIdentity, type IdentityDeps, type Principal } from '../../modules/identity/index.js';
import { buildContainer, type Container } from '../container.js';
import { registerTools } from './tools.js';
import { LORE_VERSION } from '../version.js';

function createMcpServer(container: Container): McpServer {
  const server = new McpServer({
    name: 'lore',
    version: LORE_VERSION,
  });
  registerTools(server, container);
  return server;
}

/** The MCP tools only read the catalog: no single sign-on, so a partial OIDC env cannot break MCP. */
const mcpContainer = (): Container => buildContainer(process.env, { sso: null });

const toStderr = (...args: unknown[]): void => console.error(...args);

/**
 * Over stdio, stdout carries only JSON-RPC: anything else printed there corrupts the stream. Sends
 * console.log/info/debug to stderr from now on (console.warn/error already go there).
 */
export function reserveStdoutForProtocol(): void {
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
}

export async function startMcpStdio(): Promise<void> {
  reserveStdoutForProtocol();
  const server = createMcpServer(mcpContainer());
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export interface McpHttpOptions {
  /**
   * Resolves the `Authorization` header to who is calling, or null (401). Accepts a user's `sk_`
   * token and the admin key `LORE_API_KEY`; everything else (project keys included) is null.
   */
  authenticate(authorization: string | undefined): Promise<Principal | null>;
  /** Port the server listens on (used for the default Host allowlist). */
  port: number;
  /** Interface to bind. Default 127.0.0.1. */
  host?: string;
  /** Allowed Host header values (host or host:port). Defaults to loopback names when bound to loopback. */
  allowedHosts?: string[];
  /** Allowed browser Origins. Requests carrying any other Origin are rejected. Default: none. */
  allowedOrigins?: string[];
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function splitList(value: string | undefined): string[] | undefined {
  const items = value?.split(',').map((s) => s.trim()).filter(Boolean);
  return items && items.length > 0 ? items : undefined;
}

/**
 * MCP bearer authentication against the database: a user's `sk_` token runs as its owner (null
 * when revoked, unknown or the owner is disabled), `LORE_API_KEY` is the admin. Any other kind of
 * principal, such as a project key, is rejected: MCP is for people and the admin key only.
 */
export function mcpAuthenticator(identity: IdentityDeps): McpHttpOptions['authenticate'] {
  return async (authorization) => {
    if (!authorization?.startsWith('Bearer ')) return null;
    const principal = await authenticateBearer(identity, authorization.slice('Bearer '.length));
    if (principal?.kind === 'user' || principal?.kind === 'admin-key') return principal;
    return null;
  };
}

/** MCP HTTP options from the environment (LORE_MCP_*, LORE_API_KEY). No MCP-specific key. */
export function mcpOptionsFromEnv(port: number, env: Record<string, string | undefined> = process.env): McpHttpOptions {
  return {
    authenticate: mcpAuthenticator(createPgIdentity({ adminKey: env.LORE_API_KEY || undefined })),
    port,
    host: env.LORE_MCP_HOST || '127.0.0.1',
    allowedHosts: splitList(env.LORE_MCP_ALLOWED_HOSTS),
    allowedOrigins: splitList(env.LORE_MCP_ALLOWED_ORIGINS),
  };
}

const principalKey = (p: Principal): string => (p.kind === 'user' ? `user:${p.userId}` : p.kind);

function deny(res: http.ServerResponse, status: number, error: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error }));
}

/**
 * HTTP handler serving MCP over Streamable HTTP (`/mcp`, stateless) and the
 * legacy SSE transport (`GET /sse` + `POST /messages`).
 *
 * Every request must carry `Authorization: Bearer <sk_ token or LORE_API_KEY>`, checked against the
 * database on each request (nothing is cached, so revoking or disabling applies at once); anything
 * else is 401. A legacy SSE session takes `POST /messages` only from the principal that opened it.
 * MCP tools only read and search, so they create no state of the caller. Host and Origin are
 * validated to block DNS-rebinding attacks from browsers; no CORS headers are
 * sent, so browsers on other origins cannot read responses.
 */
export function createMcpHttpHandler(opts: McpHttpOptions): http.RequestListener {
  const container = mcpContainer();
  // Legacy SSE sessions, each bound to the principal that opened it
  const transports = new Map<string, { transport: SSEServerTransport; owner: string }>();
  const host = opts.host ?? '127.0.0.1';
  const allowedHosts = opts.allowedHosts
    ?? (LOOPBACK.has(host) ? ['localhost', '127.0.0.1', '[::1]'].flatMap((h) => [h, `${h}:${opts.port}`]) : undefined);
  const allowedOrigins = opts.allowedOrigins ?? [];

  return async (req, res) => {
    try {
      const reqHost = (req.headers.host ?? '').toLowerCase();
      if (allowedHosts && !allowedHosts.map((h) => h.toLowerCase()).includes(reqHost)) {
        return deny(res, 403, 'Host not allowed');
      }
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.includes(origin)) {
        return deny(res, 403, 'Origin not allowed');
      }
      const principal = await opts.authenticate(req.headers.authorization);
      if (!principal) {
        res.setHeader('WWW-Authenticate', 'Bearer');
        return deny(res, 401, req.headers.authorization ? 'Invalid token' : 'Missing Authorization header');
      }

      const url = new URL(req.url ?? '/', 'http://localhost');

      if (url.pathname === '/mcp') {
        // Stateless Streamable HTTP: a fresh server + transport per request
        const server = createMcpServer(container);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/sse') {
        const transport = new SSEServerTransport('/messages', res);
        transports.set(transport.sessionId, { transport, owner: principalKey(principal) });
        transport.onclose = () => {
          transports.delete(transport.sessionId);
        };
        const server = createMcpServer(container);
        await server.connect(transport);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/messages') {
        const sessionId = url.searchParams.get('sessionId');
        const session = sessionId ? transports.get(sessionId) : undefined;
        // Another principal's session answers like an unknown one
        if (!session || session.owner !== principalKey(principal)) return deny(res, 404, 'Session not found');
        await session.transport.handlePostMessage(req, res);
        return;
      }

      deny(res, 404, 'Not found');
    } catch (err) {
      console.error('[mcp] request failed:', err);
      if (!res.headersSent) deny(res, 500, 'Internal Server Error');
      else res.end();
    }
  };
}

export function startMcpHttp(opts: McpHttpOptions): http.Server {
  const host = opts.host ?? '127.0.0.1';
  if (!LOOPBACK.has(host) && !opts.allowedHosts) {
    console.warn(
      `[mcp] Listening on ${host} without LORE_MCP_ALLOWED_HOSTS: Host header validation is disabled ` +
        '(bearer auth still applies). Set LORE_MCP_ALLOWED_HOSTS to the names clients use.',
    );
  }
  const httpServer = http.createServer(createMcpHttpHandler(opts));
  httpServer.listen(opts.port, host, () => {
    console.log(`MCP server listening on http://${host}:${opts.port}/mcp (Streamable HTTP) and /sse (SSE)`);
  });
  return httpServer;
}

/** Backwards-compatible entry point used by `lore serve`. */
export function startMcpSse(port: number): http.Server {
  return startMcpHttp(mcpOptionsFromEnv(port));
}
