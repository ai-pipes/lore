import 'dotenv/config';
// Usage: npx tsx scripts/debug-search.ts ["query one" "query two" ...]
// Prints libraries/versions, document counts, FTS results and sample search vectors.
import { initDb, getDb } from '../src/platform/db.js';
import { searchDocs } from '../src/modules/catalog/infrastructure/pg-document-search.js';
import { sql } from 'drizzle-orm';
import { documents } from '../src/modules/catalog/infrastructure/schema.js';
import { versions } from '../src/modules/catalog/infrastructure/schema.js';

async function run() {
  await initDb();
  const db = getDb();

  // 1. Libraries and versions
  console.log('── Libraries and versions ──────────────');
  const libs = await db.select({
    library_id: versions.library_id,
    version_id: versions.id,
    branch: versions.branch,
    is_current: versions.is_current,
  }).from(versions).orderBy(versions.library_id);
  libs.forEach(v => console.log(` ${v.library_id} | v=${v.version_id} | branch=${v.branch ?? '—'} | is_current=${v.is_current}`));

  // 2. Document count per library
  console.log('\n── Documents per library ───────────────');
  const counts = await db.select({
    library_id: documents.library_id,
    count: sql<number>`cast(count(*) as int)`,
  }).from(documents).groupBy(documents.library_id);
  counts.forEach(c => console.log(` ${c.library_id}: ${c.count} docs`));

  // 3. Try a few full-text queries
  console.log('\n── FTS queries ─────────────────────────');
  const queries = process.argv.length > 2 ? process.argv.slice(2) : ['refund', 'order', 'payment', 'notification'];
  for (const q of queries) {
    try {
      const results = await searchDocs({ query: q, limit: 5 });
      console.log(` "${q}" → ${results.length} results`);
      results.slice(0, 3).forEach(r =>
        console.log(`   [${r.score.toFixed(4)}] ${r.library_id}.${r.slug} — ${r.summary ?? '—'}`)
      );
    } catch (e: any) {
      console.log(` "${q}" → ERROR: ${e.message}`);
    }
  }

  // 4. Inspect search_vector of a few documents
  console.log('\n── Sample search_vector values ─────────');
  const sample = await db.select({
    slug: documents.slug,
    library_id: documents.library_id,
    summary: documents.summary,
    vector: sql<string>`search_vector::text`,
  }).from(documents).limit(3);
  sample.forEach(d => {
    console.log(` ${d.library_id}.${d.slug}`);
    console.log(`   summary: ${d.summary ?? '—'}`);
    console.log(`   vector:  ${d.vector?.slice(0, 120)}...`);
  });
}

run().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
