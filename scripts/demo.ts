/**
 * Push the demo documentation (examples/demo-docs) to a running Lore server
 * and run one search so you can see it working.
 *
 *   npm run demo                      # http://localhost:4737, LORE_API_KEY from .env
 *   LORE_URL=https://lore.example.com LORE_TOKEN=sk_... npm run demo
 */
import 'dotenv/config';
import { createHash } from 'crypto';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { push } from '../src/cli/push.js';
import { demoCredentials } from './demo-credentials.js';

let creds: { url: string; token: string };
try {
  creds = demoCredentials(process.env);
} catch (e) {
  console.error(`${(e as Error).message} (or set LORE_TOKEN)`);
  process.exit(1);
}
const { url: baseUrl, token } = creds;
const root = join(process.cwd(), 'examples', 'demo-docs');

function hashDir(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(p.slice(root.length)).update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex').slice(0, 12);
}

async function main() {
  const health = await fetch(`${baseUrl}/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`Lore is not reachable at ${baseUrl}. Start it first (docker compose up -d, or npm run dev).`);
    process.exit(1);
  }

  for (const library of readdirSync(root).filter((n) => statSync(join(root, n)).isDirectory())) {
    const dir = join(root, library);
    console.log(`\n=== ${library}`);
    await push({ dir, library, version: `demo-${hashDir(dir)}`, baseUrl, token, promote: true, incremental: true });
  }

  const q = 'refund delivered order';
  const res = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as { total: number; groups: Array<{ results: Array<{ library_id: string; slug: string; summary: string | null }> }> };
  console.log(`\nSearch "${q}": ${body.total} result(s)`);
  for (const r of body.groups.flatMap((g) => g.results).slice(0, 5)) {
    console.log(`  ${r.library_id}/${r.slug} — ${r.summary ?? ''}`);
  }
  console.log(`\nOpen ${baseUrl} and ask, for example:`);
  console.log('  - How do refunds work for delivered orders?');
  console.log('  - What happens after an order is placed, across services?');
  console.log('  - Which notifications can a user turn off?');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
